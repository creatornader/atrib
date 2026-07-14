// SPDX-License-Identifier: Apache-2.0

/**
 * Evidence envelope production and validation (D137, spec §5.5.7).
 *
 * The real envelope engine lives in `@atrib/verify`, which is an OPTIONAL
 * peer dependency of the SDK (same pattern as `@atrib/recall` /
 * `@atrib/verify-mcp` in client.ts): the peer module is loaded lazily and
 * its absence degrades to a `null` envelope with a warning naming the
 * package — never a throw (§5.8). The structural envelope TYPES stay in
 * ./evidence.ts so the emitted .d.ts never references the optional peer.
 *
 * Throw-vs-degrade split (the SDK-wide contract): contradictory INPUT
 * (both `hash` and `material`; `hash_rule` without `material`; neither
 * commitment source) throws TypeError — programmer error, thrown before
 * the peer is consulted. Everything operational (peer missing, envelope
 * failing §5.5.7 validation) degrades into the returned `warnings`.
 */

import type {
  EvidenceConstraint,
  EvidenceEnvelope,
  EvidencePayloadRef,
  EvidenceTier,
} from './evidence.js'

// Structural view of the '@atrib/verify' surface this module uses. Declared
// locally so the emitted .d.ts never imports from the optional peer.
interface VerifyEnvelopeModule {
  validateEnvelope: (envelope: unknown) => { valid: boolean; reasons: string[] }
  jcsSha256: (value: unknown) => string
  rawSha256: (text: string) => string
}

let verifyEnvelopeModulePromise: Promise<VerifyEnvelopeModule | null> | null = null
function loadVerifyEnvelopeModule(): Promise<VerifyEnvelopeModule | null> {
  verifyEnvelopeModulePromise ??= import('@atrib/verify').then(
    (mod) => mod as unknown as VerifyEnvelopeModule,
    () => null,
  )
  return verifyEnvelopeModulePromise
}

/** Test seam: swap the peer loader. Pass undefined to restore the default. */
export function __setVerifyEnvelopeLoaderForTests(
  loader: (() => Promise<VerifyEnvelopeModule | null>) | undefined,
): void {
  verifyEnvelopeModulePromise = loader ? loader() : null
}

const PEER_MISSING_WARNING =
  "atrib: evidence-envelope support unavailable — install the optional peer '@atrib/verify'"

/** Payload input for {@link buildEvidenceEnvelope}. */
export interface BuildEvidenceEnvelopePayloadInput {
  media_type?: string
  /** Retrievability ref. Default: `{ kind: 'inline' }` when `inline` is set, else `{ kind: 'withheld' }`. */
  ref?: EvidencePayloadRef
  /** Raw payload carried inline (local-only, never public). */
  inline?: unknown
  /** Pre-computed `sha256:<64-hex>` commitment. Mutually exclusive with `material`. */
  hash?: string
  /** Evidence material to hash with `hash_rule`. Mutually exclusive with `hash`. */
  material?: unknown
  /** §5.5.7 hash rule: 'jcs' (JSON media types, default) or 'raw' (UTF-8 text). */
  hash_rule?: 'jcs' | 'raw'
}

