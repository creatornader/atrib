// Build + sign an attribution record for the agent's emit call. Reuses
// @atrib/mcp's signing primitives so emit-signed records are byte-identical
// in canonical form to wrapper-signed records, a verifier MUST NOT be
// able to distinguish "wrapper signed this" from "emit signed this."
//
// Per spec §1.2.2: content_id is a stable identifier for the *kind* of
// action, not the specific invocation. The wrapper derives it from
// server_url + tool_name; we use the synthetic pair (`mcp://atrib-emit` +
// leaf of event_type URI), so all observations share content_id, all
// annotations share content_id, etc. Per-emit distinctness comes from
// (creator_key, context_id, timestamp), same as the wrapper.
//
// The `content` argument never lands on-chain; the log stores commitments
// only per spec §2.10. Full content lives in the local JSONL mirror for
// the agent's own recall.

import {
  computeContentId,
  getPublicKey,
  signRecord,
  base64urlEncode,
  type AtribRecord,
} from '@atrib/mcp'

const SYNTHETIC_SERVER_URL = 'mcp://atrib-emit'

export interface BuildEmitRecordInput {
  privateKey: Uint8Array
  eventType: string
  contextId: string
  chainRoot: string
  /** Cognitive content. Used only for content_id derivation context; full content lives in the mirror. */
  content: Record<string, unknown>
  informedBy?: string[] | undefined
}

/**
 * Build, sign, and return a complete AtribRecord ready for submission.
 * Pure aside from the signing primitive itself; no network I/O here.
 */
export async function buildAndSignEmitRecord(
  input: BuildEmitRecordInput,
): Promise<AtribRecord> {
  const publicKey = base64urlEncode(await getPublicKey(input.privateKey))
  const toolName = leafOfEventTypeUri(input.eventType)
  const contentId = computeContentId(SYNTHETIC_SERVER_URL, toolName)

  // informed_by must be sorted lexicographically per §1.2.5 to keep the
  // canonical form stable across emitters. Omitted entirely (not null,
  // not empty) when no references are given, presence affects JCS.
  const informedBySorted =
    input.informedBy && input.informedBy.length > 0
      ? [...input.informedBy].sort()
      : undefined

  const record: AtribRecord = {
    spec_version: 'atrib/1.0',
    content_id: contentId,
    creator_key: publicKey,
    chain_root: input.chainRoot,
    event_type: input.eventType,
    context_id: input.contextId,
    timestamp: Date.now(),
    signature: '',
    ...(informedBySorted ? { informed_by: informedBySorted } : {}),
  } as AtribRecord

  return signRecord(record, input.privateKey)
}

/**
 * Best-effort URI leaf extraction. For atrib-namespace URIs returns the
 * trailing path segment (e.g. 'observation', 'annotation'); for extension
 * URIs returns the URI itself.
 */
function leafOfEventTypeUri(uri: string): string {
  const slashIdx = uri.lastIndexOf('/')
  if (slashIdx === -1) return uri
  const leaf = uri.slice(slashIdx + 1)
  return leaf.length > 0 ? leaf : uri
}

export const __test_only__ = { leafOfEventTypeUri }
