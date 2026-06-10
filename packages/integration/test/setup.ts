// SPDX-License-Identifier: Apache-2.0

// Integration tests exercise the broadest example surface in the repo, so they
// must fail loudly if a test accidentally reaches the production atrib services.
// Live proof scripts that intentionally write to log.atrib.dev or archive.atrib.dev
// run outside Vitest and document that behavior in the example README.

const FORBIDDEN_HOSTS = [
  'archive.atrib.dev',
  'directory.atrib.dev',
  'explore.atrib.dev',
  'graph.atrib.dev',
  'log.atrib.dev',
]

const realFetch = globalThis.fetch

globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : (input as Request).url

  for (const host of FORBIDDEN_HOSTS) {
    if (url.includes(host)) {
      throw new Error(
        `[atrib integration test guard] refusing to fetch production endpoint ${url}. ` +
          `Tests must pass localhost endpoints or fully mock fetch.`,
      )
    }
  }

  return realFetch(input, init)
}) as typeof fetch
