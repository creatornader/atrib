// SPDX-License-Identifier: Apache-2.0

/**
 * Delegation-certificate evaluation per spec §1.11 (D140).
 *
 * Promoted from the reference implementation in
 * `test/conformance-delegation-certificates.test.ts`: the §1.11.4
 * verifier walk (record → run key → certificate → principal), offline and
 * deterministic, plus the §1.9.2 signing-rule-3 revoker authorization for
 * principal-signed run-key revocations (§1.11.5).
 *
 * Every output of this module is a fact/signal in the §6.7.3 posture:
 * NOTHING here alters record validity. A record signed directly by a
 * principal is delegation depth 0 — no certificate exists or is needed,
 * and verification is byte-for-byte the §1.4.3 procedure. An invalid,
 * expired, out-of-scope, or ambiguous certificate never invalidates any
 * record; at worst the record falls back to plain attribution to its
 * signing key.
 *
 * Design note on dependencies: like `ResolvedIdentityClaim` in
 * verify-record.ts, the certificate shape is declared here structurally
 * rather than imported from a producer package's non-exported module —
 * callers pass either `@atrib/mcp`'s `DelegationCertificate` (structurally
 * identical) or a hand-parsed object from a sidecar / archive / evidence
 * envelope carrier (§1.11.8). The caller supplies the certificate set;
 * this module never fetches.
 */

import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'
import canonicalize from 'canonicalize'
import { base64urlDecode, hexEncode, sha256, type AtribRecord } from '@atrib/mcp'
import type { IdentityResolution } from './resolve-identity.js'

// @noble/ed25519 v3 needs sha512 wired (idempotent; @atrib/mcp wires the
// same instance at import time — kept here so this module stands alone).
ed.hashes.sha512 = sha512
ed.hashes.sha512Async = (m) => Promise.resolve(sha512(m))

const encoder = new TextEncoder()

/** §6.7.1 capability envelope schema, reused verbatim as the cert scope (§1.11.1). */
export interface DelegationScope {
  tool_names?: string[]
  event_types?: string[]
  max_amount?: { currency: string; value: number }
  counterparties?: string[]
  expires_at?: number
  cost_policy?: DelegationCostPolicy
}

/**
 * §6.7.1 `cost_policy` sub-field (D165): the compute-spend scope of a
 * delegated run. `model_tiers` is an allowlist of host-defined tier labels
 * (free-form strings, same idiom as `tool_names`); `max_tokens` caps the
 * certified run's total token spend. Both sub-fields are individually
 * optional; absence means no constraint. Like every §6.7 constraint the
 * outputs are signals, never invalidation (§6.7.3), and enforcement stays
 * host-side: the protocol records the grant, the orchestrator enforces it.
 */
export interface DelegationCostPolicy {
  model_tiers?: string[]
  max_tokens?: number
}

/** Caller-supplied usage facts for {@link checkCostPolicy}. */
export interface CostPolicyUsage {
  model_tier?: string
  tokens_spent?: number
}

/**
 * A delegation certificate per §1.11.1. Optional fields are omitted, not
 * null, when absent — presence/absence changes the JCS canonical form and
 * therefore the principal signature and the cert hash.
 */
export interface DelegationCertificate {
  cert_type: string
  context_id?: string
  not_after: number
  not_before?: number
  principal_key: string
  run_pubkey: string
  scope?: DelegationScope
  signature: string
}

/** A record that may carry the OPTIONAL §1.11.3 genesis field. */
export type DelegatedRecord = AtribRecord & { delegation_cert_hash?: string }

/** A §1.9.1 key_revocation record possibly carrying the §1.11.5 field. */
export type KeyRevocationRecordLike = AtribRecord & {
  revoked_key: string
  revocation_reason: string
  delegation_cert_hash?: string
}

/** §6.7.2-style scope check output. Signals only (§6.7.3). */
export interface DelegationScopeCheck {
  in_scope: boolean
  /**
   * Whether the certificate scope is a subset of the principal's
   * directory-published envelope. `null` when no directory envelope was
   * supplied to the walk (the current library posture; see §1.11.4 step 5).
   */
  attenuation_ok: boolean | null
  /** Failed constraint names, e.g. 'tool_names', 'event_types'. */
  mismatches: string[]
}

