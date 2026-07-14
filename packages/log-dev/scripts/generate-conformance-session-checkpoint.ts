/**
 * Generate the session_checkpoint conformance corpus fixtures (P044 ADR,
 * spec §1.2.10).
 *
 * Run with: pnpm --filter @atrib/log-dev exec tsx scripts/generate-conformance-session-checkpoint.ts
 *
 * Output: spec/conformance/session-checkpoint/cases/*.json + manifest.json
 *
 * §1.2.10 introduces the OPTIONAL `checkpoint` field, REQUIRED on records
 * with event_type https://atrib.dev/v1/types/session_checkpoint and
 * REJECTED on every other event_type (the §1.2.7 / §1.2.9 pattern). A
 * session checkpoint commits to the RFC 6962 Merkle root over the ordered
 * record_hash leaves of its context_id, reusing the §2.3.2 leaf/node hash
 * rule verbatim (leaf preimages here are raw 32-byte record hashes, not the
 * log's 90-byte entries, so cross-tree confusion is structurally
 * impossible).
 *
 * Case families:
 *   1. schema-*        checkpoint object schema: presence rules for
 *                      session_root / tree_size / first_index /
 *                      prior_checkpoint / retroactive; required on
 *                      session_checkpoint, rejected elsewhere.
 *   2. tree-*          REAL RFC 6962 roots over ordered record-hash leaves
 *                      (1, 2, 5 leaves; empty tree invalid; hex-string trap).
 *   3. consistency-*   append-only extension between consecutive
 *                      checkpoints (valid extension with an RFC 6962
 *                      §2.1.4 consistency proof + an equivocating
 *                      divergent-root pair).
 *   4. retroactive-* / freshness-*  present-only-when-true flag
 *                      (absence-not-null) + categorical freshness facts.
 *   5. byte-uri-duality  identical signed bytes under the 0xFF
 *                      (pre-promotion extension) and 0x08 (post-promotion)
 *                      log-entry encodings.
 *
 * Seeds and timestamps are hardcoded so successive regenerations produce
 * byte-identical files. Re-run when:
 *   - the §1.2.10 checkpoint object schema changes
 *   - the canonical record format (§1.2 / §1.3) changes
 *   - new test cases are needed
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import {
  base64urlEncode,
  canonicalRecord,
  canonicalSigningInput,
  chainRoot,
  computeContentId,
  genesisChainRoot,
  getPublicKey,
  hexDecode,
  hexEncode,
  serializeEntry,
  signRecord,
  type AtribRecord,
} from '@atrib/mcp'
import { sha256 } from '@noble/hashes/sha2.js'

// ---------------------------------------------------------------------------
// Checkpoint types (local to the corpus; the field is not yet in @atrib/mcp)
// ---------------------------------------------------------------------------

interface SessionCheckpoint {
  first_index: number
  prior_checkpoint?: string
  retroactive?: boolean
  session_root: string
  tree_size: number
}

type SessionCheckpointRecord = AtribRecord & { checkpoint?: SessionCheckpoint }

const SESSION_CHECKPOINT_URI = 'https://atrib.dev/v1/types/session_checkpoint'
const OBSERVATION_URI = 'https://atrib.dev/v1/types/observation'

// Pre-promotion the URI is encoded under the extension byte (D073 pattern);
// the promotion ADR allocates 0x08. Signed bytes are identical either way.
const PROMOTED_BYTE = 0x08
const EXTENSION_BYTE = 0xff

// ---------------------------------------------------------------------------
// Fixed inputs (deterministic regeneration)
// ---------------------------------------------------------------------------

// 0x01..0x20 sequential seed pattern.
const AGENT_SEED = Uint8Array.from({ length: 32 }, (_, i) => i + 1)
const REFERENCE_TIME_MS = Date.UTC(2026, 6, 1, 0, 0, 0) // 2026-07-01T00:00:00Z
const MAIN_CONTEXT = 'ab'.repeat(16)
const SINGLE_LEAF_CONTEXT = 'cd'.repeat(16)
const RETRO_CONTEXT = 'f1'.repeat(16)
const STALE_CONTEXT = 'f2'.repeat(16)
const ABSENCE_CONTEXT = 'f3'.repeat(16)
const REJECT_CONTEXTS = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'].map((p) => p.repeat(16))

// §1.2.2 derivation with the pseudo-origin "atrib" for origin-less
// cognitive producers, mirroring directory-node's "<origin>:directory_anchor".
const CONTENT_ID_INPUT = 'atrib:session_checkpoint'

const HERE = dirname(fileURLToPath(import.meta.url))
const CORPUS_ROOT = resolve(HERE, '../../../spec/conformance/session-checkpoint')
const CASES_DIR = join(CORPUS_ROOT, 'cases')

mkdirSync(CASES_DIR, { recursive: true })

const utf8 = new TextEncoder()

// ---------------------------------------------------------------------------
// RFC 6962 §2.1 Merkle tree over raw 32-byte record-hash leaves (§2.3.2 rule)
// ---------------------------------------------------------------------------

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

function leafHash(leaf: Uint8Array): Uint8Array {
  return sha256(concatBytes(Uint8Array.of(0x00), leaf))
}

function nodeHash(left: Uint8Array, right: Uint8Array): Uint8Array {
  return sha256(concatBytes(Uint8Array.of(0x01), left, right))
}

function largestPowerOfTwoLessThan(n: number): number {
  let k = 1
  while (k * 2 < n) k *= 2
  return k
}

/** RFC 6962 §2.1 Merkle Tree Hash. MTH of the empty list is SHA-256(""). */
function merkleTreeHash(leaves: Uint8Array[]): Uint8Array {
  if (leaves.length === 0) return sha256(new Uint8Array(0))
  if (leaves.length === 1) return leafHash(leaves[0]!)
  const k = largestPowerOfTwoLessThan(leaves.length)
  return nodeHash(merkleTreeHash(leaves.slice(0, k)), merkleTreeHash(leaves.slice(k)))
}

