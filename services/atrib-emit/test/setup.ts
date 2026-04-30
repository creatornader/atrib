// Test isolation guard. Mirrors the @atrib/mcp + @atrib/agent test/setup.ts
// pattern: refuse any fetch to a production atrib endpoint during the test
// suite. A test fixture leaking real submissions to log.atrib.dev is exactly
// what produced the GX9rI mystery key incident in the production log.

import { beforeAll } from 'vitest'

const FORBIDDEN_HOSTS = [
  'log.atrib.dev',
  'graph.atrib.dev',
  'directory.atrib.dev',
  'explore.atrib.dev',
]

beforeAll(() => {
  const realFetch = globalThis.fetch
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    for (const host of FORBIDDEN_HOSTS) {
      if (url.includes(host)) {
        throw new Error(`[atrib-emit test guard] refusing to fetch production endpoint ${url}.`)
      }
    }
    return realFetch(input, init)
  }) as typeof fetch
})
