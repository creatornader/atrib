// SPDX-License-Identifier: Apache-2.0

/**
 * Identity resolution per spec §6.3 — the 9-step verifier consultation
 * algorithm. The verifier consults the directory for a record's
 * creator_key and surfaces an `identity_resolution` object.
 *
 * This implementation is the LEGIBLE PARTIAL: steps 6 (directory
 * lookup), 8 (parse claim), and 9 (revocation cross-check) are wired
 * end-to-end. Steps 1-5 (anchor freshness, witness coverage, directory
 * checkpoint signature, append-only consistency) and step 7 (AKD proof
 * validation) require heavier cryptographic infrastructure and are
 * surfaced as explicit warnings rather than falsely claimed as passing.
 *
 * Per §5.8 degradation contract: this function never throws. Network
 * failures, malformed responses, and timeout conditions all produce
 * warnings in the returned object.
 */

import type { RevocationEntry } from './revocations.js'

/** Identity claim shape from spec §6.1. Mirrored here to avoid an import cycle with @atrib/directory. */
export interface IdentityClaim {
  creator_key: string
  claim_type: 'self_attested' | 'domain_verified' | 'did_resolved'
  claim_method: string
  claim_subject: Record<string, unknown>
  capabilities?: CapabilityEnvelope
  signature: string
}

/** Capability envelope per §6.7 / D051. */
export interface CapabilityEnvelope {
  tool_names?: string[]
  max_amount?: { currency: string; value: number }
  counterparties?: string[]
  event_types?: string[]
  expires_at?: number
}

export type IdentityResolutionMethod =
  | 'directory_lookup'        // step 6 succeeded
  | 'no_anchor_available'     // step 1 surfaced no anchor; result still produced from current state
  | 'no_claim_registered'     // step 6 returned non-membership
  | 'rejected'                // a hard-failure step rejected the result

export interface KeyRevocationStatus {
  reason: 'rotation' | 'retirement' | 'compromise'
  /** Log index of the revocation, used to derive timestamp ordering. */
  revoked_at_log_index: number
  /** True when the record being resolved was signed AFTER revocation (post-revocation). */
  since_revocation: boolean
}

export interface IdentityResolution {
  identity_resolved: IdentityClaim | null
  identity_resolution_method: IdentityResolutionMethod
  capability_envelope: CapabilityEnvelope | null
  key_revocation_status: KeyRevocationStatus | null
  /**
   * lookup_proof_valid: per §6.3 step 7. NULL when the lookup returned
   * non-membership (no proof to validate) or when the verifier hasn't
   * implemented AKD proof validation in JS. The directory returns a
   * proof bytes blob; validation requires the AKD WASM bridge in the
   * verifier process. Currently null for both reasons; warnings flag
   * which one applies.
   */
  lookup_proof_valid: boolean | null
  /** §6.3 step 5 — currently not checked; reflected in warnings. */
  append_only_consistent: boolean | null
  /** §6.3 step 1 — currently not checked; reflected in warnings. */
  anchor: null
  warnings: string[]
}

/**
 * Inputs to the verifyLookupProof callback. Mirrors the signature of
 * `@atrib/directory`'s `verifyLookupProof` so callers can pass it through
 * directly. We re-declare the shape here (rather than importing from
 * `@atrib/directory`) to keep `@atrib/verify` independent of the WASM
 * bridge — same dependency-inversion pattern used for `upstreamCandidate`,
 * `informedByCandidates`, and `identityClaim` elsewhere in this package.
 */
export interface VerifyLookupProofInput {
  vrfPublicKey: Uint8Array
  rootHash: Uint8Array
  currentEpoch: number
  label: string
  proof: Uint8Array
}

