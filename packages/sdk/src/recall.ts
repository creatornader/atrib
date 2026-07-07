// SPDX-License-Identifier: Apache-2.0

/**
 * recall(): the SDK's single read verb.
 *
 * Collapses the read primitives under one query shape with a `shape`
 * discriminator (redesign upgrade-path step 6). The daemon path maps each
 * shape to the corresponding primitives-runtime tool; the in-process
 * fallback covers the shapes whose engines are exported as libraries
 * today ('history' via @atrib/recall's recall(), 'verify' via
 * @atrib/verify-mcp's handleAtribVerify()). Shapes without an exported
 * engine degrade to a warning outcome when no daemon is reachable —
 * honestly, rather than via a divergent reimplementation.
 *
 * Summarize is deliberately NOT a shape: synthesis belongs to the calling
 * harness/model. The SDK returns verified raw material.
 */

export type RecallShape =
  | 'history'
  | 'walk'
  | 'annotations'
  | 'revisions'
  | 'by_content'
  | 'session_chain'
  | 'orphans'
  | 'by_signer'
  | 'trace'
  | 'trace_forward'
  | 'verify'

export interface HistoryQuery {
  shape?: 'history'
  context_id?: string
  context_scope?: 'all' | 'env'
  creator_key?: string
  event_type?: string
  content_id?: string
  tool_name?: string
  args_hash?: string
  min_importance?: 'critical' | 'high' | 'medium' | 'low' | 'noise'
  topic_tags?: string[]
  include_revised?: boolean
  min_signers?: number
  rank_by?: 'timestamp' | 'relevance' | 'causal_distance'
  rank_anchor?: string
  toc?: boolean
  limit?: number
  offset?: number
  compact?: boolean
  include_unverified?: boolean
}

export interface WalkQuery {
  shape: 'walk'
  from_record_hash: string
  edge_types?: Array<'CHAIN_PRECEDES' | 'INFORMED_BY' | 'ANNOTATES' | 'REVISES'>
  depth?: number
}

export interface AnnotationsQuery {
  shape: 'annotations'
  record_hash: string
}

export interface RevisionsQuery {
  shape: 'revisions'
  record_hash: string
}

export interface ByContentQuery {
  shape: 'by_content'
  query: string
  k?: number
  max_records?: number
  evidence_mode?: 'bounded' | 'require_complete'
}

export interface SessionChainQuery {
  shape: 'session_chain'
  context_id?: string
  limit?: number
  include_content?: boolean
}

export interface OrphansQuery {
  shape: 'orphans'
  context_id?: string
  event_type?: string
  creator_key?: string
  limit?: number
}

export interface BySignerQuery {
  shape: 'by_signer'
  min_records?: number
}

export interface TraceQuery {
  shape: 'trace' | 'trace_forward'
  record_hash: string
  context_id?: string
  depth?: number
  max_nodes?: number
  compact?: boolean
  include_content?: boolean
}

/** Pattern 3 handoff-claim verification (D105/D106) via @atrib/verify-mcp. */
export interface VerifyQuery {
  shape: 'verify'
  packet?: unknown
  records?: unknown
  claims?: unknown
  required_record_hashes?: string[]
  trusted_creator_keys?: string[]
  allowed_context_ids?: string[]
  require_body?: boolean
  require_body_commitment?: boolean
  require_log_inclusion?: boolean
  log_public_key_b64?: string
  now_ms?: number
  max_age_ms?: number
}

export type RecallQuery =
  | HistoryQuery
  | WalkQuery
  | AnnotationsQuery
  | RevisionsQuery
  | ByContentQuery
  | SessionChainQuery
  | OrphansQuery
  | BySignerQuery
  | TraceQuery
  | VerifyQuery

export interface RecallOutcome<T = unknown> {
  shape: RecallShape
  /** Which path served the read. 'none' = degraded, see warnings. */
  via: 'daemon' | 'in-process' | 'none'
  data: T | null
  warnings: string[]
  /**
   * `dev.atrib/attribution` receipt from the daemon result's `_meta`,
   * present only when `attributionReceipts` is enabled and the daemon
   * emitted one (D141): the parsed block plus its
   * `verifyAttributionReceipt` outcome. Advisory; trust derives from
   * verifying signed records.
   */
  attribution_receipt?: import('./attribution.js').VerifiedAttributionReceipt
}

/** Physical tool name on the primitives runtime for each shape. */
export const SHAPE_TO_TOOL: Record<RecallShape, string> = {
  history: 'recall_my_attribution_history',
  walk: 'recall_walk',
  annotations: 'recall_annotations',
  revisions: 'recall_revisions',
  by_content: 'recall_by_content',
  session_chain: 'recall_session_chain',
  orphans: 'recall_orphans',
  by_signer: 'recall_by_signer',
  trace: 'trace',
  trace_forward: 'trace_forward',
  verify: 'atrib-verify',
}

export function shapeOf(query: RecallQuery): RecallShape {
  return query.shape ?? 'history'
}

/** Strip the SDK-only `shape` discriminator; the rest passes through. */
export function toToolArgs(query: RecallQuery): Record<string, unknown> {
  const { shape: _shape, ...args } = query as { shape?: RecallShape } & Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(args)) {
    if (value !== undefined) out[key] = value
  }
  return out
}