/** RFC 6962 §2.1.2 consistency proof PROOF(m, D[n]) = SUBPROOF(m, D[n], true). */
function consistencyProof(m: number, leaves: Uint8Array[]): Uint8Array[] {
  return subproof(m, leaves, true)
}

function subproof(m: number, d: Uint8Array[], b: boolean): Uint8Array[] {
  const n = d.length
  if (m === n) return b ? [] : [merkleTreeHash(d)]
  const k = largestPowerOfTwoLessThan(n)
  if (m <= k) return [...subproof(m, d.slice(0, k), b), merkleTreeHash(d.slice(k))]
  return [...subproof(m - k, d.slice(k), false), merkleTreeHash(d.slice(0, k))]
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** RFC 6962 §2.1.4.2 consistency proof verification (generator self-check). */
function verifyConsistency(
  m: number,
  n: number,
  firstRoot: Uint8Array,
  secondRoot: Uint8Array,
  proof: Uint8Array[],
): boolean {
  if (m === n) return proof.length === 0 && bytesEqual(firstRoot, secondRoot)
  if (m < 1 || m > n) return false
  let c = proof.slice()
  if ((m & (m - 1)) === 0) c = [firstRoot, ...c]
  if (c.length === 0) return false
  let fn = m - 1
  let sn = n - 1
  while ((fn & 1) === 1) {
    fn >>= 1
    sn >>= 1
  }
  let fr = c[0]!
  let sr = c[0]!
  for (let i = 1; i < c.length; i++) {
    if (sn === 0) return false
    if ((fn & 1) === 1 || fn === sn) {
      fr = nodeHash(c[i]!, fr)
      sr = nodeHash(c[i]!, sr)
      if ((fn & 1) === 0) {
        while (fn !== 0 && (fn & 1) === 0) {
          fn >>= 1
          sn >>= 1
        }
      }
    } else {
      sr = nodeHash(sr, c[i]!)
    }
    fn >>= 1
    sn >>= 1
  }
  return bytesEqual(fr, firstRoot) && bytesEqual(sr, secondRoot) && sn === 0
}

// ---------------------------------------------------------------------------
// Record helpers
// ---------------------------------------------------------------------------

function hex(bytes: Uint8Array): string {
  return hexEncode(bytes)
}

function recordHashHex(record: AtribRecord): string {
  return hex(sha256(canonicalRecord(record)))
}

function prefixedRecordHash(record: AtribRecord): string {
  return `sha256:${recordHashHex(record)}`
}

/** Decode a `"sha256:" + 64 hex` leaf reference to its raw 32 bytes. */
function leafBytesFromRef(ref: string): Uint8Array {
  return hexDecode(ref.slice('sha256:'.length))
}

function sessionRootHex(leafRefs: string[]): string {
  return hex(merkleTreeHash(leafRefs.map(leafBytesFromRef)))
}

/**
 * JCS of `{"leaves": [...]}` for the D099 args_hash commitment. For this
 * shape (single ASCII key, array of ASCII strings) plain JSON.stringify IS
 * the RFC 8785 canonical form; the reference test re-derives it with the
 * `canonicalize` package to pin the equality.
 */
function leavesArgsHash(leafRefs: string[]): string {
  const jcs = JSON.stringify({ leaves: leafRefs })
  return `sha256:${hex(sha256(utf8.encode(jcs)))}`
}

const sessionCheckpointContentId = `sha256:${hex(sha256(utf8.encode(CONTENT_ID_INPUT)))}`

interface CheckpointParams {
  contextId: string
  chainRoot: string
  timestamp: number
  leafRefs: string[]
  firstIndex: number
  priorCheckpoint?: string
  retroactive?: boolean
  /** Override checkpoint payload entirely (schema-violation vectors). */
  checkpointOverride?: SessionCheckpoint
  /** Omit the checkpoint object entirely (missing-field vector). */
  omitCheckpoint?: boolean
  eventType?: string
}

async function signCheckpoint(p: CheckpointParams): Promise<SessionCheckpointRecord> {
  const checkpoint: SessionCheckpoint | undefined = p.omitCheckpoint
    ? undefined
    : (p.checkpointOverride ?? {
        first_index: p.firstIndex,
        ...(p.priorCheckpoint !== undefined ? { prior_checkpoint: p.priorCheckpoint } : {}),
        ...(p.retroactive !== undefined ? { retroactive: p.retroactive } : {}),
        session_root: `sha256:${sessionRootHex(p.leafRefs)}`,
        tree_size: p.leafRefs.length,
      })
  const unsigned: SessionCheckpointRecord = {
    spec_version: 'atrib/1.0',
    content_id: sessionCheckpointContentId,
    creator_key: agentKey,
    chain_root: p.chainRoot,
    ...(checkpoint !== undefined ? { checkpoint } : {}),
    event_type: p.eventType ?? SESSION_CHECKPOINT_URI,
    context_id: p.contextId,
    timestamp: p.timestamp,
    args_hash: leavesArgsHash(p.leafRefs),
    signature: '',
  }
  return (await signRecord(unsigned, AGENT_SEED)) as SessionCheckpointRecord
}

async function signObservation(
  contextId: string,
  chainRootValue: string,
  timestamp: number,
  toolName: string,
): Promise<AtribRecord> {
  const unsigned: AtribRecord = {
    spec_version: 'atrib/1.0',
    content_id: computeContentId('https://tools.example.test', toolName),
    creator_key: agentKey,
    chain_root: chainRootValue,
    event_type: OBSERVATION_URI,
    context_id: contextId,
    timestamp,
    signature: '',
  }
  return signRecord(unsigned, AGENT_SEED)
}

function writeCase(name: string, body: Record<string, unknown>): void {
  writeFileSync(join(CASES_DIR, `${name}.json`), JSON.stringify(body, null, 2) + '\n')
}

// agentKey is resolved in main() before any signing helper runs.
let agentKey = ''

// ---------------------------------------------------------------------------
// Corpus generation
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  agentKey = base64urlEncode(await getPublicKey(AGENT_SEED))

  // ── The main session stream on MAIN_CONTEXT ──────────────────────────
  // r1 → r2 → K1(covers r1,r2) → r3 → r4 → K2(covers r1,r2,K1,r3,r4).
  // K1 excludes itself from its own tree (its hash depends on session_root)
  // and becomes leaf index 2 in K2's tree: checkpoints are part of the
  // stream they formalize.
  const r1 = await signObservation(
    MAIN_CONTEXT,
    genesisChainRoot(MAIN_CONTEXT),
    REFERENCE_TIME_MS + 1000,
    'leaf_1',
  )
  const r2 = await signObservation(MAIN_CONTEXT, chainRoot(r1), REFERENCE_TIME_MS + 2000, 'leaf_2')

  const k1Leaves = [prefixedRecordHash(r1), prefixedRecordHash(r2)]
  const k1 = await signCheckpoint({
    contextId: MAIN_CONTEXT,
    chainRoot: chainRoot(r2),
    timestamp: REFERENCE_TIME_MS + 10_000,
    leafRefs: k1Leaves,
    firstIndex: 0,
  })

  const r3 = await signObservation(MAIN_CONTEXT, chainRoot(k1), REFERENCE_TIME_MS + 20_000, 'leaf_3')
  const r4 = await signObservation(MAIN_CONTEXT, chainRoot(r3), REFERENCE_TIME_MS + 21_000, 'leaf_4')

  const k2Leaves = [...k1Leaves, prefixedRecordHash(k1), prefixedRecordHash(r3), prefixedRecordHash(r4)]
  const k2 = await signCheckpoint({
    contextId: MAIN_CONTEXT,
    chainRoot: chainRoot(r4),
    timestamp: REFERENCE_TIME_MS + 30_000,
    leafRefs: k2Leaves,
    firstIndex: 2,
    priorCheckpoint: prefixedRecordHash(k1),
  })

  // ── Case: schema-first-checkpoint ────────────────────────────────────
  // Valid first checkpoint: first_index 0, prior_checkpoint omitted (not
  // null), retroactive absent. Also pins the JCS slot: `checkpoint` sorts
  // after `chain_root` ("cha" < "che") and before `content_id` ("ch" < "co").
  const k1SigningInput = new TextDecoder().decode(canonicalSigningInput(k1))
  writeCase('schema-first-checkpoint', {
    name: 'schema-first-checkpoint',
    spec_section: '1.2.10',
    description:
      'A valid first session checkpoint: first_index 0, prior_checkpoint omitted (not null), retroactive absent, tree_size 2 with a real RFC 6962 root over the ordered record-hash leaves. Verifies (a) the JCS field-order invariant (checkpoint sorts between chain_root and content_id), (b) the signature round-trips with the field present, (c) validators and verifiers MUST accept, (d) the freshness fact is contemporaneous (checkpoint timestamp within the verifier bound of the max covered leaf timestamp).',
    input: {
      record: k1,
      leaves: k1Leaves,
      leaf_records: [r1, r2],
      max_covered_leaf_timestamp: r2.timestamp,
      signer_seed_hex: hex(AGENT_SEED),
      content_id_input: CONTENT_ID_INPUT,
    },
    expected: {
      canonical_signing_input_utf8: k1SigningInput,
      record_hash_hex: recordHashHex(k1),
      session_root: k1.checkpoint!.session_root,
      jcs_order: ['chain_root', 'checkpoint', 'content_id'],
      validator_should_accept: true,
      verifier_signature_ok: true,
      verifier_freshness_fact: 'contemporaneous',
    },
  })

  // ── Schema-violation vectors (signed anyway; rejection is policy) ────
  const rejectAt = (i: number): { contextId: string; chainRoot: string; timestamp: number } => ({
    contextId: REJECT_CONTEXTS[i]!,
    chainRoot: genesisChainRoot(REJECT_CONTEXTS[i]!),
    timestamp: REFERENCE_TIME_MS + 50_000 + i * 1000,
  })

  // session_checkpoint event_type without the checkpoint object.
  const missing = await signCheckpoint({
    ...rejectAt(0),
    leafRefs: k1Leaves,
    firstIndex: 0,
    omitCheckpoint: true,
  })
  writeCase('schema-missing-checkpoint-rejected', {
    name: 'schema-missing-checkpoint-rejected',
    spec_section: '1.2.10',
    description:
      'A record with event_type session_checkpoint but no checkpoint object. Per §1.2.10 the field is REQUIRED on this event_type (the §1.2.7 / §1.2.9 pattern). Signature is valid; both validators (§2.6.1) and verifiers MUST reject at the policy layer.',
    input: { record: missing, signer_seed_hex: hex(AGENT_SEED) },
    expected: {
      record_hash_hex: recordHashHex(missing),
      validator_should_accept: false,
      verifier_signature_ok: true,
      rejection_reason: 'checkpoint missing on session_checkpoint record',
    },
  })

  // checkpoint object on a non-session_checkpoint event_type.
  const wrongType = await signCheckpoint({
    ...rejectAt(1),
    leafRefs: k1Leaves,
    firstIndex: 0,
    eventType: OBSERVATION_URI,
  })
  writeCase('schema-checkpoint-on-wrong-event-type-rejected', {
    name: 'schema-checkpoint-on-wrong-event-type-rejected',
    spec_section: '1.2.10',
    description:
      'An observation record carrying a checkpoint object. Per §1.2.10 the field MUST be rejected on any event_type other than session_checkpoint (the §1.2.7 / §1.2.9 pattern). Signature is valid; rejection is at the policy layer.',
    input: { record: wrongType, signer_seed_hex: hex(AGENT_SEED) },
    expected: {
      record_hash_hex: recordHashHex(wrongType),
      validator_should_accept: false,
      verifier_signature_ok: true,
      rejection_reason: 'checkpoint on non-session_checkpoint event_type',
    },
  })

  // first_index out of range (first_index == tree_size).
  const badBounds = await signCheckpoint({
    ...rejectAt(2),
    leafRefs: k1Leaves,
    firstIndex: 0,
    checkpointOverride: {
      first_index: 2,
      prior_checkpoint: prefixedRecordHash(k1),
      session_root: `sha256:${sessionRootHex(k1Leaves)}`,
      tree_size: 2,
    },
  })
  writeCase('schema-first-index-bounds-rejected', {
    name: 'schema-first-index-bounds-rejected',
    spec_section: '1.2.10',
    description:
      'A checkpoint with first_index == tree_size. Per §1.2.10, 0 <= first_index < tree_size MUST hold: the interval [first_index, tree_size-1] must be non-empty. Signature is valid; rejection is at the policy layer.',
    input: { record: badBounds, signer_seed_hex: hex(AGENT_SEED) },
    expected: {
      record_hash_hex: recordHashHex(badBounds),
      validator_should_accept: false,
      verifier_signature_ok: true,
      rejection_reason: 'first_index >= tree_size',
    },
  })

  // prior_checkpoint present while first_index == 0.
  const priorAtZero = await signCheckpoint({
    ...rejectAt(3),
    leafRefs: k1Leaves,
    firstIndex: 0,
    priorCheckpoint: prefixedRecordHash(k1),
  })
  writeCase('schema-prior-present-at-first-index-zero-rejected', {
    name: 'schema-prior-present-at-first-index-zero-rejected',
    spec_section: '1.2.10',
    description:
      'A checkpoint with prior_checkpoint present and first_index 0. Per §1.2.10, prior_checkpoint MUST be present iff first_index > 0: a first checkpoint has no predecessor to reference. Signature is valid; rejection is at the policy layer.',
    input: { record: priorAtZero, signer_seed_hex: hex(AGENT_SEED) },
    expected: {
      record_hash_hex: recordHashHex(priorAtZero),
      validator_should_accept: false,
      verifier_signature_ok: true,
      rejection_reason: 'prior_checkpoint present with first_index == 0',
    },
  })

  // prior_checkpoint absent while first_index > 0.
  const priorMissing = await signCheckpoint({
    ...rejectAt(4),
    leafRefs: k2Leaves,
    firstIndex: 2,
  })
  writeCase('schema-prior-absent-at-positive-first-index-rejected', {
    name: 'schema-prior-absent-at-positive-first-index-rejected',
    spec_section: '1.2.10',
    description:
      'A checkpoint with first_index > 0 and no prior_checkpoint. Per §1.2.10, prior_checkpoint MUST be present iff first_index > 0: a non-first interval must reference the checkpoint that committed the prefix. Signature is valid; rejection is at the policy layer.',
    input: { record: priorMissing, signer_seed_hex: hex(AGENT_SEED) },
    expected: {
      record_hash_hex: recordHashHex(priorMissing),
      validator_should_accept: false,
      verifier_signature_ok: true,
      rejection_reason: 'prior_checkpoint absent with first_index > 0',
    },
  })

  // ── Tree-construction vectors (REAL RFC 6962 roots) ──────────────────
  // 1 leaf, on its own context: root == SHA-256(0x00 || leaf_bytes).
  const s1 = await signObservation(
    SINGLE_LEAF_CONTEXT,
    genesisChainRoot(SINGLE_LEAF_CONTEXT),
    REFERENCE_TIME_MS + 1000,
    'single_leaf',
  )
  const singleLeaves = [prefixedRecordHash(s1)]
  const kSingle = await signCheckpoint({
    contextId: SINGLE_LEAF_CONTEXT,
    chainRoot: chainRoot(s1),
    timestamp: REFERENCE_TIME_MS + 5000,
    leafRefs: singleLeaves,
    firstIndex: 0,
  })
  writeCase('tree-1-leaf', {
    name: 'tree-1-leaf',
    spec_section: '1.2.10',
    description:
      'RFC 6962 root over a single record-hash leaf: session_root = sha256(0x00 || leaf_bytes) where leaf_bytes are the raw 32 bytes hex-decoded from the covered record hash (§2.3.2 leaf rule, 32-byte preimage). tree_size 1 is the minimum valid checkpoint.',
    input: {
      record: kSingle,
      leaves: singleLeaves,
      leaf_records: [s1],
      signer_seed_hex: hex(AGENT_SEED),
    },
    expected: {
      session_root_hex: sessionRootHex(singleLeaves),
      leaf_hash_equals_root: true,
      record_hash_hex: recordHashHex(kSingle),
      validator_should_accept: true,
      verifier_signature_ok: true,
    },
  })

  // 2 leaves + the raw-32-byte-leaf trap: a tree over the UTF-8 bytes of
  // the "sha256:<hex>" strings MUST NOT reproduce session_root.
  const hexStringTrapRoot = hex(
    merkleTreeHash(k1Leaves.map((ref) => utf8.encode(ref))),
  )
  writeCase('tree-2-leaves', {
    name: 'tree-2-leaves',
    spec_section: '1.2.10',
    description:
      'RFC 6962 root over two record-hash leaves: session_root = sha256(0x01 || leaf_hash_0 || leaf_hash_1) with leaf_hash_i = sha256(0x00 || leaf_bytes_i). Includes the raw-32-byte-leaf trap: a tree computed over the UTF-8 bytes of the prefixed hex strings MUST NOT match session_root; leaves are the raw hash bytes, not the display strings.',
    input: {
      record: k1,
      leaves: k1Leaves,
      signer_seed_hex: hex(AGENT_SEED),
    },
    expected: {
      session_root_hex: sessionRootHex(k1Leaves),
      hex_string_leaf_root_hex: hexStringTrapRoot,
      hex_string_leaf_root_must_not_match: true,
      validator_should_accept: true,
      verifier_signature_ok: true,
    },
  })

  // 5 leaves (odd, unbalanced RFC 6962 shape) is K2's tree.
  writeCase('tree-5-leaves', {
    name: 'tree-5-leaves',
    spec_section: '1.2.10',
    description:
      "RFC 6962 root over five record-hash leaves (odd, unbalanced tree: split at k=4, then 2+2 and 1). Leaf index 2 is the prior checkpoint K1's own record hash: a checkpoint MUST NOT include itself as a leaf (its hash depends on session_root) and instead becomes a leaf in the next checkpoint's tree.",
    input: {
      record: k2,
      leaves: k2Leaves,
      prior_checkpoint_record: k1,
      signer_seed_hex: hex(AGENT_SEED),
    },
    expected: {
      session_root_hex: sessionRootHex(k2Leaves),
      prior_checkpoint_is_leaf_at_index: 2,
      record_hash_hex: recordHashHex(k2),
      validator_should_accept: true,
      verifier_signature_ok: true,
    },
  })

  // Empty tree: tree_size 0 rejected. The RFC 6962 empty-tree root
  // (sha256 of the empty string) is included so implementations that
  // compute it anyway can recognize the sentinel.
  const emptyRoot = hex(sha256(new Uint8Array(0)))
  const kEmpty = await signCheckpoint({
    ...rejectAt(5),
    leafRefs: [],
    firstIndex: 0,
    checkpointOverride: {
      first_index: 0,
      session_root: `sha256:${emptyRoot}`,
      tree_size: 0,
    },
  })
  writeCase('tree-empty-rejected', {
    name: 'tree-empty-rejected',
    spec_section: '1.2.10',
    description:
      'A checkpoint with tree_size 0 and the RFC 6962 empty-tree root (sha256 of the empty string). Per §1.2.10, tree_size MUST be >= 1: empty checkpoints are prohibited; producers skip intervals that added no leaves. Signature is valid; rejection is at the policy layer.',
    input: { record: kEmpty, signer_seed_hex: hex(AGENT_SEED) },
    expected: {
      rfc6962_empty_tree_root_hex: emptyRoot,
      record_hash_hex: recordHashHex(kEmpty),
      validator_should_accept: false,
      verifier_signature_ok: true,
      rejection_reason: 'tree_size < 1',
    },
  })

  // ── Consistency vectors ───────────────────────────────────────────────
  // Valid append-only extension K1 → K2 with the RFC 6962 §2.1.4
  // consistency proof from (K1.session_root, 2) to (K2.session_root, 5).
  const k1LeafBytes = k1Leaves.map(leafBytesFromRef)
  const k2LeafBytes = k2Leaves.map(leafBytesFromRef)
  const proof = consistencyProof(2, k2LeafBytes)
  if (!verifyConsistency(2, 5, merkleTreeHash(k1LeafBytes), merkleTreeHash(k2LeafBytes), proof)) {
    throw new Error('generator self-check failed: consistency proof does not verify')
  }
  writeCase('consistency-valid-extension', {
    name: 'consistency-valid-extension',
    spec_section: '1.2.10',
    description:
      "Consecutive checkpoints K1 (tree_size 2) and K2 (tree_size 5) on one context_id: K2.checkpoint.prior_checkpoint is K1's record hash, K2.first_index == K1.tree_size, and the leaf sequence 0..1 is identical, so the RFC 6962 §2.1.4 consistency proof from (K1.session_root, 2) to (K2.session_root, 5) verifies. This is the same append-only check the log's witness protocol applies between successive log checkpoints (§2.9).",
    input: {
      first_checkpoint: k1,
      second_checkpoint: k2,
      first_leaves: k1Leaves,
      second_leaves: k2Leaves,
      consistency_proof_hex: proof.map(hex),
      signer_seed_hex: hex(AGENT_SEED),
    },
    expected: {
      first_record_hash: prefixedRecordHash(k1),
      prior_checkpoint_matches: true,
      first_index_equals_prior_tree_size: true,
      consistency_proof_verifies: true,
      append_only: true,
      validator_should_accept: true,
    },
  })

  const tamperedProof = proof.map(hex)
  tamperedProof[0] = `${tamperedProof[0]!.slice(0, -1)}${tamperedProof[0]!.endsWith('0') ? '1' : '0'}`
  writeCase('consistency-proof-invalid', {
    name: 'consistency-proof-invalid',
    spec_section: '1.2.10',
    description:
      'The same consecutive checkpoints and disclosed leaves as the valid extension, with one consistency-proof nibble changed. Linkage and leaf prefix still hold, but the RFC 6962 proof fails and the pair is not consistent.',
    input: {
      first_checkpoint: k1,
      second_checkpoint: k2,
      first_leaves: k1Leaves,
      second_leaves: k2Leaves,
      consistency_proof_hex: tamperedProof,
      signer_seed_hex: hex(AGENT_SEED),
    },
    expected: {
      prior_checkpoint_matches: true,
      first_index_equals_prior_tree_size: true,
      consistency_proof_verifies: false,
      append_only: true,
      consistent: false,
    },
  })

  const foreignLeaf = await signObservation(
    SINGLE_LEAF_CONTEXT,
    genesisChainRoot(SINGLE_LEAF_CONTEXT),
    REFERENCE_TIME_MS + 9_000,
    'foreign_context_leaf',
  )
  const foreignLeaves = [prefixedRecordHash(r1), prefixedRecordHash(foreignLeaf)]
  const foreignCheckpoint = await signCheckpoint({
    contextId: MAIN_CONTEXT,
    chainRoot: chainRoot(r1),
    timestamp: REFERENCE_TIME_MS + 10_000,
    leafRefs: foreignLeaves,
    firstIndex: 0,
  })
  writeCase('foreign-context-id-leaf', {
    name: 'foreign-context-id-leaf',
    spec_section: '1.2.10',
    description:
      'A checkpoint whose root and args_hash correctly commit to disclosed hashes, but one disclosed record belongs to a different context_id. Hash-only evidence cannot expose this; when records are supplied, a verifier must reject the cross-context leaf set.',
    input: {
      record: foreignCheckpoint,
      leaves: foreignLeaves,
      leaf_records: [r1, foreignLeaf],
      signer_seed_hex: hex(AGENT_SEED),
    },
    expected: {
      root_matches_leaves: true,
      args_hash_matches_leaves: true,
      leaf_contexts_match: false,
      validator_should_accept: false,
    },
  })

  // Equivocating divergent-root pair: same creator_key, same
  // prior_checkpoint, same first_index and tree_size, different leaf at
  // index 4 → divergent session_root. Both signatures are genuine; the
  // pair itself is the equivocation evidence.
  const r4b = await signObservation(
    MAIN_CONTEXT,
    chainRoot(r3),
    REFERENCE_TIME_MS + 21_000,
    'leaf_4_divergent',
  )
  const k2bLeaves = [...k2Leaves.slice(0, 4), prefixedRecordHash(r4b)]
  const k2b = await signCheckpoint({
    contextId: MAIN_CONTEXT,
    chainRoot: chainRoot(r4b),
    timestamp: REFERENCE_TIME_MS + 30_000,
    leafRefs: k2bLeaves,
    firstIndex: 2,
    priorCheckpoint: prefixedRecordHash(k1),
  })
  writeCase('consistency-equivocation-pair', {
    name: 'consistency-equivocation-pair',
    spec_section: '1.2.10',
    description:
      'Two signed checkpoints from the same creator_key claiming the same prior_checkpoint with the same tree_size but divergent session_root values (leaf index 4 differs). Both signatures are genuine. Per §1.2.10 this pair constitutes equivocation evidence against the key, the session-scale analogue of log equivocation in §2.11, reported as a categorical verifier fact.',
    input: {
      first_variant: k2,
      second_variant: k2b,
      first_variant_leaves: k2Leaves,
      second_variant_leaves: k2bLeaves,
      shared_prior_checkpoint: prefixedRecordHash(k1),
      signer_seed_hex: hex(AGENT_SEED),
    },
    expected: {
      both_signatures_verify: true,
      same_creator_key: true,
      same_prior_checkpoint: true,
      roots_diverge: true,
      equivocation: true,
    },
  })

  // ── Retroactive / freshness vectors ───────────────────────────────────
  const DAY_MS = 24 * 60 * 60 * 1000

  // Declared retroactive backfill: checkpoint 30 days after the covered
  // leaves, retroactive: true.
  const t1 = await signObservation(
    RETRO_CONTEXT,
    genesisChainRoot(RETRO_CONTEXT),
    REFERENCE_TIME_MS + 1000,
    'retro_leaf_1',
  )
  const t2 = await signObservation(RETRO_CONTEXT, chainRoot(t1), REFERENCE_TIME_MS + 2000, 'retro_leaf_2')
  const retroLeaves = [prefixedRecordHash(t1), prefixedRecordHash(t2)]
  const kRetro = await signCheckpoint({
    contextId: RETRO_CONTEXT,
    chainRoot: chainRoot(t2),
    timestamp: REFERENCE_TIME_MS + 3 * DAY_MS,
    leafRefs: retroLeaves,
    firstIndex: 0,
    retroactive: true,
  })
  writeCase('retroactive-declared', {
    name: 'retroactive-declared',
    spec_section: '1.2.10',
    description:
      'An attested-backfill checkpoint: signed 3 days after the covered leaves with retroactive: true. Validators accept; verifiers assign the categorical freshness fact declared-retroactive. The checkpoint proves the history existed and was tree-committed as of the checkpoint, not as of the original session; the covered records’ own log entries remain the per-record contemporaneous anchors.',
    input: {
      record: kRetro,
      leaves: retroLeaves,
      max_covered_leaf_timestamp: t2.timestamp,
      verifier_staleness_bound_ms: DAY_MS,
      signer_seed_hex: hex(AGENT_SEED),
    },
    expected: {
      record_hash_hex: recordHashHex(kRetro),
      retroactive_present: true,
      validator_should_accept: true,
      verifier_signature_ok: true,
      verifier_freshness_fact: 'declared-retroactive',
    },
  })

  // retroactive: false MUST NOT be emitted (absence-not-null).
  const kRetroFalse = await signCheckpoint({
    contextId: RETRO_CONTEXT,
    chainRoot: chainRoot(kRetro),
    timestamp: REFERENCE_TIME_MS + 3 * DAY_MS + 1000,
    leafRefs: retroLeaves,
    firstIndex: 0,
    retroactive: false,
  })
  writeCase('retroactive-false-rejected', {
    name: 'retroactive-false-rejected',
    spec_section: '1.2.10',
    description:
      'A checkpoint carrying retroactive: false. Per §1.2.10 the flag is present-only-when-true: retroactive MUST be true when present and MUST be omitted otherwise, because presence changes the JCS canonical form and the signature (invariant 5 discipline). Signature is valid; rejection is at the policy layer.',
    input: { record: kRetroFalse, signer_seed_hex: hex(AGENT_SEED) },
    expected: {
      record_hash_hex: recordHashHex(kRetroFalse),
      validator_should_accept: false,
      verifier_signature_ok: true,
      rejection_reason: 'retroactive: false emitted',
    },
  })

  // Absence-not-null: the canonical form of a non-retroactive checkpoint
  // contains no "retroactive" key, and adding retroactive: true to the
  // same payload changes the record hash.
  const a1 = await signObservation(
    ABSENCE_CONTEXT,
    genesisChainRoot(ABSENCE_CONTEXT),
    REFERENCE_TIME_MS + 1000,
    'absence_leaf_1',
  )
  const absenceLeaves = [prefixedRecordHash(a1)]
  const kPlain = await signCheckpoint({
    contextId: ABSENCE_CONTEXT,
    chainRoot: chainRoot(a1),
    timestamp: REFERENCE_TIME_MS + 5000,
    leafRefs: absenceLeaves,
    firstIndex: 0,
  })
  const kFlagged = await signCheckpoint({
    contextId: ABSENCE_CONTEXT,
    chainRoot: chainRoot(a1),
    timestamp: REFERENCE_TIME_MS + 5000,
    leafRefs: absenceLeaves,
    firstIndex: 0,
    retroactive: true,
  })
  writeCase('retroactive-absence-not-null', {
    name: 'retroactive-absence-not-null',
    spec_section: '1.2.10',
    description:
      'Absence-not-null for the retroactive flag: a non-retroactive checkpoint’s canonical signing input contains no "retroactive" key. The flagged variant differs ONLY by retroactive: true inside the checkpoint object, yet its canonical form, signature, and record hash all change, mirroring the §1.2.6 omits-when-absent contract.',
    input: {
      record_without_flag: kPlain,
      record_with_flag: kFlagged,
      signer_seed_hex: hex(AGENT_SEED),
    },
    expected: {
      canonical_signing_input_utf8: new TextDecoder().decode(canonicalSigningInput(kPlain)),
      retroactive_in_canonical_form: false,
      record_hash_hex_without_flag: recordHashHex(kPlain),
      record_hash_hex_with_flag: recordHashHex(kFlagged),
      record_hashes_differ: true,
      validator_should_accept_both: true,
    },
  })

  // Stale-undeclared: checkpoint 2 days after the covered leaves without
  // retroactive. Signal not block (D051 posture): validators accept, the
  // verifier assigns the stale-undeclared fact against the 24h default.
  const u1 = await signObservation(
    STALE_CONTEXT,
    genesisChainRoot(STALE_CONTEXT),
    REFERENCE_TIME_MS + 1000,
    'stale_leaf_1',
  )
  const staleLeaves = [prefixedRecordHash(u1)]
  const kStale = await signCheckpoint({
    contextId: STALE_CONTEXT,
    chainRoot: chainRoot(u1),
    timestamp: REFERENCE_TIME_MS + 2 * DAY_MS,
    leafRefs: staleLeaves,
    firstIndex: 0,
  })
  writeCase('freshness-stale-undeclared', {
    name: 'freshness-stale-undeclared',
    spec_section: '1.2.10',
    description:
      'A checkpoint signed 2 days after its max covered leaf timestamp without retroactive: true. The checkpoint timestamp exceeds the verifier’s staleness bound (default 24h), so the verifier assigns the categorical freshness fact stale-undeclared. Signal, not block: validators still accept the record (the D051 / §6.7 posture).',
    input: {
      record: kStale,
      leaves: staleLeaves,
      max_covered_leaf_timestamp: u1.timestamp,
      verifier_staleness_bound_ms: DAY_MS,
      signer_seed_hex: hex(AGENT_SEED),
    },
    expected: {
      record_hash_hex: recordHashHex(kStale),
      validator_should_accept: true,
      verifier_signature_ok: true,
      verifier_freshness_fact: 'stale-undeclared',
    },
  })

  // ── Byte / URI duality ────────────────────────────────────────────────
  // The signed record's event_type is the URI, so records emitted before
  // and after promotion are byte-identical; only the 90-byte log entry's
  // type byte changes (0xFF extension slot pre-promotion, 0x08 after).
  const entryPre = serializeEntry({
    record_hash_hex: recordHashHex(k1),
    creator_key_b64url: k1.creator_key,
    context_id: k1.context_id,
    timestamp: k1.timestamp,
    event_type: k1.event_type,
  })
  if (entryPre[89] !== EXTENSION_BYTE) {
    throw new Error('generator self-check failed: pre-promotion entry byte is not 0xFF')
  }
  const entryPost = Uint8Array.from(entryPre)
  entryPost[89] = PROMOTED_BYTE
  writeCase('byte-uri-duality', {
    name: 'byte-uri-duality',
    spec_section: '1.2.10',
    description:
      'The same signed session_checkpoint record encoded as a 90-byte log entry (§2.3.1) under the pre-promotion 0xFF extension byte and the post-promotion 0x08 byte. The event_type inside the signed bytes is the URI, so the record’s canonical form, signature, and record hash are identical in both encodings; the two entries differ ONLY at byte 89 (the D073 staged-promotion pattern).',
    input: {
      record: k1,
      signer_seed_hex: hex(AGENT_SEED),
    },
    expected: {
      record_hash_hex: recordHashHex(k1),
      entry_pre_promotion_hex: hex(entryPre),
      entry_post_promotion_hex: hex(entryPost),
      pre_promotion_event_type_byte: EXTENSION_BYTE,
      post_promotion_event_type_byte: PROMOTED_BYTE,
      entries_identical_except_byte_89: true,
      signed_record_byte_identical_across_promotion: true,
    },
  })

  // ── Manifest ──────────────────────────────────────────────────────────
  const caseNames = [
    'schema-first-checkpoint',
    'schema-missing-checkpoint-rejected',
    'schema-checkpoint-on-wrong-event-type-rejected',
    'schema-first-index-bounds-rejected',
    'schema-prior-present-at-first-index-zero-rejected',
    'schema-prior-absent-at-positive-first-index-rejected',
    'tree-1-leaf',
    'tree-2-leaves',
    'tree-5-leaves',
    'tree-empty-rejected',
    'consistency-valid-extension',
    'consistency-proof-invalid',
    'foreign-context-id-leaf',
    'consistency-equivocation-pair',
    'retroactive-declared',
    'retroactive-false-rejected',
    'retroactive-absence-not-null',
    'freshness-stale-undeclared',
    'byte-uri-duality',
  ]
  const manifest = {
    spec_section: '1.2.10',
    spec_title: 'checkpoint (session checkpoint commitment)',
    decision_link: 'P044',
    event_type_uri: SESSION_CHECKPOINT_URI,
    promoted_byte: PROMOTED_BYTE,
    generated_at: REFERENCE_TIME_MS,
    generator: 'packages/log-dev/scripts/generate-conformance-session-checkpoint.ts',
    cases: caseNames.map((name) => ({ file: `cases/${name}.json`, name })),
    keys: { agent_pubkey: agentKey },
    note: 'The cases exercise the §1.2.10 checkpoint object schema and presence rules, real RFC 6962 roots over ordered record-hash leaves, valid and invalid append-only consistency proofs, foreign-context disclosed leaves, equivocation, retroactive and freshness facts, and the 0xFF/0x08 log-entry duality over byte-identical signed records.',
  }
  writeFileSync(join(CORPUS_ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')

  console.log(`generated ${manifest.cases.length} cases at ${CORPUS_ROOT}`)
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
