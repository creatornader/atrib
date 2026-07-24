// SPDX-License-Identifier: Apache-2.0

/**
 * Producer-side anchor plurality (D138, spec §2.11.7-§2.11.13).
 *
 * An anchor is any independently operated service that accepts a 32-byte
 * SHA-256 hash and later yields an offline-verifiable proof that the hash
 * existed no later than an attested time (§2.11.7). atrib log-nodes are the
 * richest conforming anchor; `sigstore-rekor`, `rfc3161-tsa`, and
 * `opentimestamps` conform with existence-by-time semantics (§2.11.8).
 *
 * This module provides three producer-side surfaces:
 *
 *   1. Typed anchor-set configuration + the §2.11.12 posture resolution
 *      (`resolveAnchorPosture`, `resolveEffectiveAnchors`), including the
 *      `allow_single_anchor` gate mirroring D113's opt-in escape hatch.
 *   2. The §2.11.10 anchoring-signature claim artifact builder
 *      (`anchorClaimArtifact`, `buildAnchoringClaim`,
 *      `verifyAnchoringClaim`): the UTF-8 bytes of
 *      `"atrib-anchor/v1:" + record_hash`, signed with a FRESH Ed25519
 *      anchoring signature — never the record's own `signature`. The digest
 *      path is cryptographically unimplementable twice over (§2.11.10):
 *      `record_hash` covers the complete record INCLUDING `signature`
 *      (§1.2.3) while the signature verifies over the signature-less form
 *      (§1.4.2), and Pure EdDSA cannot be verified from a digest alone.
 *   3. Asynchronous fan-out submission (`createAnchorFanout` /
 *      `submitToAnchors`): per-anchor fire-and-forget honoring §5.3.5 —
 *      anchoring is NEVER awaited before returning to the caller — with the
 *      §5.8 degradation contract everywhere (catch everything, `atrib:`
 *      prefix, never throw into the primary path, never disable signing).
 *
 * The `atrib-log` transport reuses the existing §2.6.1 submission path
 * (`createSubmissionQueue`, non-blocking with retry). The `sigstore-rekor`,
 * `rfc3161-tsa`, and `opentimestamps` adapters use their HTTP submission
 * surfaces behind the same `AnchorTransport` interface. Non-log HTTP legs
 * only activate for an explicitly configured anchor set; the built-in
 * default remains network-silent under §5.8.
 *
 * Nothing in this module changes any signed byte: proof bundles are
 * post-signing artifacts (§2.8), and anchoring is permissionless and
 * post-hoc (§2.11.7).
 */

import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'
import { base64urlEncode } from './base64url.js'
import { canonicalRecord } from './canon.js'
import { getPublicKey } from './signing.js'
import { sha256, hexEncode } from './hash.js'
import { createSubmissionQueue } from './submission.js'
import type { SubmissionQueue } from './submission.js'
import type { AtribRecord } from './types.js'

// @noble/ed25519 v3 needs sha512 wired via the hashes object. Idempotent;
// same wiring as ./signing.ts, repeated here so this module is safe to load
// in isolation (e.g. direct-file imports from conformance tests).
ed.hashes.sha512 = sha512
ed.hashes.sha512Async = (m: Uint8Array) => Promise.resolve(sha512(m))

const utf8 = new TextEncoder()

// ── Anchor type registry (§2.11.8, v1) ──────────────────────────────

/** Registered anchor types per the §2.11.8 v1 registry. */
export const ANCHOR_TYPES = [
  'atrib-log',
  'sigstore-rekor',
  'rfc3161-tsa',
  'opentimestamps',
] as const

export type AnchorType = (typeof ANCHOR_TYPES)[number]

/**
 * §2.11.10 domain-separation prefix for the anchoring-claim artifact.
 * JCS-canonical records begin with `{`; the prefix makes the separation
 * between anchoring signatures and record signatures explicit.
 */
export const ANCHOR_CLAIM_PREFIX = 'atrib-anchor/v1:'

/**
 * `kind` discriminator carried inside the flat Rekor-shaped entry body the
 * conformance corpus pins (spec/conformance/2.11/anchors/, `rekor-anchor-claim`).
 */
export const ANCHOR_CLAIM_KIND = 'atrib-anchor-claim/v1'

const RECORD_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/

// ── Anchor-set configuration (§2.11.12) ─────────────────────────────

