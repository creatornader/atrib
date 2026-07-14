// SPDX-License-Identifier: Apache-2.0

/**
 * Per-record verification (single AtribRecord).
 *
 * Distinct from `AtribVerifier.verify(recommendationDoc)` which verifies a
 * settlement recommendation document by re-running the §4.6 calculation.
 * This module verifies one signed record at a time and surfaces the
 * per-record annotations defined in the package README.
 *
 * Implemented annotations (this file):
 *   - provenance:             { token, upstream_record_hash, upstream_resolved }    (D044 / §1.2.6)
 *   - informed_by_resolution: { resolved: string[], dangling: string[] }            (D041 / §1.2.5, §3.2.4)
 *   - posture:                { timestamp_granularity, timestamp_consistent, ...}   (D045 / §8.2 / §8.3 / §8.4)
 *   - capability_check:       { envelope, in_envelope, mismatches, unresolvable }   (D051 / §6.7)
 *   - cross_attestation:      { signers_count, signers_valid, missing }             (D052 / §1.7.6)
 *   - evidence:               Generic tiered external authorization evidence blocks (D109 / §5.5.6)
 *   - ap2_vi_evidence:        AP2 receipt + Verifiable Intent evidence result       (D094 / §5.5.4)
 *
 * Pending annotations (tracked in DECISIONS.md P005):
 *   - cross_log_*:            D050 / §2.11  (needs multi-log proof-bundle infrastructure)
 *
 * Design note on dependencies. The capability_check annotation does NOT
 * fetch the identity claim itself; the caller does the @atrib/directory
 * lookup and passes the resolved claim into VerifyRecordOptions. This
 * keeps @atrib/verify lean (no WASM-bridge dep) and lets the caller
 * decide lookup strategy (cached vs live, batch vs per-record). Same
 * pattern as `upstreamCandidate` and `informedByCandidates`.
 */

import {
  base64urlDecode,
  base64urlEncode,
  canonicalCrossAttestationInput,
  canonicalRecord,
  hexEncode,
  sha256,
  verifyRecord as verifyRecordSignature,
  type AtribRecord,
  type SignerEntry,
  genesisChainRoot,
} from '@atrib/mcp'
import * as ed from '@noble/ed25519'
import { verifyAp2ViEvidenceAsync } from './ap2-vi-evidence.js'
import { verifyAuthorizationEvidence } from './authorization-evidence.js'
import type {
  Ap2ViEvidenceBundle,
  Ap2ViEvidenceVerification,
  VerifyAp2ViEvidenceOptions,
} from './ap2-vi-evidence.js'
import type {
  AuthorizationEvidenceInput,
  EvidenceVerificationBlock,
} from './authorization-evidence.js'
import { evaluateDelegation } from './delegation.js'
import type { DelegatedRecord, DelegationCertificate, DelegationOutcome } from './delegation.js'
import { mapLegacyEvidenceBlock } from './evidence-envelope.js'
import type { EvidenceEnvelope, LegacyEvidenceBlock } from './evidence-envelope.js'

const PROVENANCE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/
const SHA256_REF_PATTERN = /^sha256:[0-9a-f]{64}$/
// §8.2 hashed tool_name form per D061. The verbatim and opaque-label forms
// are NOT structurally distinguishable (the spec's verbatim example
// `book_flight` also matches the opaque regex), so this is the only
// regex-detectable form.
const TOOL_NAME_HASHED_PATTERN = /^sha256:[0-9a-f]{64}$/

/**
 * Provenance surfacing for a record carrying `provenance_token` (D044 /
 * spec §1.2.6).
 */
export interface ProvenanceAnnotation {
  token: string
  /**
   * Full sha256:<64hex> record_hash of the upstream record, or null when
   * no candidate was supplied or the candidate did not match.
   */
  upstream_record_hash: string | null
  /**
   * True iff a candidate upstream record was supplied AND the first 16
   * bytes of its canonical-form SHA-256 match the decoded token.
   */
  upstream_resolved: boolean
}

/**
 * Informed-by surfacing for a record carrying `informed_by[]` (D041 /
 * spec §1.2.5). Splits the entries into resolved (caller supplied a
 * candidate whose canonical-form SHA-256 matches the entry) and dangling
 * (no candidate matched). Dangling references are flagged but do not
 * fail verification, they're a signal that the verifier hasn't seen
 * upstream context, not that the record is invalid.
 */
export interface InformedByAnnotation {
  resolved: string[]
  dangling: string[]
}

/**
 * Capability-envelope shape from spec §6.7.1. All sub-fields are optional;
 * a claim with an empty envelope (`{}`) declares no scope. The verifier
 * reads this off the resolved IdentityClaim's `capabilities` field.
 */
export interface CapabilityEnvelope {
  tool_names?: string[]
  event_types?: string[]
  max_amount?: { currency: string; value: number }
  counterparties?: string[]
  expires_at?: number
}

/**
 * Capability-check surfacing for a record whose signer published an
 * IdentityClaim with a `capabilities` field (D051 / spec §6.7).
 *
 * Per §6.7.3: out-of-envelope is a SIGNAL, not invalidation. Records
 * outside the envelope remain cryptographically valid; the signature
 * verifies, log inclusion verifies. Consumers decide policy.
 */
