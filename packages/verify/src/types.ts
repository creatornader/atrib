// SPDX-License-Identifier: Apache-2.0

/**
 * Types for @atrib/verify. graph objects, policy documents,
 * and settlement recommendation documents.
 *
 * Mirrors §3.5 (graph response schema) and §4.7 (recommendation document).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Graph types. §3.5
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Graph-layer event_type. Short labels for the three primitives the v1
 * graph + calculation algorithm operate on, plus the catch-all `extension`
 * for records carrying an event_type URI not in atrib normative set
 * (extension URIs are graph nodes but are NOT participants in §3.2.4 edge
 * derivation in v1; see spec §3.2.1).
 *
 * Records arriving at the graph builder carry an absolute URI in
 * `record.event_type` per §1.2.4. The builder normalizes URIs to these
 * short labels via `graphLabelFromEventTypeUri()`. Extension URIs are
 * preserved verbatim on `GraphNode.event_type_uri` for graph clients that
 * want the original URI.
 */
export type EventType = 'tool_call' | 'transaction' | 'observation' | 'directory_anchor' | 'gap_node' | 'dangling_node' | 'extension'

/**
 * Map an attribution record's event_type URI to a graph-layer short label.
 * Atrib normative URIs map to their canonical short label; everything else
 * collapses to `'extension'` (the graph-layer opaque-typed category).
 */
export function graphLabelFromEventTypeUri(uri: string): EventType {
  switch (uri) {
    case 'https://atrib.dev/v1/types/tool_call':
      return 'tool_call'
    case 'https://atrib.dev/v1/types/transaction':
      return 'transaction'
    case 'https://atrib.dev/v1/types/observation':
      return 'observation'
    case 'https://atrib.dev/v1/types/directory_anchor':
      return 'directory_anchor'
    default:
      return 'extension'
  }
}

/** An unsigned hop: a tool call with no attribution record in response (§1.6, §3.2.5). */
export interface GapNode {
  type: 'gap_node'
  tool_url: string
  tool_name: string
  context_id: string
  timestamp: number
  signed: false
}

export type EdgeType =
  | 'CHAIN_PRECEDES'
  | 'SESSION_PRECEDES'
  | 'SESSION_PARALLEL'
  | 'CONVERGES_ON'
  | 'CROSS_SESSION'
  | 'INFORMED_BY'
  | 'PROVENANCE_OF'

export type VerificationState =
  | 'unsigned'
  | 'signature_valid'
  | 'log_committed'
  | 'witnessed'
  /**
   * Per spec §1.9.3: a record signed by a key that was retired before
   * the record's log_index. The signature is still cryptographically
   * valid, but the key was revoked at the moment of signing, so the
   * record MUST NOT contribute to attribution calculations (§4.6).
   * Verifiers carrying a revocation registry annotate records with this
   * state when (creator_key, log_index) falls after a key_revocation.
   */
  | 'revoked_after_revocation'

/** A node in the attribution graph (§3.5.2). */
export interface GraphNode {
  id: string
  event_type: EventType
  /**
   * The original event_type URI from the underlying record (§1.2.4), or
   * null for synthetic nodes (gap_node). Atrib normative URIs are present
   * as their canonical strings; extension URIs are preserved verbatim.
   * Graph clients that need to filter by URI rather than short label use
   * this field.
   */
  event_type_uri: string | null
  content_id: string | null
  creator_key: string | null
  chain_root: string | null
  context_id: string
  timestamp: number
  log_index: number | null
  verification_state: VerificationState
  is_genesis: boolean
}