/**
 * One anchor in a producer's anchor set. `anchor_type` absent means
 * `atrib-log` (the same absence-defaulting rule the `log_proofs`
 * discriminator uses, §2.11.9 rule (a)).
 */
export interface AnchorDescriptor {
  /** Anchor type; absent = 'atrib-log'. */
  anchor_type?: AnchorType
  /**
   * Stable anchor identity — the role `log_id` plays for logs (§2.11.9).
   * When absent, it is derived from the endpoint host (atrib-log) or a
   * per-type default.
   */
  anchor_id?: string
  /**
   * Submission endpoint. The spec §2.11.12 sample config uses the field
   * name `url`; both spellings are accepted, `url` wins when both are set.
   */
  url?: string
  /** Alias for `url` for callers that prefer the generic name. */
  endpoint?: string
  /** OpenTimestamps calendar endpoints (opentimestamps only). */
  calendars?: string[]
  /**
   * Optional trust material passthrough: the anchor service's public key
   * (base64), forwarded to verifier configuration. Not used for submission.
   */
  public_key_b64?: string
}

/** Producer anchor configuration per §2.11.12. */
export interface AnchorSetConfig {
  anchors?: AnchorDescriptor[]
  /**
   * Opt-in acknowledgment that a sub-plurality anchor set is deliberate
   * (§2.11.12 rule 3) — the single-anchor analog of a deliberate dangling
   * `informed_by` claim per D113. Defaults to false.
   */
  allow_single_anchor?: boolean
}

/**
 * The SDK's built-in default anchor set (§2.11.12 rule 1): two independently
 * identified anchor descriptors. The non-atrib member is OpenTimestamps per
 * D138. Descriptor posture is not proof success: callers use the fan-out
 * report and verifier result for those claims. The OTS transport becomes
 * active only when a producer explicitly configures the anchor leg, so
 * zero-config fan-out never creates outbound HTTP traffic.
 */
export const BUILT_IN_DEFAULT_ANCHOR_SET: readonly AnchorDescriptor[] = [
  { anchor_type: 'atrib-log', anchor_id: 'log.atrib.dev', url: 'https://log.atrib.dev/v1' },
  {
    anchor_type: 'opentimestamps',
    anchor_id: 'opentimestamps-calendars',
    calendars: ['https://a.pool.opentimestamps.org'],
  },
]

/**
 * §5.9.3 sidecar degradation marker written when a sub-plurality config
 * lacks `allow_single_anchor` (§2.11.12 rule 4):
 * `_local.anchor_config = { configured: <n>, allow_single_anchor: false }`.
 */
export interface AnchorConfigSidecarMarker {
  configured: number
  allow_single_anchor: false
}

/**
 * Result of resolving a producer anchor config per the §2.11.12 precedence
 * rules. Field names match the conformance corpus
 * (`cases/allow-single-anchor-config.json`) exactly.
 */
export interface AnchorPostureResolution {
  effective_anchor_count: number
  used_default_set: boolean
  warn: boolean
  sidecar_anchor_config: AnchorConfigSidecarMarker | null
}

/**
 * Resolve a producer anchor config per §2.11.12, exact precedence:
 *
 *   1. No anchor config at all ⇒ the built-in default set (two anchors).
 *   2. Explicit config with ≥ 2 entries ⇒ used as given.
 *   3. Explicit config with < 2 entries and `allow_single_anchor: true` ⇒
 *      used as given, no warning.
 *   4. Explicit config with < 2 entries and no flag ⇒ `warn: true` plus the
 *      sidecar degradation marker. The operation continues; this function is
 *      PURE (no console output, no throw) — the fan-out constructor emits
 *      the `atrib:`-prefixed warning so pure-function callers stay silent.
 *
 * Never throws (§5.8). A malformed config resolves as if empty.
 */
export function resolveAnchorPosture(config: AnchorSetConfig = {}): AnchorPostureResolution {
  const anchors = Array.isArray(config.anchors) ? config.anchors : undefined
  if (anchors === undefined) {
    return {
      effective_anchor_count: BUILT_IN_DEFAULT_ANCHOR_SET.length,
      used_default_set: true,
      warn: false,
      sidecar_anchor_config: null,
    }
  }
  const configured = anchors.length
  if (configured >= 2 || config.allow_single_anchor === true) {
    return {
      effective_anchor_count: configured,
      used_default_set: false,
      warn: false,
      sidecar_anchor_config: null,
    }
  }
  return {
    effective_anchor_count: configured,
    used_default_set: false,
    warn: true,
    sidecar_anchor_config: { configured, allow_single_anchor: false },
  }
}