export interface BuildEvidenceEnvelopeInput {
  /** Absolute HTTPS profile type URI. */
  profile: string
  /** Semver of the profile document. */
  profile_version: string
  tier: EvidenceTier
  payload: BuildEvidenceEnvelopePayloadInput
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

export interface BuildEvidenceEnvelopeResult {
  /** The validated envelope, or null when degraded (see warnings). */
  envelope: EvidenceEnvelope | null
  /** The peer's `validateEnvelope` outcome, or null when the peer is missing. */
  validation: unknown | null
  warnings: string[]
}

/**
 * Build a §5.5.7 evidence envelope and validate it through the optional
 * `@atrib/verify` peer.
 *
 * - `payload.hash` absent: the commitment is computed from
 *   `payload.material` via the stated `hash_rule` ('jcs' default; 'raw'
 *   requires string material) using the peer's `jcsSha256`/`rawSha256` —
 *   the same functions the conformance corpus pins.
 * - Contradictory input throws TypeError before the peer loads: both
 *   `hash` and `material`, `hash_rule` without `material`, or neither
 *   `hash` nor `material` (no commitment source).
 * - A structurally invalid RESULT (per the peer's `validateEnvelope`)
 *   yields `envelope: null` with the reject reasons in `warnings`.
 * - Peer missing yields `envelope: null` plus a warning naming
 *   '@atrib/verify' (§5.8 degrade, never a throw).
 */
export async function buildEvidenceEnvelope(
  input: BuildEvidenceEnvelopeInput,
): Promise<BuildEvidenceEnvelopeResult> {
  const payload = input.payload
  if (payload.hash !== undefined && payload.material !== undefined) {
    throw new TypeError(
      'atrib: buildEvidenceEnvelope payload carries both hash and material; provide exactly one commitment source',
    )
  }
  if (payload.hash_rule !== undefined && payload.material === undefined) {
    throw new TypeError(
      'atrib: buildEvidenceEnvelope payload has hash_rule without material; hash_rule only applies to material',
    )
  }
  if (payload.hash === undefined && payload.material === undefined) {
    throw new TypeError(
      'atrib: buildEvidenceEnvelope payload needs a hash or material to commit to',
    )
  }
  const hashRule = payload.hash_rule ?? 'jcs'
  if (hashRule === 'raw' && payload.material !== undefined && typeof payload.material !== 'string') {
    throw new TypeError(
      "atrib: buildEvidenceEnvelope hash_rule 'raw' requires string material (UTF-8 text)",
    )
  }

  const warnings: string[] = []
  const mod = await loadVerifyEnvelopeModule()
  if (mod === null) {
    return { envelope: null, validation: null, warnings: [PEER_MISSING_WARNING] }
  }

  try {
    const hash =
      payload.hash ??
      (hashRule === 'raw'
        ? mod.rawSha256(payload.material as string)
        : mod.jcsSha256(payload.material))
    const ref: EvidencePayloadRef =
      payload.ref ?? (payload.inline !== undefined ? { kind: 'inline' } : { kind: 'withheld' })
    const candidate: EvidenceEnvelope = {
      envelope: 1,
      profile: input.profile,
      profile_version: input.profile_version,
      tier: input.tier,
      payload: {
        hash,
        ...(payload.media_type !== undefined ? { media_type: payload.media_type } : {}),
        ref,
        ...(payload.inline !== undefined ? { inline: payload.inline } : {}),
      },
      ...(input.facts !== undefined ? { facts: input.facts } : {}),
      result: {
        valid: input.result?.valid ?? true,
        constraints: input.result?.constraints ?? [],
        errors: input.result?.errors ?? [],
        warnings: input.result?.warnings ?? [],
      },
      ...(input.verifier !== undefined ? { verifier: input.verifier } : {}),
    }
    const validation = mod.validateEnvelope(candidate)
    if (!validation.valid) {
      warnings.push(
        `atrib: built envelope failed §5.5.7 validation (${validation.reasons.join(', ')}); dropping the envelope`,
      )
      return { envelope: null, validation, warnings }
    }
    return { envelope: candidate, validation, warnings }
  } catch (error) {
    // Operational failure inside the peer (e.g. canonicalization of an
    // uncanonicalizable material value): degrade per §5.8, never throw.
    warnings.push(`atrib: evidence envelope construction failed: ${String(error)}`)
    return { envelope: null, validation: null, warnings }
  }
}

export interface ValidateEvidenceEnvelopeResult {
  /** The peer's `validateEnvelope` outcome, or null when the peer is missing. */
  validation: unknown | null
  warnings: string[]
}

/**
 * Validate an envelope against the normative §5.5.7 shape rules via the
 * optional `@atrib/verify` peer. Peer missing degrades to
 * `validation: null` with a warning (§5.8); never throws.
 */
export async function validateEvidenceEnvelope(
  envelope: unknown,
): Promise<ValidateEvidenceEnvelopeResult> {
  const mod = await loadVerifyEnvelopeModule()
  if (mod === null) {
    return { validation: null, warnings: [PEER_MISSING_WARNING] }
  }
  try {
    return { validation: mod.validateEnvelope(envelope), warnings: [] }
  } catch (error) {
    return {
      validation: null,
      warnings: [`atrib: evidence envelope validation failed: ${String(error)}`],
    }
  }
}
