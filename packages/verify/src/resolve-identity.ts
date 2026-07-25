// SPDX-License-Identifier: Apache-2.0

/**
 * Identity resolution per spec §6.3, the 9-step verifier consultation
 * algorithm. The verifier consults the directory for a record's
 * creator_key and surfaces an `identity_resolution` object.
 *
 * Steps 6 (directory lookup), 8 (parse claim), and 9 (revocation
 * cross-check) run by default. Caller-supplied trust roots and verification
 * callbacks enable steps 1 through 5 and 7. Step 3 verifies the selected
 * anchor's inclusion proof against a caller-pinned log checkpoint, then
 * counts only fresh signatures from caller-pinned witness keys. Every check
 * that lacks its required input remains explicit in the returned warnings.
 *
 * Per §5.8 degradation contract: this function never throws. Network
 * failures, malformed responses, and timeout conditions all produce
 * warnings in the returned object.
 */

import * as ed25519 from '@noble/ed25519'
import { sha256 } from '@noble/hashes/sha2.js'
import {
  EVENT_TYPE_DIRECTORY_ANCHOR_URI,
  leafHash,
  serializeEntry,
  verifyInclusion,
} from '@atrib/mcp'
import canonicalize from 'canonicalize'
import type { RevocationEntry } from './revocations.js'
import {
  verifyCheckpointWitnessThreshold,
  verifyOperatorCheckpoint,
  type ParsedCheckpointNote,
  type TrustedCheckpointKey,
} from './witness.js'
import {
  fetchWitnessCosignaturesForCheckpoint,
  type PinnedWitnessEndpoint,
} from './witness-endpoints.js'

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
 * the relevant inputs are available (a pinned log checkpoint key for the
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
  /** Canonical proof-bundle field. */
  log_index?: number
  /** Current `/by-context` response field. */
  index?: number
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
   * `record_hash`. The verifier fetches the commitment from the log,
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
   * §6.3 step 5: record hash of the directory anchor this verifier accepted
   * during its previous consultation. The verifier follows signed
   * `chain_root` links from the selected current anchor back to this hash.
   *
   * Supplying `verifyAuditProof` without this state does not authorize the
   * verifier to substitute a nearby log entry. The check stays explicit and
   * unchecked until the caller supplies the actual prior consultation point.
   */
  previousAnchorRecordHash?: string
  /**
   * §6.3 step 3: caller-pinned C2SP key for the log checkpoint. This is
   * distinct from `directoryOperatorKey`, which signs directory anchors.
   * Without this key, `anchor_witness_count` stays `null`.
   */
  logCheckpointKey?: TrustedCheckpointKey
  /**
   * §6.3 step 3: caller-pinned witness keys. Only fresh, valid,
   * distinct cosignatures from this set contribute to
   * `anchor_witness_count`.
   */
  trustedWitnessKeys?: readonly TrustedCheckpointKey[]
  /**
   * Caller-pinned witness names, keys, and endpoints. When supplied, step 3
   * fetches cosignatures for the exact checkpoint in the anchor proof bundle
   * and excludes witness lines delivered only by the log.
   */
  trustedWitnessEndpoints?: readonly PinnedWitnessEndpoint[]
  /**
   * Fetch witness-published C2SP cosignature lines for an
   * operator-verified checkpoint. The protocol does not require the log
   * operator to aggregate witness lines, so production callers normally
   * fetch each trusted witness's `/v1/cosig/...` endpoint here.
   */
  fetchWitnessCosignatures?: (checkpoint: ParsedCheckpointNote) => Promise<readonly string[]>
  /**
   * Minimum count of valid, trusted, fresh witness cosignatures required
   * on the log checkpoint that covers the selected directory anchor.
   * Defaults to zero. A shortfall is a soft signal.
   */
  witnessThreshold?: number
  /** Clock used for witness freshness verification. Defaults to current POSIX seconds. */
  witnessNowSeconds?: number
  /** Maximum witness cosignature age. Defaults to 24 hours. */
  witnessMaxAgeSeconds?: number
  /** Maximum accepted future clock skew. Defaults to 5 minutes. */
  witnessFutureSkewSeconds?: number
}

const DEFAULT_DIRECTORY = 'https://directory.atrib.dev/v6'