/**
 * The effective anchor set for a config: the built-in default set when no
 * config was given (§2.11.12 rule 1), the caller's entries otherwise —
 * including deliberate or warned sub-plurality sets, which are used as
 * given (rules 3-4: warn, never block).
 */
export function resolveEffectiveAnchors(config: AnchorSetConfig = {}): readonly AnchorDescriptor[] {
  return Array.isArray(config.anchors) ? config.anchors : BUILT_IN_DEFAULT_ANCHOR_SET
}

// ── §2.11.10 anchoring-claim artifact ────────────────────────────────

/**
 * Build the §2.11.10 anchor-claim artifact bytes for a record hash: the
 * UTF-8 bytes of `"atrib-anchor/v1:" + record_hash` with `record_hash` in
 * canonical `"sha256:" + 64-lowercase-hex` form. Deterministically
 * reconstructible from `record_hash` alone; reveals nothing beyond the
 * commitment itself (§8.3 posture preserved).
 *
 * Throws TypeError on a malformed record hash — this is a pure builder for
 * programmer input, and the fan-out path catches everything per §5.8.
 */
export function anchorClaimArtifact(recordHash: string): Uint8Array {
  if (!RECORD_HASH_PATTERN.test(recordHash)) {
    throw new TypeError(
      `atrib: anchor claim requires a canonical "sha256:<64 lowercase hex>" record hash, got ${JSON.stringify(recordHash).slice(0, 90)}`,
    )
  }
  return utf8.encode(ANCHOR_CLAIM_PREFIX + recordHash)
}

