// SPDX-License-Identifier: Apache-2.0

/**
 * `dev.atrib/attribution` extension receipts (accepted as D141; extension
 * spec at docs/extensions/dev.atrib-attribution/v0.1.md, conformance at
 * spec/conformance/mcp-extension/).
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

import {
  ATTRIBUTION_EXTENSION_ID,
  encodeToken,
  normalizeEventType,
  type AtribRecord,
  type AttributionLogSubmissionStatus,
  type AttributionReceiptVerification,
} from '@atrib/mcp'
import { recordHashRef } from './hashes.js'

/**
 * Alias of `@atrib/mcp`'s `ATTRIBUTION_EXTENSION_ID` — one identifier, one
 * source of truth (the SEP-2133 extension id is frozen).
 */
export const ATTRIBUTION_EXTENSION_KEY: typeof ATTRIBUTION_EXTENSION_ID = ATTRIBUTION_EXTENSION_ID

export type { AttributionLogSubmissionStatus }

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

/**
 * The receipt surface the daemon client attaches to attest/recall results:
 * the leniently parsed block plus the outcome of running `@atrib/mcp`'s
 * `verifyAttributionReceipt` over the RAW `_meta` block (structural +
 * internal-consistency check per extension spec §6.2). Verification is
 * advisory like the receipt itself: an invalid receipt is discarded from
 * trust, never from the tool result.
 */
export interface VerifiedAttributionReceipt {
  block: AttributionReceiptBlock
  verification: AttributionReceiptVerification
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

/** Outcome of checking a receipt against its attached signed record. */
export interface AttributionReceiptConsistency {
  /** True iff every receipt claim matches the attached record. */
  receipt_valid: boolean
  /** Receipt fields whose claims contradict the attached record. */
  mismatched_fields: string[]
  /** recordHashRef of the attached record (when a record is available). */
  attached_record_hash?: string
  /** The receipt's claimed record_hash (when present). */
  claimed_record_hash?: string
}

/**
 * Check a receipt block's claims against the signed record they name
 * (the attached `block.record`, or a caller-retrieved record). Receipts
 * are advisory: a mismatch NEVER invalidates the tool result — it means
 * the receipt must not be trusted or cited (conformance:
 * spec/conformance/mcp-extension/cases/receipt--*.json).
 *
 * Compared claims: `receipt.record_hash` vs the record's canonical hash,
 * `token` vs encodeToken(record), and `creator_key` / `context_id` /
 * `chain_root` / `event_type` (short name or URI, normalized) vs the
 * record's fields. Absent receipt fields are not mismatches.
 */
export function checkAttributionReceiptConsistency(
  block: AttributionReceiptBlock,
  record?: AtribRecord,
): AttributionReceiptConsistency {
  const attached = record ?? block.record
  const receipt = block.receipt
  const claimed = receipt?.record_hash
  if (!attached) {
    return {
      receipt_valid: false,
      mismatched_fields: ['record'],
      ...(claimed !== undefined ? { claimed_record_hash: claimed } : {}),
    }
  }
  const mismatched: string[] = []
  let attachedHash: string | undefined
  let token: string | undefined
  try {
    attachedHash = recordHashRef(attached)
    token = encodeToken(attached)
  } catch {
    // A record that cannot be canonicalized/hashed cannot back a receipt.
    return {
      receipt_valid: false,
      mismatched_fields: ['record'],
      ...(claimed !== undefined ? { claimed_record_hash: claimed } : {}),
    }
  }
  if (claimed !== undefined && claimed !== attachedHash) mismatched.push('record_hash')
  if (block.token !== undefined && block.token !== token) mismatched.push('token')
  if (receipt?.creator_key !== undefined && receipt.creator_key !== attached.creator_key) {
    mismatched.push('creator_key')
  }
  if (receipt?.context_id !== undefined && receipt.context_id !== attached.context_id) {
    mismatched.push('context_id')
  }
  if (receipt?.chain_root !== undefined && receipt.chain_root !== attached.chain_root) {
    mismatched.push('chain_root')
  }
  if (
    receipt?.event_type !== undefined &&
    normalizeEventType(receipt.event_type) !== normalizeEventType(attached.event_type)
  ) {
    mismatched.push('event_type')
  }
  return {
    receipt_valid: mismatched.length === 0,
    mismatched_fields: mismatched,
    attached_record_hash: attachedHash,
    ...(claimed !== undefined ? { claimed_record_hash: claimed } : {}),
  }
}

