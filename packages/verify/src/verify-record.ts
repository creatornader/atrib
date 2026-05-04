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
 *   - posture:                { timestamp_granularity, timestamp_consistent }       (D045 / §8.4)
 *
 * Pending annotations (tracked in DECISIONS.md P005):
 *   - capability_check:       D051 / §6.7  (needs @atrib/directory integration)
 *   - cross_attestation:      D052 / §1.7.6  (needs `signers[]` type addition + transaction-record signing variant in @atrib/mcp)
 *   - cross_log_*:            D050 / §2.11  (needs multi-log proof-bundle infrastructure)
 *   - tool_name_form / args_commitment_form: §8.2 / §8.3  (needs tool_name + args_hash fields on the record shape, currently only content_id is exposed)
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
 * Posture surfacing for a record. Currently exposes only the timing
 * posture (§8.4); tool_name_form (§8.2) and args_commitment_form (§8.3)
 * require fields that aren't on the current AtribRecord shape.
 *
 * `timestamp_granularity` is the declared coarsening level (or 'ms' by
 * default when absent). `timestamp_consistent` is true iff the timestamp
 * value matches the granularity's trailing-zero invariant per spec §8.4
 * (e.g., 'min' requires `timestamp % 60000 == 0`). A consistent posture
 * means the record's coarsening claim is structurally honest; an
 * inconsistent posture means the implementation declared a granularity
 * that the timestamp doesn't satisfy, which validators and verifiers
 * MUST reject per §8.4.
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
  warnings: string[]
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

  return {
    timestamp_granularity: granularity,
    timestamp_consistent: consistent,
    timestamp_granularity_explicit: explicit,
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
  detectPosture,
  base64urlDecode,
}