/** Canonical `"sha256:" + hex` hash of a signed record's COMPLETE canonical form (§1.2.3). */
export function canonicalRecordHash(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

/**
 * A signed §2.11.10 anchoring claim, in the flat entry-body construction
 * the conformance corpus pins for `sigstore-rekor` elements: sorted-key
 * JSON of `{ artifact_b64, kind, public_key_b64url, signature_b64url }`.
 */
export interface AnchoringClaim {
  /** UTF-8 artifact: `"atrib-anchor/v1:" + record_hash`. */
  artifact_utf8: string
  /** Standard base64 of the artifact bytes. */
  artifact_b64: string
  kind: typeof ANCHOR_CLAIM_KIND
  /** FRESH anchoring public key (base64url raw Ed25519). */
  public_key_b64url: string
  /** FRESH Ed25519 anchoring signature over the artifact bytes (base64url). */
  signature_b64url: string
  /** Standard base64 of the sorted-key JSON entry body. */
  entry_body_b64: string
}

function bytesToBase64(bytes: Uint8Array): string {
  // Chunked to stay under argument-list limits for large inputs; artifacts
  // here are < 100 bytes, but keep the helper safe for reuse.
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  // btoa is available in Node ≥ 16 and all browser/worker runtimes.
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

/**
 * JCS-equivalent serialization for the FLAT entry-body object (ASCII
 * string values only): JSON.stringify with sorted keys. Must byte-match
 * packages/log-dev/scripts/generate-conformance-anchors.ts.
 */
function sortedJson(obj: Record<string, string>): string {
  const sorted: Record<string, string> = {}
  for (const key of Object.keys(obj).sort()) {
    const value = obj[key]
    if (value !== undefined) sorted[key] = value
  }
  return JSON.stringify(sorted)
}

/**
 * Sign a §2.11.10 anchoring claim for `recordHash` with a FRESH Ed25519
 * anchoring signature over the artifact bytes.
 *
 * The anchoring key MAY be the record's `creator_key` or any third party's
 * key — anchoring is permissionless (§2.11.7). The record's own `signature`
 * MUST NOT be reused here; it does not verify over the bytes behind
 * `record_hash` by construction (§2.11.10).
 */
export async function buildAnchoringClaim(
  recordHash: string,
  anchoringPrivateKey: Uint8Array,
): Promise<AnchoringClaim> {
  const artifactBytes = anchorClaimArtifact(recordHash)
  const signature = await ed.signAsync(artifactBytes, anchoringPrivateKey)
  const publicKey = await getPublicKey(anchoringPrivateKey)
  const artifact_b64 = bytesToBase64(artifactBytes)
  const public_key_b64url = base64urlEncode(publicKey)
  const signature_b64url = base64urlEncode(signature)
  const entryBodyJson = sortedJson({
    artifact_b64,
    kind: ANCHOR_CLAIM_KIND,
    public_key_b64url,
    signature_b64url,
  })
  return {
    artifact_utf8: ANCHOR_CLAIM_PREFIX + recordHash,
    artifact_b64,
    kind: ANCHOR_CLAIM_KIND,
    public_key_b64url,
    signature_b64url,
    entry_body_b64: bytesToBase64(utf8.encode(entryBodyJson)),
  }
}

/**
 * Verify an anchoring claim against a bundle's `record_hash`: the artifact
 * must reconstruct from `recordHash` (binding + prefix) and the embedded
 * FRESH Ed25519 anchoring signature must verify over the artifact bytes.
 * A genuinely-signed claim for a DIFFERENT record hash returns false — it
 * is an invalid proof for this bundle, not equivocation (§2.11.10).
 *
 * Never throws; malformed input returns false (§5.8).
 */
export async function verifyAnchoringClaim(
  claim: Pick<AnchoringClaim, 'artifact_b64' | 'public_key_b64url' | 'signature_b64url'>,
  recordHash: string,
): Promise<boolean> {
  try {
    const expected = anchorClaimArtifact(recordHash)
    const artifactBytes = base64ToBytes(claim.artifact_b64)
    if (artifactBytes.length !== expected.length) return false
    for (let i = 0; i < expected.length; i++) {
      if (artifactBytes[i] !== expected[i]) return false
    }
    const publicKey = base64urlToBytes(claim.public_key_b64url)
    const signature = base64urlToBytes(claim.signature_b64url)
    if (publicKey.length !== 32 || signature.length !== 64) return false
    return await ed.verifyAsync(signature, artifactBytes, publicKey)
  } catch {
    return false
  }
}

function base64urlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  return base64ToBytes(padded + '='.repeat((4 - (padded.length % 4)) % 4))
}

// ── Fan-out submission (§2.11.12, §5.3.5, §5.8) ─────────────────────

export interface AnchorSubmissionRequest {
  record: AtribRecord
  /** Canonical `"sha256:" + hex` hash of the record's complete canonical form. */
  recordHash: string
  priority: 'high' | 'normal'
}

export type AnchorSubmissionStatus =
  /** Handed to the anchor's non-blocking submission path. */
  | 'queued'
  /** Accepted by the anchor but awaiting upstream attestation (e.g. OTS). */
  | 'pending'
  /** The transport obtained an offline-verifiable proof for this commitment. */
  | 'confirmed'
  /** No transport implementation for this anchor type yet (stub). */
  | 'unsupported'
  /** The transport threw or rejected; caught per §5.8, never rethrown. */
  | 'failed'

export interface AnchorSubmissionOutcome {
  anchor_type: AnchorType
  anchor_id: string
  status: AnchorSubmissionStatus
  detail?: string
}

/**
 * Outcome accounting for one fan-out. Configured descriptors never count as
 * attempts or accepted submissions. `pending` and `confirmed` mean the
 * upstream accepted the commitment. Only `confirmed` means the transport
 * obtained an offline-verifiable proof. Independent plurality is still a
 * verifier decision over proof bytes, trust roots, and operator groups.
 */
export interface AnchorSubmissionReport {
  configured_anchor_count: number
  attempted_anchor_count: number
  successful_submission_count: number
  proof_ready_anchor_count: number
  queued_anchor_count: number
  pending_anchor_count: number
  unsupported_anchor_count: number
  failed_anchor_count: number
  proof_ready_anchors: Array<{ anchor_type: AnchorType; anchor_id: string }>
  outcomes: AnchorSubmissionOutcome[]
}

export function summarizeAnchorOutcomes(
  outcomes: AnchorSubmissionOutcome[],
  configuredAnchorCount: number = outcomes.length,
): AnchorSubmissionReport {
  const proofReadyAnchors = outcomes
    .filter((outcome) => outcome.status === 'confirmed')
    .map((outcome) => ({
      anchor_type: outcome.anchor_type,
      anchor_id: outcome.anchor_id,
    }))

  return {
    configured_anchor_count: configuredAnchorCount,
    attempted_anchor_count: outcomes.length,
    successful_submission_count: outcomes.filter(
      (outcome) => outcome.status === 'pending' || outcome.status === 'confirmed',
    ).length,
    proof_ready_anchor_count: proofReadyAnchors.length,
    queued_anchor_count: outcomes.filter((outcome) => outcome.status === 'queued').length,
    pending_anchor_count: outcomes.filter((outcome) => outcome.status === 'pending').length,
    unsupported_anchor_count: outcomes.filter((outcome) => outcome.status === 'unsupported').length,
    failed_anchor_count: outcomes.filter((outcome) => outcome.status === 'failed').length,
    proof_ready_anchors: proofReadyAnchors,
    outcomes,
  }
}

/**
 * One anchor submission client. Implementations MUST be non-blocking in
 * spirit: `submit` may return a promise, but the fan-out never awaits it
 * before returning to the caller (§5.3.5), so slow transports only delay
 * their own outcome, never the primary path.
 */
export interface AnchorTransport {
  readonly anchorType: AnchorType
  readonly anchorId: string
  submit(
    request: AnchorSubmissionRequest,
  ): AnchorSubmissionOutcome | Promise<AnchorSubmissionOutcome>
  /** Drain transport-owned work during tests and host shutdown. */
  flush?(): Promise<void>
}

/** Injectable fetch surface for offline adapter tests and host-owned HTTP policy. */
export type AnchorFetch = (input: string, init?: RequestInit) => Promise<Response>

export interface AnchorTransportOptions {
  queue?: SubmissionQueue
  maxQueueDepth?: number
  /**
   * Enables non-log HTTP submission. `createAnchorFanout` sets this only for
   * explicit caller configuration; direct callers opt in deliberately.
   */
  allowNetwork?: boolean
  /** Defaults to global fetch when network submission is enabled. */
  fetchImpl?: AnchorFetch
}

function descriptorType(descriptor: AnchorDescriptor): AnchorType {
  // §2.11.9 rule (a) analog: absent anchor_type means atrib-log.
  return descriptor.anchor_type ?? 'atrib-log'
}

function descriptorEndpoint(descriptor: AnchorDescriptor): string | undefined {
  return descriptor.url ?? descriptor.endpoint
}

function descriptorId(descriptor: AnchorDescriptor): string {
  if (descriptor.anchor_id !== undefined && descriptor.anchor_id !== '') {
    return descriptor.anchor_id
  }
  const endpoint = descriptorEndpoint(descriptor)
  if (endpoint !== undefined) {
    try {
      return new URL(endpoint).host
    } catch {
      // Fall through to the per-type default.
    }
  }
  return descriptorType(descriptor)
}

/**
 * The `atrib-log` transport: reuses the existing §2.6.1 non-blocking
 * submission path. `queue.submit` is fire-and-forget with its own retry
 * and eviction discipline (§5.3.5), so `submit` here returns synchronously
 * with `queued`.
 */
export function createAtribLogAnchorTransport(
  descriptor: AnchorDescriptor,
  options: AnchorTransportOptions = {},
): AnchorTransport {
  const anchorId = descriptorId(descriptor)
  const queue =
    options.queue ??
    createSubmissionQueue(descriptorEndpoint(descriptor), {
      ...(options.maxQueueDepth !== undefined ? { maxQueueDepth: options.maxQueueDepth } : {}),
    })
  return {
    anchorType: 'atrib-log',
    anchorId,
    submit(request: AnchorSubmissionRequest): AnchorSubmissionOutcome {
      queue.submit(request.record, request.priority)
      return { anchor_type: 'atrib-log', anchor_id: anchorId, status: 'queued' }
    },
    flush: () => queue.flush(),
  }
}

/**
 * Network-disabled transport for non-log anchors. This is a safe default,
 * not an implementation gap: callers must explicitly configure the anchor
 * set before the adapters below make outbound requests.
 */
export function createStubAnchorTransport(
  anchorType: Exclude<AnchorType, 'atrib-log'>,
  anchorId: string,
): AnchorTransport {
  return {
    anchorType,
    anchorId,
    submit(): AnchorSubmissionOutcome {
      return {
        anchor_type: anchorType,
        anchor_id: anchorId,
        status: 'unsupported',
        detail: `atrib: no ${anchorType} transport shipped yet; anchor leg skipped`,
      }
    },
  }
}

function httpFetch(options: AnchorTransportOptions): AnchorFetch | null {
  if (!options.allowNetwork) return null
  return options.fetchImpl ?? globalThis.fetch
}

function recordHashBytes(recordHash: string): Uint8Array {
  if (!RECORD_HASH_PATTERN.test(recordHash)) throw new TypeError('invalid record hash')
  const hex = recordHash.slice('sha256:'.length)
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

function binaryBody(bytes: Uint8Array): Blob {
  return new Blob([bytes.slice().buffer as ArrayBuffer])
}

function derLength(length: number): number[] {
  if (length < 128) return [length]
  const bytes: number[] = []
  for (let value = length; value > 0; value >>>= 8) bytes.unshift(value & 0xff)
  return [0x80 | bytes.length, ...bytes]
}

function der(tag: number, value: number[]): number[] {
  return [tag, ...derLength(value.length), ...value]
}

/** Build the minimal RFC 3161 TimeStampReq for a SHA-256 imprint. */
export function rfc3161TimestampQuery(recordHash: string): Uint8Array {
  const digest = [...recordHashBytes(recordHash)]
  const sha256AlgorithmIdentifier = [
    0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05, 0x00,
  ]
  const messageImprint = der(0x30, [...sha256AlgorithmIdentifier, ...der(0x04, digest)])
  return new Uint8Array(der(0x30, [...der(0x02, [0x01]), ...messageImprint, 0x01, 0x01, 0xff]))
}

/** Real Rekor HTTP adapter. It submits an unsigned hashedrekord claim. */
export function createRekorAnchorTransport(
  descriptor: AnchorDescriptor,
  options: AnchorTransportOptions = {},
): AnchorTransport {
  const anchorId = descriptorId(descriptor)
  const fetchImpl = httpFetch(options)
  const endpoint = descriptorEndpoint(descriptor)
  if (!fetchImpl || !endpoint) return createStubAnchorTransport('sigstore-rekor', anchorId)
  return {
    anchorType: 'sigstore-rekor',
    anchorId,
    async submit(request) {
      const artifact = anchorClaimArtifact(request.recordHash)
      const response = await fetchImpl(`${endpoint.replace(/\/$/, '')}/api/v1/log/entries`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          apiVersion: '0.0.1',
          kind: 'hashedrekord',
          spec: {
            data: {
              hash: { algorithm: 'sha256', value: request.recordHash.slice('sha256:'.length) },
              content: bytesToBase64(artifact),
            },
          },
        }),
      })
      if (!response.ok) throw new Error(`Rekor submission failed: ${response.status}`)
      return { anchor_type: 'sigstore-rekor', anchor_id: anchorId, status: 'queued' }
    },
  }
}