export interface CapabilityCheckAnnotation {
  /** The active envelope at the record's timestamp, or null if none. */
  envelope: CapabilityEnvelope | null
  /**
   * True iff every present envelope field accommodates the record. False
   * when any present constraint excludes the record's content. True when
   * envelope is null (no constraint = trivially in-envelope).
   */
  in_envelope: boolean
  /**
   * Specific constraints the record violates, listed for debugging.
   * Each entry is a short string like 'event_type not in allowlist' or
   * 'expires_at exceeded'. Empty when in_envelope is true.
   */
  mismatches: string[]
  /**
   * True iff one or more checks could not be resolved out-of-band
   * (e.g., a transaction record's amount + counterparty are not
   * derivable without the protocol-specific payment event). Per §6.7.2
   * the verifier MUST flag this rather than passing or failing silently.
   */
  unresolvable: boolean
}

export interface ResolvedCapabilityFacts {
  /**
   * Resolved tool name for a tool_call record. This may come from an
   * attributed record's optional §8.2 `tool_name` field, a caller's local
   * mirror body, or an upstream protocol event that the record commits to.
   */
  tool_name?: string
  /** Resolved transaction amount from the committed payment-protocol event. */
  transaction_amount?: { currency: string; value: number }
  /** Resolved transaction counterparty from the committed payment-protocol event. */
  transaction_counterparty?: string
}

/**
 * Cross-attestation surfacing for a transaction record per spec §1.7.6
 * (D052). atrib's normative minimum is two verified signers per
 * transaction record (typically agent + counterparty). Records below
 * the minimum get `missing: true`; verifiers MUST flag this rather
 * than silently passing or failing.
 *
 * The annotation populates ONLY for records with
 * `event_type = https://atrib.dev/v1/types/transaction`. Other event
 * types continue to use the standard single-signer signature path.
 */
export interface CrossAttestationAnnotation {
  /**
   * Total signers attached to the record (regardless of validity).
   * `0` for legacy single-signer transaction records that carry only the
   * top-level `signature` field instead of the `signers[]` array.
   */
  signers_count: number
  /**
   * Number of distinct creator keys with at least one Ed25519 signature
   * that successfully verifies against the cross-attestation canonical
   * bytes (JCS form with `signers: []` and `signature` omitted, per
   * §1.7.6). Duplicate entries from one key do not inflate this count.
   */
  signers_valid: number
  /**
   * `true` iff `signers_valid < 2` (atrib's normative minimum). Per
   * §1.7.6 verifiers MUST flag this; consumers decide whether to accept
   * the record. Like §6.7's `in_envelope: false`, this is a SIGNAL not
   * an invalidation: the underlying record may still be cryptographically
   * valid via the legacy top-level signature.
   */
  missing: boolean
  /**
   * `true` iff a trust set (`VerifyRecordOptions.trustedCreatorKeys`) was
   * supplied and the trusted-signer composition was evaluated. Always present
   * on transaction cross_attestation, so that `false` is a LOUD signal: the
   * annotation reflects only the trust-blind verified-key count, and a
   * consumer gating a consequential action MUST NOT read `signers_valid >= 2`
   * as trusted authority without supplying a trust set. Per §1.7.6 trusted
   * signer composition. `signers_trusted` / `sybil_suspected` are present only
   * when this is `true`.
   */
  trust_evaluated: boolean
  /**
   * Number of distinct verified signer keys that are ALSO members of the
   * trust set supplied via `VerifyRecordOptions.trustedCreatorKeys`. A
   * verified signer key is not necessarily a trusted one: `signers_valid`
   * counts distinct keys whose signatures verify, this counts how many of
   * those keys the caller trusts. Present ONLY when `trust_evaluated` is true;
   * omitted otherwise. Non-malleable transaction authority requires
   * `signers_trusted >= 2` (see `isTrustedCrossAttested`), per §1.7.6.
   */
  signers_trusted?: number
  /**
   * `true` iff `signers_valid >= 2` but `signers_trusted < 2`: the record
   * meets the distinct-verified-key minimum yet fewer than two of those keys
   * are trusted (a Sybil / corroboration posture, e.g. two attacker-controlled
   * keys signing the same bytes). Present ONLY when a trust set is supplied.
   * Like `missing`, this is a SIGNAL and MUST NOT by itself invalidate the
   * record. Gate non-malleable authority on `isTrustedCrossAttested` (i.e.
   * `signers_trusted >= 2`), NOT on `!sybil_suspected`: a single trusted
   * signer (`signers_valid < 2`) is not sybil_suspected yet is not attested.
   */
  sybil_suspected?: boolean
}

/**
 * Non-malleable cross-attestation predicate. Returns `true` iff the record
 * carries at least 2 distinct verified signer keys that are members of the
 * caller's trust set (`signers_trusted >= 2`). This is the guarded gate a
 * consumer requiring Sybil-resistant transaction authority should call, in
 * place of the footgun `signers_valid >= 2` (which two untrusted keys also
 * satisfy) or `!sybil_suspected` (which a single trusted signer also
 * satisfies). Requires `verifyRecord` to have been called with a
 * `trustedCreatorKeys` trust set; returns `false` when trust was not
 * evaluated. Per §1.7.6 trusted signer composition.
 */
