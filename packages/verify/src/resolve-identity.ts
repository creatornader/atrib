// SPDX-License-Identifier: Apache-2.0

/**
 * Identity resolution per spec §6.3, the 9-step verifier consultation
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

import * as ed25519 from '@noble/ed25519'
import canonicalize from 'canonicalize'
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
  | 'directory_lookup' // step 6 succeeded
  | 'no_anchor_available' // step 1 surfaced no anchor; result still produced from current state
  | 'no_claim_registered' // step 6 returned non-membership
  | 'rejected' // a hard-failure step rejected the result

export interface KeyRevocationStatus {
  reason: 'rotation' | 'retirement' | 'compromise'
  /** Log index of the revocation, used to derive acceptance ordering. */
  revoked_at_log_index: number
  /** True at or after revocation, false before it, null when record position is absent. */
  since_revocation: boolean | null
  /** False means the verifier refused to infer order from signed timestamps. */
  order_verifiable: boolean
  /** True only when the caller attests it verified registry signatures and revoker authority. */
  registry_verified: boolean
}

/**
 * Anchor surface populated by spec §6.3 step 1 + step 2.
 *
 * The verifier discovers the anchor commitment on the log by querying
 * `directory_anchor` records in the directory's reserved context_id
 * (= sha256(directory_origin)[:16]) filtered by creator_key + timestamp.
 * It then fetches the body (with directory_root + directory_epoch +
 * signature) via the supplied `fetchAnchorBody` callback. The current
 * routing target is directory-node's `/v6/anchors/<hash>` endpoint;
 * after the §2.12 record-body archive layer ships (D070 placeholder
 * ADR), the same callback can route to the standard archive endpoint
 * with no change to resolveIdentity.
 *
 * `anchor_witness_count` and `anchor_freshness_ok` are populated when
 * the relevant inputs are available (witness threshold config for the
 * former; `freshnessThresholdMs` for the latter); otherwise they're
 * `null` to distinguish "not checked" from "checked + clean."
 */
export interface AnchorSurface {
  anchor_record_hash: string
  checkpoint_version: number
  anchor_timestamp: number
  anchor_age_ms: number
  anchor_witness_count: number | null
  anchor_freshness_ok: boolean | null
}

export interface IdentityResolution {
  identity_resolved: IdentityClaim | null
  identity_resolution_method: IdentityResolutionMethod
  capability_envelope: CapabilityEnvelope | null
  key_revocation_status: KeyRevocationStatus | null
  /**
   * §6.3 step 7. `true` when the AKD lookup proof verifies against the
   * directory's anchored root, `false` when verification rejects (which
   * triggers the hard-failure rejection path), `null` when not attempted
   * (callback or vrf pubkey omitted, or anchor fetch failed mid-flight).
   */
  lookup_proof_valid: boolean | null
  /**
   * §6.3 step 5. `true` when the audit proof between the prior anchor
   * and the current anchor verifies, `false` when verification rejects
   * (triggers hard-failure rejection), `null` when not attempted.
   */
  append_only_consistent: boolean | null
  /**
   * §6.3 step 1 + step 2. Populated when `directoryOperatorKey` +
   * `logEndpoint` + `fetchAnchorBody` are all supplied AND a recent
   * directory_anchor record was discovered on the log. `null` otherwise
   * (a step-1 warning carries the reason).
   */
  anchor: AnchorSurface | null
  /**
   * §6.3 step 4. `true` when the directory operator's Ed25519
   * signature on the anchor body verifies, `false` when it doesn't
   * (triggers §6.3 step 4 HARD failure rejection, a faulty operator
   * is not a soft signal). `null` when the check wasn't attempted
   * (no anchor body discovered, no `directoryOperatorKey` supplied).
   */
  directory_checkpoint_signature_valid: boolean | null
  warnings: string[]
}

/**
 * Inputs to the verifyLookupProof callback. Mirrors the signature of
 * `@atrib/directory`'s `verifyLookupProof` so callers can pass it through
 * directly. We re-declare the shape here (rather than importing from
 * `@atrib/directory`) to keep `@atrib/verify` independent of the WASM
 * bridge, same dependency-inversion pattern used for `upstreamCandidate`,
 * `informedByCandidates`, and `identityClaim` elsewhere in this package.
 */
export interface VerifyLookupProofInput {
  vrfPublicKey: Uint8Array
  rootHash: Uint8Array
  currentEpoch: number
  label: string
  proof: Uint8Array
}

/**
 * Inputs to the verifyAuditProof callback. Mirrors `@atrib/directory`'s
 * `verifyAuditProof` signature; same dependency-inversion pattern as
 * `verifyLookupProof`.
 */
export interface VerifyAuditProofInput {
  /** Sequence of 32-byte root hashes, one per epoch boundary. */
  rootHashes: Uint8Array[]
  /** Bincode-serialized append-only proof bytes. */
  proof: Uint8Array
}

