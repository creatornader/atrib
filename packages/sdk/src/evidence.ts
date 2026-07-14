// SPDX-License-Identifier: Apache-2.0

/**
 * Evidence envelope types (accepted as D137; normative schema at spec §5.5.7).
 *
 * The SDK models evidence attachments on the universal envelope schema so
 * downstream shapes align before the ADR lands: one envelope, N profiles
 * identified by type URI. The legacy `protocol` string set is frozen at
 * the five values shipped in @atrib/verify; every NEW evidence kind is an
 * envelope profile — the SDK never grows a protocol union.
 *
 * Envelopes live outside signed bytes (mirror sidecar, archive evidence
 * projection, verifier results, host-owned packets). Types only in v0:
 * the SDK does not yet produce or verify envelopes.
 */

export type EvidenceTier = 'declared' | 'shape' | 'attested' | 'verified'

export type EvidencePayloadRefKind =
  | 'inline'
  | 'mirror'
  | 'archive'
  | 'external'
  | 'withheld'

export interface EvidencePayloadRef {
  kind: EvidencePayloadRefKind
  /** For 'archive' / 'external' payload locations. Wire form uses explicit
   * null for absent (§5.5.7 example); both are accepted. */
  uri?: string | null
  /**
   * Set when the payload is itself a signed atrib record (may accompany
   * any kind except 'inline'); payload.hash then commits to that record's
   * canonical JCS bytes.
   */
  record_hash?: string | null
}

export interface EvidencePayload {
  /** "sha256:" + hex commitment to the raw evidence material (raw bytes
   * for non-JSON media types, JCS bytes for JSON payloads). */
  hash: string
  media_type?: string
  ref?: EvidencePayloadRef
  /** Raw payload; ONLY when ref.kind === 'inline'; never public. */
  inline?: unknown
}

export interface EvidenceConstraint {
  /** Profile-defined constraint discriminator (accepted §5.5.7 shape). */
  type: string
  status: 'passed' | 'failed' | 'unresolved' | 'not_checked'
  expected?: unknown
  actual?: unknown
}

export interface EvidenceEnvelope {
  /** Envelope schema version; 1 today. */
  envelope: 1
  /** Absolute HTTPS profile type URI, e.g. https://atrib.dev/v1/evidence/oauth2 */
  profile: string
  /** Semver of the profile document (versions independently of the spec). */
  profile_version: string
  /** What the verifier party actually did — instance property, not truth. */
  tier: EvidenceTier
  payload: EvidencePayload
  /** Profile-defined verifier facts (flat JSON object). */
  facts?: Record<string, unknown>
  result?: {
    valid?: boolean
    constraints?: EvidenceConstraint[]
    errors?: string[]
    warnings?: string[]
  }
  verifier?: {
    name?: string
    version?: string
    checked_at_ms?: number
  }
}

/**
 * Dedup identity per the P042 tier rules: `(profile, payload.hash)`.
 * Multiple instances per key are permitted; consumers order by tier
 * descending, then checked_at_ms descending, then verifier name.
 */
export function evidenceEnvelopeKey(envelope: EvidenceEnvelope): string {
  return `${envelope.profile} ${envelope.payload.hash}`
}

const TIER_ORDER: Record<EvidenceTier, number> = {
  declared: 0,
  shape: 1,
  attested: 2,
  verified: 3,
}

/** Numeric rank of a tier (0 = declared … 3 = verified). */
export function evidenceTierRank(tier: EvidenceTier): number {
  return TIER_ORDER[tier]
}
