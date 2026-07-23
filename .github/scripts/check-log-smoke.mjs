import { createHash, createPublicKey, verify } from 'node:crypto'

const maxTtfbMs = readPositiveInt('LOG_SMOKE_MAX_TTFB_MS', 3000)
const maxTotalMs = readPositiveInt('LOG_SMOKE_MAX_TOTAL_MS', 5000)
const timeoutMs = readPositiveInt('LOG_SMOKE_FETCH_TIMEOUT_MS', 10000)
const maxAttempts = readPositiveInt('LOG_SMOKE_ATTEMPTS', 3)
const retryDelayMs = readPositiveInt('LOG_SMOKE_RETRY_DELAY_MS', 2000)
const scope = readScope()

const endpoints = [
  {
    name: 'pubkey',
    url: 'https://atrib-log.fly.dev/v1/pubkey',
    validate(body) {
      const parsed = JSON.parse(body)
      if (parsed.origin !== 'log.atrib.dev/v1' || typeof parsed.public_key !== 'string') {
        throw new Error('Unexpected /v1/pubkey response')
      }
    },
  },
  {
    name: 'stats',
    url: 'https://log.atrib.dev/v1/stats',
    validate(body) {
      const parsed = JSON.parse(body)
      if (!Number.isInteger(parsed.tree_size) || parsed.tree_size < 1) {
        throw new Error('Unexpected /v1/stats tree_size')
      }
    },
  },
  {
    name: 'recent',
    url: 'https://log.atrib.dev/v1/recent?limit=25',
    validate(body) {
      const parsed = JSON.parse(body)
      if (!Number.isInteger(parsed.tree_size) || !Array.isArray(parsed.entries)) {
        throw new Error('Unexpected /v1/recent response')
      }
    },
  },
  {
    name: 'feed',
    url: 'https://log.atrib.dev/v1/feed.json?limit=5',
    validate(body) {
      const parsed = JSON.parse(body)
      if (parsed.version !== 'https://jsonfeed.org/version/1.1' || !Array.isArray(parsed.items)) {
        throw new Error('Unexpected /v1/feed.json response')
      }
    },
  },
  {
    name: 'explorer',
    url: 'https://explore.atrib.dev/',
    validate(body) {
      if (!body.includes('<title>atrib explorer') || !body.includes('data-route="overview"')) {
        throw new Error('Explorer HTML did not contain the expected shell')
      }
    },
  },
]

const assetGroups = [
  {
    name: 'favicon-parity',
    expectedContentTypes: ['image/x-icon', 'image/vnd.microsoft.icon'],
    assets: [
      { name: 'marketing', url: 'https://atrib.dev/favicon.ico' },
      { name: 'explorer-root', url: 'https://explore.atrib.dev/favicon.ico' },
      { name: 'explorer-static', url: 'https://explore.atrib.dev/static/favicon.ico' },
    ],
  },
  {
    name: 'touch-icon-parity',
    expectedContentTypes: ['image/png'],
    assets: [
      { name: 'marketing', url: 'https://atrib.dev/apple-touch-icon.png' },
      { name: 'explorer-static', url: 'https://explore.atrib.dev/static/apple-touch-icon.png' },
    ],
  },
  {
    name: 'opengraph-parity',
    expectedContentTypes: ['image/png'],
    assets: [
      { name: 'marketing', url: 'https://atrib.dev/opengraph-image.png' },
      { name: 'cdn', url: 'https://cdn.atrib.dev/opengraph-image.png' },
      { name: 'explorer-static', url: 'https://explore.atrib.dev/static/opengraph-image.png' },
    ],
  },
]

const results = []
let verificationResult

if (scope !== 'assets') {
  for (const endpoint of endpoints) {
    results.push(await checkEndpoint(endpoint))
  }
  verificationResult = await checkVerificationContract()
}

const assetResults = []
if (scope !== 'health') {
  for (const group of assetGroups) {
    assetResults.push(await checkAssetParity(group))
  }
}

