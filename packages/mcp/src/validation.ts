// SPDX-License-Identifier: Apache-2.0

/**
 * Shared §2.6.1 submission validation.
 * Used by both @atrib/log-dev and log-node servers.
 *
 * Steps 2–5 of §2.6.1 plus required-field presence checks.
 * Step 1 (Ed25519 signature verification) is intentionally excluded here —
 * it lives in @atrib/verify and would create a circular workspace dependency.
 * Step 6 (idempotency) is state-dependent and handled by each server's
 * proof-cache / storage layer.
 *
 * The 10-minute future-skew window (Step 4) matches §2.6.1's log-server
 * tolerance. Client-side record verification (§1.4.3) uses a tighter
 * 5-minute window; see packages/mcp/src/signing.ts for that path.
 */

import type { AtribRecord } from './types.js'
import { VALID_EVENT_TYPES } from './types.js'
const SPEC_VERSION = 'atrib/1.0'
const MAX_FUTURE_SKEW_MS = 10 * 60 * 1000 // §2.6.1 Step 4: 10 minutes

export interface ValidationResult {
  ok: boolean
  status?: number
  error?: string
}

/**
 * Validate a §2.6.1 submission body (Steps 2–5 + required fields).
 * Returns `{ ok: true }` if all checks pass, or `{ ok: false, status, error }`
 * if any check fails.
 */
export function validateSubmission(record: Partial<AtribRecord>): ValidationResult {
  // Guard: reject non-object input (null, undefined, primitives)
  if (!record || typeof record !== 'object') {
    return { ok: false, status: 400, error: `spec_version must be '${SPEC_VERSION}'` }
  }

  // Step 2: spec_version must be 'atrib/1.0'
  if (record.spec_version !== SPEC_VERSION) {
    return { ok: false, status: 400, error: `spec_version must be '${SPEC_VERSION}'` }
  }

  // Step 3: event_type must be a known value
  if (typeof record.event_type !== 'string' || !VALID_EVENT_TYPES.has(record.event_type)) {
    return {
      ok: false,
      status: 400,
      error: `event_type must be one of ${[...VALID_EVENT_TYPES].join(', ')}`,
    }
  }

  // Step 4: timestamp must be present and not more than 10 minutes in the future
  if (typeof record.timestamp !== 'number' || !Number.isInteger(record.timestamp) || record.timestamp < 0) {
    return { ok: false, status: 400, error: 'timestamp must be a non-negative integer' }
  }
  if (record.timestamp - Date.now() > MAX_FUTURE_SKEW_MS) {
    return { ok: false, status: 400, error: 'timestamp is more than 10 minutes in the future' }
  }

  // Step 5: context_id must be exactly 32 lowercase hex chars
  if (typeof record.context_id !== 'string' || !/^[0-9a-f]{32}$/.test(record.context_id)) {
    return { ok: false, status: 400, error: 'context_id must be 32 lowercase hex characters' }
  }

  // Required string fields for record_hash computation
  for (const field of ['creator_key', 'chain_root', 'content_id', 'signature'] as const) {
    if (typeof record[field] !== 'string') {
      return { ok: false, status: 400, error: `${field} is required and must be a string` }
    }
  }

  // session_token is optional and OMITTED when absent (§1.3), but if present must be a string
  if ('session_token' in record && typeof record.session_token !== 'string') {
    return { ok: false, status: 400, error: 'session_token must be a string when present' }
  }

  return { ok: true }
}