export function isTrustedCrossAttested(
  annotation: CrossAttestationAnnotation | undefined,
): boolean {
  return (annotation?.signers_trusted ?? 0) >= 2
}

/**
 * Posture surfacing for a record. Exposes three §8 postures: timing
 * (§8.4), args/result commitment (§8.3), and tool-name disclosure (§8.2).
 *
 * `timestamp_granularity` is the declared coarsening level (or 'ms' by
 * default when absent). `timestamp_consistent` is true iff the timestamp
 * value matches the granularity's trailing-zero invariant per spec §8.4
 * (e.g., 'min' requires `timestamp % 60000 == 0`).
 *
 * `args_commitment_form` and `result_commitment_form` are detected
 * structurally per spec §8.3. Presence of `args_salt` indicates the
 * salted-sha256 scheme; absence indicates the default plain-sha256
 * scheme. The hmac-sha256 variant is structurally indistinguishable to
 * non-key-holders (the issuer signals it out-of-band per §8.3, not via
 * record fields), so we surface only the two structurally-detectable
 * forms.
 *
 * `tool_name_form` is the §8.2 / D061 form of the optional `tool_name`
 * field. The §8.2 verbatim-vs-opaque distinction is NOT structurally
 * detectable (`book_flight` matches the opaque regex), so per D061 we
 * surface only `'hashed' | 'plain' | null`: hashed when the value
 * matches `^sha256:[0-9a-f]{64}$`, plain for any other present value,
 * null when the field is absent. Consumers wanting verbatim-vs-opaque
 * MUST use out-of-band metadata (e.g., a name registry).
 */
export interface PostureAnnotation {
  timestamp_granularity: 'ms' | 's' | 'min' | 'h' | 'd'
  /**
   * True iff the timestamp value matches the declared granularity's
   * trailing-zero pattern. 'ms' is always consistent (no constraint).
   */
  timestamp_consistent: boolean
  /**
   * True iff the granularity field was explicitly present on the record,
   * false iff it defaulted to 'ms' because the field was absent.
   * Surfaced separately because absence affects JCS canonical form per §1.3.
   */
  timestamp_granularity_explicit: boolean
  /**
   * Detected commitment scheme for `args_hash`. 'salted-sha256' iff
   * `args_salt` is present on the record; 'plain-sha256' otherwise. The
   * 'hmac-sha256' variant from §8.3 is not structurally detectable.
   */
  args_commitment_form: 'plain-sha256' | 'salted-sha256'
  /**
   * Detected commitment scheme for `result_hash`. Same semantics as
   * `args_commitment_form` but driven by `result_salt`.
   */
  result_commitment_form: 'plain-sha256' | 'salted-sha256'
  /**
   * Detected form of the optional `tool_name` field per §8.2 / D061:
   *   - 'hashed' when value matches `^sha256:[0-9a-f]{64}$` (unambiguous)
   *   - 'plain' for any other present value (verbatim and opaque-label
   *     forms are not structurally distinguishable; both surface as plain)
   *   - null when the field is absent (the §8.1 default posture)
   */
  tool_name_form: 'hashed' | 'plain' | null
}

const GRANULARITY_MULTIPLIER: Record<PostureAnnotation['timestamp_granularity'], number> = {
  ms: 1,
  s: 1000,
  min: 60_000,
  h: 3_600_000,
  d: 86_400_000,
}

export interface RecordVerificationResult {
  /** True iff signatureOk AND no fatal warnings. */
  valid: boolean
  /** Ed25519 signature check over JCS-canonical bytes (§1.4.3). */
  signatureOk: boolean
  /**
   * Provenance annotation. Populated only when the record carries a
   * `provenance_token` field. Genesis-record-only per spec §1.2.6;
   * verifyRecord does NOT enforce that invariant here (it's the
   * validator + verifier-of-the-chain's job per the spec), callers that
   * want the strict check should also confirm the record's chain_root
   * equals genesisChainRoot(record.context_id).
   */
  provenance?: ProvenanceAnnotation
  /**
   * Informed-by annotation. Populated only when the record carries a
   * non-empty `informed_by[]`. `resolved` lists the entries that match
   * a caller-supplied candidate; `dangling` lists the entries that did
   * not match any candidate. With no candidates supplied, all entries
   * land in `dangling` (verification continues regardless).
   */
  informed_by_resolution?: InformedByAnnotation
  /**
   * Posture annotation. Always populated (every record has a timing
   * posture, even if it defaults to 'ms'). Surfaces the declared
   * granularity and whether the timestamp value structurally matches it.
   */
  posture: PostureAnnotation
  /**
   * Capability-check annotation. Populated only when the caller passes
   * an `identityClaim` in options. When the claim has no `capabilities`
   * field (or an empty envelope), in_envelope is true and mismatches is
   * empty (no constraint = trivially in-envelope per §6.7.1).
   */
  capability_check?: CapabilityCheckAnnotation
  /**
   * Cross-attestation annotation per §1.7.6 (D052). Populated ONLY for
   * transaction records (`event_type = https://atrib.dev/v1/types/transaction`).
   * Surfaces signers_count, signers_valid, and missing (true when fewer
   * than 2 distinct signer keys verify). Per §1.7.6 verifiers MUST flag
   * missing cross-attestation; consumers decide policy.
   */
  cross_attestation?: CrossAttestationAnnotation
  /**
   * Optional AP2 / Verifiable Intent evidence annotation. Populated only
   * when the caller passes `ap2ViEvidence` and the record is a transaction
   * record. The evidence result is tiered: it does not alter `valid`,
   * `signatureOk`, or `cross_attestation`. Consumers read
   * `ap2_vi_evidence.valid` to decide AP2 / VI authorization posture.
   */
  ap2_vi_evidence?: Ap2ViEvidenceVerification
  /**
   * Generic tiered external evidence blocks. These do not alter `valid` or
   * `signatureOk`; each block carries its own `valid` bit and findings.
   */
  evidence?: EvidenceVerificationBlock[]
  /**
   * §5.5.7 (D137) envelope-form view of `evidence`, populated only when
   * `options.evidenceEnvelopes` is set. Legacy `evidence[]` above stays the
   * compatibility view; this is an additive, mapped projection. Blocks whose
   * `protocol` is not a frozen-legacy string are skipped per §5.8.
   */
  evidenceEnvelopes?: EvidenceEnvelope[]
  /**
   * §1.11.4 delegation walk output (D140). Populated only when the caller
   * supplies `delegationCertificates`. Every field is a signal per §6.7.3:
   * nothing in this block alters `valid` or `signatureOk`, and no
   * delegation fact ever pushes a warning.
   */
  delegation?: DelegationOutcome
  warnings: string[]
}

