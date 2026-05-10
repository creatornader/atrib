// Build + sign an attribution record for the agent's emit call. Reuses
// @atrib/mcp's signing primitives so emit-signed records are byte-identical
// in canonical form to wrapper-signed records — a verifier MUST NOT be
// able to distinguish "wrapper signed this" from "emit signed this."
//
// Per spec §1.2.2: content_id is a stable identifier for the *kind* of
// action, not the specific invocation. The wrapper derives it from
// server_url + tool_name; we use the synthetic pair (`mcp://atrib-emit` +
// leaf of event_type URI), so all observations share content_id, all
// annotations share content_id, etc. Per-emit distinctness comes from
// (creator_key, context_id, timestamp) — same as the wrapper.
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
  /**
   * Optional cross-session causal anchor (spec §1.2.6 / D044). Caller is
   * responsible for ensuring the genesis-record-only invariant holds; the
   * index.ts handler validates this before reaching here.
   */
  provenanceToken?: string | undefined
  /**
   * Optional annotates target per spec §1.2.7 / D058. Required when
   * eventType is the annotation URI; FORBIDDEN on any other event_type.
   * The index.ts handler enforces the require/forbid invariant before
   * reaching here. Format: "sha256:" + 64 lowercase hex.
   */
  annotates?: string | undefined
  /**
   * Optional revises target per spec §1.2.9 / D059. Required when
   * eventType is the revision URI; FORBIDDEN on any other event_type.
   * The index.ts handler enforces the require/forbid invariant before
   * reaching here. Format: "sha256:" + 64 lowercase hex.
   */
  revises?: string | undefined
  /**
   * Optional §8.2 tool_name disclosure. Lets emit-signed records carry the
   * verbatim or transformed tool name for downstream consumers (e.g.
   * `recall_my_attribution_history` filtering by tool_name). Pass through
   * unchanged: the caller picks the disclosure form (verbatim string,
   * opaque alias, or hashed). Absence indicates the §8.1 default posture
   * (no tool-name disclosure). Validators reject mixed structural forms;
   * see middleware.ts disclosure pipeline for canonical shapes.
   */
  toolName?: string | undefined
  /**
   * Optional §8.3 args_hash commitment. Lets emit-signed records carry a
   * commitment to canonical args bytes for downstream consumers (e.g.
   * `recall_my_attribution_history` filtering by args_hash, or replay
   * detection). Format: "sha256:" + 64 lowercase hex. Absence indicates
   * the §8.1 default posture (no args commitment surfaced). Salted vs
   * plain forms hash identically on the wire; the salt (when used) is
   * carried in the separate args_salt field which this signer does not
   * yet surface.
   */
  argsHash?: string | undefined
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
  // not empty) when no references are given — presence affects JCS.
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
    ...(input.annotates ? { annotates: input.annotates } : {}),
    ...(input.argsHash ? { args_hash: input.argsHash } : {}),
    ...(input.provenanceToken ? { provenance_token: input.provenanceToken } : {}),
    ...(input.revises ? { revises: input.revises } : {}),
    ...(input.toolName ? { tool_name: input.toolName } : {}),
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