/** Real RFC 3161 HTTP adapter using a DER TimeStampReq with a SHA-256 imprint. */
export function createRfc3161AnchorTransport(
  descriptor: AnchorDescriptor,
  options: AnchorTransportOptions = {},
): AnchorTransport {
  const anchorId = descriptorId(descriptor)
  const fetchImpl = httpFetch(options)
  const endpoint = descriptorEndpoint(descriptor)
  if (!fetchImpl || !endpoint) return createStubAnchorTransport('rfc3161-tsa', anchorId)
  return {
    anchorType: 'rfc3161-tsa',
    anchorId,
    async submit(request) {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/timestamp-query',
          accept: 'application/timestamp-reply',
        },
        body: binaryBody(rfc3161TimestampQuery(request.recordHash)),
      })
      if (!response.ok) throw new Error(`RFC 3161 submission failed: ${response.status}`)
      const responseBytes = new Uint8Array(await response.arrayBuffer())
      if (responseBytes.length === 0)
        throw new Error('RFC 3161 submission returned an empty response')
      return { anchor_type: 'rfc3161-tsa', anchor_id: anchorId, status: 'queued' }
    },
  }
}

/** Real OpenTimestamps calendar adapter. Accepted receipts remain pending. */
export function createOpenTimestampsAnchorTransport(
  descriptor: AnchorDescriptor,
  options: AnchorTransportOptions = {},
): AnchorTransport {
  const anchorId = descriptorId(descriptor)
  const fetchImpl = httpFetch(options)
  const calendars =
    descriptor.calendars ??
    (descriptorEndpoint(descriptor) ? [descriptorEndpoint(descriptor)!] : [])
  if (!fetchImpl || calendars.length === 0)
    return createStubAnchorTransport('opentimestamps', anchorId)
  return {
    anchorType: 'opentimestamps',
    anchorId,
    async submit(request) {
      const digest = recordHashBytes(request.recordHash)
      const failures: string[] = []
      for (const calendar of calendars) {
        try {
          const response = await fetchImpl(`${calendar.replace(/\/$/, '')}/digest`, {
            method: 'POST',
            headers: {
              'content-type': 'application/octet-stream',
              accept: 'application/vnd.opentimestamps.ots',
            },
            body: binaryBody(digest),
          })
          if (!response.ok) throw new Error(`${response.status}`)
          const receipt = new Uint8Array(await response.arrayBuffer())
          if (receipt.length === 0) throw new Error('empty receipt')
          return { anchor_type: 'opentimestamps', anchor_id: anchorId, status: 'pending' }
        } catch (error) {
          failures.push(error instanceof Error ? error.message : String(error))
        }
      }
      throw new Error(`OpenTimestamps submission failed: ${failures.join(', ')}`)
    },
  }
}