/**
 * Resolved identity claim for capability-check input. This is the SHAPE
 * @atrib/verify needs from a directory lookup, NOT the @atrib/directory
 * type itself (avoids a hard package dep). Callers pass either:
 *   - the @atrib/directory `IdentityClaim` (structurally compatible), or
 *   - a hand-constructed object with this shape (e.g., from a cache)
 */
export interface ResolvedIdentityClaim {
  creator_key: string
  capabilities?: CapabilityEnvelope
}

export interface VerifyRecordOptions {
  /**
   * Candidate upstream record for provenance_token resolution. If
   * supplied and the candidate's canonical SHA-256[:16] matches the
   * record's provenance_token, the verifier surfaces
   * upstream_record_hash and sets upstream_resolved=true.
   */
  upstreamCandidate?: AtribRecord
  /**
   * Candidate records for informed_by[] resolution. The verifier hashes
   * each candidate (canonical form) and tries to match each
   * informed_by entry against the candidate set. Entries that match a
   * candidate land in `resolved`; entries that do not land in `dangling`.
   * Pass an empty array (or omit) when the verifier has no upstream
   * context, every entry will land in `dangling`, which is informational
   * not invalidating.
   */
  informedByCandidates?: AtribRecord[]
  /**
   * Resolved identity claim for the record's `creator_key`, used for
   * capability_check (D051 / §6.7). When supplied, verifyRecord populates
   * `capability_check` on the result. The claim should be the active
   * envelope at the record's timestamp per §6.7.2 step 1; the caller
   * is responsible for picking the right historical version when the
   * envelope has rotated. When omitted, capability_check is not surfaced.
   *
   * Caller is responsible for fetching this via @atrib/directory's
   * lookup() or a cached equivalent. @atrib/verify intentionally does
   * NOT depend on @atrib/directory.
   */
  identityClaim?: ResolvedIdentityClaim
  /**
   * Caller-supplied facts resolved from the record body or the external
   * protocol event the record commits to. These let capability_check evaluate
   * constraints that are intentionally not present in the compact signed
   * record body, instead of marking them unresolvable.
   */
  resolvedFacts?: ResolvedCapabilityFacts
  /**
   * Caller-supplied external authorization evidence. Each block is verified
   * off the atrib record-validity path and attaches to `result.evidence`.
   */
  authorizationEvidence?: AuthorizationEvidenceInput[]
  /**
   * When true, verifyRecord also emits `result.evidenceEnvelopes`: each
   * frozen-legacy `evidence[]` block mapped to §5.5.7 envelope form. Off by
   * default so existing consumers see byte-identical output.
   */
  evidenceEnvelopes?: boolean
  /**
   * Delegation certificates covering the record's creator_key, supplied by
   * the caller from any §1.11.8 carrier (sidecar, archive evidence,
   * evidence envelope, out-of-band). When present (even as an empty
   * array), verifyRecord runs the §1.11.4 walk and attaches
   * `result.delegation`. Omitted → no delegation block (depth-0 records
   * verify exactly as today).
   */
  delegationCertificates?: DelegationCertificate[]
  /**
   * The context genesis record for cert_bound / delegation_unresolved
   * evaluation (§1.11.3). When omitted and the record is its own genesis
   * (chain_root === genesisChainRoot(context_id)), the record itself is
   * used; otherwise the genesis is treated as unavailable (cert_bound null).
   */
  contextGenesis?: AtribRecord
  /**
   * Keys the caller resolved as revoked at the record's log position
   * (§1.9.3 log_index cutoff applied by the caller).
   */
  delegationRevokedKeys?: ReadonlySet<string>
  /**
   * Caller-supplied AP2 / Verifiable Intent evidence for transaction
   * records. The signed atrib record commits to transaction payload hashes,
   * not full AP2 / VI bodies, so the verifier does not fetch or infer this
   * object. When supplied for a transaction record, the async AP2 / VI
   * checker runs and attaches its result as `ap2_vi_evidence`.
   */
  ap2ViEvidence?: Ap2ViEvidenceBundle
  /** Options passed through to `verifyAp2ViEvidenceAsync()`. */
  ap2ViEvidenceOptions?: VerifyAp2ViEvidenceOptions
  /**
   * Trust set for transaction cross-attestation (§1.7.6 trusted signer
   * composition). Base64url Ed25519 public keys the verifier trusts as
   * independent attesting principals. When supplied, `cross_attestation`
   * additionally surfaces `signers_trusted` and `sybil_suspected` so a
   * consumer can gate non-malleable authority on trusted (not merely
   * verified) signer keys, via `isTrustedCrossAttested`. When omitted, the
   * trust fields are not surfaced and cross_attestation is byte-identical to
   * its pre-trust shape. Same trust vocabulary as handoff verification's
   * `trusted_creator_keys`. Signal only: never flips record validity.
   */
  trustedCreatorKeys?: string[]
}

