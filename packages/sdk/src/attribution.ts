// SPDX-License-Identifier: Apache-2.0

/**
 * `dev.atrib/attribution` extension receipts (P049 draft,
 * docs/adr-draft-p049-mcp-extension.md).
 *
 * Behind an opt-in flag, the daemon client parses attestation receipts
 * from tool results' `_meta["dev.atrib/attribution"]`: the propagation
 * token, a receipt block naming the record the server already signed
 * locally, and optionally the full signed record for immediate Tier-3
 * re-verification. `log_submission` is a queue status, never an awaited
 * proof — submission stays non-blocking per §5.3.5.
 *
 * Receipts are advisory extension data: trust derives only from verifying
 * signed records and inclusion proofs, never from the receipt itself.
 */

import type { AtribRecord } from '@atrib/mcp'

export const ATTRIBUTION_EXTENSION_KEY = 'dev.atrib/attribution'

export type AttributionLogSubmissionStatus =
  | 'queued'
  | 'submitted'
  | 'disabled'
  | 'failed'

export interface AttributionReceipt {
  record_hash?: string
  creator_key?: string
  context_id?: string
  event_type?: string
  chain_root?: string
  /** Queue status; unknown future values pass through as strings. */
  log_submission?: AttributionLogSubmissionStatus | string
}

export interface AttributionReceiptBlock {
  /** §1.5.2 propagation token for the record the server just signed. */
  token?: string
  receipt?: AttributionReceipt
  /** Full signed record; present only when the client accepted 'record'. */
  record?: AtribRecord
}

const RECEIPT_STRING_FIELDS = [
  'record_hash',
  'creator_key',
  'context_id',
  'event_type',
  'chain_root',
  'log_submission',
] as const

/**
 * Extract the extension block from a tool result's `_meta`. Lenient parse
 * per the extension's degradation posture: anything malformed yields null,
 * never a throw.
 */
export function parseAttributionReceiptBlock(meta: unknown): AttributionReceiptBlock | null {
  if (typeof meta !== 'object' || meta === null) return null
  const raw = (meta as Record<string, unknown>)[ATTRIBUTION_EXTENSION_KEY]
  if (typeof raw !== 'object' || raw === null) return null
  const block = raw as Record<string, unknown>
  const out: AttributionReceiptBlock = {}
  if (typeof block['token'] === 'string') out.token = block['token']
  const rawReceipt = block['receipt']
  if (typeof rawReceipt === 'object' && rawReceipt !== null && !Array.isArray(rawReceipt)) {
    const receipt: AttributionReceipt = {}
    let kept = 0
    for (const field of RECEIPT_STRING_FIELDS) {
      const value = (rawReceipt as Record<string, unknown>)[field]
      if (typeof value === 'string') {
        receipt[field] = value
        kept += 1
      }
    }
    // A receipt where every field was wrong-typed conveys nothing; treat
    // it as absent rather than surfacing an empty object.
    if (kept > 0) out.receipt = receipt
  }
  const rawRecord = block['record']
  if (typeof rawRecord === 'object' && rawRecord !== null && !Array.isArray(rawRecord)) {
    out.record = rawRecord as AtribRecord
  }
  return out.token !== undefined || out.receipt !== undefined || out.record !== undefined
    ? out
    : null
}
