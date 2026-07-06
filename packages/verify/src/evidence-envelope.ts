// SPDX-License-Identifier: Apache-2.0

/**
 * Universal evidence envelope (spec §5.5.7, D137).
 *
 * The single protocol-level attachment model for all externally verifiable
 * material: OAuth / MCP authorization results, AAuth tokens, x401 proofs,
 * AP2 / Verifiable Intent receipts, human approvals, counterparty
 * co-signature receipts, delegation certificates, and every future evidence
 * type. Each evidence type is a *profile* of the envelope, identified by an
 * absolute HTTPS type URI and versioned independently of the specification.
 *
 * Envelopes are verifier-layer objects. They never touch signed bytes, never
 * enter the 90-byte log entry or a propagation token, and never alter record
 * signature verification, graph derivation, settlement calculation, or
 * `verifyRecord().valid`. Consumers apply their own policy over tiers.
 *
 * This module is the real library surface that the §5.5.7 conformance corpus
 * (`spec/conformance/evidence-envelope/`) exercises through the reference
 * consumer at `packages/verify/test/conformance-evidence-envelope.test.ts`.
 *
 * Producer-side writers of these envelopes follow the §5.8 degradation
 * contract: catch-all, silent-failure, `atrib:`-prefixed logging. A failed
 * envelope construction drops the envelope, never the record or the primary
 * tool response. The pure functions here throw only for the one normative
 * MUST-reject case in the legacy mapping (an unknown legacy protocol string);
 * callers running producer-side wrap that call per §5.8.
 */

import canonicalize from 'canonicalize'
import { hexEncode, sha256 } from '@atrib/mcp'
import type { EvidenceConstraintCheck, EvidenceVerificationBlock } from './authorization-evidence.js'

// ─── Closed enums (normative, spec §5.5.7) ─────────────────────────────

/** Tier ladder, ordered by independent reproducibility. Closed at four. */
export const EVIDENCE_TIERS = ['declared', 'shape', 'attested', 'verified'] as const
export type EvidenceTier = (typeof EVIDENCE_TIERS)[number]

/** Where the payload bytes are retrievable. Closed at five. */
export const EVIDENCE_REF_KINDS = ['inline', 'mirror', 'archive', 'external', 'withheld'] as const
export type EvidenceRefKind = (typeof EVIDENCE_REF_KINDS)[number]

/** Constraint status, reused unchanged from the §5.5.6 block shape. */
export const EVIDENCE_CONSTRAINT_STATUSES = [
  'passed',
  'failed',
  'unresolved',
  'not_checked',
] as const
export type EvidenceConstraintStatus = (typeof EVIDENCE_CONSTRAINT_STATUSES)[number]

/** `payload.hash` / `ref.record_hash` format: `sha256:` + 64 lowercase hex. */
export const SHA256_REF_PATTERN = /^sha256:[0-9a-f]{64}$/

/** atrib-maintained profiles live under this base URI. */
export const ATRIB_PROFILE_BASE = 'https://atrib.dev/v1/evidence/'

// ─── atrib-maintained profile registry (spec §5.5.7) ───────────────────

/**
 * The initial atrib-maintained registry. Profile identity is the FULL URI;
 * a bare name here is only the trailing path component under
 * {@link ATRIB_PROFILE_BASE}. Third parties register their own absolute
 * HTTPS URIs on domains they control and never appear in this list.
 */
export const ATRIB_PROFILE_REGISTRY = [
  'oauth2',
  'mcp-oauth',
  'aauth',
  'x401',
  'ap2-vi',
  'human-approval',
  'counterparty-attestation',
  'delegation-certificate',
] as const
export type AtribProfileName = (typeof ATRIB_PROFILE_REGISTRY)[number]

/** Full type URI for an atrib-maintained profile name. */
export function atribProfileUri(name: AtribProfileName): string {
  return `${ATRIB_PROFILE_BASE}${name}`
}

/** Convenience map from atrib profile name to its full type URI. */
export const ATRIB_PROFILE_URIS: Readonly<Record<AtribProfileName, string>> = Object.freeze(
  Object.fromEntries(
    ATRIB_PROFILE_REGISTRY.map((name) => [name, `${ATRIB_PROFILE_BASE}${name}`]),
  ) as Record<AtribProfileName, string>,
)