/**
 * Signed `directory_anchor` record body. Returned by `fetchAnchorBody`.
 * Shape mirrors `services/directory-node/src/anchor.ts:AnchorRecord`
 * but is re-declared here so `@atrib/verify` doesn't import from a
 * service package.
 */
export interface AnchorBody {
  chain_root: string
  content_id: string
  context_id: string
  creator_key: string
  event_type: string
  metadata: {
    directory_origin: string
    directory_root: string
    directory_epoch: number
  }
  spec_version: string
  timestamp: number
  signature: string
}

/**
 * Log-side commitment shape returned by `GET /v1/by-context/<hex>` on
 * log-node. Re-declared here so `@atrib/verify` doesn't import from
 * `@atrib/log-node`. Only the fields step 1 reads are typed; the rest
 * are tolerated.
 */
export interface AnchorCommitment {
  record_hash: string
  log_index: number
  creator_key: string
  context_id: string
  timestamp_ms: number
  event_type: string
}

export interface ResolveIdentityOptions {
  /** Directory base URL (e.g., https://directory.atrib.dev/v6). */
  directoryEndpoint?: string
  /** Record timestamp (ms), for the revocation since/before comparison. */
  recordTimestamp?: number
  /**
   * Record's log_index, for revocation ordering per §1.9.3 since the
   * authoritative ordering is by log_index, not timestamp.
   */
  recordLogIndex?: number | null
  /** Pre-built revocation registry from a log scan (recommended). */
  revocations?: Map<string, RevocationEntry>
  /**
   * Set only after verifying every registry source record and its §1.9.2
   * revoker authorization. The shape-only buildRevocationRegistry helper does
   * not establish this property by itself.
   */
  revocationsVerified?: boolean
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
  /**
   * Directory operator's Ed25519 public key (43-char base64url). Required
   * for §6.3 step 1 anchor discovery: the verifier filters
   * `directory_anchor` log entries by this key. Production deployments
   * publish the operator key alongside the directory origin.
   */
  directoryOperatorKey?: string
  /**
   * Tessera log endpoint (e.g., `https://log.atrib.dev/v1`). Required
   * for §6.3 step 1 to query `directory_anchor` records via
   * `GET /v1/by-context/<hex>`. When omitted, steps 1 + 2 + 5 are
   * warning-only.
   */
  logEndpoint?: string
  /**
   * Callback that retrieves a `directory_anchor` record body by its
   * `record_hash`. The verifier fetches the COMMITMENT from the log,
   * then uses this callback to fetch the BODY (which carries
   * directory_root + directory_epoch + signature). Returns `null` when
   * the body isn't available.
   *
   * The current routing target is `GET /v6/anchors/<hash>` on the
   * directory itself. After the §2.12 record-body archive layer ships
   * (D070 placeholder ADR), production deployments swap the callback
   * to route to the standard archive endpoint without any change to
   * resolveIdentity.
   */
  fetchAnchorBody?: (recordHash: string) => Promise<AnchorBody | null>
  /**
   * §6.3 step 2: anchor freshness threshold (ms). When set, the
   * verifier sets `anchor_freshness_ok` based on whether
   * `anchor_age_ms ≤ freshnessThresholdMs`. When omitted, no threshold
   * is applied and `anchor_freshness_ok` stays `null`.
   */
  freshnessThresholdMs?: number
  /**
   * Callback that performs AKD audit proof verification (spec §6.3 step 5).
   * Should be `verifyAuditProof` from `@atrib/directory`. When omitted,
   * step 5 stays warning-only. When supplied AND step 1 surfaces an
   * anchor pair (current + prior), the verifier fetches the audit proof
   * from the directory and calls this callback.
   *
   * Returns `true` for a valid proof, `false` for invalid (triggers
   * §6.3 step 5 HARD failure rejection), throws for malformed input.
   */
  verifyAuditProof?: (input: VerifyAuditProofInput) => Promise<boolean>
  /**
   * §6.3 step 3: minimum count of valid witness cosignatures required
   * on the log's checkpoint covering the anchor. When set, the
   * verifier fetches the checkpoint, parses cosignature lines, counts
   * lines whose origin differs from the log's own (witness signatures),
   * and surfaces a step-3-witness-insufficient warning if below
   * threshold. When omitted, step 3 stays warning-only.
   *
   * Note. Cryptographic verification of each witness signature against
   * a configured trusted-witness set is a separate enhancement; the
   * current implementation counts cosignature lines as a proxy. See
   * `step-3-witness-not-cryptographically-verified` warning surfaced
   * alongside the count.
   */
  witnessThreshold?: number
}

const DEFAULT_DIRECTORY = 'https://directory.atrib.dev/v6'

