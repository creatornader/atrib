// Test isolation guard. Mirrors the @atrib/mcp + @atrib/agent test/setup.ts
// pattern: refuse any fetch to a production atrib endpoint during the test
// suite. Prevents test fixtures from leaking real submissions into the
// public log, which would corrupt audit-trail integrity for real records.
//
// Also clears harness-injected env vars so D083 harness discovery
// (CLAUDE_CODE_SESSION_ID) does not leak from the parent harness process
// (e.g. Claude Code running `vitest run`) into the env-default lookup
// path. Tests that want to exercise the env-driven path should set the
// relevant vars explicitly inside their describe/beforeEach.

import { beforeAll } from 'vitest'

delete process.env.CLAUDE_CODE_SESSION_ID
delete process.env.ATRIB_CONTEXT_ID

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
