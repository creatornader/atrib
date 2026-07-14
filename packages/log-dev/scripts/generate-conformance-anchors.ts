/**
 * Generate spec §2.11 anchor-plurality conformance corpus fixtures (P043 ADR).
 *
 * Run with: pnpm --filter @atrib/log-dev exec tsx scripts/generate-conformance-anchors.ts
 *
 * Output: spec/conformance/2.11/anchors/cases/*.json + manifest.json
 *
 * The corpus pins the anchor-interface contract that generalizes §2.11
 * cross-log replication: any independently operated service that can prove a
 * record_hash existed no later than time T is an anchor. Case families:
 *
 *   1. Legacy compatibility. `log_proofs` elements with absent `anchor_type`
 *      parse as `atrib-log` and carry the existing (log_id, checkpoint,
 *      inclusion_proof) triple, byte-for-byte unchanged.
 *   2. Discriminator rules. anchor_type present without `anchor_id`+`proof`
 *      is malformed; anchor_type absent without the legacy triple is
 *      malformed; unknown anchor_type values are surfaced, not counted, and
 *      never invalidating.
 *   3. Plurality tiering. `single_anchor: true` is a tier, never a failure;
 *      OTS `pending` proofs are excluded from plurality until upgraded in
 *      place; same-operator groups collapse `independent_count`.
 *   4. The anchoring-signature claim artifact. A FRESH Ed25519 signature over
 *      the reconstructible claim bytes `"atrib-anchor/v1:" + record_hash`.
 *      The record's own signature is never reused; a dedicated vector
 *      demonstrates why the digest path is cryptographically unimplementable
 *      (record_hash covers the COMPLETE record including `signature`, while
 *      the signature verifies over the signature-less form, and Pure EdDSA
 *      cannot be verified from a digest).
 *   5. Threshold and equivocation, unchanged from §2.11.4
 *      (cross_log_threshold_not_met, cross_log_equivocation_detected,
 *      cross_log_censorship_suspected).
 *   6. Producer-side `allow_single_anchor` config posture (§5.8-safe:
 *      warnings and sidecar markers, never a throw on the primary path).
 *
 * All record signatures, anchoring-claim signatures, checkpoint signatures,
 * Merkle roots, and inclusion proofs are REAL (Ed25519 / RFC 6962 /
 * SHA-256). The rfc3161-tsa and opentimestamps payload interiors are
 * STRUCTURAL in this corpus revision: the commitment-binding fields
 * (hashed_message_hex / commitment_hex) are the real record hash, while the
 * DER TimeStampToken and serialized .ots bytes are labeled placeholder
 * payloads pending full per-type crypto vectors (see corpus README).
 *
 * Seeds and timestamps are hardcoded so successive regenerations produce
 * byte-identical files.
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import * as ed from '@noble/ed25519'
import { sha256, sha512 } from '@noble/hashes/sha2.js'
import {
  base64urlEncode,
  canonicalRecord,
  computeInclusionProof,
  computeRoot,
  genesisChainRoot,
  getPublicKey,
  leafHash,
  serializeEntry,
  signRecord,
  type AtribRecord,
} from '@atrib/mcp'

// @noble/ed25519 v3 needs sha512 wired via the hashes object (same wiring
// as packages/mcp/src/signing.ts; repeated here because pnpm may give this
// script its own module instance).
ed.hashes.sha512 = sha512
ed.hashes.sha512Async = (m: Uint8Array) => Promise.resolve(sha512(m))

// ── Deterministic inputs ─────────────────────────────────────────────
const CREATOR_SEED = new Uint8Array(32).fill(0x51)
const ANCHORING_SEED = new Uint8Array(32).fill(0x52) // fresh anchoring key, NOT the creator's
const LOG_A_SEED = new Uint8Array(32).fill(0x61)
const LOG_B_SEED = new Uint8Array(32).fill(0x62)
const LOG_E_SEED = new Uint8Array(32).fill(0x63) // equivocating log
const REKOR_SEED = new Uint8Array(32).fill(0x64)

const REFERENCE_TIME_MS = Date.UTC(2026, 6, 1, 0, 0, 0)
const CONTEXT = 'ab'.repeat(16) // 32 hex chars (16 bytes)

const LOG_A_ID = 'log-a.conformance.atrib.test'
const LOG_B_ID = 'log-b.conformance.atrib.test'
const LOG_E_ID = 'log-e.conformance.atrib.test'
const REKOR_ID = 'rekor.conformance.atrib.test'
const LOG_A_ORIGIN = `${LOG_A_ID}/v1`
const LOG_B_ORIGIN = `${LOG_B_ID}/v1`
const LOG_E_ORIGIN = `${LOG_E_ID}/v1`
const REKOR_ORIGIN = `${REKOR_ID}/v1`

const ANCHOR_CLAIM_PREFIX = 'atrib-anchor/v1:'
const OBSERVATION_URI = 'https://atrib.dev/v1/types/observation'

const HERE = dirname(fileURLToPath(import.meta.url))
const CORPUS_ROOT = resolve(HERE, '../../../spec/conformance/2.11/anchors')
const CASES_DIR = join(CORPUS_ROOT, 'cases')

mkdirSync(CASES_DIR, { recursive: true })

const utf8 = new TextEncoder()

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex')
}

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

function b64utf8(text: string): string {
  return Buffer.from(utf8.encode(text)).toString('base64')
}

function recordHashOf(record: AtribRecord): string {
  return 'sha256:' + hex(sha256(canonicalRecord(record)))
}

/**
 * JCS-equivalent serialization for the FLAT objects this corpus signs
 * (ASCII string / integer values only): JSON.stringify with lexicographically
 * sorted keys. Documented in the corpus README; the reference test rebuilds
 * the identical bytes.
 */
