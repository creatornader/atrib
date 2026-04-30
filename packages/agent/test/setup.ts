// Global vitest setup: refuse any test-time fetch that would hit a
// production atrib service. Without this guard, tests that exercise the
// middleware end-to-end (without passing a custom logEndpoint and without
// fully mocking fetch) silently submit signed records to log.atrib.dev,
// which clutters the public log and pollutes the explorer's identity view.
//
// See the 2026-04-30 audit for the bug that caused 83 leaked records under
// the deterministic fill(42) test seed: middleware tests defaulted to
// DEFAULT_LOG_ENDPOINT and the per-test fetch spies didn't catch
// async-queue retries that fired after spy restoration.
//
// This guard is fail-loud: any prod-targeted fetch throws synchronously so
// the offending test can't silently pass with leaked side effects.

const FORBIDDEN_HOSTS = [
  'log.atrib.dev',
  'graph.atrib.dev',
  'directory.atrib.dev',
  'explore.atrib.dev',
]

const realFetch = globalThis.fetch
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
  for (const host of FORBIDDEN_HOSTS) {
    if (url.includes(host)) {
      throw new Error(
        `[atrib test guard] refusing to fetch production endpoint ${url}. ` +
          `Tests must pass a localhost logEndpoint or fully mock fetch, see ` +
          `packages/mcp/test/setup.ts for the rationale.`,
      )
    }
  }
  return realFetch(input, init)
}) as typeof fetch