/**
 * Verify one signed record.
 *
 * Always returns a result; never throws. Per spec §5.8 graceful-
 * degradation: invalid inputs (malformed signature, malformed
 * provenance_token, etc.) are surfaced via warnings + signatureOk=false
 * rather than thrown errors.
 */
export async function verifyRecord(
  record: AtribRecord,
  options: VerifyRecordOptions = {},
): Promise<RecordVerificationResult> {
  const warnings: string[] = []

  // §1.2.1 + §1.7.6: the top-level `signature` field is OPTIONAL on
  // transaction records that carry the `signers[]` array. For that shape,
  // the creator's signer entry is the record's base signature path. Other
  // signers stay cross-attestation evidence and do not make a record valid
  // on behalf of the top-level creator.
  const isTransaction = record.event_type === 'https://atrib.dev/v1/types/transaction'
  const hasSignersArray = Array.isArray(record.signers) && record.signers.length > 0
  const useCreatorSignerSignature = isTransaction && hasSignersArray

  let signatureOk = false
  if (useCreatorSignerSignature) {
    try {
      signatureOk = await verifyCreatorSignerSignature(record)
      if (!signatureOk) warnings.push('creator signer verification failed')
    } catch (err) {
      warnings.push(`creator signer verification error: ${(err as Error).message}`)
    }
  } else {
    try {
      signatureOk = await verifyRecordSignature(record)
      if (!signatureOk) warnings.push('signature verification failed')
    } catch (err) {
      warnings.push(`signature verification error: ${(err as Error).message}`)
    }
  }

  const result: RecordVerificationResult = {
    valid: false,
    signatureOk,
    posture: detectPosture(record, warnings),
    warnings,
  }

  // provenance_token is OPTIONAL per spec §1.2.6, surface only when present.
  const provenanceToken = record.provenance_token
  if (typeof provenanceToken === 'string') {
    if (!PROVENANCE_TOKEN_PATTERN.test(provenanceToken)) {
      warnings.push(
        `provenance_token has invalid format (expected 22-char base64url): ${provenanceToken.slice(0, 32)}`,
      )
    } else {
      result.provenance = resolveProvenance(provenanceToken, options.upstreamCandidate)
    }
  }

  // informed_by is OPTIONAL per spec §1.2.5, surface only when present and non-empty.
  if (record.informed_by && record.informed_by.length > 0) {
    result.informed_by_resolution = resolveInformedBy(
      record.informed_by,
      options.informedByCandidates ?? [],
      warnings,
    )
  }

  // capability_check (D051 / §6.7), surface only when caller supplied a
  // resolved identity claim. We do not look up the claim ourselves to
  // avoid coupling @atrib/verify to @atrib/directory's WASM bridge.
  if (options.identityClaim) {
    result.capability_check = resolveCapabilityCheck(
      record,
      options.identityClaim,
      options.resolvedFacts,
      warnings,
    )
  }

  // cross_attestation (D052 / §1.7.6), surface only on transaction records.
  // Other event types continue to use the standard single-signer path.
  if (record.event_type === 'https://atrib.dev/v1/types/transaction') {
    result.cross_attestation = await resolveCrossAttestation(record, options.trustedCreatorKeys)
  }

  if (options.ap2ViEvidence !== undefined) {
    if (record.event_type === 'https://atrib.dev/v1/types/transaction') {
      try {
        result.ap2_vi_evidence = await verifyAp2ViEvidenceAsync(
          options.ap2ViEvidence,
          options.ap2ViEvidenceOptions,
        )
        pushEvidence(result, ap2ViEvidenceToBlock(result.ap2_vi_evidence))
      } catch (err) {
        result.ap2_vi_evidence = ap2ViEvidenceErrorResult(err)
        pushEvidence(result, ap2ViEvidenceToBlock(result.ap2_vi_evidence))
      }
    } else {
      warnings.push('ap2_vi_evidence supplied for non-transaction record')
    }
  }

  if (options.authorizationEvidence) {
    for (const evidence of options.authorizationEvidence) {
      try {
        pushEvidence(result, await verifyAuthorizationEvidence(evidence))
      } catch (err) {
        pushEvidence(result, authorizationEvidenceErrorResult(err))
      }
    }
  }

  // delegation (D140 / §1.11.4): signal-not-block. The walk never throws,
  // never pushes warnings, and never affects `valid` — delegation is
  // attribution resolution, exactly like the D051 capability check.
  if (options.delegationCertificates !== undefined) {
    const genesis =
      options.contextGenesis ??
      (record.chain_root === genesisChainRoot(record.context_id) ? record : null)
    result.delegation = await evaluateDelegation(
      record as DelegatedRecord,
      genesis as DelegatedRecord | null,
      options.delegationCertificates,
      options.delegationRevokedKeys ? { revokedKeys: options.delegationRevokedKeys } : {},
    )
  }

  if (options.evidenceEnvelopes && result.evidence) {
    const envelopes: EvidenceEnvelope[] = []
    for (const block of result.evidence) {
      try {
        envelopes.push(mapLegacyEvidenceBlock(block as unknown as LegacyEvidenceBlock))
      } catch {
        // §5.8: non-frozen-protocol blocks (e.g. 'authorization' errors) are
        // skipped, never thrown to the caller.
      }
    }
    if (envelopes.length > 0) result.evidenceEnvelopes = envelopes
  }

  result.valid = signatureOk && warnings.length === 0
  return result
}