/** An edge in the attribution graph (§3.5.3). */
export interface GraphEdge {
  type: EdgeType
  source: string
  target: string
  directed: boolean
  /**
   * True when the edge target is a synthetic dangling node, the agent's
   * declared informed_by or provenance_token reference did not resolve to a
   * record in the resolved set. Per spec §3.2.4 steps 6 + 7, dangling
   * references MUST be surfaced as edges (not silently dropped) so verifiers
   * can see what the agent claimed even when the upstream isn't accessible.
   * Only INFORMED_BY and PROVENANCE_OF edges can be dangling.
   */
  dangling?: boolean
  /**
   * Optional reason annotation. Currently used by PROVENANCE_OF dangling
   * edges with the value `"no_token_source_in_record_set"` per spec §3.2.4
   * step 7.
   */
  reason?: string
}

/** A graph response object (§3.5.1). */
export interface GraphResponse {
  spec_version: 'atrib/1.0'
  context_id: string
  generated_at: number
  node_count: number
  edge_count: number
  has_transaction: boolean
  cross_session_count: number
  nodes: GraphNode[]
  edges: GraphEdge[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Policy types. §4.2
// ─────────────────────────────────────────────────────────────────────────────

export type DistributionMethod = 'proportional' | 'equal' | 'weighted'

export interface EdgeWeights {
  CHAIN_PRECEDES?: number
  SESSION_PRECEDES?: number
  SESSION_PARALLEL?: number
  CONVERGES_ON?: number
  CROSS_SESSION?: number
  unsigned?: number
}

export type Modifier =
  | { type: 'temporal_decay'; half_life_ms: number }
  | { type: 'chain_depth_penalty'; penalty_per_level: number }
  | { type: 'call_count_boost'; multiplier_per_call: number; cap: number }
  | { type: string; [key: string]: unknown } // unknown modifiers ignored

export interface PolicyConstraints {
  minimum_share?: number
  maximum_share?: number
  minimum_own_share?: number
  maximum_total_share?: number
}

/** A policy document (§4.2). */
export interface PolicyDocument {
  spec_version: 'atrib/1.0'
  policy_id?: string
  role?: 'merchant' | 'creator' | 'default'
  edge_weights?: EdgeWeights
  modifiers?: Modifier[]
  distribution?: DistributionMethod
  constraints?: PolicyConstraints
}

/** Minimal policy shape for creator policy entries. Accepts any spec_version. */
export interface CreatorPolicySnapshot {
  spec_version: string
  constraints?: {
    minimum_share?: number
    maximum_share?: number
    minimum_own_share?: number
    maximum_total_share?: number
  }
  [key: string]: unknown
}

/** Creator policy entry in the session policy record (§4.5.3). */
export interface CreatorPolicyEntry {
  server_url: string
  policy_url: string
  status: 'compatible' | 'floor_scaled' | 'conflict_defaulted' | 'not_found'
  /** The fetched policy document snapshot, if available. */
  policy?: CreatorPolicySnapshot | undefined
}

/** Session policy record (§4.5.3). Full record as created by the agent. */
export interface SessionPolicyRecord {
  spec_version: 'atrib/1.0'
  record_id: string
  context_id: string
  created_at: number
  merchant_policy: string
  creator_policies: CreatorPolicyEntry[]
  agreed_policy: string
  applied_constraints: {
    minimum_floors: Record<string, number>
  }
  warnings: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Settlement recommendation document. §4.7.1
// ─────────────────────────────────────────────────────────────────────────────

/** A creator key → share fraction map. May contain "__unsigned__" sentinel. */
export type Distribution = Record<string, number>

export interface RecommendationDocument {
  spec_version: 'atrib/1.0'
  document_type: 'settlement_recommendation'
  context_id: string
  transaction_id: string
  policy_record_id: string
  graph_checkpoint: string
  graph_tree_size: number
  calculated_at: number
  calculated_by: string
  distribution: Distribution
  maximum_total_share: number | null
  warnings: string[]
  signature: string
}

/** Verification result for a recommendation document (§5.5.2). */
export interface VerificationResult {
  valid: boolean
  signatureOk: boolean
  calcMatch: boolean
  distribution: Distribution
  warnings: string[]
  graph_node_count: number
}
