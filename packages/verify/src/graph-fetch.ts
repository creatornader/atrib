// SPDX-License-Identifier: Apache-2.0

/**
 * HTTP fetcher for graph snapshots and session policy records.
 * Thin wrapper used by AtribVerifier.verify() / .calculate().
 */

import type { GraphResponse, SessionPolicyRecord, PolicyDocument } from './types.js'

const DEFAULT_TIMEOUT_MS = 10_000

/**
 * Fetch a graph snapshot for a context_id at a specific tree size (§3.4.1).
 *
 * @param graphEndpoint — base URL, e.g. "https://graph.atrib.io/v1"
 * @param contextId
 * @param treeSize — optional; if provided, pins the graph to that log tree size
 */
export async function fetchGraph(
  graphEndpoint: string,
  contextId: string,
  treeSize?: number,
): Promise<GraphResponse> {
  const params = new URLSearchParams({
    include_gap_nodes: 'true',
    include_cross_session: 'true',
  })
  if (treeSize !== undefined) params.set('tree_size', String(treeSize))
  const url = `${graphEndpoint.replace(/\/$/, '')}/graph/${contextId}?${params.toString()}`
  const res = await fetchWithTimeout(url)
  if (!res.ok) {
    throw new Error(`fetchGraph failed: ${res.status} ${res.statusText}`)
  }
  return (await res.json()) as GraphResponse
}

/**
 * Fetch a session policy record by its record_id (§4.5.3).
 */
export async function fetchSessionPolicyRecord(
  graphEndpoint: string,
  recordId: string,
): Promise<SessionPolicyRecord> {
  const url = `${graphEndpoint.replace(/\/$/, '')}/policy-records/${encodeURIComponent(recordId)}`
  const res = await fetchWithTimeout(url)
  if (!res.ok) {
    throw new Error(`fetchSessionPolicyRecord failed: ${res.status} ${res.statusText}`)
  }
  return (await res.json()) as SessionPolicyRecord
}

/**
 * Fetch a policy document by URL (§4.4).
 */
export async function fetchPolicyDocument(url: string): Promise<PolicyDocument> {
  // Validate URL scheme to prevent SSRF via crafted agreed_policy URLs
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:') {
    throw new Error(`fetchPolicyDocument: only https: URLs are allowed, got ${parsed.protocol}`)
  }
  const res = await fetchWithTimeout(url)
  if (!res.ok) {
    throw new Error(`fetchPolicyDocument failed: ${res.status} ${res.statusText}`)
  }
  return (await res.json()) as PolicyDocument
}

async function fetchWithTimeout(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}