function ap2ViEvidenceErrorResult(err: unknown): Ap2ViEvidenceVerification {
  const message = err instanceof Error ? err.message : String(err)
  return {
    valid: false,
    transactionAccepted: false,
    ap2: {},
    vi: {
      mode: 'unknown',
      credentials: [],
      delegationOk: null,
      checkoutPaymentBindingOk: null,
      constraints: { status: 'not_checked', checks: [] },
    },
    errors: [`ap2_vi_evidence verification error: ${message}`],
    warnings: [],
  }
}

function pushEvidence(result: RecordVerificationResult, block: EvidenceVerificationBlock): void {
  if (!result.evidence) result.evidence = []
  result.evidence.push(block)
}

function ap2ViEvidenceToBlock(result: Ap2ViEvidenceVerification): EvidenceVerificationBlock {
  return {
    protocol: 'ap2_vi',
    valid: result.valid,
    issuer: null,
    subject: null,
    scope: [],
    attenuation_ok: result.vi.constraints.status === 'passed' ? true : null,
    delegation_ok: result.vi.delegationOk,
    constraints: result.vi.constraints.checks.map((constraint) => {
      const status =
        constraint.status === 'passed'
          ? 'passed'
          : constraint.status === 'failed'
            ? 'failed'
            : constraint.status === 'unresolved'
              ? 'unresolved'
              : 'not_checked'
      return constraint.reason
        ? { type: constraint.type, status, reason: constraint.reason }
        : { type: constraint.type, status }
    }),
    errors: result.errors,
    warnings: result.warnings,
    details: result,
  }
}

function authorizationEvidenceErrorResult(err: unknown): EvidenceVerificationBlock {
  const message = err instanceof Error ? err.message : String(err)
  return {
    protocol: 'authorization',
    valid: false,
    issuer: null,
    subject: null,
    scope: [],
    attenuation_ok: null,
    delegation_ok: null,
    constraints: [],
    errors: [`authorization_evidence verification error: ${message}`],
    warnings: [],
  }
}

function resolveProvenance(
  token: string,
  upstreamCandidate: AtribRecord | undefined,
): ProvenanceAnnotation {
  if (!upstreamCandidate) {
    return { token, upstream_record_hash: null, upstream_resolved: false }
  }

  const candidateHashBytes = sha256(canonicalRecord(upstreamCandidate))
  const candidateTokenBytes = candidateHashBytes.slice(0, 16)
  const candidateToken = base64urlEncode(candidateTokenBytes)

  if (candidateToken !== token) {
    return { token, upstream_record_hash: null, upstream_resolved: false }
  }

  const fullHash = `sha256:${hexEncode(candidateHashBytes)}`
  return { token, upstream_record_hash: fullHash, upstream_resolved: true }
}

function resolveInformedBy(
  entries: string[],
  candidates: AtribRecord[],
  warnings: string[],
): InformedByAnnotation {
  // Pre-hash every candidate once. Each entry is a sha256:<64hex> ref;
  // matching is by string comparison against the candidate's full hash.
  const candidateHashes = new Set<string>()
  for (const c of candidates) {
    candidateHashes.add(`sha256:${hexEncode(sha256(canonicalRecord(c)))}`)
  }

  const resolved: string[] = []
  const dangling: string[] = []
  for (const entry of entries) {
    if (!SHA256_REF_PATTERN.test(entry)) {
      warnings.push(`informed_by entry has invalid format: ${entry.slice(0, 80)}`)
      continue
    }
    if (candidateHashes.has(entry)) {
      resolved.push(entry)
    } else {
      dangling.push(entry)
    }
  }

  return { resolved, dangling }
}

