// SPDX-License-Identifier: Apache-2.0

/**
 * Verifier-side session-checkpoint validation (D139, spec §1.2.10).
 *
 * Covers every family in the spec/conformance/session-checkpoint/ corpus:
 *
 *   - structural (validator-role) rules: `checkpoint` REQUIRED on
 *     session_checkpoint records and REJECTED on every other event_type
 *     (the §1.2.7 / §1.2.9 pattern), tree_size ≥ 1,
 *     0 ≤ first_index < tree_size, prior_checkpoint iff first_index > 0,
 *     `retroactive` present-only-when-true;
 *   - root recomputation from a supplied ordered leaf list (§1.2.10.1 —
 *     leaves are the RAW 32-byte record hashes, never the "sha256:<hex>"
 *     display strings) plus the D099 args_hash replay;
 *   - inclusion-proof verification (§2.7 procedure over 32-byte leaves);
 *   - append-only consistency between consecutive checkpoints via
 *     RFC 6962 §2.1.4.2 proofs, with divergent-root pairs surfaced as
 *     categorical equivocation evidence (§1.2.10.2);
 *   - categorical freshness tiering per §1.2.10.3 (`contemporaneous` /
 *     `declared-retroactive` / `stale-undeclared`, signal not block).
 *
 * Tree algebra reuses the exported §2.3.2 helpers from @atrib/mcp
 * (`leafHash`, `nodeHash`, `verifyInclusion`); the Merkle Tree Hash and
 * §2.1.4.2 consistency walk are implemented here so the verifier stays
 * independent of producer-side proof generation. Everything is pure and
 * non-throwing on malformed *records* (rejection is a returned reason);
 * helpers that take verifier-owned inputs (leaf refs) throw on caller error.
 */

import canonicalize from 'canonicalize'
import {
  canonicalRecord,
  hexDecode,
  hexEncode,
  leafHash,
  nodeHash,
  sha256,
  verifyInclusion,
  verifyRecord as verifyRecordSignature,
  type AtribRecord,
} from '@atrib/mcp'

const encoder = new TextEncoder()

/** The session_checkpoint event_type URI (§1.2.10, D139). */
export const SESSION_CHECKPOINT_EVENT_TYPE_URI = 'https://atrib.dev/v1/types/session_checkpoint'

/** Verifier default for the §1.2.10.3 stale-undeclared freshness bound. */
export const DEFAULT_SESSION_CHECKPOINT_STALENESS_BOUND_MS = 24 * 60 * 60 * 1000

const SHA256_REF = /^sha256:[0-9a-f]{64}$/

/**
 * The §1.2.10 checkpoint object as a verifier sees it. `retroactive` is
 * typed `boolean` (not the producer-side `true` literal) because the
 * verifier's job includes rejecting the `retroactive: false` wire form.
 */
export interface SessionCheckpointBody {
  first_index: number
  prior_checkpoint?: string
  retroactive?: boolean
  session_root: string
  tree_size: number
}

/** A record that may carry a checkpoint body (any event_type; presence is validated). */
export type SessionCheckpointRecord = AtribRecord & { checkpoint?: SessionCheckpointBody }

/** Categorical freshness fact per §1.2.10.3 (signal, not block). */
export type SessionCheckpointFreshness =
  | 'contemporaneous'
  | 'declared-retroactive'
  | 'stale-undeclared'

// ---------------------------------------------------------------------------
// Structural (validator-role) rules
// ---------------------------------------------------------------------------

/**
 * Validate the §1.2.10 structural rules. Returns undefined when the record
 * passes, or the rejection reason otherwise (reasons are pinned by the
 * conformance corpus). The signature on a violating record may itself be
 * valid; rejection is at the policy layer, for validators (§2.6.1) and
 * verifiers alike.
 */
