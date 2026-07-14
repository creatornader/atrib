// SPDX-License-Identifier: Apache-2.0

/**
 * Anchor plurality verification (D138, spec §2.11.7-§2.11.13).
 *
 * Implements the verifier side of the anchor interface over §2.11.3
 * `log_proofs` arrays:
 *
 *   - `anchor_type` discrimination per §2.11.9: absent = `atrib-log`
 *     carrying the legacy `(log_id, checkpoint, inclusion_proof)` triple,
 *     so every existing bundle parses unchanged, byte-for-byte.
 *   - Malformation rules (a)/(b) per §2.11.9: a malformed element is
 *     excluded from every count except `proof_count` / `malformed_count`
 *     and never invalidates the bundle or the record. Malformation takes
 *     precedence over unknown-type surfacing: an element that violates
 *     rule (b) is malformed even when its `anchor_type` is unregistered.
 *   - Unknown-type forward compatibility: surfaced in `unknown_types`,
 *     never counted toward plurality, never invalidating — the same rule
 *     as unknown event types (§1.2.4).
 *   - The `anchor_plurality` annotation per §2.11.11, with
 *     `single_anchor: true` as a TIER, never a failure — signal not block,
 *     exactly like `cross_attestation_missing` (D052) and
 *     `in_envelope: false` (D051).
 *   - The §2.11.4 hard conditions, UNCHANGED: `cross_log_threshold_not_met`
 *     (consumer threshold M, default 1) and
 *     `cross_log_equivocation_detected` (pairwise committed-leaf-byte
 *     comparison across trusted logs) are the only hard rejections;
 *     censorship-shaped disagreement is flagged
 *     (`cross_log_censorship_suspected`) with the silent log identified,
 *     never rejected.
 *
 * Every verification here is a pure function of the bundle, the record
 * hash, and the caller's trust configuration (§2.11.7(c)): no network, no
 * wall clock, no randomness. Two runs on identical input produce identical
 * output — the same determinism discipline as §4.6.
 *
 * The `rfc3161-tsa` and `opentimestamps` payload interiors are STRUCTURAL
 * in this revision, matching the conformance corpus
 * (spec/conformance/2.11/anchors/): the commitment-binding fields
 * (`hashed_message_hex` / `commitment_hex`) MUST equal the bundle's record
 * hash and are checked; the DER TimeStampToken and serialized `.ots` bytes
 * are carried opaquely. Implementations with real RFC 3161 / OTS verifiers
 * additionally verify those payloads and treat a cryptographic failure as
 * an invalid proof.
 */

import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'
import {
  base64urlDecode,
  hexEncode,
  leafHash,
  sha256,
  verifyInclusion,
} from '@atrib/mcp'

// @noble/ed25519 v3 needs sha512 wired via the hashes object. Idempotent;
// the same wiring @atrib/mcp performs on load, repeated so this module is
// safe to import in isolation.
ed.hashes.sha512 = sha512
ed.hashes.sha512Async = (m: Uint8Array) => Promise.resolve(sha512(m))

const utf8 = new TextEncoder()
const utf8Decode = new TextDecoder()

/** §2.11.10 domain-separation prefix for the anchoring-claim artifact. */
export const ANCHOR_CLAIM_PREFIX = 'atrib-anchor/v1:'

/** Registered non-atrib-log anchor types per the §2.11.8 v1 registry. */
export const REGISTERED_NON_LOG_ANCHOR_TYPES: ReadonlySet<string> = new Set([
  'sigstore-rekor',
  'rfc3161-tsa',
  'opentimestamps',
])

// ── Wire shapes (§2.11.3 / §2.11.9) ─────────────────────────────────

/**
 * One `log_proofs` element. Legacy elements (absent `anchor_type`) carry
 * the atrib-log triple; discriminated elements carry `anchor_id` + `proof`.
 * The corpus additionally carries `log_index` and `entry_bytes_b64` on
 * atrib-log elements so the inclusion proof and the §2.11.4 step-4 leaf
 * comparison are independently checkable.
 */
export interface AnchorProofElement {
  anchor_type?: string
  anchor_id?: string
  proof?: Record<string, unknown>
  log_id?: string
  log_index?: number
  checkpoint?: string
  inclusion_proof?: string[]
  entry_bytes_b64?: string
}

/** A proof bundle whose `log_proofs` array is the wire shape for all anchors. */
export interface AnchorProofBundle {
  record_hash: string
  log_proofs: AnchorProofElement[]
}