/**
 * Capability-check derivation per spec §6.7.2.
 *
 * The signer's claim may declare a capability envelope. We check the
 * record against each present sub-field of the envelope and report any
 * mismatches. The caller is responsible for supplying the ACTIVE envelope
 * at the record's timestamp (i.e., picking the right historical version
 * when capabilities have rotated per §6.7.4).
 *
 * Per §6.7.3 mismatches are SIGNALS, not invalidation. We don't push
 * mismatches into `warnings` (which would set `valid: false`); they go
 * into the structured `mismatches[]` field for consumer policy to weigh.
 *
 * For constraints whose underlying facts are not present in the compact
 * signed record, callers can pass `resolvedFacts`. Missing facts are
 * flagged as `unresolvable` rather than silently passed.
 */
function resolveCapabilityCheck(
  record: AtribRecord,
  claim: ResolvedIdentityClaim,
  facts: ResolvedCapabilityFacts | undefined,
  _warnings: string[],
): CapabilityCheckAnnotation {
  const envelope = claim.capabilities ?? null
  // Empty envelope or absent capabilities field: no constraint declared.
  // Per §6.7.1: "A claim with `capabilities: {}` declares no scope."
  if (!envelope || Object.keys(envelope).length === 0) {
    return { envelope: null, in_envelope: true, mismatches: [], unresolvable: false }
  }

  const mismatches: string[] = []
  let unresolvable = false

  // expires_at: envelope expired when the record's timestamp is after the cutoff.
  // Per §6.7.2: expired envelope is "treated as having no constraint and flagged
  // separately", we add the mismatch but don't treat it as out-of-envelope on
  // its own; other sub-fields still apply if present.
  if (typeof envelope.expires_at === 'number' && record.timestamp > envelope.expires_at) {
    mismatches.push(
      `envelope expired at ${envelope.expires_at}; record timestamp ${record.timestamp}`,
    )
  }

  // event_types: the record's event_type URI must be in the allowlist.
  if (Array.isArray(envelope.event_types) && envelope.event_types.length > 0) {
    if (!envelope.event_types.includes(record.event_type)) {
      mismatches.push(`event_type '${record.event_type}' not in allowlist`)
    }
  }

  // tool_names: per §6.7.2 step 2, only applies to tool_call records and
  // requires a resolved tool_name. The field may be present on the record
  // under §8.2 or supplied by the caller from local body material.
  if (Array.isArray(envelope.tool_names) && envelope.tool_names.length > 0) {
    if (record.event_type === 'https://atrib.dev/v1/types/tool_call') {
      const toolName = facts?.tool_name ?? record.tool_name
      if (typeof toolName === 'string' && toolName.length > 0) {
        if (!envelope.tool_names.includes(toolName)) {
          mismatches.push(`tool_name '${toolName}' not in allowlist`)
        }
      } else {
        unresolvable = true
      }
    }
  }

  // max_amount + counterparties: per §6.7.2 the verifier uses the
  // protocol-specific transaction event the record commits to. The caller
  // supplies those resolved facts when available.
  if (record.event_type === 'https://atrib.dev/v1/types/transaction') {
    if (envelope.max_amount) {
      const amount = facts?.transaction_amount
      if (!amount) {
        unresolvable = true
      } else if (amount.currency !== envelope.max_amount.currency) {
        mismatches.push(
          `transaction currency '${amount.currency}' does not match envelope currency '${envelope.max_amount.currency}'`,
        )
      } else if (amount.value > envelope.max_amount.value) {
        mismatches.push(
          `transaction amount ${amount.value} exceeds envelope max ${envelope.max_amount.value}`,
        )
      }
    }

    if (Array.isArray(envelope.counterparties) && envelope.counterparties.length > 0) {
      const counterparty = facts?.transaction_counterparty
      if (!counterparty) {
        unresolvable = true
      } else if (!envelope.counterparties.includes(counterparty)) {
        mismatches.push(`counterparty '${counterparty}' not in allowlist`)
      }
    }
  }

  return {
    envelope,
    in_envelope: mismatches.length === 0,
    mismatches,
    unresolvable,
  }
}

/**
 * Cross-attestation derivation per spec §1.7.6 (D052).
 *
 * For each entry in `record.signers`, verify the Ed25519 signature
 * against the cross-attestation canonical bytes (JCS form with
 * `signers: []` and the top-level `signature` field omitted). Count
 * distinct valid signer keys; flag `missing: true` when fewer than 2
 * independent keys verify.
 *
 * Per §1.7.6 mismatches are SIGNALS, not invalidation: missing
 * cross-attestation does NOT push to `warnings[]` (which would flip
 * `valid` to false). The legacy top-level `signature` (already
 * verified above by `verifyRecordSignature`) keeps the record
 * cryptographically valid; cross_attestation is a policy signal.
 */
