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
 *
 * Pending annotations (tracked in DECISIONS.md P005):
 *   - cross_attestation:      D052 / §1.7.6  (needs `signers[]` type addition + transaction-record signing variant in @atrib/mcp)
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
  canonicalRecord,
  hexEncode,
  sha256,
  verifyRecord as verifyRecordSignature,
  type AtribRecord,
} from '@atrib/mcp'

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

  let signatureOk = false
  try {
    signatureOk = await verifyRecordSignature(record)
    if (!signatureOk) warnings.push('signature verification failed')
  } catch (err) {
    warnings.push(`signature verification error: ${(err as Error).message}`)
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
    result.capability_check = resolveCapabilityCheck(record, options.identityClaim, warnings)
  }

  result.valid = signatureOk && warnings.length === 0
  return result
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
 * For transaction records with `max_amount` or `counterparties`
 * constraints, we set `unresolvable: true`. The protocol-specific
 * transaction event isn't accessible to @atrib/verify; the caller would
 * need to provide the resolved amount + counterparty out-of-band, which
 * is a future-API extension if a real consumer needs it.
 */
function resolveCapabilityCheck(
  record: AtribRecord,
  claim: ResolvedIdentityClaim,
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
    mismatches.push(`envelope expired at ${envelope.expires_at}; record timestamp ${record.timestamp}`)
  }

  // event_types: the record's event_type URI must be in the allowlist.
  if (Array.isArray(envelope.event_types) && envelope.event_types.length > 0) {
    if (!envelope.event_types.includes(record.event_type)) {
      mismatches.push(`event_type '${record.event_type}' not in allowlist`)
    }
  }

  // tool_names: per §6.7.2 step 2, only applies to tool_call records and
  // requires the record's tool_name. The current AtribRecord shape does
  // not expose tool_name (per §8.2 default posture: only content_id is
  // present, which is a hash of serverUrl + toolName). Without tool_name
  // we can't check this constraint. Mark unresolvable.
  if (Array.isArray(envelope.tool_names) && envelope.tool_names.length > 0) {
    if (record.event_type === 'https://atrib.dev/v1/types/tool_call') {
      unresolvable = true
    }
  }

  // max_amount + counterparties: per §6.7.2 the verifier "MUST resolve
  // the transaction amount and counterparty from the protocol-specific
  // transaction event the record commits to". @atrib/verify doesn't
  // have access to the payment-protocol event; flag as unresolvable.
  // Future API extension: accept resolved amount + counterparty as
  // VerifyRecordOptions inputs if a real consumer needs it.
  if (record.event_type === 'https://atrib.dev/v1/types/transaction') {
    if (envelope.max_amount || (Array.isArray(envelope.counterparties) && envelope.counterparties.length > 0)) {
      unresolvable = true
    }
  }

  return {
    envelope,
    in_envelope: mismatches.length === 0,
    mismatches,
    unresolvable,
  }
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
  const args_commitment_form = typeof record.args_salt === 'string' ? 'salted-sha256' : 'plain-sha256'
  const result_commitment_form = typeof record.result_salt === 'string' ? 'salted-sha256' : 'plain-sha256'

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
  detectPosture,
  base64urlDecode,
}