/** Trust material for one log-shaped anchor (atrib log or Rekor instance). */
export interface AnchorTrustEntry {
  /** §2.4 origin string the checkpoint's first line must match. */
  origin: string
  /** The anchor service's Ed25519 public key, standard base64. */
  pubkey_b64: string
}

/** Declared operator grouping for independence counting (§2.11.11). */
export interface AnchorOperatorGroup {
  group: string
  members: Array<{ anchor_type: string; anchor_id: string }>
}

/**
 * Verifier trust configuration. `trust_material` maps anchor identities to
 * their published keys; `trusted_logs` and `threshold_m` drive the
 * unchanged §2.11.4 hard conditions; `required_anchors` (default 2) drives
 * the §2.11.11 `plurality_met` tier; `operator_groups` declares operator
 * identity for independence counting (default: one group per distinct
 * `(anchor_type, anchor_id)` pair).
 */
export interface AnchorTrustConfig {
  trust_material: {
    logs: Record<string, AnchorTrustEntry>
    rekor?: Record<string, AnchorTrustEntry>
  }
  trusted_logs?: string[]
  threshold_m?: number
  required_anchors?: number
  operator_groups?: AnchorOperatorGroup[]
}

/**
 * A "record not found" response from a trusted log inside the bundle's
 * epoch window — the censorship-shaped equivocation input of §2.11.4.
 */
export interface AnchorNotFoundResponse {
  log_id: string
  status: string
  epoch_window_ms: [number, number]
}

// ── Verdict shapes (§2.11.11 / §2.11.4) ─────────────────────────────

/** The §2.11.11 `anchor_plurality` annotation, exact field set. */
export interface AnchorPluralityAnnotation {
  proof_count: number
  verified_count: number
  pending_count: number
  malformed_count: number
  unknown_types: string[]
  independent_count: number
  plurality_met: boolean
  single_anchor: boolean
  equivocation_detected: boolean
  anchored_at_range_ms: [number, number] | null
}

/** The disagreeing pair surfaced on §2.11.4 equivocation detection. */
export interface AnchorDisagreeingPair {
  log_id_a: string
  leaf_hash_a_hex: string
  log_id_b: string
  leaf_hash_b_hex: string
}

/**
 * Full verifier verdict: the `anchor_plurality` annotation plus the
 * unchanged §2.11.4 hard-condition facts. `hard_reject` is true only for
 * the §2.11.4 conditions; `single_anchor` is a tier, never a failure.
 */
export interface AnchorPluralityVerdict {
  anchor_plurality: AnchorPluralityAnnotation
  malformed_indices: number[]
  invalid_indices: number[]
  trusted_verified_count: number
  cross_log_threshold_not_met: boolean
  cross_log_equivocation_detected: boolean
  cross_log_censorship_suspected: boolean
  silent_log: string | null
  untrusted_surfaced: string[]
  disagreeing_pair: AnchorDisagreeingPair | null
  hard_reject: boolean
}

/** Per-element verification status. */
export type AnchorElementStatus = 'verified' | 'pending' | 'invalid' | 'malformed' | 'unknown'

/** Per-element verification result (exported for unit-level assertions). */
export interface AnchorElementResult {
  status: AnchorElementStatus
  anchorType: string
  anchorId: string
  attestedTimeMs: number | null
  /** Committed entry bytes (atrib-log elements only), for §2.11.4 step 4. */
  entryBytesB64: string | null
}

// ── Internals ────────────────────────────────────────────────────────

function b64decode(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, 'base64'))
}

/**
 * JCS-equivalent serialization for the FLAT objects the corpus signs
 * (ASCII string / integer values only): JSON.stringify with sorted keys.
 */
function sortedJson(obj: Record<string, string | number>): string {
  const sorted: Record<string, string | number> = {}
  for (const key of Object.keys(obj).sort()) {
    const value = obj[key]
    if (value !== undefined) sorted[key] = value
  }
  return JSON.stringify(sorted)
}

/** §2.4.2 key_id = SHA-256(key_name || 0x0A || 0x01 || public_key_bytes)[:4] */
function computeKeyId(origin: string, publicKey: Uint8Array): Uint8Array {
  const nameBytes = utf8.encode(origin)
  const preimage = new Uint8Array(nameBytes.length + 2 + publicKey.length)
  preimage.set(nameBytes, 0)
  preimage[nameBytes.length] = 0x0a
  preimage[nameBytes.length + 1] = 0x01
  preimage.set(publicKey, nameBytes.length + 2)
  return sha256(preimage).slice(0, 4)
}