// ─── Frozen legacy protocol set (spec §5.5.7) ──────────────────────────

/**
 * The pre-envelope §5.5.6 `protocol` string set, frozen at exactly five
 * values. No new legacy protocol string may be introduced anywhere in the
 * substrate; every new evidence type registers as an envelope profile.
 */
export const FROZEN_LEGACY_PROTOCOLS = ['oauth2', 'mcp_oauth', 'aauth', 'x401', 'ap2_vi'] as const
export type FrozenLegacyProtocol = (typeof FROZEN_LEGACY_PROTOCOLS)[number]

/** The fixed five-row legacy-protocol → profile-URI table. Complete and final. */
export const LEGACY_PROTOCOL_TO_PROFILE: Readonly<Record<FrozenLegacyProtocol, string>> =
  Object.freeze({
    oauth2: `${ATRIB_PROFILE_BASE}oauth2`,
    mcp_oauth: `${ATRIB_PROFILE_BASE}mcp-oauth`,
    aauth: `${ATRIB_PROFILE_BASE}aauth`,
    x401: `${ATRIB_PROFILE_BASE}x401`,
    ap2_vi: `${ATRIB_PROFILE_BASE}ap2-vi`,
  })

// ─── Envelope schema (normative, spec §5.5.7) ──────────────────────────

/** Retrievability reference. `record_hash` is a sibling of `kind`, never a kind value. */
export interface EvidenceEnvelopeRef {
  kind: EvidenceRefKind
  uri?: string | null
  /**
   * When set, declares the payload is itself a signed atrib record;
   * `payload.hash` commits to that record's canonical JCS bytes. MAY
   * accompany any `kind` except `inline`.
   */
  record_hash?: string | null
}

export interface EvidenceEnvelopePayload {
  hash: string
  media_type?: string
  ref: EvidenceEnvelopeRef
  /** Raw payload, local-only, never public. Permitted ONLY under ref.kind 'inline'. */
  inline?: unknown
}

export interface EvidenceEnvelopeResult {
  valid: boolean
  constraints: EvidenceConstraintCheck[]
  errors: string[]
  warnings: string[]
}

export interface EvidenceEnvelopeVerifier {
  name: string
  version?: string
  checked_at_ms?: number
}

/** The one schema, versioned by the integer `envelope` field. */
export interface EvidenceEnvelope {
  envelope: 1
  profile: string
  profile_version: string
  tier: EvidenceTier
  payload: EvidenceEnvelopePayload
  facts?: Record<string, unknown>
  result: EvidenceEnvelopeResult
  verifier?: EvidenceEnvelopeVerifier
}

// ─── Validation (normative shape rules, spec §5.5.7) ───────────────────

export interface EnvelopeValidation {
  valid: boolean
  /** Machine-readable reject reason codes; empty iff accepted. */
  reasons: string[]
}