console.log(
  `log smoke passed: scope=${scope} max_ttfb=${maxTtfbMs}ms max_total=${maxTotalMs}ms attempts=${maxAttempts}`,
)
for (const result of results) {
  console.log(
    `${result.name}: status=${result.status} ttfb=${result.ttfbMs.toFixed(0)}ms total=${result.totalMs.toFixed(
      0,
    )}ms bytes=${result.bytes} attempt=${result.attempt}`,
  )
}
if (verificationResult) {
  console.log(
    `verification-contract: checkpoint_size=${verificationResult.checkpointTreeSize} ` +
      `entry=${verificationResult.logIndex} tile=${verificationResult.tilePath} ` +
      `width=${verificationResult.tileWidth} proof_nodes=${verificationResult.proofNodes}`,
  )
}
for (const result of assetResults) {
  console.log(
    `${result.name}: hash=${result.hash} assets=${result.assets.map((asset) => `${asset.name}:${asset.status}`).join(',')}`,
  )
}

async function checkVerificationContract() {
  const [pubkeyArtifact, checkpointArtifact, recentArtifact] = await Promise.all([
    fetchContractArtifact('verification-pubkey', 'https://log.atrib.dev/v1/pubkey'),
    fetchContractArtifact('verification-checkpoint', 'https://log.atrib.dev/v1/checkpoint'),
    fetchContractArtifact('verification-recent', 'https://log.atrib.dev/v1/recent?limit=1'),
  ])

  const pubkey = JSON.parse(pubkeyArtifact.bytes.toString('utf8'))
  const checkpoint = parseAndVerifyCheckpoint(checkpointArtifact.bytes.toString('utf8'), pubkey)
  const recent = JSON.parse(recentArtifact.bytes.toString('utf8'))
  const latest = recent.entries?.[0]
  if (
    !latest ||
    !Number.isInteger(latest.index) ||
    typeof latest.record_hash !== 'string' ||
    !/^sha256:[0-9a-f]{64}$/.test(latest.record_hash)
  ) {
    throw new Error('verification-recent did not return a usable latest entry')
  }

  const recordHash = latest.record_hash.slice('sha256:'.length)
  const proofArtifact = await fetchContractArtifact(
    'verification-proof',
    `https://log.atrib.dev/v1/proof/${recordHash}`,
  )
  const proof = JSON.parse(proofArtifact.bytes.toString('utf8'))
  if (
    proof.log_index !== latest.index ||
    !Array.isArray(proof.inclusion_proof) ||
    typeof proof.leaf_hash !== 'string'
  ) {
    throw new Error('verification-proof did not bind the latest entry to an inclusion proof')
  }

  const tileIndex = Math.floor(latest.index / 256)
  const tileWidth = (latest.index % 256) + 1
  const encodedIndex = encodeTileIndex(tileIndex)
  const tilePath = tileWidth === 256 ? encodedIndex : `${encodedIndex}.p/${tileWidth}`
  const [hashTileArtifact, entryTileArtifact] = await Promise.all([
    fetchContractArtifact('verification-hash-tile', `https://log.atrib.dev/v1/tile/0/${tilePath}`),
    fetchContractArtifact(
      'verification-entry-tile',
      `https://log.atrib.dev/v1/tile/entries/${tilePath}`,
    ),
  ])

  if (hashTileArtifact.bytes.length !== tileWidth * 32) {
    throw new Error(
      `verification-hash-tile returned ${hashTileArtifact.bytes.length} bytes for width ${tileWidth}`,
    )
  }
  if (entryTileArtifact.bytes.length !== tileWidth * 92) {
    throw new Error(
      `verification-entry-tile returned ${entryTileArtifact.bytes.length} bytes for width ${tileWidth}`,
    )
  }
  requireImmutableCache('verification-hash-tile', hashTileArtifact.response)
  requireImmutableCache('verification-entry-tile', entryTileArtifact.response)

  const entryOffset = (tileWidth - 1) * 92
  const entryLength = entryTileArtifact.bytes.readUInt16BE(entryOffset)
  if (entryLength !== 90) {
    throw new Error(`verification-entry-tile encoded an unexpected entry length ${entryLength}`)
  }
  const entryBytes = entryTileArtifact.bytes.subarray(
    entryOffset + 2,
    entryOffset + 2 + entryLength,
  )
  const computedLeafHash = createHash('sha256')
    .update(Buffer.from([0]))
    .update(entryBytes)
    .digest()
  const tileLeafHash = hashTileArtifact.bytes.subarray((tileWidth - 1) * 32, tileWidth * 32)
  const proofLeafHash = Buffer.from(proof.leaf_hash, 'base64')
  if (!computedLeafHash.equals(tileLeafHash) || !computedLeafHash.equals(proofLeafHash)) {
    throw new Error('verification artifacts disagree on the latest entry leaf hash')
  }

  return {
    checkpointTreeSize: checkpoint.treeSize,
    logIndex: latest.index,
    tilePath,
    tileWidth,
    proofNodes: proof.inclusion_proof.length,
  }
}