interface ParsedCheckpoint {
  origin: string
  treeSize: number
  root: Uint8Array
  bodyBytes: Uint8Array
  keyId: Uint8Array
  signature: Uint8Array
}

/** Parse a §2.4.3 signed note (3-line body + blank line + signature line). */
function parseCheckpoint(checkpoint: string): ParsedCheckpoint | null {
  const lines = checkpoint.split('\n')
  if (lines.length < 5) return null
  const origin = lines[0]
  const sizeStr = lines[1]
  const rootB64 = lines[2]
  if (origin === undefined || sizeStr === undefined || rootB64 === undefined) return null
  if (lines[3] !== '') return null
  const sigLine = lines[4]
  if (sigLine === undefined) return null
  const m = sigLine.match(/^[—-] (\S+) (\S+)\s*$/)
  if (!m) return null
  const sigOrigin = m[1] as string
  if (sigOrigin !== origin) return null
  const decoded = b64decode(m[2] as string)
  if (decoded.length !== 4 + 64) return null
  if (!/^\d+$/.test(sizeStr)) return null
  const body = `${origin}\n${sizeStr}\n${rootB64}\n`
  return {
    origin,
    treeSize: Number(sizeStr),
    root: b64decode(rootB64),
    bodyBytes: utf8.encode(body),
    keyId: decoded.slice(0, 4),
    signature: decoded.slice(4),
  }
}

/** Verify a signed checkpoint against a trust-material entry. */
async function verifyCheckpoint(
  checkpoint: string,
  material: AnchorTrustEntry,
): Promise<ParsedCheckpoint | null> {
  const parsed = parseCheckpoint(checkpoint)
  if (!parsed) return null
  if (parsed.origin !== material.origin) return null
  const pubkey = b64decode(material.pubkey_b64)
  const expectedKeyId = computeKeyId(material.origin, pubkey)
  if (hexEncode(parsed.keyId) !== hexEncode(expectedKeyId)) return null
  const ok = await ed.verifyAsync(parsed.signature, parsed.bodyBytes, pubkey)
  return ok ? parsed : null
}

// ── Per-element verification (§2.11.7(c) pure function) ─────────────

/**
 * Verify one `log_proofs` element against the bundle's `record_hash` and
 * the caller's trust material. Pure: no network, no clock, no randomness.
 * Never throws; unexpected failures surface as `invalid` (§5.8).
 */
export async function verifyAnchorProofElement(
  el: AnchorProofElement,
  recordHash: string,
  trust: AnchorTrustConfig,
): Promise<AnchorElementResult> {
  try {
    return await verifyElementInner(el, recordHash, trust)
  } catch {
    return {
      status: 'invalid',
      anchorType: typeof el?.anchor_type === 'string' ? el.anchor_type : 'atrib-log',
      anchorId:
        typeof el?.anchor_id === 'string'
          ? el.anchor_id
          : typeof el?.log_id === 'string'
            ? el.log_id
            : '',
      attestedTimeMs: null,
      entryBytesB64: null,
    }
  }
}

