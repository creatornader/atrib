import { createHash } from 'node:crypto'

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

if (scope !== 'assets') {
  for (const endpoint of endpoints) {
    results.push(await checkEndpoint(endpoint))
  }
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
for (const result of assetResults) {
  console.log(
    `${result.name}: hash=${result.hash} assets=${result.assets.map((asset) => `${asset.name}:${asset.status}`).join(',')}`,
  )
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