export function validateSessionCheckpointStructural(
  record: SessionCheckpointRecord,
): string | undefined {
  const isCheckpointType = record.event_type === SESSION_CHECKPOINT_EVENT_TYPE_URI
  const cp = record.checkpoint
  if (isCheckpointType && cp === undefined) {
    return 'checkpoint missing on session_checkpoint record'
  }
  if (!isCheckpointType && cp !== undefined) {
    return 'checkpoint on non-session_checkpoint event_type'
  }
  if (cp === undefined) return undefined
  if (typeof cp.session_root !== 'string' || !SHA256_REF.test(cp.session_root)) {
    return 'malformed session_root'
  }
  if (!Number.isInteger(cp.tree_size) || cp.tree_size < 1) return 'tree_size < 1'
  if (!Number.isInteger(cp.first_index) || cp.first_index < 0) return 'malformed first_index'
  if (cp.first_index >= cp.tree_size) return 'first_index >= tree_size'
  if (cp.prior_checkpoint !== undefined) {
    if (typeof cp.prior_checkpoint !== 'string' || !SHA256_REF.test(cp.prior_checkpoint)) {
      return 'malformed prior_checkpoint'
    }
    if (cp.first_index === 0) return 'prior_checkpoint present with first_index == 0'
  } else if (cp.first_index > 0) {
    return 'prior_checkpoint absent with first_index > 0'
  }
  if (cp.retroactive !== undefined && cp.retroactive !== true) {
    return 'retroactive: false emitted'
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Session-tree recomputation (§1.2.10.1)
// ---------------------------------------------------------------------------

function largestPowerOfTwoLessThan(n: number): number {
  let k = 1
  while (k * 2 < n) k *= 2
  return k
}

/**
 * RFC 6962 §2.1 Merkle Tree Hash over raw leaf byte strings. MTH of the
 * empty list is SHA-256("") per the RFC; §1.2.10 prohibits committing to it
 * as a session_root (tree_size ≥ 1), but the sentinel is computable so
 * implementations can recognize it.
 */
function merkleTreeHash(leaves: readonly Uint8Array[]): Uint8Array {
  if (leaves.length === 0) return sha256(new Uint8Array(0))
  if (leaves.length === 1) return leafHash(leaves[0] as Uint8Array)
  const k = largestPowerOfTwoLessThan(leaves.length)
  return nodeHash(merkleTreeHash(leaves.slice(0, k)), merkleTreeHash(leaves.slice(k)))
}

/** Decode a `"sha256:<64-hex>"` ref to its raw 32 leaf bytes. Throws on malformed refs. */
export function sessionLeafBytes(ref: string): Uint8Array {
  if (!SHA256_REF.test(ref)) {
    throw new Error(`atrib: session leaf ref is not "sha256:<64-hex>": ${ref}`)
  }
  return hexDecode(ref.slice('sha256:'.length))
}

/**
 * Recompute the §1.2.10.1 session root from ordered `"sha256:<hex>"` leaf
 * refs (raw-32-byte-leaf rule). Returns the `"sha256:"+hex` form for direct
 * comparison against `checkpoint.session_root`.
 */
export function recomputeSessionRoot(leafRefs: readonly string[]): string {
  return `sha256:${hexEncode(merkleTreeHash(leafRefs.map(sessionLeafBytes)))}`
}

/**
 * Recompute an RFC 6962 root over arbitrary raw leaf byte strings. Exists
 * for trap-vector checks (a tree over the UTF-8 bytes of the prefixed hex
 * strings MUST NOT reproduce a session_root) and for the empty-tree
 * sentinel; conforming session roots always come from `recomputeSessionRoot`.
 */
export function recomputeSessionRootFromLeafBytes(leaves: readonly Uint8Array[]): string {
  return `sha256:${hexEncode(merkleTreeHash(leaves))}`
}

/** `"sha256:" + hex(SHA-256(JCS(signed record)))` — the §1.2.3 record hash. */
export function sessionCheckpointRecordHash(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

/**
 * Recompute the D099 content commitment for a checkpoint:
 * `sha256(JCS({"leaves": [...refs...]}))`, prefixed. Compare against the
 * record's `args_hash` to replay-check the disclosed leaf list.
 */
export function sessionCheckpointArgsHash(leafRefs: readonly string[]): string {
  const json = canonicalize({ leaves: [...leafRefs] })
  if (json === undefined) {
    throw new Error('atrib: session checkpoint leaf list is not canonicalizable')
  }
  return `sha256:${hexEncode(sha256(encoder.encode(json)))}`
}

// ---------------------------------------------------------------------------
// Freshness tiering (§1.2.10.3)
// ---------------------------------------------------------------------------

/**
 * Assign the categorical freshness fact for a checkpoint given the maximum
 * covered leaf timestamp. Signal, not block (the D051 / §6.7 posture): a
 * stale-undeclared checkpoint remains valid and admissible; the fact
 * travels with the verification result.
 */
export function sessionCheckpointFreshness(
  record: SessionCheckpointRecord,
  maxCoveredLeafTimestamp: number,
  boundMs: number = DEFAULT_SESSION_CHECKPOINT_STALENESS_BOUND_MS,
): SessionCheckpointFreshness {
  if (record.checkpoint?.retroactive === true) return 'declared-retroactive'
  if (record.timestamp - maxCoveredLeafTimestamp > boundMs) return 'stale-undeclared'
  return 'contemporaneous'
}

// ---------------------------------------------------------------------------
// Inclusion proofs (§2.7 procedure over 32-byte session leaves)
// ---------------------------------------------------------------------------

export interface VerifySessionInclusionProofOptions {
  /** 0-based leaf index the proof claims. */
  index: number
  /** The checkpoint's tree_size. */
  treeSize: number
  /** The covered record's hash: raw 32 bytes or its `"sha256:<hex>"` ref. */
  recordHash: Uint8Array | string
  /** Sibling hashes, leaf to root. */
  proof: readonly Uint8Array[]
  /** The checkpoint's session_root (`"sha256:"+hex`). */
  sessionRoot: string
}

/**
 * Verify that a record hash sits at `index` in the committed session tree.
 * This is the §1.2.10 selective-disclosure primitive: it reveals only the
 * record hash, its position, and ~log2(n) sibling hashes. Never throws;
 * malformed input (wrong index, wrong root, truncated or padded path,
 * non-32-byte leaf) returns false.
 */
export function verifySessionInclusionProof(opts: VerifySessionInclusionProofOptions): boolean {
  try {
    const leaf =
      typeof opts.recordHash === 'string'
        ? SHA256_REF.test(opts.recordHash)
          ? hexDecode(opts.recordHash.slice('sha256:'.length))
          : null
        : opts.recordHash
    if (leaf === null || leaf.length !== 32) return false
    if (!SHA256_REF.test(opts.sessionRoot)) return false
    const root = hexDecode(opts.sessionRoot.slice('sha256:'.length))
    return verifyInclusion(opts.index, opts.treeSize, leafHash(leaf), [...opts.proof], root)
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Consistency and equivocation (§1.2.10.2)
// ---------------------------------------------------------------------------

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number)
  return diff === 0
}

export interface VerifySessionConsistencyProofOptions {
  /** The prior checkpoint's tree_size. */
  firstTreeSize: number
  /** The later checkpoint's tree_size. */
  secondTreeSize: number
  /** The prior checkpoint's session_root (`"sha256:"+hex`). */
  firstRoot: string
  /** The later checkpoint's session_root (`"sha256:"+hex`). */
  secondRoot: string
  /** RFC 6962 §2.1.2 consistency proof nodes. */
  proof: readonly Uint8Array[]
}

/**
 * RFC 6962 §2.1.4.2 consistency-proof verification: proves the later
 * session tree is an append-only extension of the earlier one — the same
 * check the log's witness protocol applies between successive log
 * checkpoints (§2.9). Never throws; malformed input returns false.
 */
export function verifySessionConsistencyProof(
  opts: VerifySessionConsistencyProofOptions,
): boolean {
  try {
    if (!SHA256_REF.test(opts.firstRoot) || !SHA256_REF.test(opts.secondRoot)) return false
    const firstRoot = hexDecode(opts.firstRoot.slice('sha256:'.length))
    const secondRoot = hexDecode(opts.secondRoot.slice('sha256:'.length))
    const m = opts.firstTreeSize
    const n = opts.secondTreeSize
    if (!Number.isInteger(m) || !Number.isInteger(n)) return false
    if (m === n) return opts.proof.length === 0 && bytesEqual(firstRoot, secondRoot)
    if (m < 1 || m > n) return false
    let c = [...opts.proof]
    if ((m & (m - 1)) === 0) c = [firstRoot, ...c]
    if (c.length === 0) return false
    let fn = m - 1
    let sn = n - 1
    while ((fn & 1) === 1) {
      fn >>= 1
      sn >>= 1
    }
    let fr = c[0] as Uint8Array
    let sr = c[0] as Uint8Array
    for (let i = 1; i < c.length; i++) {
      if (sn === 0) return false
      const node = c[i] as Uint8Array
      if ((fn & 1) === 1 || fn === sn) {
        fr = nodeHash(node, fr)
        sr = nodeHash(node, sr)
        if ((fn & 1) === 0) {
          while (fn !== 0 && (fn & 1) === 0) {
            fn >>= 1
            sn >>= 1
          }
        }
      } else {
        sr = nodeHash(sr, node)
      }
      fn >>= 1
      sn >>= 1
    }
    return bytesEqual(fr, firstRoot) && bytesEqual(sr, secondRoot) && sn === 0
  } catch {
    return false
  }
}

/**
 * Equivocation evidence per §1.2.10.2: two signed checkpoints from the same
 * creator_key on one context claiming the same prior_checkpoint (or
 * overlapping ranges) with inconsistent roots. The session-scale analogue
 * of log equivocation in §2.11, reported as a categorical verifier fact.
 */
export interface SessionCheckpointEquivocationEvidence {
  creator_key: string
  context_id: string
  reason: 'divergent-roots-same-claim' | 'append-only-violation'
  prior_checkpoint?: string
  first_record_hash: string
  second_record_hash: string
  first: { session_root: string; tree_size: number; first_index: number }
  second: { session_root: string; tree_size: number; first_index: number }
}

function evidenceSummary(cp: SessionCheckpointBody): {
  session_root: string
  tree_size: number
  first_index: number
} {
  return { session_root: cp.session_root, tree_size: cp.tree_size, first_index: cp.first_index }
}

/**
 * Detect the direct §1.2.10.2 equivocation pair: same creator_key and
 * context_id, same prior_checkpoint claim (or overlapping covered ranges),
 * same tree_size, divergent session_root. Both signatures being genuine is
 * what makes the pair evidence — callers verify signatures separately.
 * Pairs of different tree sizes need leaf material to prove divergence; use
 * `checkConsecutiveSessionCheckpoints` for those. Returns undefined when
 * the pair is not (provably) equivocating.
 */
export function detectSessionCheckpointEquivocation(
  a: SessionCheckpointRecord,
  b: SessionCheckpointRecord,
): SessionCheckpointEquivocationEvidence | undefined {
  const acp = a.checkpoint
  const bcp = b.checkpoint
  if (acp === undefined || bcp === undefined) return undefined
  if (a.creator_key !== b.creator_key || a.context_id !== b.context_id) return undefined
  const samePrior = acp.prior_checkpoint === bcp.prior_checkpoint
  const overlapping = acp.first_index <= bcp.tree_size - 1 && bcp.first_index <= acp.tree_size - 1
  if (!samePrior && !overlapping) return undefined
  if (acp.tree_size !== bcp.tree_size) return undefined
  if (acp.session_root === bcp.session_root) return undefined
  return {
    creator_key: a.creator_key,
    context_id: a.context_id,
    reason: 'divergent-roots-same-claim',
    ...(samePrior && acp.prior_checkpoint !== undefined
      ? { prior_checkpoint: acp.prior_checkpoint }
      : {}),
    first_record_hash: sessionCheckpointRecordHash(a),
    second_record_hash: sessionCheckpointRecordHash(b),
    first: evidenceSummary(acp),
    second: evidenceSummary(bcp),
  }
}

export interface CheckConsecutiveSessionCheckpointsOptions {
  /** Ordered `"sha256:<hex>"` leaf refs of the FIRST checkpoint's tree. */
  firstLeaves?: readonly string[] | undefined
  /** Ordered `"sha256:<hex>"` leaf refs of the SECOND checkpoint's tree. */
  secondLeaves?: readonly string[] | undefined
  /** Pre-generated RFC 6962 §2.1.2 consistency proof nodes. */
  consistencyProof?: readonly Uint8Array[] | undefined
}

export interface ConsecutiveSessionCheckpointCheck {
  /** second.prior_checkpoint equals the first checkpoint's record hash. */
  priorCheckpointMatches: boolean
  /** second.first_index equals first.tree_size. */
  firstIndexMatchesPriorTreeSize: boolean
  /** first root recomputes from firstLeaves (undefined when not supplied). */
  firstRootRecomputes: boolean | undefined
  /** second root recomputes from secondLeaves (undefined when not supplied). */
  secondRootRecomputes: boolean | undefined
  /** Leaf prefix 0..first.tree_size-1 identical (undefined without both leaf lists). */
  appendOnly: boolean | undefined
  /** §2.1.4.2 proof result (undefined when no proof was supplied). */
  consistencyProofVerifies: boolean | undefined
  /** Every checkable §1.2.10.2 constraint holds. */
  consistent: boolean
  /** Populated when the pair provably diverges over the same claim. */
  equivocation?: SessionCheckpointEquivocationEvidence
}

/**
 * Check the full §1.2.10.2 contract for consecutive checkpoints
 * K_i → K_{i+1}: prior_checkpoint linkage, first_index continuation, root
 * recomputation from disclosed leaf lists, leaf-prefix append-only
 * identity, and the RFC 6962 §2.1.4.2 consistency proof. Constraints whose
 * material was not supplied report `undefined` (not checkable) rather than
 * failing. A linked, range-continuing pair whose roots provably diverge is
 * surfaced as equivocation evidence.
 */
export function checkConsecutiveSessionCheckpoints(
  first: SessionCheckpointRecord,
  second: SessionCheckpointRecord,
  opts: CheckConsecutiveSessionCheckpointsOptions = {},
): ConsecutiveSessionCheckpointCheck {
  const fcp = first.checkpoint
  const scp = second.checkpoint
  const firstHash = sessionCheckpointRecordHash(first)
  const priorCheckpointMatches = scp?.prior_checkpoint === firstHash
  const firstIndexMatchesPriorTreeSize =
    fcp !== undefined && scp !== undefined && scp.first_index === fcp.tree_size

  const safeRecompute = (refs: readonly string[]): string | undefined => {
    try {
      return recomputeSessionRoot(refs)
    } catch {
      return undefined
    }
  }

  const firstRootRecomputes =
    opts.firstLeaves !== undefined && fcp !== undefined
      ? safeRecompute(opts.firstLeaves) === fcp.session_root
      : undefined
  const secondRootRecomputes =
    opts.secondLeaves !== undefined && scp !== undefined
      ? safeRecompute(opts.secondLeaves) === scp.session_root
      : undefined

  const appendOnly =
    opts.firstLeaves !== undefined && opts.secondLeaves !== undefined && fcp !== undefined
      ? opts.secondLeaves.length >= fcp.tree_size &&
        opts.firstLeaves.length === fcp.tree_size &&
        opts.firstLeaves.every((ref, i) => opts.secondLeaves?.[i] === ref)
      : undefined

  const consistencyProofVerifies =
    opts.consistencyProof !== undefined && fcp !== undefined && scp !== undefined
      ? verifySessionConsistencyProof({
          firstTreeSize: fcp.tree_size,
          secondTreeSize: scp.tree_size,
          firstRoot: fcp.session_root,
          secondRoot: scp.session_root,
          proof: opts.consistencyProof,
        })
      : undefined

  const consistent =
    priorCheckpointMatches &&
    firstIndexMatchesPriorTreeSize &&
    firstRootRecomputes !== false &&
    secondRootRecomputes !== false &&
    appendOnly !== false &&
    consistencyProofVerifies !== false

  let equivocation: SessionCheckpointEquivocationEvidence | undefined
  if (
    fcp !== undefined &&
    scp !== undefined &&
    priorCheckpointMatches &&
    firstIndexMatchesPriorTreeSize &&
    (consistencyProofVerifies === false || appendOnly === false) &&
    first.creator_key === second.creator_key &&
    first.context_id === second.context_id
  ) {
    equivocation = {
      creator_key: first.creator_key,
      context_id: first.context_id,
      reason: 'append-only-violation',
      ...(scp.prior_checkpoint !== undefined ? { prior_checkpoint: scp.prior_checkpoint } : {}),
      first_record_hash: firstHash,
      second_record_hash: sessionCheckpointRecordHash(second),
      first: evidenceSummary(fcp),
      second: evidenceSummary(scp),
    }
  } else {
    equivocation = detectSessionCheckpointEquivocation(first, second)
  }

  return {
    priorCheckpointMatches,
    firstIndexMatchesPriorTreeSize,
    firstRootRecomputes,
    secondRootRecomputes,
    appendOnly,
    consistencyProofVerifies,
    consistent,
    ...(equivocation !== undefined ? { equivocation } : {}),
  }
}

// ---------------------------------------------------------------------------
// Composed per-record verification
// ---------------------------------------------------------------------------

export interface VerifySessionCheckpointRecordOptions {
  /** Ordered `"sha256:<hex>"` refs of the disclosed leaf list (Tier 2 material). */
  leaves?: readonly string[] | undefined
  /**
   * Optional disclosed record bodies for the leaves. When present, every
   * covered record must belong to the checkpoint's context_id. Hash-only
   * leaves cannot establish that fact.
   */
  leafRecords?: readonly Pick<AtribRecord, 'context_id'>[] | undefined
  /** Max covered leaf timestamp for §1.2.10.3 freshness tiering. */
  maxCoveredLeafTimestamp?: number | undefined
  /** Verifier staleness bound; defaults to 24h. */
  stalenessBoundMs?: number | undefined
}

export interface SessionCheckpointVerification {
  /** Ed25519 signature verifies over the canonical bytes (§1.4). */
  signatureOk: boolean
  /** §1.2.3 record hash of the checkpoint record. */
  recordHash: string
  /** §1.2.10 structural rejection reason; undefined when the record passes. */
  structuralRejection?: string
  /** session_root recomputes from the disclosed leaves (undefined when not supplied). */
  rootMatchesLeaves?: boolean
  /** D099 args_hash replays from the disclosed leaves (undefined when not supplied). */
  argsHashMatchesLeaves?: boolean
  /** Every disclosed leaf record belongs to this checkpoint's context_id. */
  leafContextsMatch?: boolean
  /** §1.2.10.3 categorical freshness fact (undefined without a leaf timestamp). */
  freshness?: SessionCheckpointFreshness
}

/**
 * Composed verifier entry point for one session_checkpoint record:
 * signature, structural rules, root recomputation, D099 args_hash replay,
 * and categorical freshness. Facts whose material was not supplied are
 * omitted rather than failed. Never throws.
 */
export async function verifySessionCheckpointRecord(
  record: SessionCheckpointRecord,
  opts: VerifySessionCheckpointRecordOptions = {},
): Promise<SessionCheckpointVerification> {
  let signatureOk = false
  try {
    signatureOk = await verifyRecordSignature(record)
  } catch {
    signatureOk = false
  }
  const structuralRejection = validateSessionCheckpointStructural(record)

  let rootMatchesLeaves: boolean | undefined
  let argsHashMatchesLeaves: boolean | undefined
  if (opts.leaves !== undefined && record.checkpoint !== undefined) {
    try {
      rootMatchesLeaves = recomputeSessionRoot(opts.leaves) === record.checkpoint.session_root
    } catch {
      rootMatchesLeaves = false
    }
    try {
      argsHashMatchesLeaves = sessionCheckpointArgsHash(opts.leaves) === record.args_hash
    } catch {
      argsHashMatchesLeaves = false
    }
  }

  const leafContextsMatch =
    opts.leafRecords === undefined
      ? undefined
      : opts.leafRecords.length === (opts.leaves?.length ?? opts.leafRecords.length) &&
        opts.leafRecords.every((leaf) => leaf.context_id === record.context_id)

  const freshness =
    opts.maxCoveredLeafTimestamp !== undefined
      ? sessionCheckpointFreshness(
          record,
          opts.maxCoveredLeafTimestamp,
          opts.stalenessBoundMs ?? DEFAULT_SESSION_CHECKPOINT_STALENESS_BOUND_MS,
        )
      : undefined

  return {
    signatureOk,
    recordHash: sessionCheckpointRecordHash(record),
    ...(structuralRejection !== undefined ? { structuralRejection } : {}),
    ...(rootMatchesLeaves !== undefined ? { rootMatchesLeaves } : {}),
    ...(argsHashMatchesLeaves !== undefined ? { argsHashMatchesLeaves } : {}),
    ...(leafContextsMatch !== undefined ? { leafContextsMatch } : {}),
    ...(freshness !== undefined ? { freshness } : {}),
  }
}