/**
 * Per-certificate facts surfaced when the §1.11.4 ambiguity rule fires.
 * Same fact set as a depth-1 outcome, scoped to one candidate.
 */
export interface DelegationCandidate {
  principal_key: string
  cert_hash: string
  in_window: boolean
  context_bound: boolean | null
  cert_bound: boolean | null
  scope_check: DelegationScopeCheck | null
}

/**
 * The §1.11.4 verifier output block. At depth 0 every certificate-derived
 * field is null and `errors` is empty — unless a covering-but-invalid
 * certificate was rejected as evidence, in which case its `cert_hash`,
 * `cert_valid: false`, and the rejection error are reported while the
 * walk still resolves to depth 0. No field in this block affects record
 * validity.
 */
export interface DelegationOutcome {
  depth: 0 | 1
  principal_key: string | null
  cert_hash: string | null
  cert_valid: boolean | null
  in_window: boolean | null
  context_bound: boolean | null
  cert_bound: boolean | null
  scope_check: DelegationScopeCheck | null
  revoked: boolean | null
  /**
   * Rejection errors for a covering-but-invalid certificate:
   * 'principal_key_malformed', 'run_pubkey_malformed', 'self_certificate',
   * 'principal_signature_invalid', 'delegation_depth_exceeded'.
   */
  errors: string[]
  /**
   * §1.11.4 step 2: present (true) ONLY when the context genesis signed
   * by the record's own creator_key commits to a certificate through
   * `delegation_cert_hash` but no valid covering certificate resolved.
   * Signal, not invalidation (D113 posture).
   */
  delegation_unresolved?: boolean
  /**
   * §1.11.4 ambiguity rule: two valid certificates from DIFFERENT
   * principals cover the same run key in overlapping windows. The
   * verifier MUST surface both (in `candidates`) rather than choosing.
   */
  delegation_ambiguous?: boolean
  /** Present only alongside `delegation_ambiguous: true`. */
  candidates?: DelegationCandidate[]
  /** §1.11.4 step 4 result for the resolved principal key. */
  principal_identity_resolution?: IdentityResolution
  /** §1.11.4 structural anomaly: a run key has a directory claim. */
  run_key_in_directory?: boolean | null
}

export interface EvaluateDelegationOptions {
  /**
   * Keys the caller has resolved as revoked at the record's log position
   * (per §1.9.3 / §1.11.5 — the caller applies the log_index cutoff, this
   * module has no log access). When supplied, `revoked` is true iff the
   * run key or the resolved principal key is in the set; when omitted,
   * `revoked` stays `false` at depth 1 (the walk carries no revocation
   * log) and `null` at depth 0.
   */
  revokedKeys?: ReadonlySet<string>
}

/** §1.9.2 revoker-authorization outcome (including §1.11.5 rule 3). */
export interface RevokerAuthorization {
  authorized: boolean
  /** 'retired_key' (rule 1) or 'principal_via_delegation_certificate' (rule 3). */
  rule?: string
  /**
   * Rejection reason: 'certificate_not_resolved', 'certificate_invalid',
   * 'certificate_does_not_cover_revoked_key',
   * 'signer_is_not_certificate_principal', 'no_authorization_path'.
   */
  reason?: string
}

/**
 * The certificate signing input (§1.11.2): UTF-8 bytes of
 * JCS(cert with signature omitted).
 */
export function delegationCertSigningInput(cert: DelegationCertificate): Uint8Array {
  const { signature: _, ...unsigned } = cert
  const json = canonicalize(unsigned)
  if (json === undefined) {
    throw new Error('atrib: delegation certificate canonicalization produced undefined')
  }
  return encoder.encode(json)
}

/** cert_hash = "sha256:" + hex(SHA-256(UTF-8(JCS(full signed cert)))) (§1.11.2). */
export function delegationCertHash(cert: DelegationCertificate): string {
  const json = canonicalize(cert)
  if (json === undefined) {
    throw new Error('atrib: delegation certificate canonicalization produced undefined')
  }
  return `sha256:${hexEncode(sha256(encoder.encode(json)))}`
}