async function verifyElementInner(
  el: AnchorProofElement,
  recordHash: string,
  trust: AnchorTrustConfig,
): Promise<AnchorElementResult> {
  // Guard non-object elements as malformed rather than crashing on access.
  if (typeof el !== 'object' || el === null) {
    return {
      status: 'malformed',
      anchorType: 'atrib-log',
      anchorId: '',
      attestedTimeMs: null,
      entryBytesB64: null,
    }
  }

  const anchorType = el.anchor_type
  const recordHashHex = recordHash.startsWith('sha256:')
    ? recordHash.slice('sha256:'.length)
    : recordHash

  // Rule (a): anchor_type absent (or explicit "atrib-log") requires the
  // legacy (log_id, checkpoint, inclusion_proof) triple; when the
  // discriminator is absent a `proof` object is additionally forbidden.
  if (anchorType === undefined || anchorType === 'atrib-log') {
    if (
      typeof el.log_id !== 'string' ||
      typeof el.checkpoint !== 'string' ||
      !Array.isArray(el.inclusion_proof) ||
      (anchorType === undefined && el.proof !== undefined)
    ) {
      return {
        status: 'malformed',
        anchorType: 'atrib-log',
        anchorId: typeof el.log_id === 'string' ? el.log_id : '',
        attestedTimeMs: null,
        entryBytesB64: null,
      }
    }
    const base: Omit<AnchorElementResult, 'status'> = {
      anchorType: 'atrib-log',
      anchorId: el.log_id,
      attestedTimeMs: null,
      entryBytesB64: el.entry_bytes_b64 ?? null,
    }
    const material = trust.trust_material.logs[el.log_id]
    if (!material || typeof el.entry_bytes_b64 !== 'string' || typeof el.log_index !== 'number') {
      return { ...base, status: 'invalid' }
    }
    const parsed = await verifyCheckpoint(el.checkpoint, material)
    if (!parsed) return { ...base, status: 'invalid' }
    const entryBytes = b64decode(el.entry_bytes_b64)
    // The 90-byte entry embeds record_hash at bytes [1..33] (§2.3.1).
    if (entryBytes.length !== 90 || hexEncode(entryBytes.slice(1, 33)) !== recordHashHex) {
      return { ...base, status: 'invalid' }
    }
    const proof = el.inclusion_proof.map(b64decode)
    const ok = verifyInclusion(el.log_index, parsed.treeSize, leafHash(entryBytes), proof, parsed.root)
    return { ...base, status: ok ? 'verified' : 'invalid' }
  }

  // Rule (b): anchor_type present and != "atrib-log" requires anchor_id +
  // proof. Malformation takes precedence over unknown-type surfacing: an
  // element violating rule (b) is malformed per §2.11.9(e) even when its
  // anchor_type is unregistered.
  if (typeof el.anchor_id !== 'string' || typeof el.proof !== 'object' || el.proof === null) {
    return {
      status: 'malformed',
      anchorType,
      anchorId: el.anchor_id ?? '',
      attestedTimeMs: null,
      entryBytesB64: null,
    }
  }

  const base: Omit<AnchorElementResult, 'status'> = {
    anchorType,
    anchorId: el.anchor_id,
    attestedTimeMs: null,
    entryBytesB64: null,
  }

  if (!REGISTERED_NON_LOG_ANCHOR_TYPES.has(anchorType)) {
    // Forward compatibility (§2.11.8): surfaced, not counted, never invalidating.
    return { ...base, status: 'unknown' }
  }

  const proof = el.proof

  if (anchorType === 'sigstore-rekor') {
    const material = trust.trust_material.rekor?.[el.anchor_id]
    const entryBodyB64 = proof['entry_body_b64']
    const logIndex = proof['log_index']
    const checkpoint = proof['checkpoint']
    const inclusionProof = proof['inclusion_proof']
    const integratedTimeMs = proof['integrated_time_ms']
    const setB64 = proof['signed_entry_timestamp_b64']
    if (
      !material ||
      typeof entryBodyB64 !== 'string' ||
      typeof logIndex !== 'number' ||
      typeof checkpoint !== 'string' ||
      !Array.isArray(inclusionProof) ||
      typeof integratedTimeMs !== 'number' ||
      typeof setB64 !== 'string'
    ) {
      return { ...base, status: 'invalid' }
    }
    // 1. Reconstruct the anchor-claim artifact from the bundle's record_hash
    //    (§2.11.10). An entry whose artifact does not reconstruct is an
    //    INVALID proof — not counted, not equivocation — even when its
    //    embedded signature is genuinely valid over its own artifact.
    const expectedArtifact = ANCHOR_CLAIM_PREFIX + recordHash
    const bodyBytes = b64decode(entryBodyB64)
    let body: Record<string, unknown>
    try {
      body = JSON.parse(utf8Decode.decode(bodyBytes)) as Record<string, unknown>
    } catch {
      return { ...base, status: 'invalid' }
    }
    const artifactB64 = body['artifact_b64']
    const pubB64url = body['public_key_b64url']
    const sigB64url = body['signature_b64url']
    if (
      typeof artifactB64 !== 'string' ||
      typeof pubB64url !== 'string' ||
      typeof sigB64url !== 'string'
    ) {
      return { ...base, status: 'invalid' }
    }
    const artifactBytes = b64decode(artifactB64)
    const artifact = utf8Decode.decode(artifactBytes)
    if (artifact !== expectedArtifact || !artifact.startsWith(ANCHOR_CLAIM_PREFIX)) {
      return { ...base, status: 'invalid' }
    }
    // 2. Verify the FRESH anchoring signature over the artifact bytes —
    //    never the record's own signature (§2.11.10).
    const sigOk = await ed.verifyAsync(
      base64urlDecode(sigB64url),
      artifactBytes,
      base64urlDecode(pubB64url),
    )
    if (!sigOk) return { ...base, status: 'invalid' }
    // 3. Verify the inclusion proof against the checkpoint.
    const parsed = await verifyCheckpoint(checkpoint, material)
    if (!parsed) return { ...base, status: 'invalid' }
    const inclusionOk = verifyInclusion(
      logIndex,
      parsed.treeSize,
      leafHash(bodyBytes),
      (inclusionProof as string[]).map(b64decode),
      parsed.root,
    )
    if (!inclusionOk) return { ...base, status: 'invalid' }
    // 4. Verify the signed entry timestamp over the reconstructed input.
    const setInput = sortedJson({
      entry_body_b64: entryBodyB64,
      integrated_time_ms: integratedTimeMs,
      log_index: logIndex,
    })
    const setOk = await ed.verifyAsync(
      b64decode(setB64),
      utf8.encode(setInput),
      b64decode(material.pubkey_b64),
    )
    if (!setOk) return { ...base, status: 'invalid' }
    return { ...base, status: 'verified', attestedTimeMs: integratedTimeMs }
  }

  if (anchorType === 'rfc3161-tsa') {
    // STRUCTURAL verification in this revision: the commitment-binding
    // field must equal the bundle's record hash; the DER token is opaque.
    // A token whose hashedMessage differs is an invalid proof, not
    // equivocation (§2.11.11).
    const hashedMessageHex = proof['hashed_message_hex']
    const tokenB64 = proof['timestamp_token_b64']
    const genTimeMs = proof['gen_time_ms']
    if (
      typeof hashedMessageHex !== 'string' ||
      typeof tokenB64 !== 'string' ||
      typeof genTimeMs !== 'number' ||
      hashedMessageHex !== recordHashHex ||
      b64decode(tokenB64).length === 0
    ) {
      return { ...base, status: 'invalid' }
    }
    return { ...base, status: 'verified', attestedTimeMs: genTimeMs }
  }

  // opentimestamps. A `pending` proof is carried and upgraded in place
  // later (§2.11.8); it counts in pending_count, never toward plurality.
  const commitmentHex = proof['commitment_hex']
  const otsB64 = proof['ots_b64']
  const status = proof['status']
  if (
    typeof commitmentHex !== 'string' ||
    typeof otsB64 !== 'string' ||
    commitmentHex !== recordHashHex ||
    b64decode(otsB64).length === 0
  ) {
    return { ...base, status: 'invalid' }
  }
  if (status === 'pending') return { ...base, status: 'pending' }
  const attestedTimeMs = proof['attested_time_ms']
  if (status !== 'complete' || typeof attestedTimeMs !== 'number') {
    return { ...base, status: 'invalid' }
  }
  return { ...base, status: 'verified', attestedTimeMs }
}

