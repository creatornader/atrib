// SPDX-License-Identifier: Apache-2.0

/**
 * Per-record verification (single AtribRecord).
 *
 * Distinct from `AtribVerifier.verify(recommendationDoc)` which verifies a
 * settlement recommendation document by re-running the §4.6 calculation.
 * This module verifies one signed record at a time and surfaces the
 * per-record annotations defined in the package README:
 *
 *   - provenance: { token, upstream_record_hash, upstream_resolved }
 *
 * Other annotations the README mentions (informed_by_resolution,
 * capability_check, cross_attestation, cross_log_*, posture detection)
 * are not yet implemented; see DECISIONS.md "Pending decisions" for the
 * planned reconciliation. Adding them follows the same shape: an optional
 * field on RecordVerificationResult populated when applicable to the record.
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
 *
 * The token is the first 16 bytes of SHA-256(JCS(upstream-record)),
 * base64url-encoded (22 chars). The 16-byte truncation is irreversible:
 * `upstream_record_hash` cannot be derived from `token` alone. A caller
 * must supply the candidate upstream record (or look it up by other
 * means) to produce a populated `upstream_record_hash` and
 * `upstream_resolved=true`.
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
    warnings,
  }

  // provenance_token is OPTIONAL per spec §1.2.6, surface only when present.
  const provenanceToken = (record as AtribRecord & { provenance_token?: string })
    .provenance_token
  if (typeof provenanceToken === 'string') {
    if (!PROVENANCE_TOKEN_PATTERN.test(provenanceToken)) {
      warnings.push(
        `provenance_token has invalid format (expected 22-char base64url): ${provenanceToken.slice(0, 32)}`,
      )
    } else {
      result.provenance = resolveProvenance(provenanceToken, options.upstreamCandidate)
    }
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

  // token = base64url(sha256(canonicalRecord(upstream))[:16])
  // Compare the candidate's canonical-SHA[:16] to the decoded token bytes.
  const candidateHashBytes = sha256(canonicalRecord(upstreamCandidate))
  const candidateTokenBytes = candidateHashBytes.slice(0, 16)
  const candidateToken = base64urlEncode(candidateTokenBytes)

  if (candidateToken !== token) {
    return { token, upstream_record_hash: null, upstream_resolved: false }
  }

  // Match: surface the full record_hash so the caller doesn't need to
  // recompute. The full hash uses the same canonicalRecord input.
  const fullHash = `sha256:${hexEncode(candidateHashBytes)}`
  return { token, upstream_record_hash: fullHash, upstream_resolved: true }
}

// Re-exported defensively so consumers that want stricter validation can
// align with the same regex atrib-emit's input schema enforces.
export const __test_only__ = {
  PROVENANCE_TOKEN_PATTERN,
  SHA256_REF_PATTERN,
  resolveProvenance,
  base64urlDecode, // referenced for test setup; export keeps it tree-shakable
}