/** Build the default transport for one descriptor. */
export function createAnchorTransport(
  descriptor: AnchorDescriptor,
  options: AnchorTransportOptions = {},
): AnchorTransport {
  const anchorType = descriptorType(descriptor)
  if (anchorType === 'atrib-log') {
    return createAtribLogAnchorTransport(descriptor, options)
  }
  if (anchorType === 'sigstore-rekor') return createRekorAnchorTransport(descriptor, options)
  if (anchorType === 'rfc3161-tsa') return createRfc3161AnchorTransport(descriptor, options)
  return createOpenTimestampsAnchorTransport(descriptor, options)
}

/**
 * Handle returned by `submitToAnchors`. The caller MUST NOT await
 * `outcomes` on the primary path (§5.3.5); it exists for tests, flush
 * hooks, and audit sinks.
 */
export interface AnchorFanoutTicket {
  outcomes: Promise<AnchorSubmissionOutcome[]>
  /** Successful-leg accounting derived from settled outcomes. */
  report: Promise<AnchorSubmissionReport>
}

export interface CreateAnchorFanoutOptions {
  /** Anchor-set configuration (§2.11.12). Absent = built-in default set. */
  config?: AnchorSetConfig
  /**
   * Transport injection: overrides the built-in transport for any effective
   * descriptor whose `(anchor_type, anchor_id)` pair matches. Extra
   * transports with no matching descriptor are ignored. Used by tests and
   * by hosts that ship their own adapters ahead of the built-in ones.
   */
  transports?: AnchorTransport[]
  /** Forwarded to atrib-log submission queues created by this fan-out. */
  maxQueueDepth?: number
  /** Injectable HTTP client for explicitly configured non-log anchor legs. */
  fetchImpl?: AnchorFetch
  /**
   * Observer invoked once per settled anchor leg. Errors are caught and
   * logged per §5.8; they never affect other legs or the caller.
   */
  onOutcome?: (outcome: AnchorSubmissionOutcome) => void
}