function parseAndVerifyCheckpoint(note, pubkey) {
  if (
    pubkey.origin !== 'log.atrib.dev/v1' ||
    pubkey.algorithm !== 'Ed25519' ||
    typeof pubkey.public_key !== 'string' ||
    !/^[0-9a-f]{8}$/.test(pubkey.key_id)
  ) {
    throw new Error('verification-pubkey returned an unsupported key description')
  }

  const separator = note.indexOf('\n\n')
  if (separator < 0) {
    throw new Error('verification-checkpoint omitted the signed-note separator')
  }
  const body = note.slice(0, separator + 1)
  const signatureLine = note.slice(separator + 2).trim()
  const signatureMatch = signatureLine.match(/^[—-] (\S+) (\S+)$/)
  if (!signatureMatch) {
    throw new Error('verification-checkpoint contained a malformed signature line')
  }

  const [origin, treeSizeText, rootHash] = body.trimEnd().split('\n')
  if (
    origin !== pubkey.origin ||
    !/^[1-9]\d*$/.test(treeSizeText) ||
    Buffer.from(rootHash, 'base64').length !== 32 ||
    signatureMatch[1] !== pubkey.origin
  ) {
    throw new Error('verification-checkpoint body did not match the published log identity')
  }

  const signed = Buffer.from(signatureMatch[2], 'base64')
  if (signed.length !== 68 || signed.subarray(0, 4).toString('hex') !== pubkey.key_id) {
    throw new Error('verification-checkpoint key ID did not match /v1/pubkey')
  }
  const rawPublicKey = Buffer.from(pubkey.public_key, 'base64url')
  if (rawPublicKey.length !== 32) {
    throw new Error('verification-pubkey did not contain a 32-byte Ed25519 public key')
  }
  const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), rawPublicKey])
  const publicKey = createPublicKey({ key: spki, format: 'der', type: 'spki' })
  if (!verify(null, Buffer.from(body), publicKey, signed.subarray(4))) {
    throw new Error('verification-checkpoint signature verification failed')
  }

  return { treeSize: Number(treeSizeText), rootHash }
}

function encodeTileIndex(index) {
  const padded = String(index).padStart(Math.ceil(String(index).length / 3) * 3, '0')
  const groups = padded.match(/.{3}/g)
  if (groups.length === 1) return groups[0]
  return groups
    .map((group, position) => (position < groups.length - 1 ? `x${group}` : group))
    .join('/')
}

function requireImmutableCache(name, response) {
  const cacheControl = response.headers.get('cache-control') || ''
  if (!cacheControl.includes('immutable')) {
    throw new Error(`${name} did not return an immutable cache policy`)
  }
}

async function fetchContractArtifact(name, url) {
  let lastError
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    const started = performance.now()
    try {
      const response = await fetch(url, { signal: controller.signal })
      const headersAt = performance.now()
      const bytes = Buffer.from(await response.arrayBuffer())
      const completed = performance.now()
      if (!response.ok) {
        throw new Error(`${name} returned HTTP ${response.status}`)
      }
      const ttfbMs = headersAt - started
      const totalMs = completed - started
      if (ttfbMs > maxTtfbMs) {
        throw new Error(`${name} TTFB ${ttfbMs.toFixed(0)}ms exceeded ${maxTtfbMs}ms`)
      }
      if (totalMs > maxTotalMs) {
        throw new Error(`${name} total ${totalMs.toFixed(0)}ms exceeded ${maxTotalMs}ms`)
      }
      return { bytes, response, attempt }
    } catch (error) {
      lastError = error
      if (attempt === maxAttempts) break
      console.warn(`${name} attempt ${attempt} failed: ${error.message}; retrying`)
      await sleep(retryDelayMs)
    } finally {
      clearTimeout(timeout)
    }
  }
  throw lastError
}

