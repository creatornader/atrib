// SPDX-License-Identifier: Apache-2.0

/**
 * content_id derivation (§1.2.2).
 *
 * content_id = "sha256:" + hex(SHA-256(UTF-8(normalizedServerUrl + ":" + toolName)))
 */

import { sha256, hexEncode } from './hash.js'

const encoder = new TextEncoder()

/**
 * Normalize a server URL per §1.2.2:
 * - Lowercase scheme and host
 * - Remove trailing slash from path
 * - Preserve port if explicitly specified
 * - Exclude query strings and fragments
 */
export function normalizeServerUrl(url: string): string {
  if (!url) return ''
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    // If URL is not parseable, return it as-is (lowercase).
    // This handles cases like empty strings or non-URL identifiers.
    return url.toLowerCase()
  }
  // URL constructor lowercases scheme and host automatically
  let normalized = `${parsed.protocol}//${parsed.host}${parsed.pathname}`
  // Remove trailing slash (unless path is just "/")
  if (normalized.endsWith('/') && parsed.pathname !== '/') {
    normalized = normalized.slice(0, -1)
  }
  // Handle root path: "https://example.com/" → "https://example.com"
  if (parsed.pathname === '/') {
    normalized = normalized.slice(0, -1)
  }
  return normalized
}

/**
 * Compute the content_id for a tool (§1.2.2).
 */
export function computeContentId(serverUrl: string, toolName: string): string {
  const normalized = normalizeServerUrl(serverUrl)
  const input = `${normalized}:${toolName}`
  const digest = sha256(encoder.encode(input))
  return `sha256:${hexEncode(digest)}`
}
