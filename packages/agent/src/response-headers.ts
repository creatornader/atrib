// SPDX-License-Identifier: Apache-2.0

/**
 * Read response headers exposed by an MCP client wrapper.
 *
 * The MCP JSON-RPC result does not standardize raw HTTP headers. Client or
 * transport wrappers may expose them as `headers` or `responseHeaders`; when
 * they do, adapters pass the values to the payment detector.
 */
export function extractResponseHeaders(
  response: unknown,
): Record<string, string | undefined> | undefined {
  if (response === null || typeof response !== 'object') return undefined

  const record = response as Record<string, unknown>
  const candidates = [record['headers'], record['responseHeaders']]

  for (const candidate of candidates) {
    if (candidate === null || typeof candidate !== 'object') continue

    const headers: Record<string, string | undefined> = {}
    if (typeof (candidate as { forEach?: unknown }).forEach === 'function') {
      ;(candidate as { forEach(callback: (value: string, key: string) => void): void }).forEach(
        (value, key) => {
          headers[key] = value
        },
      )
    } else {
      for (const [key, value] of Object.entries(candidate)) {
        if (typeof value === 'string') headers[key] = value
      }
    }

    if (Object.keys(headers).length > 0) return headers
  }

  return undefined
}