/** Ed25519 verification of the certificate under its declared principal_key. Never throws. */
export async function delegationCertSignatureVerifies(
  cert: DelegationCertificate,
): Promise<boolean> {
  try {
    const pub = base64urlDecode(cert.principal_key)
    if (pub.length !== 32) return false
    const sig = base64urlDecode(cert.signature)
    if (sig.length !== 64) return false
    return await ed.verifyAsync(sig, delegationCertSigningInput(cert), pub)
  } catch {
    return false
  }
}

function isWellFormedKey(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0) return false
  try {
    return base64urlDecode(value).length === 32
  } catch {
    return false
  }
}

/**
 * Certificate validity AS DELEGATION EVIDENCE per §1.11.2: both keys
 * well-formed per §1.4.1, `run_pubkey !== principal_key` (a
 * self-certificate is rejected with 'self_certificate' even when its
 * signature verifies), and the principal signature verifies. Returns the
 * error list (empty = valid). Never throws.
 *
 * The §1.11.2 depth rule ('delegation_depth_exceeded') needs the full
 * certificate set and is applied by `evaluateDelegation`, not here.
 */
export async function delegationCertErrors(cert: DelegationCertificate): Promise<string[]> {
  const errors: string[] = []
  if (!isWellFormedKey(cert.principal_key)) errors.push('principal_key_malformed')
  if (!isWellFormedKey(cert.run_pubkey)) errors.push('run_pubkey_malformed')
  if (errors.length > 0) return errors
  if (cert.run_pubkey === cert.principal_key) {
    return ['self_certificate']
  }
  if (!(await delegationCertSignatureVerifies(cert))) {
    errors.push('principal_signature_invalid')
  }
  return errors
}

/**
 * §6.7.1 envelope check against the certificate scope (§1.11.4 step 5).
 * Signals only, never invalidation (§6.7.3).
 *
 * Checks the constraints resolvable from the record alone: `tool_names`
 * (when the record discloses §8.2 `tool_name`) and `event_types`.
 * `max_amount` / `counterparties` / `cost_policy` require facts the
 * compact signed record does not carry (transaction amounts, counterparty
 * identity, model tier and token spend); they produce no mismatch here
 * (same posture the conformance corpus pins). Callers holding usage facts
 * evaluate `cost_policy` with {@link checkCostPolicy}. `attenuation_ok`
 * is `null` until a caller supplies the principal's directory envelope.
 */
export function checkDelegationScope(
  record: DelegatedRecord,
  scope: DelegationScope,
): DelegationScopeCheck {
  const mismatches: string[] = []
  if (
    scope.tool_names &&
    record.tool_name !== undefined &&
    !scope.tool_names.includes(record.tool_name)
  ) {
    mismatches.push('tool_names')
  }
  if (scope.event_types && !scope.event_types.includes(record.event_type)) {
    mismatches.push('event_types')
  }
  return { in_scope: mismatches.length === 0, attenuation_ok: null, mismatches }
}

/**
 * §6.7.2 cost-policy check (D165). Evaluable only when the caller holds
 * usage facts: signed records do not carry model tier or token spend
 * (accounting lives in local sidecar and join-record content per the
 * orchestration conventions), so this never runs inside the record-only
 * §1.11.4 walk. A host verifying a join, or a receiver deciding whether a
 * leg stayed inside its certified grant, supplies the claimed usage and
 * reads the mismatch list. Signals only, never invalidation (§6.7.3):
 * an over-budget leg's records remain valid; the mismatch is a fact for
 * the accepting party to weigh.
 *
 * Absent constraints and absent usage facts both produce no mismatch:
 * a policy without `max_tokens` caps nothing, and usage without
 * `tokens_spent` claims nothing checkable.
 */
export function checkCostPolicy(
  policy: DelegationCostPolicy,
  usage: CostPolicyUsage,
): { in_scope: boolean; mismatches: string[] } {
  const mismatches: string[] = []
  if (
    policy.model_tiers &&
    usage.model_tier !== undefined &&
    !policy.model_tiers.includes(usage.model_tier)
  ) {
    mismatches.push('cost_policy.model_tiers')
  }
  if (
    policy.max_tokens !== undefined &&
    usage.tokens_spent !== undefined &&
    usage.tokens_spent > policy.max_tokens
  ) {
    mismatches.push('cost_policy.max_tokens')
  }
  return { in_scope: mismatches.length === 0, mismatches }
}