function sortedJson(obj: Record<string, string | number>): string {
  const sorted: Record<string, string | number> = {}
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = obj[key] as string | number
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

/** §2.4.1 checkpoint body: origin\n treeSize\n base64(root)\n */
function checkpointBody(origin: string, treeSize: number, root: Uint8Array): string {
  return `${origin}\n${treeSize}\n${b64(root)}\n`
}

/** §2.4.3 signed note: body\n— origin base64(keyId[4] || sig[64])\n */
async function signCheckpoint(
  origin: string,
  treeSize: number,
  root: Uint8Array,
  seed: Uint8Array,
  publicKey: Uint8Array,
): Promise<string> {
  const body = checkpointBody(origin, treeSize, root)
  const sig = await ed.signAsync(utf8.encode(body), seed)
  const keyId = computeKeyId(origin, publicKey)
  const combined = new Uint8Array(keyId.length + sig.length)
  combined.set(keyId, 0)
  combined.set(sig, keyId.length)
  return `${body}\n— ${origin} ${b64(combined)}\n`
}

interface AtribLogElement {
  log_id: string
  log_index: number
  checkpoint: string
  inclusion_proof: string[]
  /** The §2.5.3-served 90-byte entry this log committed to, base64. */
  entry_bytes_b64: string
}

async function buildAtribLogElement(
  logId: string,
  origin: string,
  seed: Uint8Array,
  publicKey: Uint8Array,
  leaves: Uint8Array[],
  index: number,
): Promise<AtribLogElement> {
  const root = computeRoot(leaves)
  const proof = computeInclusionProof(index, leaves)
  const checkpoint = await signCheckpoint(origin, leaves.length, root, seed, publicKey)
  return {
    log_id: logId,
    log_index: index,
    checkpoint,
    inclusion_proof: proof.map(b64),
    entry_bytes_b64: b64(leaves[index] as Uint8Array),
  }
}

function writeCase(name: string, body: Record<string, unknown>): void {
  writeFileSync(join(CASES_DIR, `${name}.json`), JSON.stringify(body, null, 2) + '\n')
}

async function main(): Promise<void> {
  const creatorPub = await getPublicKey(CREATOR_SEED)
  const creatorKey = base64urlEncode(creatorPub)
  const anchoringPub = await ed.getPublicKeyAsync(ANCHORING_SEED)
  const logAPub = await ed.getPublicKeyAsync(LOG_A_SEED)
  const logBPub = await ed.getPublicKeyAsync(LOG_B_SEED)
  const logEPub = await ed.getPublicKeyAsync(LOG_E_SEED)
  const rekorPub = await ed.getPublicKeyAsync(REKOR_SEED)

  const chainRoot = genesisChainRoot(CONTEXT)

  // ── Records ──────────────────────────────────────────────────────
  async function makeRecord(contentByte: string, tsOffset: number): Promise<AtribRecord> {
    const unsigned = {
      spec_version: 'atrib/1.0' as const,
      content_id: 'sha256:' + contentByte.repeat(32),
      creator_key: creatorKey,
      chain_root: chainRoot,
      event_type: OBSERVATION_URI,
      context_id: CONTEXT,
      timestamp: REFERENCE_TIME_MS + tsOffset,
      signature: '',
    }
    return signRecord(unsigned as AtribRecord, CREATOR_SEED)
  }

  const record = await makeRecord('d1', 1000) // the anchored record
  const filler1 = await makeRecord('d2', 2000)
  const filler2 = await makeRecord('d3', 3000)

  const recordHash = recordHashOf(record)
  const recordHashHex = recordHash.slice('sha256:'.length)
  const filler1Hash = recordHashOf(filler1)

  function entryFor(r: AtribRecord, timestampOverride?: number): Uint8Array {
    return serializeEntry({
      record_hash_hex: recordHashOf(r).slice('sha256:'.length),
      creator_key_b64url: r.creator_key,
      context_id: r.context_id,
      timestamp: timestampOverride ?? r.timestamp,
      event_type: r.event_type,
    })
  }

  // ── atrib-log anchors (real trees, real checkpoints) ─────────────
  const entryA = entryFor(record)
  const elementA = await buildAtribLogElement(
    LOG_A_ID,
    LOG_A_ORIGIN,
    LOG_A_SEED,
    logAPub,
    [entryA, entryFor(filler1), entryFor(filler2)],
    0,
  )

  const elementB = await buildAtribLogElement(
    LOG_B_ID,
    LOG_B_ORIGIN,
    LOG_B_SEED,
    logBPub,
    [entryFor(filler1), entryFor(record)],
    1,
  )

  // Equivocating log: commits an entry for the SAME record_hash with a
  // different timestamp_ms, so the leaf bytes differ (§2.11.4 step 4).
  const entryE = entryFor(record, record.timestamp + 999_999)
  const elementEReal = await buildAtribLogElement(
    LOG_E_ID,
    LOG_E_ORIGIN,
    LOG_E_SEED,
    logEPub,
    [entryE, entryFor(filler2)],
    0,
  )

  // ── sigstore-rekor anchor (fresh anchoring signature, real tree) ──
  async function buildRekorElement(anchoredRecordHash: string, logIndex: number) {
    const artifact = ANCHOR_CLAIM_PREFIX + anchoredRecordHash
    const artifactBytes = utf8.encode(artifact)
    const anchoringSig = await ed.signAsync(artifactBytes, ANCHORING_SEED)
    const entryBodyJson = sortedJson({
      artifact_b64: b64(artifactBytes),
      kind: 'atrib-anchor-claim/v1',
      public_key_b64url: base64urlEncode(anchoringPub),
      signature_b64url: base64urlEncode(anchoringSig),
    })
    const entryBodyBytes = utf8.encode(entryBodyJson)
    // A second, unrelated rekor leaf so the tree has depth.
    const otherLeaf = utf8.encode(
      sortedJson({ artifact_b64: b64utf8('unrelated-rekor-leaf'), kind: 'other/v1' }),
    )
    const leaves = logIndex === 0 ? [entryBodyBytes, otherLeaf] : [otherLeaf, entryBodyBytes]
    const root = computeRoot(leaves)
    const proof = computeInclusionProof(logIndex, leaves)
    const checkpoint = await signCheckpoint(REKOR_ORIGIN, leaves.length, root, REKOR_SEED, rekorPub)
    const integratedTimeMs = REFERENCE_TIME_MS + 60_000
    const entryBodyB64 = b64(entryBodyBytes)
    const setInput = sortedJson({
      entry_body_b64: entryBodyB64,
      integrated_time_ms: integratedTimeMs,
      log_index: logIndex,
    })
    const setSig = await ed.signAsync(utf8.encode(setInput), REKOR_SEED)
    return {
      element: {
        anchor_type: 'sigstore-rekor',
        anchor_id: REKOR_ID,
        proof: {
          entry_uuid: hex(leafHash(entryBodyBytes)),
          log_index: logIndex,
          entry_body_b64: entryBodyB64,
          inclusion_proof: proof.map(b64),
          checkpoint,
          integrated_time_ms: integratedTimeMs,
          signed_entry_timestamp_b64: b64(setSig),
        },
      },
      artifact,
      setInput,
    }
  }

  const rekorValid = await buildRekorElement(recordHash, 0)
  // Binding mismatch: a genuinely-signed claim, but for a DIFFERENT record.
  const rekorMismatch = await buildRekorElement(filler1Hash, 0)

  // ── rfc3161-tsa anchor (structural payload, real binding fields) ──
  const TSA_ID = 'tsa.conformance.atrib.test'
  const tsaGenTimeMs = REFERENCE_TIME_MS + 31_000
  const tsaElement = {
    anchor_type: 'rfc3161-tsa',
    anchor_id: TSA_ID,
    proof: {
      // STRUCTURAL placeholder: a real vector carries a DER TimeStampToken.
      timestamp_token_b64: b64utf8('conformance-structural-token:' + recordHash),
      hashed_message_hex: recordHashHex,
      gen_time_ms: tsaGenTimeMs,
    },
  }

  // ── opentimestamps anchor (structural payload, real binding fields) ─
  const OTS_ID = 'opentimestamps-calendars'
  const otsAttestedTimeMs = REFERENCE_TIME_MS + 7_200_000
  const otsPendingElement = {
    anchor_type: 'opentimestamps',
    anchor_id: OTS_ID,
    proof: {
      // STRUCTURAL placeholder: a real vector carries serialized .ots bytes.
      ots_b64: b64utf8('conformance-structural-ots:' + recordHash),
      commitment_hex: recordHashHex,
      status: 'pending',
    },
  }
  const otsCompleteElement = {
    anchor_type: 'opentimestamps',
    anchor_id: OTS_ID,
    proof: {
      ots_b64: b64utf8('conformance-structural-ots:' + recordHash),
      commitment_hex: recordHashHex,
      status: 'complete',
      attested_time_ms: otsAttestedTimeMs,
    },
  }

  // ── Shared trust material ─────────────────────────────────────────
  const trustMaterial = {
    logs: {
      [LOG_A_ID]: { origin: LOG_A_ORIGIN, pubkey_b64: b64(logAPub) },
      [LOG_B_ID]: { origin: LOG_B_ORIGIN, pubkey_b64: b64(logBPub) },
      [LOG_E_ID]: { origin: LOG_E_ORIGIN, pubkey_b64: b64(logEPub) },
    },
    rekor: {
      [REKOR_ID]: { origin: REKOR_ORIGIN, pubkey_b64: b64(rekorPub) },
    },
  }

  const baseTrust = {
    trust_material: trustMaterial,
    trusted_logs: [LOG_A_ID],
    threshold_m: 1,
    required_anchors: 2,
  }

  const emptyPlurality = {
    proof_count: 0,
    verified_count: 0,
    pending_count: 0,
    malformed_count: 0,
    unknown_types: [] as string[],
    independent_count: 0,
    plurality_met: false,
    single_anchor: false,
    equivocation_detected: false,
    anchored_at_range_ms: null as [number, number] | null,
  }

  // ── Case 1: legacy-single-log ─────────────────────────────────────
  writeCase('legacy-single-log', {
    name: 'legacy-single-log',
    spec_section: '2.11',
    description:
      'A proof bundle with one legacy log_proofs element (no anchor_type). MUST parse as anchor_type "atrib-log" byte-for-byte unchanged. Verifies as independent_count 1, single_anchor true, plurality_met false, and the record stays VALID: single-anchor is a tier, never a failure.',
    input: {
      record,
      bundle: { record_hash: recordHash, log_proofs: [elementA] },
      trust: baseTrust,
    },
    expected: {
      resolved_anchor_types: ['atrib-log'],
      record_signature_ok: true,
      atrib_log_proof_verifies: true,
      anchor_plurality: {
        ...emptyPlurality,
        proof_count: 1,
        verified_count: 1,
        independent_count: 1,
        single_anchor: true,
      },
      hard_reject: false,
    },
  })

  // ── Case 2: discriminator-malformed-elements ──────────────────────
  writeCase('discriminator-malformed-elements', {
    name: 'discriminator-malformed-elements',
    spec_section: '2.11',
    description:
      'Discriminator rules: an element with a registered non-atrib-log anchor_type but no proof object is malformed (rule b); an element without anchor_type missing the legacy triple is malformed (rule a). Malformed elements are not counted; the record itself is never invalidated by them.',
    input: {
      record,
      bundle: {
        record_hash: recordHash,
        log_proofs: [
          elementA,
          { anchor_type: 'rfc3161-tsa', anchor_id: TSA_ID }, // rule (b): proof REQUIRED
          { proof: { note_b64: b64utf8('orphan proof object') } }, // rule (a): triple REQUIRED
        ],
      },
      trust: baseTrust,
    },
    expected: {
      malformed_indices: [1, 2],
      anchor_plurality: {
        ...emptyPlurality,
        proof_count: 3,
        verified_count: 1,
        malformed_count: 2,
        independent_count: 1,
        single_anchor: true,
      },
      record_signature_ok: true,
      hard_reject: false,
    },
  })

  // ── Case 3: unknown-anchor-type ───────────────────────────────────
  writeCase('unknown-anchor-type', {
    name: 'unknown-anchor-type',
    spec_section: '2.11',
    description:
      'Forward compatibility: an unknown anchor_type MUST be surfaced in unknown_types, MUST NOT count toward plurality, and MUST NOT invalidate the bundle or the record (same rule as unknown event types).',
    input: {
      record,
      bundle: {
        record_hash: recordHash,
        log_proofs: [
          elementA,
          {
            anchor_type: 'example-quantum-beacon/v9',
            anchor_id: 'beacon.conformance.atrib.test',
            proof: { attestation_b64: b64utf8('opaque future attestation') },
          },
        ],
      },
      trust: baseTrust,
    },
    expected: {
      anchor_plurality: {
        ...emptyPlurality,
        proof_count: 2,
        verified_count: 1,
        unknown_types: ['example-quantum-beacon/v9'],
        independent_count: 1,
        single_anchor: true,
      },
      record_signature_ok: true,
      hard_reject: false,
    },
  })

  // ── Case 4: plurality-atrib-log-plus-rfc3161 ──────────────────────
  writeCase('plurality-atrib-log-plus-rfc3161', {
    name: 'plurality-atrib-log-plus-rfc3161',
    spec_section: '2.11',
    description:
      'Anchor plurality met with one atrib-log proof plus one rfc3161-tsa element whose hashed_message binds the bundle record_hash. independent_count 2, plurality_met true, single_anchor false. The TSA payload interior is structural in this corpus revision; the binding field is the real record hash.',
    input: {
      record,
      bundle: { record_hash: recordHash, log_proofs: [elementA, tsaElement] },
      trust: baseTrust,
    },
    expected: {
      anchor_plurality: {
        ...emptyPlurality,
        proof_count: 2,
        verified_count: 2,
        independent_count: 2,
        plurality_met: true,
        anchored_at_range_ms: [tsaGenTimeMs, tsaGenTimeMs],
      },
      record_signature_ok: true,
      hard_reject: false,
    },
  })

  // Per-type negative bindings are intentionally independent of the
  // plurality threshold. A malformed commitment excludes only that anchor.
  writeCase('rfc3161-binding-mismatch', {
    name: 'rfc3161-binding-mismatch',
    spec_section: '2.11',
    description:
      'An RFC 3161 structural proof whose hashed_message_hex binds a different record. The valid atrib-log proof remains usable; the TSA proof is invalid and never counted.',
    input: {
      record,
      bundle: {
        record_hash: recordHash,
        log_proofs: [
          elementA,
          { ...tsaElement, proof: { ...tsaElement.proof, hashed_message_hex: filler1Hash.slice(7) } },
        ],
      },
      trust: baseTrust,
    },
    expected: { invalid_indices: [1], hard_reject: false },
  })

  writeCase('opentimestamps-binding-mismatch', {
    name: 'opentimestamps-binding-mismatch',
    spec_section: '2.11',
    description:
      'An OpenTimestamps completion with a commitment_hex for a different record. It is invalid rather than pending, and it contributes no plurality evidence.',
    input: {
      record,
      bundle: {
        record_hash: recordHash,
        log_proofs: [
          elementA,
          { ...otsCompleteElement, proof: { ...otsCompleteElement.proof, commitment_hex: filler1Hash.slice(7) } },
        ],
      },
      trust: baseTrust,
    },
    expected: { invalid_indices: [1], hard_reject: false },
  })

  writeCase('malformed-unknown-precedence', {
    name: 'malformed-unknown-precedence',
    spec_section: '2.11',
    description:
      'A non-atrib anchor with an unknown discriminator but no anchor_id is malformed. Rule (b) malformation takes precedence over unknown-type preservation.',
    input: {
      record,
      bundle: {
        record_hash: recordHash,
        log_proofs: [elementA, { anchor_type: 'example-quantum-beacon/v9', proof: {} }],
      },
      trust: baseTrust,
    },
    expected: { malformed_indices: [1], unknown_types: [], hard_reject: false },
  })

  // ── Case 5: rekor-anchor-claim ────────────────────────────────────
  writeCase('rekor-anchor-claim', {
    name: 'rekor-anchor-claim',
    spec_section: '2.11',
    description:
      'The anchoring-signature claim artifact: a sigstore-rekor element whose entry body carries a FRESH Ed25519 signature over the reconstructible claim bytes "atrib-anchor/v1:" + record_hash. The anchoring key differs from creator_key. Inclusion proof, checkpoint signature, and signed entry timestamp all verify. Plurality met with the atrib-log proof.',
    input: {
      record,
      bundle: { record_hash: recordHash, log_proofs: [elementA, rekorValid.element] },
      trust: baseTrust,
      anchoring_seed_hex: hex(ANCHORING_SEED),
    },
    expected: {
      anchor_claim_artifact_utf8: rekorValid.artifact,
      anchor_claim_prefix: ANCHOR_CLAIM_PREFIX,
      artifact_reconstructs_from_record_hash: true,
      anchoring_signature_verifies: true,
      anchoring_key_b64url: base64urlEncode(anchoringPub),
      anchoring_key_differs_from_creator_key: true,
      set_signing_input_utf8: rekorValid.setInput,
      rekor_inclusion_proof_verifies: true,
      rekor_checkpoint_signature_verifies: true,
      signed_entry_timestamp_verifies: true,
      anchor_plurality: {
        ...emptyPlurality,
        proof_count: 2,
        verified_count: 2,
        independent_count: 2,
        plurality_met: true,
        anchored_at_range_ms: [
          rekorValid.element.proof.integrated_time_ms,
          rekorValid.element.proof.integrated_time_ms,
        ],
      },
      record_signature_ok: true,
      hard_reject: false,
    },
  })

  // ── Case 6: rekor-claim-binding-mismatch ──────────────────────────
  writeCase('rekor-claim-binding-mismatch', {
    name: 'rekor-claim-binding-mismatch',
    spec_section: '2.11',
    description:
      "Adversarial: a rekor element whose claim artifact is a genuinely-signed anchor claim for a DIFFERENT record hash. The embedded signature verifies over its own artifact, but the artifact does not reconstruct from the bundle's record_hash, so the element is an invalid proof: not counted, not equivocation, and the record itself stays valid on the remaining anchor.",
    input: {
      record,
      bundle: { record_hash: recordHash, log_proofs: [elementA, rekorMismatch.element] },
      trust: baseTrust,
      mismatched_artifact_utf8: rekorMismatch.artifact,
    },
    expected: {
      invalid_indices: [1],
      invalid_reason: 'anchor_claim_binding_mismatch',
      artifact_reconstructs_from_record_hash: false,
      embedded_signature_verifies_over_its_own_artifact: true,
      anchor_plurality: {
        ...emptyPlurality,
        proof_count: 2,
        verified_count: 1,
        independent_count: 1,
        single_anchor: true,
      },
      record_signature_ok: true,
      hard_reject: false,
    },
  })

  // ── Case 7: record-signature-digest-path-invalid ──────────────────
  writeCase('record-signature-digest-path-invalid', {
    name: 'record-signature-digest-path-invalid',
    spec_section: '2.11',
    description:
      "Why the record's own signature MUST NOT be reused as the anchoring signature (the Rekor hashedrekord digest path): record_hash is computed over the COMPLETE record INCLUDING the signature field (§1.2.3), while the signature verifies over the signature-less canonical form (§1.4.2). The two byte strings differ, so an upload-time check that the signature verifies over the artifact behind record_hash fails by construction; and Pure EdDSA (RFC 8032 §5.1.6) cannot be verified from a digest alone. Anchors therefore carry a FRESH anchoring signature over the reconstructible claim artifact.",
    input: { record, creator_key_b64url: creatorKey },
    expected: {
      record_hash: recordHash,
      signature_verifies_over_signing_input: true,
      signature_verifies_over_full_canonical_record: false,
      signing_input_differs_from_hashed_bytes: true,
    },
  })

  // ── Case 8: ots-pending-then-upgraded ─────────────────────────────
  writeCase('ots-pending-then-upgraded', {
    name: 'ots-pending-then-upgraded',
    spec_section: '2.11',
    description:
      'An opentimestamps proof with status "pending" is carried in the bundle, counted in pending_count, and excluded from plurality. The same bundle after in-place upgrade (status "complete" with attested_time_ms) meets plurality. Proof bundle caching stays keyed by record_hash per §5.3.5, which is what makes in-place upgrade safe.',
    input: {
      record,
      bundle_pending: { record_hash: recordHash, log_proofs: [elementA, otsPendingElement] },
      bundle_upgraded: { record_hash: recordHash, log_proofs: [elementA, otsCompleteElement] },
      trust: baseTrust,
    },
    expected: {
      pending: {
        anchor_plurality: {
          ...emptyPlurality,
          proof_count: 2,
          verified_count: 1,
          pending_count: 1,
          independent_count: 1,
          single_anchor: true,
        },
        hard_reject: false,
      },
      upgraded: {
        anchor_plurality: {
          ...emptyPlurality,
          proof_count: 2,
          verified_count: 2,
          independent_count: 2,
          plurality_met: true,
          anchored_at_range_ms: [otsAttestedTimeMs, otsAttestedTimeMs],
        },
        hard_reject: false,
      },
      record_signature_ok: true,
    },
  })

  // ── Case 9: same-operator-group ───────────────────────────────────
  writeCase('same-operator-group', {
    name: 'same-operator-group',
    spec_section: '2.11',
    description:
      'Independence is counted over operator groups, not elements. Two atrib-log proofs from logs declared to share an operator group collapse to independent_count 1 (single_anchor true); the default grouping (one group per distinct (anchor_type, anchor_id) pair) counts them as 2.',
    input: {
      record,
      bundle: { record_hash: recordHash, log_proofs: [elementA, elementB] },
      trust_default_grouping: { ...baseTrust, trusted_logs: [LOG_A_ID, LOG_B_ID] },
      trust_declared_group: {
        ...baseTrust,
        trusted_logs: [LOG_A_ID, LOG_B_ID],
        operator_groups: [
          {
            group: 'conformance-operator',
            members: [
              { anchor_type: 'atrib-log', anchor_id: LOG_A_ID },
              { anchor_type: 'atrib-log', anchor_id: LOG_B_ID },
            ],
          },
        ],
      },
    },
    expected: {
      default_grouping: {
        anchor_plurality: {
          ...emptyPlurality,
          proof_count: 2,
          verified_count: 2,
          independent_count: 2,
          plurality_met: true,
        },
      },
      declared_group: {
        anchor_plurality: {
          ...emptyPlurality,
          proof_count: 2,
          verified_count: 2,
          independent_count: 1,
          single_anchor: true,
        },
      },
      record_signature_ok: true,
      hard_reject: false,
    },
  })

  // ── Case 10: threshold-not-met ────────────────────────────────────
  writeCase('threshold-not-met', {
    name: 'threshold-not-met',
    spec_section: '2.11',
    description:
      'Hard rejection unchanged from §2.11.4: consumer-configured threshold M=2 with a trusted set of one log. Both proofs verify cryptographically, but only one is in the trusted set (V=1 < M=2), so cross_log_threshold_not_met fires. Untrusted-set proofs are surfaced, not counted toward M. Note plurality_met can be true while the threshold rejects: tiering and threshold are orthogonal.',
    input: {
      record,
      bundle: { record_hash: recordHash, log_proofs: [elementA, elementB] },
      trust: { ...baseTrust, trusted_logs: [LOG_A_ID], threshold_m: 2 },
    },
    expected: {
      trusted_verified_count: 1,
      cross_log_threshold_not_met: true,
      untrusted_surfaced: [LOG_B_ID],
      anchor_plurality: {
        ...emptyPlurality,
        proof_count: 2,
        verified_count: 2,
        independent_count: 2,
        plurality_met: true,
      },
      hard_reject: true,
    },
  })

  // ── Case 11: equivocation-detected ────────────────────────────────
  writeCase('equivocation-detected', {
    name: 'equivocation-detected',
    spec_section: '2.11',
    description:
      'Hard rejection unchanged from §2.11.4 step 4: two trusted atrib-log proofs for the same record_hash whose committed leaf bytes differ (the equivocating log altered timestamp_ms). Both inclusion proofs verify against their own checkpoints; the pairwise leaf-byte comparison detects the fork. The disagreeing pair is surfaced with both leaf hashes.',
    input: {
      record,
      bundle: { record_hash: recordHash, log_proofs: [elementA, elementEReal] },
      trust: { ...baseTrust, trusted_logs: [LOG_A_ID, LOG_E_ID] },
    },
    expected: {
      cross_log_equivocation_detected: true,
      disagreeing_pair: {
        log_id_a: LOG_A_ID,
        leaf_hash_a_hex: hex(leafHash(entryA)),
        log_id_b: LOG_E_ID,
        leaf_hash_b_hex: hex(leafHash(entryE)),
      },
      anchor_plurality: {
        ...emptyPlurality,
        proof_count: 2,
        verified_count: 2,
        independent_count: 2,
        plurality_met: true,
        equivocation_detected: true,
      },
      hard_reject: true,
    },
  })

  // ── Case 12: censorship-suspected ─────────────────────────────────
  writeCase('censorship-suspected', {
    name: 'censorship-suspected',
    spec_section: '2.11',
    description:
      'Censorship-shaped equivocation per §2.11.4: one trusted log returns a valid proof while another trusted log returns "record not found" within the bundle epoch window. MUST be flagged as cross_log_censorship_suspected with the silent log identified. Flag, not tier: the annotation still reports the verified anchors.',
    input: {
      record,
      bundle: { record_hash: recordHash, log_proofs: [elementA] },
      not_found_responses: [
        {
          log_id: LOG_B_ID,
          status: 'not_found',
          epoch_window_ms: [REFERENCE_TIME_MS, REFERENCE_TIME_MS + 86_400_000],
        },
      ],
      trust: { ...baseTrust, trusted_logs: [LOG_A_ID, LOG_B_ID] },
    },
    expected: {
      cross_log_censorship_suspected: true,
      silent_log: LOG_B_ID,
      anchor_plurality: {
        ...emptyPlurality,
        proof_count: 1,
        verified_count: 1,
        independent_count: 1,
        single_anchor: true,
      },
      record_signature_ok: true,
    },
  })

  // ── Case 13: allow-single-anchor-config ───────────────────────────
  writeCase('allow-single-anchor-config', {
    name: 'allow-single-anchor-config',
    spec_section: '2.11',
    description:
      'Producer-side posture: zero-config resolves to the built-in two-anchor default set; explicit >= 2 configs are used as given; one anchor with allow_single_anchor true is deliberate (no warning); one anchor without the flag warns with an atrib: prefix and writes a sidecar degradation marker. Never a throw on the primary path, never disables signing (§5.8).',
    input: {
      configs: [
        { name: 'zero-config', config: {} },
        {
          name: 'two-explicit',
          config: {
            anchors: [
              { anchor_type: 'atrib-log', url: 'https://log.atrib.dev/v1' },
              { anchor_type: 'opentimestamps', calendars: ['https://a.pool.opentimestamps.org'] },
            ],
          },
        },
        {
          name: 'single-with-flag',
          config: {
            anchors: [{ anchor_type: 'atrib-log', url: 'https://log.atrib.dev/v1' }],
            allow_single_anchor: true,
          },
        },
        {
          name: 'single-no-flag',
          config: { anchors: [{ anchor_type: 'atrib-log', url: 'https://log.atrib.dev/v1' }] },
        },
        { name: 'empty-no-flag', config: { anchors: [] } },
      ],
    },
    expected: {
      resolutions: [
        {
          name: 'zero-config',
          effective_anchor_count: 2,
          used_default_set: true,
          warn: false,
          sidecar_anchor_config: null,
        },
        {
          name: 'two-explicit',
          effective_anchor_count: 2,
          used_default_set: false,
          warn: false,
          sidecar_anchor_config: null,
        },
        {
          name: 'single-with-flag',
          effective_anchor_count: 1,
          used_default_set: false,
          warn: false,
          sidecar_anchor_config: null,
        },
        {
          name: 'single-no-flag',
          effective_anchor_count: 1,
          used_default_set: false,
          warn: true,
          sidecar_anchor_config: { configured: 1, allow_single_anchor: false },
        },
        {
          name: 'empty-no-flag',
          effective_anchor_count: 0,
          used_default_set: false,
          warn: true,
          sidecar_anchor_config: { configured: 0, allow_single_anchor: false },
        },
      ],
      never_throws_on_primary_path: true,
      never_disables_signing: true,
    },
  })

  // ── Manifest ──────────────────────────────────────────────────────
  const caseNames = [
    'legacy-single-log',
    'discriminator-malformed-elements',
    'unknown-anchor-type',
    'plurality-atrib-log-plus-rfc3161',
    'rfc3161-binding-mismatch',
    'opentimestamps-binding-mismatch',
    'malformed-unknown-precedence',
    'rekor-anchor-claim',
    'rekor-claim-binding-mismatch',
    'record-signature-digest-path-invalid',
    'ots-pending-then-upgraded',
    'same-operator-group',
    'threshold-not-met',
    'equivocation-detected',
    'censorship-suspected',
    'allow-single-anchor-config',
  ]

  const manifest = {
    spec_section: '2.11',
    spec_title: 'Cross-log replication: anchor interface and anchor plurality',
    decision_link: 'P043 (anchor plurality ADR; extends D050)',
    generated_at: REFERENCE_TIME_MS,
    generator: 'packages/log-dev/scripts/generate-conformance-anchors.ts',
    anchor_claim_prefix: ANCHOR_CLAIM_PREFIX,
    cases: caseNames.map((name) => ({ file: `cases/${name}.json`, name })),
    keys: {
      creator_pubkey: creatorKey,
      anchoring_pubkey: base64urlEncode(anchoringPub),
      log_a_pubkey_b64: b64(logAPub),
      log_b_pubkey_b64: b64(logBPub),
      log_e_pubkey_b64: b64(logEPub),
      rekor_pubkey_b64: b64(rekorPub),
    },
    note: 'The cases exercise legacy absent-discriminator compatibility, discriminator malformation and unknown-type precedence, structural rfc3161/opentimestamps bindings with per-type negative vectors, fresh Rekor anchoring claims, operator-group independence, §2.11.4 threshold/equivocation/censorship conditions, and the producer-side allow_single_anchor posture. Verifier determinism is asserted by the reference test over every case.',
  }

  writeFileSync(join(CORPUS_ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')

  console.log(`generated ${manifest.cases.length} cases at ${CORPUS_ROOT}`)
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