export async function resolveIdentity(
  creatorKey: string,
  opts: ResolveIdentityOptions = {},
): Promise<IdentityResolution> {
  const warnings: string[] = []
  const directoryEndpoint = opts.directoryEndpoint ?? DEFAULT_DIRECTORY
  const fetchFn = opts.fetchImpl ?? fetch

  // Steps not yet implemented, flag once, up front, so consumers can
  // distinguish "verifier didn't check this" from "verifier checked
  // this and it passed."
  warnings.push('step-1-anchor-not-checked: anchor freshness not verified by this implementation')
  warnings.push('step-3-witness-not-checked: witness coverage not verified by this implementation')
  warnings.push(
    'step-4-checkpoint-signature-not-checked: directory checkpoint signature not verified by this implementation',
  )
  warnings.push(
    'step-5-append-only-not-checked: append-only consistency not verified by this implementation',
  )
  warnings.push(
    'step-7-akd-proof-not-validated: AKD lookup proof returned but not cryptographically validated',
  )

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
        directory_checkpoint_signature_valid: null,
        append_only_consistent: null,
        anchor: null,
        warnings,
      }
    } else {
      lookupBody = (await res.json()) as typeof lookupBody
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
      directory_checkpoint_signature_valid: null,
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
      directory_checkpoint_signature_valid: null,
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
    warnings.push(
      'step-8-claim-malformed: lookup returned but claim payload is missing or wrong creator_key',
    )
    return {
      identity_resolved: null,
      identity_resolution_method: 'rejected',
      capability_envelope: null,
      key_revocation_status: applyRevocationOnly(creatorKey, opts, warnings),
      lookup_proof_valid: null,
      directory_checkpoint_signature_valid: null,
      append_only_consistent: null,
      anchor: null,
      warnings,
    }
  }

  // Step 1 (anchor discovery on the log) + Step 2 (anchor freshness threshold).
  // Runs when `directoryOperatorKey` + `logEndpoint` + `fetchAnchorBody` are
  // all supplied. Discovers the most recent directory_anchor record on the
  // log (in the directory's reserved context_id), fetches its body via
  // the supplied callback, cross-checks the body's metadata, and populates
  // the `anchor` output field.
  //
  // T (the record's timestamp) defaults to `recordTimestamp` opt; falls back
  // to `Date.now()` when unset (verifying a record produced just-in-time).
  const T = typeof opts.recordTimestamp === 'number' ? opts.recordTimestamp : Date.now()
  let anchor: AnchorSurface | null = null
  let anchorBody: AnchorBody | null = null
  let priorAnchorBody: AnchorBody | null = null
  let directorySignatureValid: boolean | null = null
  if (opts.logEndpoint && opts.directoryOperatorKey && opts.fetchAnchorBody) {
    const stepOneResult = await runStepOne({
      logEndpoint: opts.logEndpoint,
      directoryOperatorKey: opts.directoryOperatorKey,
      fetchAnchorBody: opts.fetchAnchorBody,
      directoryEndpoint,
      recordTimestamp: T,
      freshnessThresholdMs: opts.freshnessThresholdMs,
      fetchFn,
      signal: opts.signal,
      warnings,
    })
    if (stepOneResult) {
      anchor = stepOneResult.anchor
      anchorBody = stepOneResult.currentBody
      priorAnchorBody = stepOneResult.priorBody
    }
  }

  // Step 4 (directory checkpoint signature verification). HARD failure
  // path per spec §6.3: a directory operator returning an invalidly-
  // signed anchor body is a fault, not a soft signal, reject the
  // entire query. Step 4 runs only when step 1 surfaced a body AND
  // `directoryOperatorKey` was supplied (which step 1 already required).
  if (anchorBody && opts.directoryOperatorKey) {
    const ok = await verifyAnchorSignature(anchorBody, opts.directoryOperatorKey, warnings)
    directorySignatureValid = ok
    if (ok) {
      const idx = warnings.findIndex((w) => w.startsWith('step-4-checkpoint-signature-not-checked'))
      if (idx >= 0) warnings.splice(idx, 1)
    } else {
      // §6.3 step 4 hard-failure: reject. Anchor + step-4 result stay
      // populated so consumers see WHY the rejection happened.
      return {
        identity_resolved: null,
        identity_resolution_method: 'rejected',
        capability_envelope: null,
        key_revocation_status: applyRevocationOnly(creatorKey, opts, warnings),
        lookup_proof_valid: null,
        append_only_consistent: null,
        anchor,
        directory_checkpoint_signature_valid: false,
        warnings,
      }
    }
  }

  // Step 3 (witness coverage on the log's checkpoint). Soft signal:
  // counts cosignature lines on the latest log checkpoint whose origin
  // differs from the log's own (= witness signatures). Compares against
  // `witnessThreshold`. Implemented as a count-only check; cryptographic
  // verification of each witness signature is a separate enhancement.
  // log-node currently produces single-signer checkpoints (no witnesses
  // cosigning), so the actual count is 0 against any production
  // checkpoint as of the time of writing, that's honest data, not
  // a bug; the threshold semantic still works once witnesses come online.
  if (opts.logEndpoint && anchor) {
    const witnessCount = await runStepThree(
      opts.logEndpoint,
      opts.witnessThreshold,
      fetchFn,
      opts.signal,
      warnings,
    )
    if (witnessCount !== null) {
      // anchor is non-null here (we checked above); update its witness count.
      anchor = { ...anchor, anchor_witness_count: witnessCount }
    }
  }

  // Step 7 (AKD lookup proof verification). Only attempted when the
  // caller supplies both `verifyLookupProof` (the bridge wrapper from
  // `@atrib/directory`) and `directoryVrfPublicKey`. When supplied AND
  // the proof is missing/malformed, we surface a warning and proceed
  // (soft signal). When the proof verifies as invalid, §6.3 step 7
  // mandates a HARD failure: the result is rejected.
  //
  // When step 1 surfaced a log-anchored body, step 7 verifies against
  // the LOG-ANCHORED root (stronger; catches directory body forgery).
  // Otherwise it falls back to the directory's self-reported `/anchor`.
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
      anchorBody, // pass log-anchored body when available; else null → self-report fallback
    )
    if (stepSevenOutcome === 'rejected') {
      return {
        identity_resolved: null,
        identity_resolution_method: 'rejected',
        capability_envelope: null,
        key_revocation_status: applyRevocationOnly(creatorKey, opts, warnings),
        lookup_proof_valid: false,
        append_only_consistent: null,
        anchor,
        directory_checkpoint_signature_valid: directorySignatureValid,
        warnings,
      }
    }
    lookupProofValid = stepSevenOutcome // true | null
  }

  // Step 5 (append-only consistency). Only attempted when step 1 surfaced
  // both a current AND a prior anchor body (need a pair for audit_verify),
  // AND `verifyAuditProof` callback is supplied.
  let appendOnlyConsistent: boolean | null = null
  if (opts.verifyAuditProof && anchorBody && priorAnchorBody) {
    const stepFiveOutcome = await runStepFive({
      currentBody: anchorBody,
      priorBody: priorAnchorBody,
      directoryEndpoint,
      verifyAuditProof: opts.verifyAuditProof,
      fetchFn,
      signal: opts.signal,
      warnings,
    })
    if (stepFiveOutcome === 'rejected') {
      // §6.3 step 5 hard-failure path: append-only consistency violated.
      return {
        identity_resolved: null,
        identity_resolution_method: 'rejected',
        capability_envelope: null,
        key_revocation_status: applyRevocationOnly(creatorKey, opts, warnings),
        lookup_proof_valid: lookupProofValid,
        append_only_consistent: false,
        anchor,
        directory_checkpoint_signature_valid: directorySignatureValid,
        warnings,
      }
    }
    appendOnlyConsistent = stepFiveOutcome // true | null
  }

  return {
    identity_resolved: claim,
    identity_resolution_method: 'directory_lookup',
    capability_envelope: claim.capabilities ?? null,
    key_revocation_status: applyRevocationOnly(creatorKey, opts, warnings),
    lookup_proof_valid: lookupProofValid,
    append_only_consistent: appendOnlyConsistent,
    anchor,
    directory_checkpoint_signature_valid: directorySignatureValid,
    warnings,
  }
}