function isHttpsUri(value: unknown): boolean {
  if (typeof value !== 'string') return false
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  return url.protocol === 'https:'
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Validate an envelope against the normative §5.5.7 shape rules. Returns a
 * closed set of reason codes; an empty `reasons` array (and `valid: true`)
 * means the envelope is well-formed. Rejecting an envelope never rejects the
 * record it attaches to. This function does not throw.
 *
 * Reason codes: `envelope_version`, `profile_uri`, `profile_version`, `tier`,
 * `payload`, `payload_hash`, `ref`, `ref_kind`, `inline_without_inline_kind`,
 * `record_hash_format`, `record_hash_with_inline_kind`, `result`,
 * `result_valid`, `result_constraints`, `constraint_status`, `result_errors`,
 * `result_warnings`, `verifier`.
 */
export function validateEnvelope(envelope: unknown): EnvelopeValidation {
  const reasons: string[] = []

  if (!isPlainObject(envelope)) {
    return { valid: false, reasons: ['envelope'] }
  }

  if (envelope['envelope'] !== 1) reasons.push('envelope_version')

  if (!isHttpsUri(envelope['profile'])) reasons.push('profile_uri')

  const profileVersion = envelope['profile_version']
  if (typeof profileVersion !== 'string' || profileVersion.length === 0) {
    reasons.push('profile_version')
  }

  const tier = envelope['tier']
  if (typeof tier !== 'string' || !(EVIDENCE_TIERS as readonly string[]).includes(tier)) {
    reasons.push('tier')
  }

  const payload = envelope['payload']
  if (!isPlainObject(payload)) {
    reasons.push('payload')
  } else {
    const hash = payload['hash']
    if (typeof hash !== 'string' || !SHA256_REF_PATTERN.test(hash)) {
      reasons.push('payload_hash')
    }

    const ref = payload['ref']
    if (!isPlainObject(ref)) {
      reasons.push('ref')
    } else {
      const kind = ref['kind']
      if (typeof kind !== 'string' || !(EVIDENCE_REF_KINDS as readonly string[]).includes(kind)) {
        reasons.push('ref_kind')
      }
      // inline is permitted ONLY when ref.kind is 'inline'.
      if (payload['inline'] !== undefined && kind !== 'inline') {
        reasons.push('inline_without_inline_kind')
      }
      const recordHash = ref['record_hash']
      if (recordHash !== undefined && recordHash !== null) {
        if (typeof recordHash !== 'string' || !SHA256_REF_PATTERN.test(recordHash)) {
          reasons.push('record_hash_format')
        }
        // record_hash is redundant with an inline body.
        if (kind === 'inline') reasons.push('record_hash_with_inline_kind')
      }
    }
  }

  const result = envelope['result']
  if (!isPlainObject(result)) {
    reasons.push('result')
  } else {
    if (typeof result['valid'] !== 'boolean') reasons.push('result_valid')
    const constraints = result['constraints']
    if (!Array.isArray(constraints)) {
      reasons.push('result_constraints')
    } else {
      for (const entry of constraints) {
        const status = isPlainObject(entry) ? entry['status'] : undefined
        if (
          typeof status !== 'string' ||
          !(EVIDENCE_CONSTRAINT_STATUSES as readonly string[]).includes(status)
        ) {
          reasons.push('constraint_status')
          break
        }
      }
    }
    if (!Array.isArray(result['errors'])) reasons.push('result_errors')
    if (!Array.isArray(result['warnings'])) reasons.push('result_warnings')
  }

  const verifier = envelope['verifier']
  if (verifier !== undefined) {
    if (
      !isPlainObject(verifier) ||
      typeof verifier['name'] !== 'string' ||
      (verifier['name'] as string).length === 0
    ) {
      reasons.push('verifier')
    }
  }

  return { valid: reasons.length === 0, reasons }
}

/** True iff the envelope is well-formed per {@link validateEnvelope}. */
export function isValidEnvelope(envelope: unknown): envelope is EvidenceEnvelope {
  return validateEnvelope(envelope).valid
}

// ─── Profile classification (spec §5.5.7 registration rule) ────────────

export interface ProfileClassification {
  uri_valid: boolean
  atrib_maintained: boolean
  registered: boolean
  treat_as: 'registered' | 'unknown-preserve'
}

/**
 * Classify a profile URI against the atrib registry. Identity is the full
 * URI: a foreign domain reusing an atrib profile name (e.g.
 * `https://example.com/v1/evidence/oauth2`) is a valid third-party profile
 * and MUST NOT be treated as the atrib profile of the same name.
 *
 * @param registry trailing-name registry to check against; defaults to the
 *   atrib-maintained set. Only consulted for URIs under
 *   {@link ATRIB_PROFILE_BASE}.
 */
export function classifyProfile(
  uri: string,
  registry: readonly string[] = ATRIB_PROFILE_REGISTRY,
): ProfileClassification {
  const uriValid = isHttpsUri(uri)
  const atribMaintained = uriValid && uri.startsWith(ATRIB_PROFILE_BASE)
  const name = atribMaintained ? uri.slice(ATRIB_PROFILE_BASE.length) : ''
  // A nested atrib-shaped path (e.g. .../oauth2/extra) is not a bare
  // registered name; require an exact trailing-name match.
  const registered = atribMaintained && name.length > 0 && registry.includes(name)
  return {
    uri_valid: uriValid,
    atrib_maintained: atribMaintained,
    registered,
    treat_as: registered ? 'registered' : 'unknown-preserve',
  }
}

// ─── Unknown-profile preservation (spec §5.5.7) ────────────────────────

export interface OpaqueEnvelopeRender {
  profile: string
  tier: string
  payload_hash: string
}

/**
 * The opaque rendering surface for any envelope (known or unknown profile):
 * profile URI, tier, and payload hash. Consumers MUST render unknown-profile
 * envelopes this way; they MUST NOT drop them and MUST NOT let them affect
 * record validity. Preservation itself is the identity function — this
 * helper only extracts the safe-to-surface fields.
 */
export function renderEnvelopeOpaque(envelope: EvidenceEnvelope): OpaqueEnvelopeRender {
  return {
    profile: envelope.profile,
    tier: envelope.tier,
    payload_hash: envelope.payload.hash,
  }
}

// ─── Hashing helpers (spec §5.5.7 payload hash rule) ───────────────────

const utf8 = new TextEncoder()

function jcsBytes(value: unknown): Uint8Array {
  const json = canonicalize(value)
  if (json === undefined) throw new Error('canonicalize returned undefined')
  return utf8.encode(json)
}

/** `sha256:` + hex(SHA-256(JCS(value))). The JSON-media-type hash rule. */
export function jcsSha256(value: unknown): string {
  return 'sha256:' + hexEncode(sha256(jcsBytes(value)))
}

/** `sha256:` + hex(SHA-256(UTF-8(text))). The raw-bytes hash rule. */
export function rawSha256(text: string): string {
  return 'sha256:' + hexEncode(sha256(utf8.encode(text)))
}

// ─── Legacy mapping (normative, spec §5.5.7) ───────────────────────────

/**
 * The legacy §5.5.6 evidence block shape as consumed by the mapping. This is
 * structurally the {@link EvidenceVerificationBlock} plus its required
 * fields; the mapping reads only the fields listed here.
 */
export interface LegacyEvidenceBlock {
  protocol: string
  valid: boolean
  issuer: string | null
  subject: string | null
  scope: string[]
  attenuation_ok: boolean | null
  delegation_ok: boolean | null
  constraints: EvidenceConstraintCheck[]
  errors: string[]
  warnings: string[]
  details?: unknown
}

function isFrozenLegacyProtocol(value: string): value is FrozenLegacyProtocol {
  return (FROZEN_LEGACY_PROTOCOLS as readonly string[]).includes(value)
}

/**
 * Deterministically map a legacy §5.5.6 evidence block into envelope form.
 * Two implementations given the same block MUST produce identical envelopes.
 *
 * - `protocol` maps through the fixed five-row table; any other string throws
 *   (`unknown legacy evidence protocol '<protocol>'`). The mapping never
 *   invents a profile URI. Producer-side callers wrap this per §5.8.
 * - The mapped envelope carries `envelope: 1`, `profile_version: "1.0.0"`,
 *   and `tier: "attested"` (a legacy block records what a caller-owned path
 *   accepted; it carries no trust roots, so it never claims `"verified"`).
 * - `payload.hash` commits to the legacy block itself (JCS), with
 *   `media_type: "application/json"` and `ref.kind: "withheld"`.
 * - `issuer` / `subject` / `scope` / `attenuation_ok` / `delegation_ok` copy
 *   into `facts` unchanged (nulls preserved); `details`, when present, is
 *   committed as `facts.details_hash` (never inlined).
 * - `valid` / `constraints` / `errors` / `warnings` copy into `result`.
 * - No `verifier` block: the mapping is mechanical, not a re-verification.
 */
export function mapLegacyEvidenceBlock(block: LegacyEvidenceBlock): EvidenceEnvelope {
  if (!isFrozenLegacyProtocol(block.protocol)) {
    throw new Error(`unknown legacy evidence protocol '${block.protocol}'`)
  }
  const profile = LEGACY_PROTOCOL_TO_PROFILE[block.protocol]

  const facts: Record<string, unknown> = {
    issuer: block.issuer,
    subject: block.subject,
    scope: block.scope,
    attenuation_ok: block.attenuation_ok,
    delegation_ok: block.delegation_ok,
  }
  if (block.details !== undefined) {
    facts['details_hash'] = jcsSha256(block.details)
  }

  return {
    envelope: 1,
    profile,
    profile_version: '1.0.0',
    tier: 'attested',
    payload: {
      hash: jcsSha256(block),
      media_type: 'application/json',
      ref: { kind: 'withheld' },
    },
    facts,
    result: {
      valid: block.valid,
      constraints: block.constraints,
      errors: block.errors,
      warnings: block.warnings,
    },
  }
}

/**
 * Spec-named alias for {@link mapLegacyEvidenceBlock}. §5.5.7 refers to the
 * mapping as `fromLegacyEvidenceBlock`; both names are the same function.
 */
export const fromLegacyEvidenceBlock = mapLegacyEvidenceBlock

/** Map a verifier {@link EvidenceVerificationBlock} whose protocol is frozen-legacy. */
export function envelopeFromEvidenceBlock(block: EvidenceVerificationBlock): EvidenceEnvelope {
  return mapLegacyEvidenceBlock(block as unknown as LegacyEvidenceBlock)
}

// ─── Tier semantics (spec §5.5.7 tier rules) ───────────────────────────

const TIER_RANK: Record<EvidenceTier, number> = {
  declared: 0,
  shape: 1,
  attested: 2,
  verified: 3,
}

/** Numeric rank of a tier (higher = more independently reproducible). */
export function tierRank(tier: EvidenceTier): number {
  return TIER_RANK[tier]
}

/** The dedup identity key for an envelope instance: `(profile, payload.hash)`. */
export function envelopeIdentityKey(envelope: EvidenceEnvelope): string {
  return `${envelope.profile} ${envelope.payload.hash}`
}

/**
 * Order envelope instances the way consumers MUST: tier descending, then
 * `verifier.checked_at_ms` descending, then verifier name ascending. Stable;
 * does not mutate the input.
 */
export function orderEnvelopeInstances<T extends EvidenceEnvelope>(instances: readonly T[]): T[] {
  return [...instances].sort((a, b) => {
    const tierDelta = TIER_RANK[b.tier] - TIER_RANK[a.tier]
    if (tierDelta !== 0) return tierDelta
    const aChecked = a.verifier?.checked_at_ms ?? 0
    const bChecked = b.verifier?.checked_at_ms ?? 0
    if (bChecked !== aChecked) return bChecked - aChecked
    return (a.verifier?.name ?? '').localeCompare(b.verifier?.name ?? '')
  })
}

/**
 * Relay-swap detector. A consumer MUST NOT relay another party's envelope
 * with its own identity in `verifier` or with a raised tier; re-verification
 * produces a new instance with its own checks. An instance that differs from
 * another ONLY in its `verifier` block — same tier, facts, result, payload —
 * is a relay under a swapped identity, not a re-verification, and is flagged.
 */
export function isRelayIdentitySwap(
  original: Record<string, unknown>,
  relayed: Record<string, unknown>,
): boolean {
  const strip = (envelope: Record<string, unknown>): Record<string, unknown> => {
    const clone = { ...envelope }
    delete clone['verifier']
    return clone
  }
  const bodiesIdentical = canonicalize(strip(original)) === canonicalize(strip(relayed))
  const verifierChanged =
    canonicalize(original['verifier'] ?? null) !== canonicalize(relayed['verifier'] ?? null)
  return bodiesIdentical && verifierChanged
}

/**
 * Reproducibility of a well-formed envelope. A `tier: "verified"` envelope
 * whose payload cannot be retrieved (`ref.kind: "withheld"`) is still
 * well-formed; consumers MUST report it as claimed-but-not-reproducible,
 * mirroring the §2.12.7 tiered record-verifiability ladder.
 */
export interface EnvelopeReproducibility {
  reproducible: boolean
  report: 'reproducible' | 'claimed-not-reproducible'
}

export function assessReproducibility(envelope: EvidenceEnvelope): EnvelopeReproducibility {
  const reproducible = envelope.payload.ref.kind !== 'withheld'
  return {
    reproducible,
    report: reproducible ? 'reproducible' : 'claimed-not-reproducible',
  }
}