function certWindow(cert: DelegationCertificate): { from: number; to: number } {
  return { from: cert.not_before ?? 0, to: cert.not_after }
}

function windowsOverlap(a: DelegationCertificate, b: DelegationCertificate): boolean {
  const wa = certWindow(a)
  const wb = certWindow(b)
  return wa.from <= wb.to && wb.from <= wa.to
}

function candidateFacts(
  record: DelegatedRecord,
  cert: DelegationCertificate,
  hash: string,
  genesisCommits: boolean,
  genesis: DelegatedRecord | null,
): DelegationCandidate {
  const { from, to } = certWindow(cert)
  return {
    principal_key: cert.principal_key,
    cert_hash: hash,
    in_window: from <= record.timestamp && record.timestamp <= to,
    context_bound: cert.context_id === undefined ? null : cert.context_id === record.context_id,
    // Binding scope per §1.11.3: cert_bound is evaluable only when the
    // context genesis was signed by the record's OWN creator_key AND
    // carries the field — the verifier-pass fix to the signed-by
    // qualifier. Another producer's genesis commitment says nothing about
    // this record's signer (D067 / §1.11.6: cert_bound stays null).
    cert_bound: genesisCommits && genesis !== null ? genesis.delegation_cert_hash === hash : null,
    scope_check: cert.scope ? checkDelegationScope(record, cert.scope) : null,
  }
}

/**
 * The §1.11.4 verifier walk, offline and deterministic: record → run key
 * → certificate → principal. `genesis` is the context genesis record when
 * available (it may be the record itself). Every output is a fact/signal;
 * nothing here alters record validity, and the record's own signature is
 * checked by the UNCHANGED §1.4.3 procedure elsewhere (step 1 belongs to
 * `verifyRecord`, not this walk).
 *
 * Never throws: malformed certificates degrade to rejection errors, and
 * two implementations given the same record and certificate set MUST
 * produce identical outcomes (§1.11.11).
 */
export async function evaluateDelegation(
  record: DelegatedRecord,
  genesis: DelegatedRecord | null,
  certs: DelegationCertificate[],
  options: EvaluateDelegationOptions = {},
): Promise<DelegationOutcome> {
  const depth0: DelegationOutcome = {
    depth: 0,
    principal_key: null,
    cert_hash: null,
    cert_valid: null,
    in_window: null,
    context_bound: null,
    cert_bound: null,
    scope_check: null,
    revoked: null,
    errors: [],
  }

  try {
    // §1.11.4 step 2: delegation_unresolved only applies when the context
    // genesis was signed by R.creator_key (the field commits the genesis
    // signer's OWN run key; another producer's genesis commitment says
    // nothing about this record's signer).
    const genesisCommits =
      genesis !== null &&
      genesis.creator_key === record.creator_key &&
      typeof genesis.delegation_cert_hash === 'string'

    // Step 2: select certificates covering the record's signing key.
    const candidates = certs.filter((c) => c.run_pubkey === record.creator_key)
    if (candidates.length === 0) {
      if (genesisCommits) return { ...depth0, delegation_unresolved: true }
      return depth0
    }

    // Evaluate each covering certificate's validity as evidence,
    // including the §1.11.2 depth rule: principal_key MUST NOT itself be
    // a run key under another VALID certificate known to the verifier.
    const evaluated: { cert: DelegationCertificate; hash: string; errors: string[] }[] = []
    for (const cert of candidates) {
      let errors = await delegationCertErrors(cert)
      if (errors.length === 0) {
        for (const other of certs) {
          if (other === cert) continue
          if (other.run_pubkey !== cert.principal_key) continue
          if ((await delegationCertErrors(other)).length === 0) {
            errors = ['delegation_depth_exceeded']
            break
          }
        }
      }
      evaluated.push({ cert, hash: safeCertHash(cert), errors })
    }

    const valid = evaluated.filter((e) => e.errors.length === 0)
    if (valid.length === 0) {
      // Rejected as delegation evidence: fall back to plain attribution.
      // The walk reports the (first) covering certificate's hash, its
      // cert_valid: false, and the rejection errors (§1.11.4 step 2).
      const first = evaluated[0]
      if (first === undefined) return depth0
      return { ...depth0, cert_hash: first.hash, cert_valid: false, errors: first.errors }
    }

    // Ambiguity rule (§1.11.4): two valid certificates from DIFFERENT
    // principals covering the same run key in overlapping windows —
    // surface both rather than choosing. Choosing would be
    // interpretation; surfacing is fact.
    for (let i = 0; i < valid.length; i++) {
      for (let j = i + 1; j < valid.length; j++) {
        const a = valid[i]!
        const b = valid[j]!
        if (a.cert.principal_key !== b.cert.principal_key && windowsOverlap(a.cert, b.cert)) {
          return {
            ...depth0,
            delegation_ambiguous: true,
            candidates: valid.map((e) =>
              candidateFacts(record, e.cert, e.hash, genesisCommits, genesis),
            ),
          }
        }
      }
    }

    // Unambiguous selection: prefer the valid certificate whose window
    // covers the record's timestamp; otherwise the first valid one in
    // caller order (deterministic for a given ordered certificate set).
    const selected =
      valid.find((e) => {
        const { from, to } = certWindow(e.cert)
        return from <= record.timestamp && record.timestamp <= to
      }) ?? valid[0]!

    const facts = candidateFacts(record, selected.cert, selected.hash, genesisCommits, genesis)
    const revoked = options.revokedKeys
      ? options.revokedKeys.has(record.creator_key) ||
        options.revokedKeys.has(selected.cert.principal_key)
      : false

    return {
      depth: 1,
      principal_key: facts.principal_key,
      cert_hash: facts.cert_hash,
      cert_valid: true,
      in_window: facts.in_window,
      context_bound: facts.context_bound,
      cert_bound: facts.cert_bound,
      scope_check: facts.scope_check,
      revoked,
      errors: [],
    }
  } catch {
    // §5.8-aligned posture for a signal surface: never throw out of the
    // walk; an unevaluable input degrades to the depth-0 identity case.
    return depth0
  }
}

