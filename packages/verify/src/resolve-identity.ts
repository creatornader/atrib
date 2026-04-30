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

  return {
    identity_resolved: claim,
    identity_resolution_method: 'directory_lookup',
    capability_envelope: claim.capabilities ?? null,
    key_revocation_status: applyRevocationOnly(creatorKey, opts, warnings),
    lookup_proof_valid: null,
    append_only_consistent: null,
    anchor: null,
    warnings,
  }
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