async function resolveCrossAttestation(
  record: AtribRecord,
  trustedCreatorKeys?: string[],
): Promise<CrossAttestationAnnotation> {
  // §1.7.6 trusted signer composition. `signers_valid` and `missing` keep
  // their existing (trust-blind) semantics on every path. `trust_evaluated`
  // is ALWAYS attached, so `false` is a loud signal that only the trust-blind
  // count was computed. When a trust set is supplied we additionally attach
  // `signers_trusted` / `sybil_suspected` by intersecting the already-verified
  // keys with the trust set. Signal only: never pushes to warnings[] or flips
  // `valid`.
  const withTrust = (
    base: { signers_count: number; signers_valid: number; missing: boolean },
    validKeys: ReadonlySet<string>,
  ): CrossAttestationAnnotation => {
    if (trustedCreatorKeys === undefined) return { ...base, trust_evaluated: false }
    const trustSet = new Set(trustedCreatorKeys)
    let signers_trusted = 0
    for (const key of validKeys) if (trustSet.has(key)) signers_trusted++
    return {
      ...base,
      trust_evaluated: true,
      signers_trusted,
      sybil_suspected: base.signers_valid >= 2 && signers_trusted < 2,
    }
  }

  const signers = Array.isArray(record.signers) ? record.signers : []
  const signers_count = signers.length
  const NO_KEYS: ReadonlySet<string> = new Set()

  if (signers_count === 0) {
    // Legacy single-signer transaction record. Per §1.7.6 normative
    // minimum is 2; flag as missing.
    return withTrust({ signers_count: 0, signers_valid: 0, missing: true }, NO_KEYS)
  }

  // All signers cover the same canonical bytes (§1.7.6).
  let canonicalBytes: Uint8Array
  try {
    canonicalBytes = canonicalCrossAttestationInput(record)
  } catch {
    // Canonicalization shouldn't fail on a structurally-valid record;
    // if it does, treat all signers as unverifiable.
    return withTrust({ signers_count, signers_valid: 0, missing: true }, NO_KEYS)
  }

  const validSignerKeys = new Set<string>()
  for (const entry of signers as SignerEntry[]) {
    if (typeof entry?.creator_key !== 'string' || typeof entry?.signature !== 'string') continue
    try {
      const pubKey = base64urlDecode(entry.creator_key)
      const sig = base64urlDecode(entry.signature)
      const ok = await ed.verifyAsync(sig, canonicalBytes, pubKey)
      if (ok) validSignerKeys.add(entry.creator_key)
    } catch {
      // Malformed key/sig bytes: skip without counting.
    }
  }
  const signers_valid = validSignerKeys.size

  return withTrust(
    {
      signers_count,
      signers_valid,
      missing: signers_valid < 2,
    },
    validSignerKeys,
  )
}

async function verifyCreatorSignerSignature(record: AtribRecord): Promise<boolean> {
  const signers = Array.isArray(record.signers) ? record.signers : []
  const creatorSigners = signers.filter((entry) => entry.creator_key === record.creator_key)
  if (creatorSigners.length === 0) return false

  const verifyInput = canonicalCrossAttestationInput(record)
  for (const creatorSigner of creatorSigners) {
    try {
      const pubKey = base64urlDecode(creatorSigner.creator_key)
      const sig = base64urlDecode(creatorSigner.signature)
      if (pubKey.length !== 32 || sig.length !== 64) continue
      if (await ed.verifyAsync(sig, verifyInput, pubKey)) return true
    } catch {
      // Try the next matching signer entry.
    }
  }
  return false
}

function detectPosture(record: AtribRecord, warnings: string[]): PostureAnnotation {
  const declared = record.timestamp_granularity
  const explicit = typeof declared === 'string'
  const granularity = explicit ? declared! : ('ms' as const)

  // Spec §8.4 invariant: timestamp must match the granularity's trailing-zero pattern.
  const multiplier = GRANULARITY_MULTIPLIER[granularity]
  const consistent = record.timestamp % multiplier === 0
  if (!consistent) {
    warnings.push(
      `timestamp_granularity declares '${granularity}' but timestamp ${record.timestamp} is not a multiple of ${multiplier}`,
    )
  }

  // Spec §8.3 commitment-posture detection: presence of args_salt /
  // result_salt indicates the salted-sha256 scheme; absence indicates the
  // default plain-sha256 scheme. The hmac-sha256 variant from §8.3 is
  // signaled out-of-band and is not structurally detectable.
  const args_commitment_form =
    typeof record.args_salt === 'string' ? 'salted-sha256' : 'plain-sha256'
  const result_commitment_form =
    typeof record.result_salt === 'string' ? 'salted-sha256' : 'plain-sha256'

  // Spec §8.2 / D061 tool_name_form: hashed when the value matches the
  // `sha256:<hex>` form (unambiguous), plain otherwise (verbatim vs opaque
  // not structurally distinguishable), null when the field is absent.
  let tool_name_form: 'hashed' | 'plain' | null = null
  if (typeof record.tool_name === 'string') {
    tool_name_form = TOOL_NAME_HASHED_PATTERN.test(record.tool_name) ? 'hashed' : 'plain'
  }

  return {
    timestamp_granularity: granularity,
    timestamp_consistent: consistent,
    timestamp_granularity_explicit: explicit,
    args_commitment_form,
    result_commitment_form,
    tool_name_form,
  }
}

// Re-exported defensively so consumers that want stricter validation can
// align with the same regex atrib-emit's input schema enforces.
export const __test_only__ = {
  PROVENANCE_TOKEN_PATTERN,
  SHA256_REF_PATTERN,
  GRANULARITY_MULTIPLIER,
  resolveProvenance,
  resolveInformedBy,
  resolveCapabilityCheck,
  resolveCrossAttestation,
  detectPosture,
  base64urlDecode,
}