export interface ResolveIdentityOptions {
  /** Directory base URL (e.g., https://directory.atrib.dev/v6). */
  directoryEndpoint?: string
  /** Record timestamp (ms) — for the revocation since/before comparison. */
  recordTimestamp?: number
  /**
   * Record's log_index — for revocation ordering per §1.9.3 since the
   * authoritative ordering is by log_index, not timestamp.
   */
  recordLogIndex?: number | null
  /** Pre-built revocation registry from a log scan (recommended). */
  revocations?: Map<string, RevocationEntry>
  /** AbortSignal for timeout / cancellation. */
  signal?: AbortSignal
  /** Override fetch (testing). */
  fetchImpl?: typeof fetch
  /**
   * Directory operator's VRF public key (32 bytes). Required for step 7
   * AKD lookup proof verification. When omitted, step 7 stays warning-only.
   *
   * For the reference HardCodedAkdVRF backend exposed by `@atrib/directory`,
   * use `directoryVrfPublicKey()` from that package. Production directories
   * swapping the VRF backend publish their own VRF pubkey out of band.
   */
  directoryVrfPublicKey?: Uint8Array
  /**
   * Callback that performs AKD lookup proof verification (spec §6.3 step 7).
   * Should be `verifyLookupProof` from `@atrib/directory`. When omitted,
   * step 7 stays warning-only. When supplied AND `directoryVrfPublicKey`
   * is also supplied, the verifier fetches the directory's anchor +
   * decodes the lookup proof + calls this callback to validate.
   *
   * The callback returns `true` for a valid proof, `false` for an
   * internally-consistent-but-invalid proof, and throws for malformed
   * input. The verifier surfaces all three outcomes appropriately
   * (true → `lookup_proof_valid: true`; false → reject per §6.3
   * step 7 HARD failure semantics; throw → warning + null).
   */
  verifyLookupProof?: (input: VerifyLookupProofInput) => boolean
}

const DEFAULT_DIRECTORY = 'https://directory.atrib.dev/v6'