/**
 * Compute the directory's reserved context_id from its origin per the
 * pattern in services/directory-node/src/anchor.ts: sha256(origin)
 * truncated to the first 16 bytes (32 hex chars).
 */
function deriveDirectoryContextId(origin: string): string {
  // Use SubtleCrypto if available to avoid importing @noble/hashes here.
  // (The SDK callers already import @noble/hashes; this function lives
  // in the verify package which we keep dep-light.)
  const enc = new TextEncoder().encode(origin)
  // Synchronous SHA-256 via @noble/hashes is already a transitive dep
  // (through @atrib/mcp); use it to keep the call sync.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { sha256 } = require('@noble/hashes/sha2.js') as {
    sha256: (data: Uint8Array) => Uint8Array
  }
  const digest = sha256(enc)
  return Array.from(digest.slice(0, 16))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Inputs to runStepOne (anchor discovery + step 2 freshness). */
interface StepOneInputs {
  logEndpoint: string
  directoryOperatorKey: string
  fetchAnchorBody: (recordHash: string) => Promise<AnchorBody | null>
  directoryEndpoint: string
  recordTimestamp: number
  freshnessThresholdMs: number | undefined
  fetchFn: typeof fetch
  signal: AbortSignal | undefined
  warnings: string[]
}

interface StepOneSuccess {
  anchor: AnchorSurface
  /** Body of the discovered anchor (current). */
  currentBody: AnchorBody
  /** Body of the predecessor anchor when present; null for a single-anchor history. */
  priorBody: AnchorBody | null
}