/**
 * Operator-group key for independence counting (§2.11.11): the declared
 * group when the trust config names one, else one group per distinct
 * `(anchor_type, anchor_id)` pair (the default grouping).
 */
export function anchorOperatorGroup(
  anchorType: string,
  anchorId: string,
  trust: AnchorTrustConfig,
): string {
  for (const g of trust.operator_groups ?? []) {
    for (const m of g.members) {
      if (m.anchor_type === anchorType && m.anchor_id === anchorId) return `group:${g.group}`
    }
  }
  return `pair:${anchorType} ${anchorId}`
}

// ── Bundle-level verdict (§2.11.11 annotation + §2.11.4 hard conditions) ──

/**
 * Compute the `anchor_plurality` annotation and the unchanged §2.11.4 hard
 * conditions for a proof bundle. Deterministic: identical bundle + trust
 * config + not-found responses in, identical verdict out. Never throws;
 * a structurally hopeless bundle degrades to zero counts (§5.8).
 *
 * `single_anchor: true` is a TIER: the record stays valid, `hard_reject`
 * stays false. Hard rejection is reserved for `cross_log_threshold_not_met`
 * and `cross_log_equivocation_detected`; `cross_log_censorship_suspected`
 * is a flag, not a rejection.
 */
export async function verifyAnchorPlurality(
  bundle: AnchorProofBundle,
  trust: AnchorTrustConfig,
  notFoundResponses: AnchorNotFoundResponse[] = [],
): Promise<AnchorPluralityVerdict> {
  const elements =
    typeof bundle === 'object' && bundle !== null && Array.isArray(bundle.log_proofs)
      ? bundle.log_proofs
      : []
  const recordHash =
    typeof bundle === 'object' && bundle !== null && typeof bundle.record_hash === 'string'
      ? bundle.record_hash
      : ''

  const results: AnchorElementResult[] = []
  for (const el of elements) {
    results.push(await verifyAnchorProofElement(el, recordHash, trust))
  }

  const malformedIndices: number[] = []
  const invalidIndices: number[] = []
  const unknownTypes: string[] = []
  const groups = new Set<string>()
  const times: number[] = []
  let verified = 0
  let pending = 0

  results.forEach((r, i) => {
    if (r.status === 'malformed') malformedIndices.push(i)
    if (r.status === 'invalid') invalidIndices.push(i)
    if (r.status === 'unknown' && !unknownTypes.includes(r.anchorType)) {
      unknownTypes.push(r.anchorType)
    }
    if (r.status === 'pending') pending += 1
    if (r.status === 'verified') {
      verified += 1
      groups.add(anchorOperatorGroup(r.anchorType, r.anchorId, trust))
      if (r.attestedTimeMs !== null) times.push(r.attestedTimeMs)
    }
  })

  const requiredAnchors = trust.required_anchors ?? 2
  const thresholdM = trust.threshold_m ?? 1
  const trustedLogs = trust.trusted_logs ?? []

  // §2.11.4 threshold: count verified atrib-log proofs in the trusted set.
  // Untrusted-set proofs are surfaced, never counted toward M.
  const trustedVerified = results.filter(
    (r) => r.status === 'verified' && r.anchorType === 'atrib-log' && trustedLogs.includes(r.anchorId),
  )
  const untrustedSurfaced = results
    .filter(
      (r) =>
        r.status === 'verified' && r.anchorType === 'atrib-log' && !trustedLogs.includes(r.anchorId),
    )
    .map((r) => r.anchorId)
  const thresholdNotMet = trustedVerified.length < thresholdM

  // §2.11.4 step 4, unchanged: pairwise committed-leaf-byte comparison
  // across trusted logs for the same record_hash.
  let equivocation = false
  let disagreeingPair: AnchorDisagreeingPair | null = null
  for (let i = 0; i < trustedVerified.length; i++) {
    for (let j = i + 1; j < trustedVerified.length; j++) {
      const a = trustedVerified[i] as AnchorElementResult
      const b = trustedVerified[j] as AnchorElementResult
      if (a.entryBytesB64 !== null && b.entryBytesB64 !== null && a.entryBytesB64 !== b.entryBytesB64) {
        equivocation = true
        disagreeingPair = {
          log_id_a: a.anchorId,
          leaf_hash_a_hex: hexEncode(leafHash(b64decode(a.entryBytesB64))),
          log_id_b: b.anchorId,
          leaf_hash_b_hex: hexEncode(leafHash(b64decode(b.entryBytesB64))),
        }
      }
    }
  }

  // §2.11.4 censorship-shaped equivocation: a trusted log reports not-found
  // inside the epoch window while another trusted log holds a verified
  // proof. Flag, not rejection; the silent log is identified.
  let censorship = false
  let silentLog: string | null = null
  for (const nf of notFoundResponses) {
    if (nf.status === 'not_found' && trustedLogs.includes(nf.log_id) && trustedVerified.length > 0) {
      censorship = true
      silentLog = nf.log_id
    }
  }

  const independentCount = groups.size
  const annotation: AnchorPluralityAnnotation = {
    proof_count: elements.length,
    verified_count: verified,
    pending_count: pending,
    malformed_count: malformedIndices.length,
    unknown_types: unknownTypes,
    independent_count: independentCount,
    plurality_met: independentCount >= requiredAnchors,
    single_anchor: independentCount === 1,
    equivocation_detected: equivocation,
    anchored_at_range_ms: times.length > 0 ? [Math.min(...times), Math.max(...times)] : null,
  }

  return {
    anchor_plurality: annotation,
    malformed_indices: malformedIndices,
    invalid_indices: invalidIndices,
    trusted_verified_count: trustedVerified.length,
    cross_log_threshold_not_met: thresholdNotMet,
    cross_log_equivocation_detected: equivocation,
    cross_log_censorship_suspected: censorship,
    silent_log: silentLog,
    untrusted_surfaced: untrustedSurfaced,
    disagreeing_pair: disagreeingPair,
    // Hard rejection is reserved for the §2.11.4 conditions. single_anchor
    // is a tier, never a failure (§2.11.11).
    hard_reject: thresholdNotMet || equivocation,
  }
}