export async function resolveIdentity(
  creatorKey: string,
  opts: ResolveIdentityOptions = {},
): Promise<IdentityResolution> {
  const warnings: string[] = []
  const directoryEndpoint = opts.directoryEndpoint ?? DEFAULT_DIRECTORY
  const fetchFn = opts.fetchImpl ?? fetch

  // Start with explicit unchecked warnings. Each caller-enabled verification
  // step removes its warning after it completes so consumers can distinguish
  // "not checked" from "checked and passed."
  warnings.push('step-1-anchor-not-checked: anchor discovery and freshness did not complete')
  warnings.push(
    'step-3-witness-not-checked: checkpoint coverage and witness signatures did not complete',
  )
  warnings.push(
    'step-4-checkpoint-signature-not-checked: directory checkpoint signature did not complete',
  )
  warnings.push(
    'step-5-append-only-not-checked: append-only consistency verification did not complete',
  )
  warnings.push('step-7-akd-proof-not-validated: AKD lookup proof validation did not complete')

  // Step 6: directory lookup
  let lookupBody: {
    found?: boolean
    claim?: IdentityClaim
    version?: number
    proof?: string
    epoch?: number
    directory_root?: string
  } = {}
  try {
    const url = `${directoryEndpoint.replace(/\/$/, '')}/lookup/${encodeURIComponent(creatorKey)}`
    const res = await fetchFn(url, {
      headers: { accept: 'application/json' },
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
    if (res.status === 404) {
      // Non-membership. Preserve any proof metadata returned by a
      // conforming directory, even though the reference service does not
      // produce an absence proof yet.
      try {
        lookupBody = { ...((await res.json()) as typeof lookupBody), found: false }
      } catch {
        lookupBody = { found: false }
      }
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
  let anchorCommitment: (AnchorCommitment & { log_index: number }) | null = null
  let anchorCommitments: AnchorCommitment[] = []
  let anchorDirectoryOrigin: string | null = null
  let anchorBody: AnchorBody | null = null
  let directorySignatureValid: boolean | null = null
  let anchorDiscoveryAttempted = false
  if (opts.logEndpoint && opts.directoryOperatorKey && opts.fetchAnchorBody) {
    anchorDiscoveryAttempted = true
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
      anchorCommitment = stepOneResult.anchorCommitment
      anchorCommitments = stepOneResult.anchorCommitments
      anchorDirectoryOrigin = stepOneResult.directoryOrigin
      anchorBody = stepOneResult.currentBody
    }
  }

  // Step 4 (directory checkpoint signature verification). HARD failure
  // path per spec §6.3: a directory operator returning an invalidly-
  // signed anchor body is a fault, not a soft signal, reject the
  // entire query. Step 4 runs only when step 1 surfaced a body AND
  // `directoryOperatorKey` was supplied (which step 1 already required).
  if (anchorBody && opts.directoryOperatorKey) {
    const ok = await verifyAnchorBody(
      anchorBody,
      opts.directoryOperatorKey,
      anchorCommitment!,
      anchorDirectoryOrigin!,
      warnings,
    )
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

  if (
    anchorBody &&
    typeof lookupBody.epoch === 'number' &&
    lookupBody.epoch !== anchorBody.metadata.directory_epoch
  ) {
    warnings.push(
      `step-6-lookup-epoch-mismatch: lookup=${lookupBody.epoch}, anchor=${anchorBody.metadata.directory_epoch}`,
    )
    return {
      identity_resolved: null,
      identity_resolution_method: 'rejected',
      capability_envelope: null,
      key_revocation_status: applyRevocationOnly(creatorKey, opts, warnings),
      lookup_proof_valid: null,
      append_only_consistent: null,
      anchor,
      directory_checkpoint_signature_valid: directorySignatureValid,
      warnings,
    }
  }

  // Step 3 (witness coverage on the log's checkpoint). Soft signal:
  // verify the caller-pinned log signature and the anchor's inclusion
  // proof, fetch any witness-published lines, and count only fresh
  // signatures from caller-pinned witness keys.
  if (opts.logEndpoint && anchor) {
    const witnessCount = await runStepThree({
      logEndpoint: opts.logEndpoint,
      anchorCommitment,
      logCheckpointKey: opts.logCheckpointKey,
      trustedWitnessKeys: opts.trustedWitnessKeys ?? [],
      trustedWitnessEndpoints: opts.trustedWitnessEndpoints ?? [],
      fetchWitnessCosignatures: opts.fetchWitnessCosignatures,
      threshold: opts.witnessThreshold,
      nowSeconds: opts.witnessNowSeconds,
      maxAgeSeconds: opts.witnessMaxAgeSeconds,
      futureSkewSeconds: opts.witnessFutureSkewSeconds,
      fetchFn,
      signal: opts.signal,
      warnings,
    })
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

  // Step 5 (append-only consistency). The caller supplies the anchor hash
  // accepted during its previous consultation. The verifier follows the
  // current body's signed chain_root path back to that exact anchor and
  // verifies every path body and log inclusion before checking AKD
  // consistency. It never substitutes the second-newest log entry.
  let appendOnlyConsistent: boolean | null = null
  if (
    opts.verifyAuditProof &&
    opts.previousAnchorRecordHash &&
    opts.logEndpoint &&
    opts.directoryOperatorKey &&
    opts.fetchAnchorBody &&
    anchorBody &&
    anchorCommitment &&
    anchorDirectoryOrigin
  ) {
    const stepFiveOutcome = await runStepFive({
      current: { body: anchorBody, commitment: anchorCommitment },
      previousAnchorRecordHash: opts.previousAnchorRecordHash,
      anchorCommitments,
      directoryOperatorKey: opts.directoryOperatorKey,
      directoryOrigin: anchorDirectoryOrigin,
      directoryEndpoint,
      logEndpoint: opts.logEndpoint,
      logCheckpointKey: opts.logCheckpointKey,
      fetchAnchorBody: opts.fetchAnchorBody,
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
  } else if (opts.verifyAuditProof && anchorBody && !opts.previousAnchorRecordHash) {
    warnings.push(
      'step-5-previous-anchor-not-supplied: append-only verification requires the prior consulted anchor hash',
    )
  }

  return {
    identity_resolved: claim,
    identity_resolution_method:
      anchorDiscoveryAttempted && !anchor ? 'no_anchor_available' : 'directory_lookup',
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
  const enc = new TextEncoder().encode(origin)
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
  /** Anchor fields needed to reconstruct and verify its log leaf. */
  anchorCommitment: AnchorCommitment & { log_index: number }
  /** Matching directory-anchor commitments available for signed path walking. */
  anchorCommitments: AnchorCommitment[]
  /** Directory origin used to derive the queried log context. */
  directoryOrigin: string
  /** Body of the discovered anchor (current). */
  currentBody: AnchorBody
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
 * Step 4 re-canonicalizes the body and verifies the signature against
 * the caller-pinned directory operator key before the result is accepted.
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
  if (current.context_id !== contextHex) {
    opts.warnings.push(
      'step-1-anchor-context-mismatch: log response entry does not match the queried directory context',
    )
    return null
  }
  const currentLogIndex = normalizeAnchorLogIndex(current)
  if (currentLogIndex === null) {
    opts.warnings.push(
      'step-1-anchor-index-malformed: directory_anchor omitted a non-negative log index',
    )
    return null
  }

  // Fetch the body for the current anchor. Step 5 later follows this body's
  // signed chain_root to the caller's explicit prior consultation point.
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

  // Cross-check the fields needed by the later cryptographic checks.
  // Step 4 verifies the complete body commitment and operator signature.
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
    anchor_witness_count: null, // populated after step 3 verifies checkpoint coverage
    anchor_freshness_ok: freshnessOk,
  }

  // Remove the up-front step-1 warning since we did discover one.
  const idx = opts.warnings.findIndex((w) => w.startsWith('step-1-anchor-not-checked'))
  if (idx >= 0) opts.warnings.splice(idx, 1)

  return {
    anchor: surface,
    anchorCommitment: {
      ...current,
      record_hash: recordHashStr,
      log_index: currentLogIndex,
    },
    anchorCommitments: entries,
    directoryOrigin,
    currentBody,
  }
}

function normalizeAnchorLogIndex(commitment: AnchorCommitment): number | null {
  const value = commitment.log_index ?? commitment.index
  return value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : null
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
  current: {
    body: AnchorBody
    commitment: AnchorCommitment & { log_index: number }
  }
  previousAnchorRecordHash: string
  anchorCommitments: AnchorCommitment[]
  directoryOperatorKey: string
  directoryOrigin: string
  directoryEndpoint: string
  logEndpoint: string
  logCheckpointKey: TrustedCheckpointKey | undefined
  fetchAnchorBody: (recordHash: string) => Promise<AnchorBody | null>
  verifyAuditProof: (input: VerifyAuditProofInput) => Promise<boolean>
  fetchFn: typeof fetch
  signal: AbortSignal | undefined
  warnings: string[]
}

/**
 * Spec §6.3 step 5: append-only consistency check. Walks signed
 * `chain_root` links from the current anchor back to the exact anchor the
 * caller accepted during its previous consultation. Every body on that path
 * must match a log commitment, carry a valid directory-operator signature,
 * occur earlier in the log, and have a valid inclusion proof under the
 * caller-pinned log key. Only then does the verifier check the AKD audit proof
 * between the endpoint roots.
 *
 * Returns:
 *   - `true`     when the audit proof verifies
 *   - `null`     when required external evidence was unavailable
 *   - `'rejected'` when verification rejects → §6.3 step 5 HARD failure
 */
async function runStepFive(opts: StepFiveInputs): Promise<true | null | 'rejected'> {
  const previousHash = normalizeAnchorRecordHash(opts.previousAnchorRecordHash)
  if (!previousHash) {
    opts.warnings.push('step-5-previous-anchor-hash-malformed: expected sha256:<64-lowercase-hex>')
    return 'rejected'
  }

  const currentHash = normalizeAnchorRecordHash(opts.current.commitment.record_hash)
  if (!currentHash) {
    opts.warnings.push('step-5-current-anchor-hash-malformed: selected commitment is malformed')
    return 'rejected'
  }
  if (previousHash === currentHash) {
    removeWarning(opts.warnings, 'step-5-append-only-not-checked')
    return true
  }

  const commitmentsByHash = new Map<
    string,
    AnchorCommitment & { log_index: number; record_hash: string }
  >()
  for (const commitment of opts.anchorCommitments) {
    const recordHash = normalizeAnchorRecordHash(commitment.record_hash)
    const logIndex = normalizeAnchorLogIndex(commitment)
    if (
      recordHash &&
      logIndex !== null &&
      commitment.creator_key === opts.directoryOperatorKey &&
      commitment.context_id === opts.current.commitment.context_id &&
      commitment.event_type === 'directory_anchor'
    ) {
      commitmentsByHash.set(recordHash, {
        ...commitment,
        record_hash: recordHash,
        log_index: logIndex,
      })
    }
  }

  if (!commitmentsByHash.has(previousHash)) {
    opts.warnings.push(
      `step-5-previous-anchor-not-visible: prior consulted anchor ${previousHash} is absent from the current log view`,
    )
    return 'rejected'
  }

  const currentInclusion = await verifyAnchorLogInclusion({
    logEndpoint: opts.logEndpoint,
    commitment: { ...opts.current.commitment, record_hash: currentHash },
    logCheckpointKey: opts.logCheckpointKey,
    fetchFn: opts.fetchFn,
    signal: opts.signal,
    warnings: opts.warnings,
    warningPrefix: 'step-5-chain',
  })
  if (currentInclusion === false) return 'rejected'
  if (currentInclusion === null) return null

  const genesisRoot = directoryAnchorGenesisRoot(opts.current.body.context_id)
  const seen = new Set<string>([currentHash])
  let child = {
    body: opts.current.body,
    commitment: { ...opts.current.commitment, record_hash: currentHash },
  }
  let priorBody: AnchorBody | null = null

  while (child.commitment.record_hash !== previousHash) {
    const parentHash = normalizeAnchorRecordHash(child.body.chain_root)
    if (!parentHash) {
      opts.warnings.push(`step-5-chain-parent-malformed: child=${child.commitment.record_hash}`)
      return 'rejected'
    }
    if (parentHash === genesisRoot) {
      opts.warnings.push(
        `step-5-previous-anchor-not-ancestor: chain reached genesis before ${previousHash}`,
      )
      return 'rejected'
    }
    if (seen.has(parentHash)) {
      opts.warnings.push(`step-5-chain-cycle: repeated=${parentHash}`)
      return 'rejected'
    }
    seen.add(parentHash)

    const parentCommitment = commitmentsByHash.get(parentHash)
    if (!parentCommitment) {
      opts.warnings.push(
        `step-5-chain-parent-not-in-log: child=${child.commitment.record_hash}, parent=${parentHash}`,
      )
      return 'rejected'
    }
    if (parentCommitment.log_index >= child.commitment.log_index) {
      opts.warnings.push(
        `step-5-chain-log-order-invalid: child=${child.commitment.log_index}, parent=${parentCommitment.log_index}`,
      )
      return 'rejected'
    }

    let parentBody: AnchorBody | null
    try {
      parentBody = await opts.fetchAnchorBody(parentHash)
    } catch (e) {
      opts.warnings.push(
        `step-5-chain-body-fetch-error: ${e instanceof Error ? e.message : String(e)}`,
      )
      return null
    }
    if (!parentBody) {
      opts.warnings.push(`step-5-chain-body-not-available: anchor=${parentHash}`)
      return null
    }

    const parentBodyValid = await verifyAnchorBody(
      parentBody,
      opts.directoryOperatorKey,
      parentCommitment,
      opts.directoryOrigin,
      opts.warnings,
      'step-5-chain',
    )
    if (!parentBodyValid) return 'rejected'

    const parentInclusion = await verifyAnchorLogInclusion({
      logEndpoint: opts.logEndpoint,
      commitment: parentCommitment,
      logCheckpointKey: opts.logCheckpointKey,
      fetchFn: opts.fetchFn,
      signal: opts.signal,
      warnings: opts.warnings,
      warningPrefix: 'step-5-chain',
    })
    if (parentInclusion === false) return 'rejected'
    if (parentInclusion === null) return null

    const parentEpoch = parentBody.metadata.directory_epoch
    const childEpoch = child.body.metadata.directory_epoch
    if (
      parentEpoch > childEpoch ||
      (parentEpoch === childEpoch &&
        parentBody.metadata.directory_root !== child.body.metadata.directory_root)
    ) {
      opts.warnings.push(`step-5-chain-epoch-invalid: child=${childEpoch}, parent=${parentEpoch}`)
      return 'rejected'
    }

    child = { body: parentBody, commitment: parentCommitment }
    if (parentHash === previousHash) priorBody = parentBody
  }

  if (!priorBody) {
    opts.warnings.push(`step-5-chain-resolution-failed: prior=${previousHash}`)
    return null
  }

  const fromEpoch = priorBody.metadata.directory_epoch
  const toEpoch = opts.current.body.metadata.directory_epoch
  if (toEpoch < fromEpoch) {
    opts.warnings.push(`step-5-invalid-epoch-range: prior=${fromEpoch} > current=${toEpoch}`)
    return 'rejected'
  }
  if (toEpoch === fromEpoch) {
    if (priorBody.metadata.directory_root !== opts.current.body.metadata.directory_root) {
      opts.warnings.push(
        `step-5-same-epoch-root-mismatch: epoch=${toEpoch}, prior and current roots differ`,
      )
      return 'rejected'
    }
    removeWarning(opts.warnings, 'step-5-append-only-not-checked')
    return true
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
    const body = (await res.json()) as { from_epoch?: number; to_epoch?: number; proof?: string }
    if (body.from_epoch !== fromEpoch || body.to_epoch !== toEpoch) {
      opts.warnings.push(
        `step-5-audit-proof-range-mismatch: requested=${fromEpoch}:${toEpoch}, returned=${String(body.from_epoch)}:${String(body.to_epoch)}`,
      )
      return 'rejected'
    }
    if (typeof body.proof !== 'string' || body.proof.length === 0) {
      opts.warnings.push(
        'step-5-audit-proof-missing: directory /audit-proof response missing proof field',
      )
      return 'rejected'
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
    priorRoot = hexToBytes(priorBody.metadata.directory_root)
    currentRoot = hexToBytes(opts.current.body.metadata.directory_root)
    if (priorRoot.length !== 32 || currentRoot.length !== 32) {
      throw new Error('directory_root must be 32 bytes')
    }
    proof = base64urlToBytes(proofB64u)
  } catch (e) {
    opts.warnings.push(`step-5-input-decode-error: ${e instanceof Error ? e.message : String(e)}`)
    return 'rejected'
  }

  let verified: boolean
  try {
    verified = await opts.verifyAuditProof({
      rootHashes: [priorRoot, currentRoot],
      proof,
    })
  } catch (e) {
    opts.warnings.push(`step-5-verify-threw: ${e instanceof Error ? e.message : String(e)}`)
    return 'rejected'
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

function normalizeAnchorRecordHash(recordHash: string): string | null {
  const normalized = recordHash.startsWith('sha256:') ? recordHash : `sha256:${recordHash}`
  return /^sha256:[0-9a-f]{64}$/.test(normalized) ? normalized : null
}

function directoryAnchorGenesisRoot(contextId: string): string {
  return `sha256:${Buffer.from(sha256(new TextEncoder().encode(contextId))).toString('hex')}`
}

interface AnchorLogInclusionInputs {
  logEndpoint: string
  commitment: AnchorCommitment & { log_index: number }
  logCheckpointKey: TrustedCheckpointKey | undefined
  fetchFn: typeof fetch
  signal: AbortSignal | undefined
  warnings: string[]
  warningPrefix: string
}

/**
 * Independently verify that one directory-anchor commitment is included in a
 * checkpoint signed by the caller-pinned log key.
 *
 * `null` means required evidence was unavailable. `false` means supplied
 * evidence was malformed or cryptographically inconsistent.
 */
async function verifyAnchorLogInclusion(opts: AnchorLogInclusionInputs): Promise<boolean | null> {
  if (!opts.logCheckpointKey) {
    opts.warnings.push(
      `${opts.warningPrefix}-log-checkpoint-key-not-configured: a caller-pinned log key is required`,
    )
    return null
  }

  let proofBundle: AnchorProofBundle
  try {
    const recordHashHex = opts.commitment.record_hash.replace(/^sha256:/, '')
    const url = `${opts.logEndpoint.replace(/\/$/, '')}/proof/${recordHashHex}`
    const res = await opts.fetchFn(url, {
      headers: { accept: 'application/json' },
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
    if (!res.ok) {
      opts.warnings.push(`${opts.warningPrefix}-proof-fetch-error: ${res.status} ${res.statusText}`)
      return null
    }
    const body = (await res.json()) as Partial<AnchorProofBundle>
    if (
      !Number.isSafeInteger(body.log_index) ||
      (body.log_index as number) < 0 ||
      typeof body.checkpoint !== 'string' ||
      !Array.isArray(body.inclusion_proof) ||
      !body.inclusion_proof.every((hash) => typeof hash === 'string') ||
      typeof body.leaf_hash !== 'string'
    ) {
      opts.warnings.push(`${opts.warningPrefix}-proof-malformed: log returned an invalid bundle`)
      return false
    }
    proofBundle = body as AnchorProofBundle
  } catch (e) {
    opts.warnings.push(
      `${opts.warningPrefix}-proof-fetch-error: ${e instanceof Error ? e.message : String(e)}`,
    )
    return null
  }

  const operator = await verifyOperatorCheckpoint(proofBundle.checkpoint, opts.logCheckpointKey)
  if (!operator.valid || !operator.checkpoint) {
    opts.warnings.push(
      `${opts.warningPrefix}-operator-checkpoint-invalid: ${operator.reason ?? 'unknown verification failure'}`,
    )
    return false
  }
  if (proofBundle.log_index !== opts.commitment.log_index) {
    opts.warnings.push(
      `${opts.warningPrefix}-proof-index-mismatch: anchor=${opts.commitment.log_index}, proof=${proofBundle.log_index}`,
    )
    return false
  }
  if (operator.checkpoint.treeSize <= opts.commitment.log_index) {
    opts.warnings.push(
      `${opts.warningPrefix}-checkpoint-does-not-cover-anchor: tree_size=${operator.checkpoint.treeSize}, anchor_log_index=${opts.commitment.log_index}`,
    )
    return false
  }

  try {
    const entryBytes = serializeEntry({
      record_hash_hex: opts.commitment.record_hash.replace(/^sha256:/, ''),
      creator_key_b64url: opts.commitment.creator_key,
      context_id: opts.commitment.context_id,
      timestamp: opts.commitment.timestamp_ms,
      event_type: EVENT_TYPE_DIRECTORY_ANCHOR_URI,
    })
    const expectedLeafHash = leafHash(entryBytes)
    const claimedLeafHash = decodeCanonicalBase64(proofBundle.leaf_hash, 32)
    const proof = proofBundle.inclusion_proof.map((hash) => decodeCanonicalBase64(hash, 32))
    if (!equalBytes(expectedLeafHash, claimedLeafHash)) {
      opts.warnings.push(
        `${opts.warningPrefix}-leaf-hash-mismatch: proof leaf does not match the anchor entry`,
      )
      return false
    }
    if (
      !verifyInclusion(
        proofBundle.log_index,
        operator.checkpoint.treeSize,
        expectedLeafHash,
        proof,
        operator.checkpoint.rootHash,
      )
    ) {
      opts.warnings.push(
        `${opts.warningPrefix}-inclusion-proof-invalid: anchor is not included in the signed checkpoint`,
      )
      return false
    }
  } catch (e) {
    opts.warnings.push(
      `${opts.warningPrefix}-inclusion-proof-malformed: ${e instanceof Error ? e.message : String(e)}`,
    )
    return false
  }

  return true
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
 * actually validated. When step 1 completed, validation uses the
 * log-anchored root. Otherwise it uses the directory's self-reported
 * `/anchor` root and leaves the step-1 warning in place.
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
 * Spec §6.3 step 4. Verify the anchor body commitment and the directory
 * operator's Ed25519 signature.
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
async function verifyAnchorBody(
  body: AnchorBody,
  expectedOperatorKey: string,
  expectedCommitment: AnchorCommitment & { log_index: number },
  expectedDirectoryOrigin: string,
  warnings: string[],
  warningPrefix = 'step-4',
): Promise<boolean> {
  const commitmentMismatches: string[] = []
  if (body.creator_key !== expectedCommitment.creator_key) {
    commitmentMismatches.push('creator_key')
  }
  if (body.context_id !== expectedCommitment.context_id) {
    commitmentMismatches.push('context_id')
  }
  if (body.timestamp !== expectedCommitment.timestamp_ms) {
    commitmentMismatches.push('timestamp')
  }
  if (body.event_type !== EVENT_TYPE_DIRECTORY_ANCHOR_URI) {
    commitmentMismatches.push('event_type')
  }
  if (body.metadata.directory_origin !== expectedDirectoryOrigin) {
    commitmentMismatches.push('directory_origin')
  }
  if (commitmentMismatches.length > 0) {
    warnings.push(`${warningPrefix}-body-entry-mismatch: fields=${commitmentMismatches.join(',')}`)
  }

  let commitmentMatches = false
  const fullCanonical = canonicalize(body)
  if (typeof fullCanonical !== 'string') {
    warnings.push(
      `${warningPrefix}-canonicalize-failed: full anchor body could not be canonicalized`,
    )
  } else {
    const computedRecordHash = `sha256:${Buffer.from(
      sha256(new TextEncoder().encode(fullCanonical)),
    ).toString('hex')}`
    commitmentMatches = computedRecordHash === expectedCommitment.record_hash
    if (!commitmentMatches) {
      warnings.push(
        `${warningPrefix}-body-commitment-mismatch: expected=${expectedCommitment.record_hash}, actual=${computedRecordHash}`,
      )
    }
  }

  // Re-canonicalize without the signature field. Order matches the
  // emit-side: every non-signature field is included.
  const { signature, ...unsigned } = body
  const canonical = canonicalize(unsigned)
  if (typeof canonical !== 'string') {
    warnings.push(`${warningPrefix}-canonicalize-failed: anchor body could not be canonicalized`)
    return false
  }
  let sigBytes: Uint8Array
  let pubBytes: Uint8Array
  try {
    sigBytes = base64urlToBytes(signature)
    pubBytes = base64urlToBytes(expectedOperatorKey)
  } catch (e) {
    warnings.push(`${warningPrefix}-decode-failed: ${e instanceof Error ? e.message : String(e)}`)
    return false
  }
  if (sigBytes.length !== 64 || pubBytes.length !== 32) {
    warnings.push(
      `${warningPrefix}-decode-failed: signature must be 64 bytes (got ${sigBytes.length}), pubkey 32 bytes (got ${pubBytes.length})`,
    )
    return false
  }
  let ok: boolean
  try {
    ok = await ed25519.verifyAsync(sigBytes, new TextEncoder().encode(canonical), pubBytes)
  } catch (e) {
    warnings.push(`${warningPrefix}-verify-threw: ${e instanceof Error ? e.message : String(e)}`)
    return false
  }
  if (!ok) {
    warnings.push(
      `${warningPrefix}-signature-invalid: directory operator signature on anchor body did not verify`,
    )
  }
  return ok && commitmentMatches && commitmentMismatches.length === 0
}

interface StepThreeInputs {
  logEndpoint: string
  anchorCommitment: (AnchorCommitment & { log_index: number }) | null
  logCheckpointKey: TrustedCheckpointKey | undefined
  trustedWitnessKeys: readonly TrustedCheckpointKey[]
  trustedWitnessEndpoints: readonly PinnedWitnessEndpoint[]
  fetchWitnessCosignatures:
    ((checkpoint: ParsedCheckpointNote) => Promise<readonly string[]>) | undefined
  threshold: number | undefined
  nowSeconds: number | undefined
  maxAgeSeconds: number | undefined
  futureSkewSeconds: number | undefined
  fetchFn: typeof fetch
  signal: AbortSignal | undefined
  warnings: string[]
}

interface AnchorProofBundle {
  log_index: number
  checkpoint: string
  inclusion_proof: string[]
  leaf_hash: string
}

/**
 * Spec §6.3 step 3. Verify the log checkpoint that covers the selected
 * directory anchor, verify the anchor's inclusion proof, then count valid
 * cosignatures from caller-pinned witness keys. A shortfall remains a soft
 * signal.
 *
 * Returns the verified witness count. Returns `null` when the operator
 * checkpoint or inclusion proof cannot be trusted, or configured witness
 * evidence could not be fetched.
 */
async function runStepThree(opts: StepThreeInputs): Promise<number | null> {
  if (!opts.logCheckpointKey) {
    opts.warnings.push(
      'step-3-log-checkpoint-key-not-configured: a caller-pinned log key is required',
    )
    return null
  }
  if (!opts.anchorCommitment) {
    opts.warnings.push('step-3-anchor-commitment-missing: inclusion cannot be established')
    return null
  }

  let proofBundle: AnchorProofBundle
  try {
    const recordHashHex = opts.anchorCommitment.record_hash.replace(/^sha256:/, '')
    const url = `${opts.logEndpoint.replace(/\/$/, '')}/proof/${recordHashHex}`
    const res = await opts.fetchFn(url, {
      headers: { accept: 'application/json' },
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
    if (!res.ok) {
      opts.warnings.push(`step-3-proof-fetch-error: ${res.status} ${res.statusText}`)
      return null
    }
    const body = (await res.json()) as Partial<AnchorProofBundle>
    if (
      !Number.isSafeInteger(body.log_index) ||
      (body.log_index as number) < 0 ||
      typeof body.checkpoint !== 'string' ||
      !Array.isArray(body.inclusion_proof) ||
      !body.inclusion_proof.every((hash) => typeof hash === 'string') ||
      typeof body.leaf_hash !== 'string'
    ) {
      opts.warnings.push('step-3-proof-malformed: log returned an invalid proof bundle')
      return null
    }
    proofBundle = body as AnchorProofBundle
  } catch (e) {
    opts.warnings.push(`step-3-proof-fetch-error: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }

  const operator = await verifyOperatorCheckpoint(proofBundle.checkpoint, opts.logCheckpointKey)
  if (!operator.valid || !operator.checkpoint) {
    opts.warnings.push(
      `step-3-operator-checkpoint-invalid: ${operator.reason ?? 'unknown verification failure'}`,
    )
    removeWarning(opts.warnings, 'step-3-witness-not-checked')
    return null
  }

  if (proofBundle.log_index !== opts.anchorCommitment.log_index) {
    opts.warnings.push(
      `step-3-proof-index-mismatch: anchor=${opts.anchorCommitment.log_index}, proof=${proofBundle.log_index}`,
    )
    removeWarning(opts.warnings, 'step-3-witness-not-checked')
    return null
  }

  if (operator.checkpoint.treeSize <= opts.anchorCommitment.log_index) {
    opts.warnings.push(
      `step-3-checkpoint-does-not-cover-anchor: tree_size=${operator.checkpoint.treeSize}, anchor_log_index=${opts.anchorCommitment.log_index}`,
    )
    removeWarning(opts.warnings, 'step-3-witness-not-checked')
    return null
  }

  try {
    const entryBytes = serializeEntry({
      record_hash_hex: opts.anchorCommitment.record_hash.replace(/^sha256:/, ''),
      creator_key_b64url: opts.anchorCommitment.creator_key,
      context_id: opts.anchorCommitment.context_id,
      timestamp: opts.anchorCommitment.timestamp_ms,
      event_type: EVENT_TYPE_DIRECTORY_ANCHOR_URI,
    })
    const expectedLeafHash = leafHash(entryBytes)
    const claimedLeafHash = decodeCanonicalBase64(proofBundle.leaf_hash, 32)
    const proof = proofBundle.inclusion_proof.map((hash) => decodeCanonicalBase64(hash, 32))
    if (!equalBytes(expectedLeafHash, claimedLeafHash)) {
      opts.warnings.push('step-3-leaf-hash-mismatch: proof leaf does not match the anchor entry')
      removeWarning(opts.warnings, 'step-3-witness-not-checked')
      return null
    }
    if (
      !verifyInclusion(
        proofBundle.log_index,
        operator.checkpoint.treeSize,
        expectedLeafHash,
        proof,
        operator.checkpoint.rootHash,
      )
    ) {
      opts.warnings.push(
        'step-3-inclusion-proof-invalid: anchor is not included in the signed checkpoint',
      )
      removeWarning(opts.warnings, 'step-3-witness-not-checked')
      return null
    }
  } catch (e) {
    opts.warnings.push(
      `step-3-inclusion-proof-malformed: ${e instanceof Error ? e.message : String(e)}`,
    )
    removeWarning(opts.warnings, 'step-3-witness-not-checked')
    return null
  }

  let checkpointText = proofBundle.checkpoint
  let trustedWitnessKeys = opts.trustedWitnessKeys
  if (opts.trustedWitnessEndpoints.length > 0) {
    const endpointResult = await fetchWitnessCosignaturesForCheckpoint({
      checkpointNote: proofBundle.checkpoint,
      operatorKey: opts.logCheckpointKey,
      witnesses: opts.trustedWitnessEndpoints,
      requiredWitnesses: opts.threshold ?? 0,
      ...(opts.nowSeconds === undefined ? {} : { nowSeconds: opts.nowSeconds }),
      ...(opts.maxAgeSeconds === undefined ? {} : { maxAgeSeconds: opts.maxAgeSeconds }),
      ...(opts.futureSkewSeconds === undefined
        ? {}
        : { futureSkewSeconds: opts.futureSkewSeconds }),
      fetchImpl: opts.fetchFn,
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
    checkpointText = endpointResult.checkpointNote
    trustedWitnessKeys = opts.trustedWitnessEndpoints
    for (const outcome of endpointResult.witnesses.filter(
      (candidate) => !candidate.verification.valid,
    )) {
      const reason =
        outcome.verification.reason ?? outcome.transport.reason ?? outcome.transport.state
      opts.warnings.push(
        `step-3-witness-endpoint-rejected: name=${outcome.name}, state=${outcome.transport.state}, reason=${reason}`,
      )
    }
  } else if (opts.fetchWitnessCosignatures) {
    let lines: readonly string[]
    try {
      lines = await opts.fetchWitnessCosignatures(operator.checkpoint)
    } catch (e) {
      opts.warnings.push(
        `step-3-witness-fetch-error: ${e instanceof Error ? e.message : String(e)}`,
      )
      removeWarning(opts.warnings, 'step-3-witness-not-checked')
      return null
    }
    checkpointText = appendWitnessCosignatures(checkpointText, lines, opts.warnings)
  }

  let verification
  try {
    verification = await verifyCheckpointWitnessThreshold(checkpointText, {
      operatorKey: opts.logCheckpointKey,
      witnessKeys: trustedWitnessKeys,
      requiredWitnesses: opts.threshold ?? 0,
      ...(opts.nowSeconds === undefined ? {} : { nowSeconds: opts.nowSeconds }),
      ...(opts.maxAgeSeconds === undefined ? {} : { maxAgeSeconds: opts.maxAgeSeconds }),
      ...(opts.futureSkewSeconds === undefined
        ? {}
        : { futureSkewSeconds: opts.futureSkewSeconds }),
    })
  } catch (e) {
    opts.warnings.push(`step-3-verification-error: ${e instanceof Error ? e.message : String(e)}`)
    removeWarning(opts.warnings, 'step-3-witness-not-checked')
    return null
  }

  const rejectedWitnesses = verification.witnesses.filter((witness) => !witness.valid)
  for (const witness of rejectedWitnesses.slice(0, 20)) {
    const reason = witness.reason ?? 'unknown failure'
    const code = reason.replace(/^witness /, '').replaceAll(' ', '-')
    opts.warnings.push(`step-3-witness-${code}: name=${witness.name}, key_id=${witness.keyId}`)
  }
  if (rejectedWitnesses.length > 20) {
    opts.warnings.push(
      `step-3-witness-rejections-truncated: omitted=${rejectedWitnesses.length - 20}`,
    )
  }

  if (!verification.thresholdMet) {
    opts.warnings.push(
      `step-3-witness-insufficient: actual=${verification.validWitnesses}, required=${verification.requiredWitnesses}`,
    )
  }

  removeWarning(opts.warnings, 'step-3-witness-not-checked')
  return verification.validWitnesses
}

function appendWitnessCosignatures(
  checkpointText: string,
  lines: readonly string[],
  warnings: string[],
): string {
  const accepted: string[] = []
  for (const line of lines) {
    const normalized = line.endsWith('\n') ? line.slice(0, -1) : line
    const match = /^— \S+ ([A-Za-z0-9+/]+={0,2})$/.exec(normalized)
    if (!match) {
      warnings.push('step-3-witness-cosignature-malformed: fetch callback returned an invalid line')
      continue
    }
    try {
      decodeCanonicalBase64(match[1]!, 76)
    } catch {
      warnings.push('step-3-witness-cosignature-malformed: fetch callback returned an invalid line')
      continue
    }
    accepted.push(normalized)
  }
  if (accepted.length === 0) return checkpointText
  return `${checkpointText.trimEnd()}\n${accepted.join('\n')}\n`
}

function decodeCanonicalBase64(value: string, expectedLength: number): Uint8Array {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new Error('proof hash is not canonical base64')
  }
  const bytes = new Uint8Array(Buffer.from(value, 'base64'))
  if (bytes.length !== expectedLength || Buffer.from(bytes).toString('base64') !== value) {
    throw new Error(`proof hash must be canonical base64 for ${expectedLength} bytes`)
  }
  return bytes
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] as number) ^ (right[index] as number)
  }
  return difference === 0
}

function removeWarning(warnings: string[], prefix: string): void {
  const index = warnings.findIndex((warning) => warning.startsWith(prefix))
  if (index >= 0) warnings.splice(index, 1)
}
