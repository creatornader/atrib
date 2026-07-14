// SPDX-License-Identifier: Apache-2.0

import { sha256 } from '@noble/hashes/sha2.js'
import canonicalize from 'canonicalize'

const encoder = new TextEncoder()
const DEFAULT_MAX_AGE_MS = 300_000

/** The tuple an approval binds to, per arXiv 2606.24322: (tool, value, amount, nonce, timestamp). */
export interface ActionBindingInput {
  /** Tool or action class the approval covers. */
  tool: string
  /** 'sha256:<64-hex>' commitment to the security-relevant value driving the action. */
  value_hash: string
  /** Decimal string amount. OMITTED (absent, not null) when the action has no amount. */
  amount?: string
  /** Caller-supplied nonce. This module never generates randomness. */
  nonce: string
  /** Caller-supplied issuance time, ms since epoch. This module never reads a clock. */
  issued_at_ms: number
}

/** binding = 'sha256:' + hex(sha256(utf8(JCS(input)))). JCS per RFC 8785 via the canonicalize package. */
export function computeActionBinding(input: ActionBindingInput): string {
  const tuple = projectActionBindingInput(input)
  const json = canonicalize(tuple)
  if (json === undefined) {
    throw new Error('action-gate: token canonicalization produced undefined')
  }

  return `sha256:${hexEncode(sha256(encoder.encode(json)))}`
}

export interface IssuedActionToken extends ActionBindingInput {
  binding: string
}

/** Pure issuance: computes the binding over the tuple. No I/O, clock, or randomness. */
export function issueActionToken(input: ActionBindingInput): IssuedActionToken {
  const tuple = projectActionBindingInput(input)
  return { ...tuple, binding: computeActionBinding(tuple) }
}

/** Host-owned consumption state. In-memory reference implementation below; persistent
 *  adapters (HTTP, Durable Object, Redis) follow the D111 replay-cache precedent and are
 *  host-side. The single atomic operation exists because a split read-then-write lets two
 *  concurrent checks both observe an unused binding (double-spend). */
export interface TokenConsumptionStore {
  /** Atomically consume the binding. Returns true for exactly one call per binding (the call
   *  that consumed it) and false ever after. May be async for shared stores. */
  consume(binding: string): boolean | Promise<boolean>
}

export function createMemoryConsumptionStore(): TokenConsumptionStore {
  const consumed = new Set<string>()
  return {
    consume(binding) {
      if (consumed.has(binding)) return false
      consumed.add(binding)
      return true
    },
  }
}

export type TokenCheckReason = 'ok' | 'binding-invalid' | 'binding-mismatch' | 'expired' | 'consumed'

export interface TokenCheckResult {
  ok: boolean
  reason: TokenCheckReason
  /** Feeds elevation.ts ActionBoundToken.fresh directly. Equal to ok. */
  fresh: boolean
}

export interface TokenCheckInput {
  token: IssuedActionToken
  /** The binding the gate recomputes for the action actually being attempted. */
  actionBinding: string
  store: TokenConsumptionStore
  /** Caller-supplied current time, ms since epoch. */
  nowMs: number
  /** Max token age in ms. Default 300000 (5 minutes). */
  maxAgeMs?: number
}

/** Check order, first failure wins; consumption is attempted ONLY after every pure check passes:
 *  1. Recompute binding from the token's own tuple. If it differs from token.binding,
 *     return 'binding-invalid' (tampered or malformed token).
 *  2. If token.binding !== actionBinding, return 'binding-mismatch' (the action or its
 *     driving value changed after approval; re-binding voids the authorization).
 *  3. If nowMs < token.issued_at_ms, return 'expired' (not-yet-valid is rejected; be
 *     conservative under clock skew). If nowMs - token.issued_at_ms > maxAgeMs, return 'expired'.
 *  4. Await store.consume(token.binding). False means 'consumed'. True means
 *     { ok: true, reason: 'ok', fresh: true }.
 *  A failed pure check MUST NOT reach consume: an attacker probing with a mismatched action
 *  must not be able to burn a legitimate pending approval. Under a concurrent race, the atomic
 *  consume guarantees exactly one caller gets ok.
 *  Guarantee: at most one successful check per binding per store. Coupling consumption to
 *  execution is the host's contract: check immediately before each attempt and never reuse a
 *  prior result's fresh flag.
 */
export async function checkAndConsumeToken(input: TokenCheckInput): Promise<TokenCheckResult> {
  if (computeActionBinding(input.token) !== input.token.binding) {
    return failedCheck('binding-invalid')
  }
  if (input.token.binding !== input.actionBinding) {
    return failedCheck('binding-mismatch')
  }

  const maxAgeMs = input.maxAgeMs ?? DEFAULT_MAX_AGE_MS
  if (
    input.nowMs < input.token.issued_at_ms ||
    input.nowMs - input.token.issued_at_ms > maxAgeMs
  ) {
    return failedCheck('expired')
  }

  const consumed = await input.store.consume(input.token.binding)
  if (!consumed) return failedCheck('consumed')
  return { ok: true, reason: 'ok', fresh: true }
}

function projectActionBindingInput(input: ActionBindingInput): ActionBindingInput {
  const tuple: ActionBindingInput = {
    tool: input.tool,
    value_hash: input.value_hash,
    nonce: input.nonce,
    issued_at_ms: input.issued_at_ms,
  }
  if (input.amount !== undefined) tuple.amount = input.amount
  return tuple
}

function failedCheck(reason: Exclude<TokenCheckReason, 'ok'>): TokenCheckResult {
  return { ok: false, reason, fresh: false }
}

function hexEncode(bytes: Uint8Array): string {
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return hex
}
