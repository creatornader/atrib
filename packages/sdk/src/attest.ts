// SPDX-License-Identifier: Apache-2.0

/**
 * attest(): the SDK's single write verb.
 *
 * Collapses emit / annotate / revise under one input shape with an
 * optional `ref` discriminator (redesign upgrade-path step 6). All three
 * routes produce records byte-identical to the existing producers because
 * every path terminates in the same `handleEmit` pipeline:
 *
 *   daemon path      → tools/call 'emit' on the primitives runtime
 *                      (the mounted @atrib/emit server; daemon-owned key)
 *   in-process path  → emitInProcess() from @atrib/emit (caller-owned key)
 *
 * There is deliberately no third signing implementation.
 */

import type { ProofBundle } from '@atrib/mcp'
import type { VerifiedAttributionReceipt } from './attribution.js'

/**
 * The client's resolved D138 anchor posture (§2.11.12), surfaced on
 * in-process attest results. `warned` is true exactly when the config is
 * sub-plurality without `allowSingleAnchor` (rule 4) — the case where the
 * fan-out also produced the §5.9.3 sidecar degradation marker.
 */
export interface AttestAnchorPosture {
  effective_anchor_count: number
  used_default_set: boolean
  warned: boolean
}

/** Reference discriminator collapsing the annotate/revise write kinds. */
export interface AttestRef {
  kind: 'annotates' | 'revises'
  record_hash: string
}

export interface AttestInput {
  /**
   * The content being attested. Committed via default args_hash
   * (sha256 of JCS(content)) per D099; full content stays in the local
   * mirror sidecar.
   */
  content: Record<string, unknown>
  /**
   * Event type short name ('observation', 'annotation', …) or absolute
   * URI. Default 'observation', or derived from `ref.kind` when a ref is
   * present ('annotates' → annotation, 'revises' → revision).
   */
  event_type?: string
  /** Collapsed annotate/revise reference (sets annotates/revises field). */
  ref?: AttestRef
  /** sha256:<64-hex> refs of records this one was informed by. */
  informed_by?: string[]
  /** Keep deliberately dangling informed_by refs (D113 opt-in). */
  allow_unresolved_informed_by?: boolean
  /** Explicit context_id (32 lowercase hex). */
  context_id?: string
  /** Explicit chain_root override (requires context_id). */
  chain_root?: string
  /** §1.2.6 cross-session anchor (genesis-only, 22-char base64url). */
  provenance_token?: string
  /** §8.2 tool-name disclosure. */
  tool_name?: string
  /** Explicit §8.3 args commitment (overrides the D099 default). */
  args_hash?: string
  /** Explicit §8.3 result commitment. */
  result_hash?: string
}

export interface AttestResult {
  /** `sha256:<64-hex>` of the signed record, or null when nothing signed. */
  record_hash: string | null
  context_id: string | null
  log_index: number | null
  inclusion_proof: ProofBundle['inclusion_proof'] | null
  receipt_id?: string
  /** Which path produced the record. 'none' = degraded, see warnings. */
  via: 'daemon' | 'in-process' | 'none'
  warnings: string[]
  /**
   * `dev.atrib/attribution` receipt from the daemon result's `_meta`,
   * present only when `attributionReceipts` is enabled and the daemon
   * emitted one (D141): the parsed block plus its
   * `verifyAttributionReceipt` outcome. Advisory; trust derives from
   * verifying signed records.
   */
  attribution_receipt?: VerifiedAttributionReceipt
  /**
   * D138 anchor posture of the client's fan-out (§2.11.12), present on
   * in-process results after anchor fan-out was consulted. The daemon
   * path never carries it: the daemon owns its own anchors.
   */
  anchor_posture?: AttestAnchorPosture
}

const REF_EVENT_TYPE: Record<AttestRef['kind'], string> = {
  annotates: 'annotation',
  revises: 'revision',
}

/**
 * Map AttestInput to the EmitInput argument shape shared by the daemon's
 * `emit` tool and `emitInProcess`. Throws TypeError on contradictory input
 * (the only throw path of the write verb — operational failures degrade).
 */
export function buildEmitArgs(
  input: AttestInput,
  defaultContextId?: string,
): Record<string, unknown> {
  const ref = input.ref
  let eventType = input.event_type
  if (ref) {
    const derived = REF_EVENT_TYPE[ref.kind]
    if (derived === undefined) {
      throw new TypeError(`atrib: unknown attest ref kind: ${String((ref as AttestRef).kind)}`)
    }
    if (eventType !== undefined && eventType !== derived && !eventType.endsWith(`/${derived}`)) {
      throw new TypeError(
        `atrib: attest ref kind '${ref.kind}' requires event_type '${derived}', got '${eventType}'`,
      )
    }
    eventType = eventType ?? derived
  }
  const contextId = input.context_id ?? defaultContextId
  return {
    event_type: eventType ?? 'observation',
    content: input.content,
    ...(contextId !== undefined ? { context_id: contextId } : {}),
    ...(ref?.kind === 'annotates' ? { annotates: ref.record_hash } : {}),
    ...(ref?.kind === 'revises' ? { revises: ref.record_hash } : {}),
    ...(input.informed_by !== undefined ? { informed_by: input.informed_by } : {}),
    ...(input.allow_unresolved_informed_by !== undefined
      ? { allow_unresolved_informed_by: input.allow_unresolved_informed_by }
      : {}),
    ...(input.chain_root !== undefined ? { chain_root: input.chain_root } : {}),
    ...(input.provenance_token !== undefined
      ? { provenance_token: input.provenance_token }
      : {}),
    ...(input.tool_name !== undefined ? { tool_name: input.tool_name } : {}),
    ...(input.args_hash !== undefined ? { args_hash: input.args_hash } : {}),
    ...(input.result_hash !== undefined ? { result_hash: input.result_hash } : {}),
  }
}

/** Shape of the daemon `emit` tool's JSON result (EmitOutput). */
export interface EmitOutputLike {
  record_hash?: unknown
  log_index?: unknown
  inclusion_proof?: unknown
  context_id?: unknown
  receipt_id?: unknown
  warnings?: unknown
}

export function attestResultFromEmitOutput(
  output: EmitOutputLike,
  via: 'daemon' | 'in-process',
  extraWarnings: string[],
): AttestResult {
  const warnings = [
    ...extraWarnings,
    ...(Array.isArray(output.warnings) ? output.warnings.map(String) : []),
  ]
  const receiptId = typeof output.receipt_id === 'string' ? output.receipt_id : undefined
  return {
    record_hash: typeof output.record_hash === 'string' && output.record_hash !== ''
      ? output.record_hash
      : null,
    context_id: typeof output.context_id === 'string' ? output.context_id : null,
    log_index: typeof output.log_index === 'number' ? output.log_index : null,
    inclusion_proof: Array.isArray(output.inclusion_proof)
      ? (output.inclusion_proof as ProofBundle['inclusion_proof'])
      : null,
    ...(receiptId !== undefined ? { receipt_id: receiptId } : {}),
    via,
    warnings,
  }
}
