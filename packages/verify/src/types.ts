// SPDX-License-Identifier: Apache-2.0

/**
 * Types for @atrib/verify — graph objects, policy documents,
 * and settlement recommendation documents.
 *
 * Mirrors §3.5 (graph response schema) and §4.7 (recommendation document).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Graph types — §3.5
// ─────────────────────────────────────────────────────────────────────────────

export type EventType = 'tool_call' | 'transaction' | 'gap_node'

export type EdgeType =
  | 'CHAIN_PRECEDES'
  | 'SESSION_PRECEDES'
  | 'SESSION_PARALLEL'
  | 'CONVERGES_ON'
  | 'CROSS_SESSION'

export type VerificationState = 'unsigned' | 'signature_valid' | 'log_committed' | 'witnessed'

/** A node in the attribution graph (§3.5.2). */
export interface GraphNode {
  id: string
  event_type: EventType
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
// Policy types — §4.2
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

/** Session policy record (§4.5.3) — minimal shape needed for calculation. */
export interface SessionPolicyRecord {
  spec_version: 'atrib/1.0'
  record_id: string
  context_id: string
  agreed_policy: string
  applied_constraints: {
    minimum_floors: Record<string, number>
  }
  warnings: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Settlement recommendation document — §4.7.1
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
