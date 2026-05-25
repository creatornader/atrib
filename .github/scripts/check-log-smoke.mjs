const maxTtfbMs = readPositiveInt('LOG_SMOKE_MAX_TTFB_MS', 3000)
const maxTotalMs = readPositiveInt('LOG_SMOKE_MAX_TOTAL_MS', 5000)
const timeoutMs = readPositiveInt('LOG_SMOKE_FETCH_TIMEOUT_MS', 10000)
const maxAttempts = readPositiveInt('LOG_SMOKE_ATTEMPTS', 3)
const retryDelayMs = readPositiveInt('LOG_SMOKE_RETRY_DELAY_MS', 2000)

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
    name: 'explorer',
    url: 'https://explore.atrib.dev/',
    validate(body) {
      if (!body.includes('<title>atrib explorer') || !body.includes('data-route="overview"')) {
        throw new Error('Explorer HTML did not contain the expected shell')
      }
    },
  },
]

const results = []

for (const endpoint of endpoints) {
  results.push(await checkEndpoint(endpoint))
}

console.log(
  `log smoke passed: max_ttfb=${maxTtfbMs}ms max_total=${maxTotalMs}ms attempts=${maxAttempts}`,
)
for (const result of results) {
  console.log(
    `${result.name}: status=${result.status} ttfb=${result.ttfbMs.toFixed(0)}ms total=${result.totalMs.toFixed(
      0,
    )}ms bytes=${result.bytes} attempt=${result.attempt}`,
  )
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