export interface AnchorFanout {
  /** The §2.11.12 posture this fan-out resolved at creation time. */
  readonly posture: AnchorPostureResolution
  /**
   * §5.9.3 sidecar degradation marker, or null. Non-null exactly when the
   * config warned (§2.11.12 rule 4); hosts write it to `_local.anchor_config`.
   */
  readonly sidecarMarker: AnchorConfigSidecarMarker | null
  /** The transports this fan-out submits to, in effective-set order. */
  readonly transports: readonly AnchorTransport[]
  /**
   * Fan a signed record out to every configured anchor. Returns
   * synchronously; never awaits any transport, never throws (§5.3.5, §5.8).
   */
  submitToAnchors(record: AtribRecord, priority?: 'high' | 'normal'): AnchorFanoutTicket
  /** Await all in-flight anchor legs (testing/shutdown only). */
  flush(): Promise<void>
}

/**
 * Create a long-lived anchor fan-out for a producer. Resolves the §2.11.12
 * posture once, emits the rule-4 `atrib:` warning when applicable (the
 * operation continues; signing is never disabled), and builds one transport
 * per effective anchor.
 */
export function createAnchorFanout(options: CreateAnchorFanoutOptions = {}): AnchorFanout {
  const config = options.config ?? {}
  const posture = resolveAnchorPosture(config)
  if (posture.warn) {
    console.warn(
      `atrib: anchor config names ${posture.effective_anchor_count} anchor(s) without allow_single_anchor; ` +
        'anchor plurality (>=2 independent anchors, spec §2.11.12) is not met. ' +
        'The operation continues and signing is unaffected (§5.8).',
    )
  }

  const injected = options.transports ?? []
  const allowNetwork = Array.isArray(config.anchors)
  const transports: AnchorTransport[] = []
  for (const descriptor of resolveEffectiveAnchors(config)) {
    try {
      const anchorType = descriptorType(descriptor)
      const anchorId = descriptorId(descriptor)
      const override = injected.find((t) => t.anchorType === anchorType && t.anchorId === anchorId)
      transports.push(
        override ??
          createAnchorTransport(descriptor, {
            ...(options.maxQueueDepth !== undefined
              ? { maxQueueDepth: options.maxQueueDepth }
              : {}),
            allowNetwork,
            ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
          }),
      )
    } catch (err) {
      // A single bad descriptor must not take down the rest of the set.
      console.warn('atrib: anchor descriptor could not be initialized; leg skipped', err)
    }
  }

  const inFlight: Promise<AnchorSubmissionOutcome[]>[] = []

  function settleOutcome(outcome: AnchorSubmissionOutcome): AnchorSubmissionOutcome {
    if (options.onOutcome) {
      try {
        options.onOutcome(outcome)
      } catch (err) {
        console.warn('atrib: anchor outcome observer threw', err)
      }
    }
    return outcome
  }

  return {
    posture,
    sidecarMarker: posture.sidecar_anchor_config,
    transports,

    submitToAnchors(
      record: AtribRecord,
      priority: 'high' | 'normal' = 'normal',
    ): AnchorFanoutTicket {
      let recordHash: string
      try {
        recordHash = canonicalRecordHash(record)
      } catch (err) {
        // Canonicalization failure: no anchor leg can proceed, but the
        // primary path is unaffected (§5.8).
        console.warn('atrib: anchor fan-out could not hash record; skipping all legs', err)
        const outcomes = Promise.resolve<AnchorSubmissionOutcome[]>([])
        return {
          outcomes,
          report: outcomes.then((settled) =>
            summarizeAnchorOutcomes(settled, posture.effective_anchor_count),
          ),
        }
      }
      const request: AnchorSubmissionRequest = { record, recordHash, priority }

      // Per-anchor fire-and-forget with independent failure isolation
      // (§2.11.12): one leg's failure never affects another leg or the
      // caller. Nothing below is awaited before this function returns.
      const legs = transports.map(async (transport): Promise<AnchorSubmissionOutcome> => {
        try {
          return settleOutcome(await transport.submit(request))
        } catch (err) {
          console.warn(
            `atrib: anchor submission failed (${transport.anchorType} ${transport.anchorId})`,
            { record_hash: recordHash, error: err },
          )
          return settleOutcome({
            anchor_type: transport.anchorType,
            anchor_id: transport.anchorId,
            status: 'failed',
            detail: err instanceof Error ? err.message : String(err),
          })
        }
      })

      const outcomes = Promise.all(legs)
      inFlight.push(outcomes)
      void outcomes.finally(() => {
        const idx = inFlight.indexOf(outcomes)
        if (idx !== -1) inFlight.splice(idx, 1)
      })
      return {
        outcomes,
        report: outcomes.then((settled) =>
          summarizeAnchorOutcomes(settled, posture.effective_anchor_count),
        ),
      }
    },

    async flush(): Promise<void> {
      do {
        while (inFlight.length > 0) {
          const batch = inFlight.splice(0)
          await Promise.allSettled(batch)
        }
        await Promise.allSettled(
          transports.map((transport) => transport.flush?.() ?? Promise.resolve()),
        )
      } while (inFlight.length > 0)
    },
  }
}

export interface SubmitToAnchorsOptions extends CreateAnchorFanoutOptions {
  priority?: 'high' | 'normal'
}

/**
 * One-shot convenience over `createAnchorFanout`: fan a single signed
 * record out to the configured anchor set. Returns synchronously with an
 * `AnchorFanoutTicket`; never awaits, never throws (§5.3.5, §5.8).
 *
 * Long-lived producers should hold a `createAnchorFanout` instance instead
 * so atrib-log retry queues persist across records.
 */
export function submitToAnchors(
  record: AtribRecord,
  options: SubmitToAnchorsOptions = {},
): AnchorFanoutTicket {
  try {
    const { priority, ...fanoutOptions } = options
    const fanout = createAnchorFanout(fanoutOptions)
    return fanout.submitToAnchors(record, priority ?? 'normal')
  } catch (err) {
    console.warn('atrib: anchor fan-out failed unexpectedly', err)
    const outcomes = Promise.resolve<AnchorSubmissionOutcome[]>([])
    return { outcomes, report: outcomes.then(summarizeAnchorOutcomes) }
  }
}