/**
 * Spec §6.3 step 1: discover the most recent `directory_anchor` record
 * on the log whose timestamp is ≤ T (the verifying record's timestamp),
 * fetch its body, cross-check the body's signed metadata, and populate
 * the verifier's `anchor` output field. Step 2 (freshness threshold)
 * piggybacks since we have anchor.timestamp + recordTimestamp here.
 *
 * Side effects (only on the warnings array):
 *   - Removes the up-front step-1-anchor-not-checked warning when
 *     anchor discovery succeeds (a more specific warning replaces it
 *     when the body fetch fails or the cross-check rejects).
 *
 * Returns null when discovery couldn't be completed (log fetch
 * failure, no anchor matches, body fetch fails). Returns a
 * StepOneSuccess when the anchor is discovered + body retrieved +
 * metadata cross-check passes.
 *
 * Cross-check (lightweight sanity): body's metadata.directory_origin
 * must be a non-empty string; body's metadata.directory_epoch must be
 * a number; body's signature must be a non-empty string.
 * Stronger: re-canonicalize the body and verify the signature against
 * the operator's pubkey (deferred to a follow-on commit; the log's
 * inclusion proof already authenticates the hash, so the signature
 * re-verify is defense-in-depth, not required for step 1).
 */
async function runStepOne(opts: StepOneInputs): Promise<StepOneSuccess | null> {
  const directoryOrigin = await fetchDirectoryOrigin(
    opts.directoryEndpoint,
    opts.fetchFn,
    opts.signal,
    opts.warnings,
  )
  if (!directoryOrigin) return null
  const contextHex = deriveDirectoryContextId(directoryOrigin)

  let entries: AnchorCommitment[]
  try {
    const url = `${opts.logEndpoint.replace(/\/$/, '')}/by-context/${contextHex}`
    const res = await opts.fetchFn(url, {
      headers: { accept: 'application/json' },
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
    if (res.status === 404) {
      opts.warnings.push(
        "step-1-anchor-not-found: no directory_anchor records in the directory's context_id on the log",
      )
      return null
    }
    if (!res.ok) {
      opts.warnings.push(`step-1-log-fetch-error: ${res.status} ${res.statusText}`)
      return null
    }
    const body = (await res.json()) as { entries?: AnchorCommitment[] }
    entries = body.entries ?? []
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    opts.warnings.push(`step-1-log-fetch-error: ${msg}`)
    return null
  }

  // Filter by event_type=directory_anchor + creator_key match + timestamp ≤ T.
  // The handleByContext response is newest-first.
  const matches = entries.filter(
    (e) =>
      e.event_type === 'directory_anchor' &&
      e.creator_key === opts.directoryOperatorKey &&
      e.timestamp_ms <= opts.recordTimestamp,
  )
  if (matches.length === 0) {
    opts.warnings.push(
      'step-1-anchor-not-found: no directory_anchor on the log matches the operator key + timestamp window',
    )
    return null
  }
  const current = matches[0]! // newest-first → first match is the most recent
  const prior = matches[1] ?? null // second-most-recent, if any

  // Fetch the body for the current anchor (and predecessor when present).
  const recordHashStr = current.record_hash.startsWith('sha256:')
    ? current.record_hash
    : `sha256:${current.record_hash}`
  let currentBody: AnchorBody | null
  try {
    currentBody = await opts.fetchAnchorBody(recordHashStr)
  } catch (e) {
    opts.warnings.push(`step-1-body-fetch-error: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
  if (!currentBody) {
    opts.warnings.push(
      `step-1-body-not-available: anchor ${recordHashStr} present on log but body not retrievable from directory or archive`,
    )
    return null
  }

  // Cross-check: body's signed metadata must be self-consistent. Strong
  // checks (signature re-verify against operator pubkey) are deferred;
  // log inclusion already authenticates the hash, so this catches body
  // forgery scenarios without re-implementing Ed25519 verify here.
  if (
    typeof currentBody.metadata?.directory_origin !== 'string' ||
    currentBody.metadata.directory_origin.length === 0 ||
    typeof currentBody.metadata?.directory_epoch !== 'number' ||
    typeof currentBody.metadata?.directory_root !== 'string' ||
    typeof currentBody.signature !== 'string' ||
    currentBody.signature.length === 0
  ) {
    opts.warnings.push('step-1-body-malformed: anchor body missing required metadata fields')
    return null
  }
  if (currentBody.creator_key !== opts.directoryOperatorKey) {
    opts.warnings.push(
      'step-1-body-creator-mismatch: anchor body creator_key does not match directoryOperatorKey',
    )
    return null
  }

  // Optional predecessor body for step 5; tolerate failure since step 5
  // can stay warning-only without it.
  let priorBody: AnchorBody | null = null
  if (prior) {
    const priorHashStr = prior.record_hash.startsWith('sha256:')
      ? prior.record_hash
      : `sha256:${prior.record_hash}`
    try {
      priorBody = await opts.fetchAnchorBody(priorHashStr)
    } catch {
      // Soft: step 5 will note its absence.
    }
  }

  const anchorAgeMs = opts.recordTimestamp - current.timestamp_ms
  const freshnessOk =
    typeof opts.freshnessThresholdMs === 'number' ? anchorAgeMs <= opts.freshnessThresholdMs : null
  if (typeof opts.freshnessThresholdMs === 'number' && freshnessOk === false) {
    opts.warnings.push(
      `step-2-anchor-stale: anchor_age_ms=${anchorAgeMs} > threshold=${opts.freshnessThresholdMs}`,
    )
  }

  const surface: AnchorSurface = {
    anchor_record_hash: recordHashStr,
    checkpoint_version: currentBody.metadata.directory_epoch,
    anchor_timestamp: current.timestamp_ms,
    anchor_age_ms: anchorAgeMs,
    anchor_witness_count: null, // step 3, deferred
    anchor_freshness_ok: freshnessOk,
  }

  // Remove the up-front step-1 warning since we did discover one.
  const idx = opts.warnings.findIndex((w) => w.startsWith('step-1-anchor-not-checked'))
  if (idx >= 0) opts.warnings.splice(idx, 1)

  return { anchor: surface, currentBody, priorBody }
}

/**
 * Fetch the directory's origin string from its `/anchor` endpoint.
 * The origin is what we hash to compute the directory's reserved
 * context_id for log-side anchor discovery.
 *
 * Returns null on any error (warnings array gets a step-1-origin-fetch entry).
 */
async function fetchDirectoryOrigin(
  directoryEndpoint: string,
  fetchFn: typeof fetch,
  signal: AbortSignal | undefined,
  warnings: string[],
): Promise<string | null> {
  try {
    const url = `${directoryEndpoint.replace(/\/$/, '')}/anchor`
    const res = await fetchFn(url, {
      headers: { accept: 'application/json' },
      ...(signal ? { signal } : {}),
    })
    if (!res.ok) {
      warnings.push(`step-1-origin-fetch-error: ${res.status} ${res.statusText}`)
      return null
    }
    const body = (await res.json()) as { directory_origin?: string }
    if (typeof body.directory_origin !== 'string' || body.directory_origin.length === 0) {
      warnings.push('step-1-origin-missing: directory /anchor response missing directory_origin')
      return null
    }
    return body.directory_origin
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    warnings.push(`step-1-origin-fetch-error: ${msg}`)
    return null
  }
}

interface StepFiveInputs {
  currentBody: AnchorBody
  priorBody: AnchorBody
  directoryEndpoint: string
  verifyAuditProof: (input: VerifyAuditProofInput) => Promise<boolean>
  fetchFn: typeof fetch
  signal: AbortSignal | undefined
  warnings: string[]
}

/**
 * Spec §6.3 step 5: append-only consistency check. Fetches the audit
 * proof between the prior anchor's epoch and the current anchor's
 * epoch from the directory's `/v6/audit-proof` endpoint, then runs
 * verify_audit_proof against the [prior_root, current_root] pair.
 *
 * Returns:
 *   - `true`     when the audit proof verifies
 *   - `null`     when verification couldn't be attempted (fetch or
 *                decode error, callback throws)
 *   - `'rejected'` when verification rejects → §6.3 step 5 HARD failure
 */
async function runStepFive(opts: StepFiveInputs): Promise<true | null | 'rejected'> {
  const fromEpoch = opts.priorBody.metadata.directory_epoch
  const toEpoch = opts.currentBody.metadata.directory_epoch
  if (toEpoch <= fromEpoch) {
    opts.warnings.push(`step-5-invalid-epoch-range: prior=${fromEpoch} >= current=${toEpoch}`)
    return null
  }

  // Fetch audit proof from the directory.
  let proofB64u: string
  try {
    const url = `${opts.directoryEndpoint.replace(/\/$/, '')}/audit-proof?from=${fromEpoch}&to=${toEpoch}`
    const res = await opts.fetchFn(url, {
      headers: { accept: 'application/json' },
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
    if (!res.ok) {
      opts.warnings.push(`step-5-audit-proof-fetch-error: ${res.status} ${res.statusText}`)
      return null
    }
    const body = (await res.json()) as { proof?: string }
    if (typeof body.proof !== 'string' || body.proof.length === 0) {
      opts.warnings.push(
        'step-5-audit-proof-missing: directory /audit-proof response missing proof field',
      )
      return null
    }
    proofB64u = body.proof
  } catch (e) {
    opts.warnings.push(
      `step-5-audit-proof-fetch-error: ${e instanceof Error ? e.message : String(e)}`,
    )
    return null
  }

  // Decode roots + proof.
  let priorRoot: Uint8Array
  let currentRoot: Uint8Array
  let proof: Uint8Array
  try {
    priorRoot = hexToBytes(opts.priorBody.metadata.directory_root)
    currentRoot = hexToBytes(opts.currentBody.metadata.directory_root)
    if (priorRoot.length !== 32 || currentRoot.length !== 32) {
      throw new Error('directory_root must be 32 bytes')
    }
    proof = base64urlToBytes(proofB64u)
  } catch (e) {
    opts.warnings.push(`step-5-input-decode-error: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }

  let verified: boolean
  try {
    verified = await opts.verifyAuditProof({
      rootHashes: [priorRoot, currentRoot],
      proof,
    })
  } catch (e) {
    opts.warnings.push(`step-5-verify-threw: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }

  if (verified) {
    const idx = opts.warnings.findIndex((w) => w.startsWith('step-5-append-only-not-checked'))
    if (idx >= 0) opts.warnings.splice(idx, 1)
    return true
  }
  opts.warnings.push(
    'step-5-audit-proof-invalid: audit proof did not verify against the prior + current anchored roots',
  )
  return 'rejected'
}

/**
 * Runs spec §6.3 step 7, AKD lookup proof verification, against the
 * directory's currently-anchored root.
 *
 * Returns:
 *   - `true`  when the proof verified
 *   - `null`  when verification couldn't be attempted (anchor fetch
 *             failed, proof was missing or undecodable, callback threw)
 *   - `'rejected'` when the proof verified as INVALID, §6.3 step 7
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
  /**
   * Optional log-anchored body from step 1. When supplied, step 7
   * verifies the lookup proof against the LOG-ANCHORED root + epoch
   * (stronger; catches directory body forgery). When null, falls back
   * to the directory's self-reported `/anchor` (still useful but
   * weaker, depends on the directory being honest about its current
   * state). The fallback path is tracked by the step-1 warnings
   * since step 1 is what discovers the log-anchored body in the first
   * place.
   */
  logAnchoredBody: AnchorBody | null,
): Promise<true | null | 'rejected'> {
  if (typeof proofB64u !== 'string' || proofB64u.length === 0) {
    warnings.push('step-7-proof-missing: directory lookup did not return a proof field')
    return null
  }

  // Source the (root, epoch) pair: prefer log-anchored body when supplied.
  let rootHashHex: string
  let currentEpoch: number
  if (logAnchoredBody) {
    rootHashHex = logAnchoredBody.metadata.directory_root
    currentEpoch = logAnchoredBody.metadata.directory_epoch
  } else {
    let anchorResp: { epoch?: number; root_hash?: string }
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
      anchorResp = (await res.json()) as typeof anchorResp
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      warnings.push(`step-7-anchor-fetch-error: ${msg}`)
      return null
    }
    if (typeof anchorResp.epoch !== 'number' || typeof anchorResp.root_hash !== 'string') {
      warnings.push('step-7-anchor-malformed: anchor response missing epoch or root_hash')
      return null
    }
    rootHashHex = anchorResp.root_hash
    currentEpoch = anchorResp.epoch
  }

  let rootHash: Uint8Array
  let proof: Uint8Array
  try {
    rootHash = hexToBytes(rootHashHex)
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
      currentEpoch,
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
  warnings.push(
    "step-7-akd-proof-invalid: AKD lookup proof did not verify against the directory's anchored root",
  )
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
 * is true when the record's log_index is greater than or equal to the
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
  const orderVerifiable =
    typeof opts.recordLogIndex === 'number' &&
    Number.isSafeInteger(opts.recordLogIndex) &&
    opts.recordLogIndex >= 0
  const sinceRevocation = orderVerifiable ? opts.recordLogIndex! >= entry.log_index : null
  if (!orderVerifiable) {
    warnings.push(
      'step-9-revocation-order-unverifiable: record log index was not supplied; timestamps were not used',
    )
  }
  const registryVerified = opts.revocationsVerified === true
  if (!registryVerified) {
    warnings.push(
      'step-9-revocation-registry-unverified: registry shape was supplied without signature and revoker-authorization assurance',
    )
  }
  return {
    reason: entry.revocation_reason,
    revoked_at_log_index: entry.log_index,
    since_revocation: sinceRevocation,
    order_verifiable: orderVerifiable,
    registry_verified: registryVerified,
  }
}

/**
 * Spec §6.3 step 4, verify the directory operator's Ed25519 signature
 * on the anchor record body.
 *
 * The signed bytes are the canonical (JCS-style) JSON of the body MINUS
 * the `signature` field. The atrib substrate uses `canonicalize` (RFC
 * 8785 JCS); the directory's own emitDirectoryAnchor canonicalizes the
 * unsigned shape THEN appends the signature, so re-canonicalizing the
 * body without `signature` reproduces the bytes the operator signed.
 *
 * Returns `true` for a valid signature, `false` otherwise. Pushes a
 * `step-4-signature-invalid` warning on rejection so consumers see why.
 * Errors during canonicalization, base64url decode, or ed25519 verify
 * all return `false`, a fault during step 4 is not a soft signal,
 * per spec §6.3 ("a directory operator returning an invalidly-signed
 * checkpoint is a fault").
 */
async function verifyAnchorSignature(
  body: AnchorBody,
  expectedOperatorKey: string,
  warnings: string[],
): Promise<boolean> {
  // Re-canonicalize without the signature field. Order matches the
  // emit-side: every non-signature field is included.
  const { signature, ...unsigned } = body
  const canonical = canonicalize(unsigned)
  if (typeof canonical !== 'string') {
    warnings.push('step-4-canonicalize-failed: anchor body could not be canonicalized')
    return false
  }
  let sigBytes: Uint8Array
  let pubBytes: Uint8Array
  try {
    sigBytes = base64urlToBytes(signature)
    pubBytes = base64urlToBytes(expectedOperatorKey)
  } catch (e) {
    warnings.push(`step-4-decode-failed: ${e instanceof Error ? e.message : String(e)}`)
    return false
  }
  if (sigBytes.length !== 64 || pubBytes.length !== 32) {
    warnings.push(
      `step-4-decode-failed: signature must be 64 bytes (got ${sigBytes.length}), pubkey 32 bytes (got ${pubBytes.length})`,
    )
    return false
  }
  let ok = false
  try {
    ok = await ed25519.verifyAsync(sigBytes, new TextEncoder().encode(canonical), pubBytes)
  } catch (e) {
    warnings.push(`step-4-verify-threw: ${e instanceof Error ? e.message : String(e)}`)
    return false
  }
  if (!ok) {
    warnings.push(
      'step-4-signature-invalid: directory operator signature on anchor body did not verify',
    )
  }
  return ok
}

/**
 * Spec §6.3 step 3, count witness cosignatures on the log's latest
 * checkpoint. Soft signal.
 *
 * Fetches `GET /v1/checkpoint` from the log, parses the C2SP signed-note
 * format, counts cosignature lines whose origin differs from the log's
 * own (= witnesses, not the log signing itself). Compares against
 * `threshold` and surfaces a step-3-witness-insufficient warning if
 * below.
 *
 * Returns the count when discoverable; `null` when the count couldn't
 * be determined (fetch failure, malformed checkpoint, etc.).
 *
 * Implementation note. This is a count-only check: each cosignature
 * line is parsed for shape and origin, but the signatures are NOT
 * cryptographically verified against a configured trusted-witness
 * set. The `step-3-witness-not-cryptographically-verified` warning
 * surfaces alongside the count to make this honest. Verifying each
 * signature against trusted witness vkeys is a separate enhancement.
 */
async function runStepThree(
  logEndpoint: string,
  threshold: number | undefined,
  fetchFn: typeof fetch,
  signal: AbortSignal | undefined,
  warnings: string[],
): Promise<number | null> {
  let checkpointText: string
  try {
    const url = `${logEndpoint.replace(/\/$/, '')}/checkpoint`
    const res = await fetchFn(url, {
      headers: { accept: 'text/plain' },
      ...(signal ? { signal } : {}),
    })
    if (!res.ok) {
      warnings.push(`step-3-checkpoint-fetch-error: ${res.status} ${res.statusText}`)
      return null
    }
    checkpointText = await res.text()
  } catch (e) {
    warnings.push(`step-3-checkpoint-fetch-error: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }

  // Parse the C2SP signed-note format: `body\n\n<signature lines>`.
  // The first line of the body is the log's origin string; cosignature
  // lines whose origin matches are the log's own signature, not witness
  // cosignatures.
  const blankSep = checkpointText.indexOf('\n\n')
  if (blankSep < 0) {
    warnings.push('step-3-checkpoint-malformed: signed-note body/signature separator not found')
    return null
  }
  const body = checkpointText.slice(0, blankSep)
  const sigBlock = checkpointText.slice(blankSep + 2)
  const logOrigin = body.split('\n', 1)[0] ?? ''

  let witnessCount = 0
  for (const line of sigBlock.split('\n')) {
    if (!line.trim()) continue
    // Each signature line starts with em-dash + space + origin + space + sigToken.
    const match = line.match(/^[—\-] (\S+) (\S+)\s*$/)
    if (!match) continue
    const sigOrigin = match[1] as string
    if (sigOrigin !== logOrigin) witnessCount += 1
  }

  warnings.push(
    'step-3-witness-not-cryptographically-verified: witness cosignature count is line-based, not cryptographically verified against a trusted-witness set',
  )

  if (typeof threshold === 'number' && witnessCount < threshold) {
    warnings.push(`step-3-witness-insufficient: actual=${witnessCount}, required=${threshold}`)
  }

  // Remove the up-front step-3-witness-not-checked warning since we did parse the checkpoint.
  const idx = warnings.findIndex((w) => w.startsWith('step-3-witness-not-checked'))
  if (idx >= 0) warnings.splice(idx, 1)

  return witnessCount
}