async function checkAssetParity(group) {
  const assets = []
  for (const asset of group.assets) {
    assets.push(await checkAssetEndpoint(asset, group.expectedContentTypes))
  }

  const [first, ...rest] = assets
  const mismatched = rest.find((asset) => asset.hash !== first.hash)
  if (mismatched) {
    throw new Error(
      `${group.name} hash mismatch: ${first.name}=${first.hash} ${mismatched.name}=${mismatched.hash}`,
    )
  }

  return { name: group.name, hash: first.hash, assets }
}

async function checkAssetEndpoint(asset, expectedContentTypes) {
  let lastError
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await checkAssetEndpointOnce(asset, expectedContentTypes, attempt)
    } catch (error) {
      lastError = error
      if (attempt === maxAttempts) break
      console.warn(`${asset.name} asset attempt ${attempt} failed: ${error.message}; retrying`)
      await sleep(retryDelayMs)
    }
  }
  throw lastError
}

async function checkAssetEndpointOnce(asset, expectedContentTypes, attempt) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const started = performance.now()

  try {
    const response = await fetch(asset.url, { signal: controller.signal })
    const headersAt = performance.now()
    const bytes = Buffer.from(await response.arrayBuffer())
    const completed = performance.now()

    const ttfbMs = headersAt - started
    const totalMs = completed - started

    if (!response.ok) {
      throw new Error(`${asset.name} returned HTTP ${response.status}`)
    }

    if (ttfbMs > maxTtfbMs) {
      throw new Error(`${asset.name} TTFB ${ttfbMs.toFixed(0)}ms exceeded ${maxTtfbMs}ms`)
    }

    if (totalMs > maxTotalMs) {
      throw new Error(`${asset.name} total ${totalMs.toFixed(0)}ms exceeded ${maxTotalMs}ms`)
    }

    const contentType = response.headers.get('content-type') || ''
    if (!expectedContentTypes.some((expected) => contentType.includes(expected))) {
      throw new Error(
        `${asset.name} content-type ${contentType || '<none>'} did not include ${expectedContentTypes.join(
          ' or ',
        )} (${asset.url}; ${formatResponseDiagnostics(response)})`,
      )
    }

    return {
      name: asset.name,
      status: response.status,
      hash: createHash('sha256').update(bytes).digest('hex'),
      ttfbMs,
      totalMs,
      bytes: bytes.length,
      attempt,
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function checkEndpoint(endpoint) {
  let lastError
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await checkEndpointOnce(endpoint, attempt)
    } catch (error) {
      lastError = error
      if (attempt === maxAttempts) break
      console.warn(`${endpoint.name} attempt ${attempt} failed: ${error.message}; retrying`)
      await sleep(retryDelayMs)
    }
  }
  throw lastError
}

async function checkEndpointOnce(endpoint, attempt) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const started = performance.now()

  try {
    const response = await fetch(endpoint.url, { signal: controller.signal })
    const headersAt = performance.now()
    const body = await response.text()
    const completed = performance.now()

    const ttfbMs = headersAt - started
    const totalMs = completed - started

    if (!response.ok) {
      throw new Error(`${endpoint.name} returned HTTP ${response.status}`)
    }

    if (ttfbMs > maxTtfbMs) {
      throw new Error(`${endpoint.name} TTFB ${ttfbMs.toFixed(0)}ms exceeded ${maxTtfbMs}ms`)
    }

    if (totalMs > maxTotalMs) {
      throw new Error(`${endpoint.name} total ${totalMs.toFixed(0)}ms exceeded ${maxTotalMs}ms`)
    }

    endpoint.validate(body)

    return {
      name: endpoint.name,
      status: response.status,
      ttfbMs,
      totalMs,
      bytes: Buffer.byteLength(body),
      attempt,
    }
  } finally {
    clearTimeout(timeout)
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function readPositiveInt(name, fallback) {
  const value = process.env[name]
  if (value === undefined || value === '') {
    return fallback
  }

  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }

  return parsed
}

function readScope() {
  const value = process.env.LOG_SMOKE_SCOPE ?? 'all'
  if (value === 'all' || value === 'health' || value === 'assets') {
    return value
  }

  throw new Error('LOG_SMOKE_SCOPE must be all, health, or assets')
}

function formatResponseDiagnostics(response) {
  return [
    `cache-control=${response.headers.get('cache-control') || '<none>'}`,
    `cf-cache-status=${response.headers.get('cf-cache-status') || '<none>'}`,
    `fly-request-id=${response.headers.get('fly-request-id') || '<none>'}`,
  ].join(' ')
}