export async function resolveIdentity(
  creatorKey: string,
  opts: ResolveIdentityOptions = {},
): Promise<IdentityResolution> {
  const warnings: string[] = []
  const directoryEndpoint = opts.directoryEndpoint ?? DEFAULT_DIRECTORY
  const fetchFn = opts.fetchImpl ?? fetch

  // Steps not yet implemented — flag once, up front, so consumers can
  // distinguish "verifier didn't check this" from "verifier checked
  // this and it passed."
  warnings.push('step-1-anchor-not-checked: anchor freshness not verified by this implementation')
  warnings.push('step-3-witness-not-checked: witness coverage not verified by this implementation')
  warnings.push('step-4-checkpoint-signature-not-checked: directory checkpoint signature not verified by this implementation')
  warnings.push('step-5-append-only-not-checked: append-only consistency not verified by this implementation')
  warnings.push('step-7-akd-proof-not-validated: AKD lookup proof returned but not cryptographically validated')

  // Step 6: directory lookup
  let lookupBody: { found?: boolean; claim?: IdentityClaim; version?: number; proof?: string } = {}
  try {
    const url = `${directoryEndpoint.replace(/\/$/, '')}/lookup/${encodeURIComponent(creatorKey)}`
    const res = await fetchFn(url, {
      headers: { accept: 'application/json' },
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
    if (res.status === 404) {
      // Non-membership. The endpoint returns { found: false } body.
      lookupBody = { found: false }
    } else if (!res.ok) {
      warnings.push(`step-6-directory-error: ${res.status} ${res.statusText}`)
      const status = applyRevocationOnly(creatorKey, opts, warnings)
      return {
        identity_resolved: null,
        identity_resolution_method: 'rejected',
        capability_envelope: null,
        key_revocation_status: status,
        lookup_proof_valid: null,
        append_only_consistent: null,
        anchor: null,
        warnings,
      }
    } else {
      lookupBody = await res.json() as typeof lookupBody
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    warnings.push(`step-6-directory-error: ${msg}`)
    const status = applyRevocationOnly(creatorKey, opts, warnings)
    return {
      identity_resolved: null,
      identity_resolution_method: 'rejected',
      capability_envelope: null,
      key_revocation_status: status,
      lookup_proof_valid: null,
      append_only_consistent: null,
      anchor: null,
      warnings,
    }
  }

  // Non-membership branch
  if (lookupBody.found === false) {
    return {
      identity_resolved: null,
      identity_resolution_method: 'no_claim_registered',
      capability_envelope: null,
      key_revocation_status: applyRevocationOnly(creatorKey, opts, warnings),
      lookup_proof_valid: null,
      append_only_consistent: null,
      anchor: null,
      warnings,
    }
  }

  // Step 8: parse claim. The directory already returned a parsed JSON
  // claim object; spec-conformance check is delegated to the schema
  // already applied by the directory. We do a minimal sanity check.
  const claim = lookupBody.claim
  if (!claim || typeof claim !== 'object' || claim.creator_key !== creatorKey) {
    warnings.push('step-8-claim-malformed: lookup returned but claim payload is missing or wrong creator_key')
    return {
      identity_resolved: null,
      identity_resolution_method: 'rejected',
      capability_envelope: null,
      key_revocation_status: applyRevocationOnly(creatorKey, opts, warnings),
      lookup_proof_valid: null,
      append_only_consistent: null,
      anchor: null,
      warnings,
    }
  }

  // Step 7 (AKD lookup proof verification). Only attempted when the
  // caller supplies both `verifyLookupProof` (the bridge wrapper from
  // `@atrib/directory`) and `directoryVrfPublicKey`. When supplied AND
  // the proof is missing/malformed, we surface a warning and proceed
  // (soft signal). When the proof verifies as invalid, §6.3 step 7
  // mandates a HARD failure: the result is rejected.
  let lookupProofValid: boolean | null = null
  if (opts.verifyLookupProof && opts.directoryVrfPublicKey) {
    const stepSevenOutcome = await runStepSeven(
      creatorKey,
      directoryEndpoint,
      lookupBody.proof,
      opts.verifyLookupProof,
      opts.directoryVrfPublicKey,
      fetchFn,
      opts.signal,
      warnings,
    )
    if (stepSevenOutcome === 'rejected') {
      // §6.3 step 7 hard-failure path: cryptographically valid signature
      // but the AKD proof did not anchor to the directory's claimed root.
      // The directory is faulty; reject the result.
      return {
        identity_resolved: null,
        identity_resolution_method: 'rejected',
        capability_envelope: null,
        key_revocation_status: applyRevocationOnly(creatorKey, opts, warnings),
        lookup_proof_valid: false,
        append_only_consistent: null,
        anchor: null,
        warnings,
      }
    }
    lookupProofValid = stepSevenOutcome // true | null
  }

  return {
    identity_resolved: claim,
    identity_resolution_method: 'directory_lookup',
    capability_envelope: claim.capabilities ?? null,
    key_revocation_status: applyRevocationOnly(creatorKey, opts, warnings),
    lookup_proof_valid: lookupProofValid,
    append_only_consistent: null,
    anchor: null,
    warnings,
  }
}

/**
 * Runs spec §6.3 step 7 — AKD lookup proof verification — against the
 * directory's currently-anchored root.
 *
 * Returns:
 *   - `true`  when the proof verified
 *   - `null`  when verification couldn't be attempted (anchor fetch
 *             failed, proof was missing or undecodable, callback threw)
 *   - `'rejected'` when the proof verified as INVALID — §6.3 step 7
 *                  hard-failure path; caller short-circuits the result
 *
 * On `true`, removes the `step-7-akd-proof-not-validated` warning that
 * was pushed up front; the warning becomes inaccurate once we've
 * actually validated. The step-1 anchor cross-check warning stays
 * regardless: this implementation trusts the directory's self-reported
 * `/anchor` root rather than cross-checking against a log-anchored
 * `directory_anchor` record.
 */
async function runStepSeven(
  creatorKey: string,
  directoryEndpoint: string,
  proofB64u: string | undefined,
  verifyLookupProof: (input: VerifyLookupProofInput) => boolean,
  vrfPublicKey: Uint8Array,
  fetchFn: typeof fetch,
  signal: AbortSignal | undefined,
  warnings: string[],
): Promise<true | null | 'rejected'> {
  if (typeof proofB64u !== 'string' || proofB64u.length === 0) {
    warnings.push('step-7-proof-missing: directory lookup did not return a proof field')
    return null
  }

  // Fetch the directory's currently-anchored snapshot. The
  // `/anchor` endpoint returns `{ epoch, root_hash }` per
  // `services/directory-node/src/server.ts` handleAnchor.
  let anchorBody: { epoch?: number; root_hash?: string }
  try {
    const url = `${directoryEndpoint.replace(/\/$/, '')}/anchor`
    const res = await fetchFn(url, {
      headers: { accept: 'application/json' },
      ...(signal ? { signal } : {}),
    })
    if (!res.ok) {
      warnings.push(`step-7-anchor-fetch-error: ${res.status} ${res.statusText}`)
      return null
    }
    anchorBody = await res.json() as typeof anchorBody
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    warnings.push(`step-7-anchor-fetch-error: ${msg}`)
    return null
  }

  if (typeof anchorBody.epoch !== 'number' || typeof anchorBody.root_hash !== 'string') {
    warnings.push('step-7-anchor-malformed: anchor response missing epoch or root_hash')
    return null
  }

  let rootHash: Uint8Array
  let proof: Uint8Array
  try {
    rootHash = hexToBytes(anchorBody.root_hash)
    if (rootHash.length !== 32) {
      throw new Error(`root_hash must be 32 bytes (got ${rootHash.length})`)
    }
    proof = base64urlToBytes(proofB64u)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    warnings.push(`step-7-input-decode-error: ${msg}`)
    return null
  }

  let verified: boolean
  try {
    verified = verifyLookupProof({
      vrfPublicKey,
      rootHash,
      currentEpoch: anchorBody.epoch,
      label: creatorKey,
      proof,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    warnings.push(`step-7-verify-threw: ${msg}`)
    return null
  }

  if (verified) {
    // We did the check; the up-front warning is now inaccurate.
    const idx = warnings.findIndex((w) => w.startsWith('step-7-akd-proof-not-validated'))
    if (idx >= 0) warnings.splice(idx, 1)
    return true
  }
  warnings.push('step-7-akd-proof-invalid: AKD lookup proof did not verify against the directory\'s anchored root')
  return 'rejected'
}

/** Decode a hex string into bytes. Throws on odd-length or non-hex input. */
function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('hex string must have even length')
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
    if (Number.isNaN(byte)) throw new Error(`invalid hex at offset ${i * 2}`)
    out[i] = byte
  }
  return out
}

/** Decode a base64url string into bytes. Pads as needed. */
function base64urlToBytes(s: string): Uint8Array {
  const padLen = (4 - (s.length % 4)) % 4
  return new Uint8Array(Buffer.from(s + '='.repeat(padLen), 'base64url'))
}

/**
 * Step 9 helper: cross-check the revocation registry. since_revocation
 * is true when the record's log_index is strictly greater than the
 * revocation's log_index.
 */
function applyRevocationOnly(
  creatorKey: string,
  opts: ResolveIdentityOptions,
  warnings: string[],
): KeyRevocationStatus | null {
  if (!opts.revocations) {
    warnings.push('step-9-revocation-not-checked: no revocation registry supplied')
    return null
  }
  const entry = opts.revocations.get(creatorKey)
  if (!entry) return null
  const sinceRevocation =
    typeof opts.recordLogIndex === 'number' && opts.recordLogIndex > entry.log_index
  return {
    reason: entry.revocation_reason,
    revoked_at_log_index: entry.log_index,
    since_revocation: sinceRevocation,
  }
}