function safeCertHash(cert: DelegationCertificate): string {
  try {
    return delegationCertHash(cert)
  } catch {
    return ''
  }
}

/**
 * §1.9.2 revoker authorization including the §1.11.5 rule 3: a
 * key_revocation MAY be signed by the principal key of a valid delegation
 * certificate covering `revoked_key`, referenced through the record's
 * `delegation_cert_hash` field. Verifiers MUST resolve that certificate —
 * valid per §1.11.2, `run_pubkey === revoked_key`, `principal_key ===
 * creator_key` — before accepting the principal as an authorized revoker.
 *
 * Rule 1 (signed by the key being retired) is handled here; rule 2
 * (pre-registered emergency key) requires a directory consultation this
 * module does not perform — callers with directory access apply it
 * upstream. The revocation record's OWN Ed25519 signature is the
 * caller's job (`verifyRecord` per §1.4.3); this function decides only
 * whether the signer is an authorized revoker.
 */
export async function evaluateRevokerAuthorization(
  revocation: KeyRevocationRecordLike,
  certs: DelegationCertificate[],
): Promise<RevokerAuthorization> {
  // Rule 1: signed by the key being retired.
  if (revocation.creator_key === revocation.revoked_key) {
    return { authorized: true, rule: 'retired_key' }
  }
  // Rule 3: principal via delegation certificate.
  if (typeof revocation.delegation_cert_hash === 'string') {
    const cert = certs.find((c) => safeCertHash(c) === revocation.delegation_cert_hash)
    if (cert === undefined) {
      return { authorized: false, reason: 'certificate_not_resolved' }
    }
    if ((await delegationCertErrors(cert)).length > 0) {
      return { authorized: false, reason: 'certificate_invalid' }
    }
    if (cert.run_pubkey !== revocation.revoked_key) {
      return { authorized: false, reason: 'certificate_does_not_cover_revoked_key' }
    }
    if (cert.principal_key !== revocation.creator_key) {
      return { authorized: false, reason: 'signer_is_not_certificate_principal' }
    }
    return { authorized: true, rule: 'principal_via_delegation_certificate' }
  }
  return { authorized: false, reason: 'no_authorization_path' }
}
