// SPDX-License-Identifier: Apache-2.0

/**
 * Session checkpoints (D139, spec §1.2.10).
 *
 * A session checkpoint is an ordinary signed atrib record whose `checkpoint`
 * body commits to the RFC 6962 Merkle root over the ordered record_hash
 * stream of its `context_id` so far. This module provides the producer-side
 * primitives:
 *
 *   - session-tree construction (`computeSessionRoot`) reusing the §2.3.2
 *     RFC 6962 helpers (`leafHash`, `nodeHash`, `computeRoot`) verbatim —
 *     leaves here are the RAW 32-byte record hashes (§1.2.10.1), never the
 *     `"sha256:<hex>"` display strings;
 *   - checkpoint-body assembly (`buildCheckpointBody`) enforcing the §1.2.10
 *     structural invariants (tree_size ≥ 1, 0 ≤ first_index < tree_size,
 *     prior_checkpoint iff first_index > 0, retroactive present-only-when-true);
 *   - selective-disclosure inclusion proofs (`sessionInclusionProof`,
 *     `verifySessionInclusion`) over the same §2.7 procedure;
 *   - append-only consistency proofs between consecutive checkpoints
 *     (RFC 6962 §2.1.2 generation, §2.1.4.2 verification) plus equivocation
 *     detection for divergent-root pairs (§1.2.10.2);
 *   - unsigned checkpoint-record assembly (`buildSessionCheckpointRecord`)
 *     under the extension URI. Byte `0x08` is NOT allocated yet: producers
 *     emit the URI and log operators encode the entry under `0xFF` per the
 *     D073 staged-promotion pattern. Signing stays with the existing owner
 *     (`signRecord` in `./signing.js`); this module never signs.
 *
 * Everything here is pure computation (no I/O). Producer wrappers layered on
 * the emit pipeline own the §5.8 degradation contract; these helpers throw
 * `Error` on contract violations so wrappers can catch and degrade.
 */

import canonicalize from 'canonicalize'
import { canonicalRecord } from './canon.js'
import { computeContentId } from './content-id.js'
import { sha256, hexEncode, hexDecode } from './hash.js'
import { computeRoot, computeInclusionProof, verifyInclusion, leafHash, nodeHash } from './merkle.js'
import { SHA256_REF_PATTERN } from './refs.js'
import type { AtribRecord } from './types.js'

const encoder = new TextEncoder()

/**
 * The session_checkpoint event_type URI (§1.2.10, D139). Pre-promotion the
 * log encodes entries with this URI under the `0xFF` extension byte
 * (§2.3.1); the signed bytes carry the URI either way, so records are
 * byte-identical across the promotion.
 */
export const SESSION_CHECKPOINT_EVENT_TYPE_URI = 'https://atrib.dev/v1/types/session_checkpoint'

/**
 * The byte the promotion ADR allocates for session_checkpoint log entries
 * (skipping 0x07, which stays D073's design-level `handoff` reservation).
 * NOT allocated yet: do not encode entries under this byte until the D036
 * promotion lands. Exposed so verifiers and tests can pin the §1.2.10
 * byte/URI duality.
 */
export const SESSION_CHECKPOINT_PROMOTED_EVENT_TYPE_BYTE = 0x08

/**
 * §1.2.2 content_id derivation input for origin-less cognitive producers:
 * pseudo-origin `atrib`, tool_name `session_checkpoint`. Pinned by the
 * conformance corpus.
 */
export const SESSION_CHECKPOINT_CONTENT_ID_ORIGIN = 'atrib'

/**
 * The §1.2.10 checkpoint object. All fields REQUIRED except
 * `prior_checkpoint` (present iff `first_index > 0`) and `retroactive`
 * (present-only-when-true; the `true` literal type makes
 * `retroactive: false` unrepresentable, mirroring the absence-not-null
 * contract — presence changes the JCS canonical form and the signature).
 */
export interface SessionCheckpoint {
  /** Index of the first leaf newly covered by this interval. */
  first_index: number
  /** Record hash of the immediately preceding checkpoint on this context. */
  prior_checkpoint?: string
  /** Present-only-when-true attested-backfill flag (§1.2.10.3). */
  retroactive?: true
  /** RFC 6962 Merkle Tree Hash over leaves 0..tree_size-1, `"sha256:"+hex`. */
  session_root: string
  /** Number of leaves committed; ≥ 1. */
  tree_size: number
}

/** A session_checkpoint record: an ordinary AtribRecord plus the checkpoint body. */
export type SessionCheckpointRecord = AtribRecord & { checkpoint: SessionCheckpoint }

/**
 * Derive the §1.2.2 content_id for a session_checkpoint record.
 * Origin-less cognitive producers use the pseudo-origin `"atrib"`, giving
 * the input `"atrib:session_checkpoint"` (corpus-pinned). Producers with a
 * service origin pass their normalized origin, mirroring directory_anchor.
 */
export function sessionCheckpointContentId(origin?: string): string {
  return computeContentId(origin ?? SESSION_CHECKPOINT_CONTENT_ID_ORIGIN, 'session_checkpoint')
}

/**
 * Decode an ordered list of `"sha256:<64-hex>"` record-hash refs into the
 * raw 32-byte leaf values the session tree is built over (§1.2.10.1 leaf
 * rule). Throws on any malformed ref.
 */
export function sessionLeavesFromRefs(refs: readonly string[]): Uint8Array[] {
  return refs.map((ref) => {
    if (!SHA256_REF_PATTERN.test(ref)) {
      throw new Error(`atrib: session leaf ref is not "sha256:<64-hex>": ${ref}`)
    }
    return hexDecode(ref.slice('sha256:'.length))
  })
}

function assertSessionLeaves(recordHashes: readonly Uint8Array[]): void {
  if (recordHashes.length === 0) {
    throw new Error('atrib: empty session checkpoints are prohibited (tree_size >= 1 per §1.2.10)')
  }
  for (const leaf of recordHashes) {
    if (leaf.length !== 32) {
      throw new Error(
        `atrib: session leaves are raw 32-byte record hashes (§1.2.10.1); got ${leaf.length} bytes`,
      )
    }
  }
}

/**
 * Compute the §1.2.10.1 session root over an ordered 32-byte record-hash
 * list. Reuses the §2.3.2 RFC 6962 helpers verbatim (leaf preimages here
 * are the raw 32-byte hashes; log entries have 90-byte preimages, so
 * cross-tree confusion is structurally impossible). Returns the
 * `"sha256:" + 64-hex` form carried in `checkpoint.session_root`.
 *
 * Throws on an empty list (empty checkpoints prohibited) or any non-32-byte
 * leaf (a tree over the UTF-8 display strings MUST NOT match).
 */
export function computeSessionRoot(recordHashes: readonly Uint8Array[]): string {
  assertSessionLeaves(recordHashes)
  return `sha256:${hexEncode(computeRoot([...recordHashes]))}`
}

/**
 * D099 local content commitment for a checkpoint record:
 * `args_hash = sha256(JCS({"leaves": [...ordered "sha256:<hex>" refs...]}))`.
 * The flat leaf list itself stays in `_local.content.leaves` in the mirror;
 * any party handed the list can replay both this commitment and the root.
 */
export function sessionCheckpointArgsHash(leafRefs: readonly string[]): string {
  const json = canonicalize({ leaves: [...leafRefs] })
  if (json === undefined) {
    throw new Error('atrib: session checkpoint leaf list is not canonicalizable')
  }
  return `sha256:${hexEncode(sha256(encoder.encode(json)))}`
}

export interface BuildCheckpointBodyOptions {
  /** Ordered raw 32-byte record hashes of every covered leaf (0..tree_size-1). */
  recordHashes: readonly Uint8Array[]
  /** Index of the first leaf newly covered by this interval. */
  firstIndex: number
  /**
   * Record hash of the immediately preceding checkpoint on this context.
   * MUST be present iff `firstIndex > 0` (§1.2.10).
   */
  priorCheckpoint?: string | undefined
  /**
   * Attested-backfill flag. Only `true` is representable in the body;
   * `false`/`undefined` produce the canonical absent form (absence-not-null).
   */
  retroactive?: boolean | undefined
}

/**
 * Build a structurally valid §1.2.10 checkpoint object. Throws on any
 * violation of the validator rules (the emit-pipeline wrapper catches and
 * degrades per §5.8). `retroactive` is included only when strictly `true`.
 */
export function buildCheckpointBody(opts: BuildCheckpointBodyOptions): SessionCheckpoint {
  const sessionRoot = computeSessionRoot(opts.recordHashes)
  const treeSize = opts.recordHashes.length
  if (!Number.isInteger(opts.firstIndex) || opts.firstIndex < 0) {
    throw new Error(`atrib: malformed first_index ${opts.firstIndex}`)
  }
  if (opts.firstIndex >= treeSize) {
    throw new Error(
      `atrib: first_index ${opts.firstIndex} >= tree_size ${treeSize} (interval must be non-empty per §1.2.10)`,
    )
  }
  if (opts.priorCheckpoint !== undefined && !SHA256_REF_PATTERN.test(opts.priorCheckpoint)) {
    throw new Error(`atrib: malformed prior_checkpoint ${opts.priorCheckpoint}`)
  }
  if (opts.priorCheckpoint !== undefined && opts.firstIndex === 0) {
    throw new Error('atrib: prior_checkpoint present with first_index == 0 (§1.2.10)')
  }
  if (opts.priorCheckpoint === undefined && opts.firstIndex > 0) {
    throw new Error('atrib: prior_checkpoint absent with first_index > 0 (§1.2.10)')
  }
  return {
    first_index: opts.firstIndex,
    ...(opts.priorCheckpoint !== undefined ? { prior_checkpoint: opts.priorCheckpoint } : {}),
    ...(opts.retroactive === true ? { retroactive: true as const } : {}),
    session_root: sessionRoot,
    tree_size: treeSize,
  }
}

export interface BuildSessionCheckpointRecordOptions {
  /** Producer public key, base64url (the same key that will sign). */
  creatorKey: string
  /** 32-hex session anchor the checkpoint commits over. */
  contextId: string
  /**
   * chain_root resolved through the normal D067 precedence
   * (`resolveChainRoot` / `inheritChainContext` — never reimplemented here).
   */
  chainRoot: string
  /** Structurally valid checkpoint body (see buildCheckpointBody). */
  checkpoint: SessionCheckpoint
  /** Record timestamp; defaults to Date.now(). */
  timestamp?: number | undefined
  /**
   * Ordered `"sha256:<hex>"` refs of the covered leaves. Used for the D099
   * default `args_hash` and self-checked against the checkpoint body
   * (length == tree_size, recomputed root == session_root).
   */
  leafRefs?: readonly string[] | undefined
  /** Explicit §8.3 args_hash override; required when leafRefs are omitted. */
  argsHash?: string | undefined
  /** §1.2.2 content_id origin; defaults to the `atrib` pseudo-origin. */
  contentIdOrigin?: string | undefined
  /**
   * Optional §1.2.5 informed_by refs (e.g. the prior checkpoint hash, per
   * the §1.2.10.4 MAY). Sorted lexicographically before assembly.
   */
  informedBy?: readonly string[] | undefined
}

/**
 * Assemble the unsigned session_checkpoint record (signature: '') ready for
 * the existing signing owner (`signRecord`). This function does NOT sign —
 * there is exactly one signing path and it is not here.
 *
 * JCS slotting: `checkpoint` sorts between `chain_root` and `content_id`;
 * object-literal order is irrelevant because signing canonicalizes.
 */
export function buildSessionCheckpointRecord(
  opts: BuildSessionCheckpointRecordOptions,
): SessionCheckpointRecord {
  if (opts.leafRefs !== undefined) {
    if (opts.leafRefs.length !== opts.checkpoint.tree_size) {
      throw new Error(
        `atrib: leafRefs length ${opts.leafRefs.length} != tree_size ${opts.checkpoint.tree_size}`,
      )
    }
    const recomputed = computeSessionRoot(sessionLeavesFromRefs(opts.leafRefs))
    if (recomputed !== opts.checkpoint.session_root) {
      throw new Error(
        `atrib: leafRefs recompute to ${recomputed}, checkpoint claims ${opts.checkpoint.session_root}`,
      )
    }
  }
  const argsHash =
    opts.argsHash ?? (opts.leafRefs !== undefined ? sessionCheckpointArgsHash(opts.leafRefs) : undefined)
  if (argsHash === undefined) {
    throw new Error('atrib: session checkpoint records commit content per D099; pass leafRefs or argsHash')
  }
  const informedBySorted =
    opts.informedBy !== undefined && opts.informedBy.length > 0
      ? [...opts.informedBy].sort()
      : undefined
  return {
    spec_version: 'atrib/1.0',
    content_id: sessionCheckpointContentId(opts.contentIdOrigin),
    creator_key: opts.creatorKey,
    chain_root: opts.chainRoot,
    checkpoint: opts.checkpoint,
    event_type: SESSION_CHECKPOINT_EVENT_TYPE_URI,
    context_id: opts.contextId,
    timestamp: opts.timestamp ?? Date.now(),
    args_hash: argsHash,
    ...(informedBySorted !== undefined ? { informed_by: informedBySorted } : {}),
    signature: '',
  }
}

// ---------------------------------------------------------------------------
// Inclusion proofs (§2.7 procedure over 32-byte session leaves)
// ---------------------------------------------------------------------------

/**
 * Generate the inclusion proof for the session leaf at `index`. Delegates to
 * the §2.3.2/§2.7 helper (`computeInclusionProof`), which hashes each raw
 * leaf with the 0x00 domain prefix internally. Throws on empty trees,
 * out-of-range indexes, or non-32-byte leaves.
 */
export function sessionInclusionProof(
  index: number,
  recordHashes: readonly Uint8Array[],
): Uint8Array[] {
  assertSessionLeaves(recordHashes)
  return computeInclusionProof(index, [...recordHashes])
}

export interface VerifySessionInclusionOptions {
  /** 0-based leaf index the proof claims. */
  index: number
  /** The checkpoint's tree_size. */
  treeSize: number
  /** Raw 32-byte record hash of the leaf, or its `"sha256:<hex>"` ref. */
  recordHash: Uint8Array | string
  /** Sibling hashes, leaf to root. */
  proof: readonly Uint8Array[]
  /** The checkpoint's session_root (`"sha256:"+hex`). */
  sessionRoot: string
}

/**
 * Verify an inclusion proof of a record hash against a session_root.
 * Never throws; malformed input returns false.
 */
export function verifySessionInclusion(opts: VerifySessionInclusionOptions): boolean {
  try {
    const leaf =
      typeof opts.recordHash === 'string'
        ? SHA256_REF_PATTERN.test(opts.recordHash)
          ? hexDecode(opts.recordHash.slice('sha256:'.length))
          : null
        : opts.recordHash
    if (leaf === null || leaf.length !== 32) return false
    if (!SHA256_REF_PATTERN.test(opts.sessionRoot)) return false
    const root = hexDecode(opts.sessionRoot.slice('sha256:'.length))
    return verifyInclusion(opts.index, opts.treeSize, leafHash(leaf), [...opts.proof], root)
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Consistency proofs (RFC 6962 §2.1.2 / §2.1.4.2 over the same helpers)
// ---------------------------------------------------------------------------

function largestPowerOfTwoLessThan(n: number): number {
  let k = 1
  while (k * 2 < n) k *= 2
  return k
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number)
  return diff === 0
}

/**
 * Generate the RFC 6962 §2.1.2 consistency proof
 * `PROOF(firstTreeSize, D[recordHashes])` from a prior checkpoint's tree
 * size to the current full leaf list. Subtree roots come from the same
 * §2.3.2 `computeRoot` helper the session root uses. Throws when
 * `firstTreeSize` is out of range or leaves are malformed.
 */
export function sessionConsistencyProof(
  firstTreeSize: number,
  recordHashes: readonly Uint8Array[],
): Uint8Array[] {
  assertSessionLeaves(recordHashes)
  if (!Number.isInteger(firstTreeSize) || firstTreeSize < 1 || firstTreeSize > recordHashes.length) {
    throw new Error(
      `atrib: consistency proof requires 1 <= firstTreeSize <= ${recordHashes.length}; got ${firstTreeSize}`,
    )
  }
  return subproof(firstTreeSize, [...recordHashes], true)
}

function subproof(m: number, d: Uint8Array[], b: boolean): Uint8Array[] {
  const n = d.length
  if (m === n) return b ? [] : [computeRoot(d)]
  const k = largestPowerOfTwoLessThan(n)
  if (m <= k) return [...subproof(m, d.slice(0, k), b), computeRoot(d.slice(k))]
  return [...subproof(m - k, d.slice(k), false), computeRoot(d.slice(0, k))]
}

export interface VerifySessionConsistencyOptions {
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
 * RFC 6962 §2.1.4.2 consistency-proof verification: proves the later tree
 * is an append-only extension of the earlier one. Never throws; malformed
 * input returns false.
 */
export function verifySessionConsistency(opts: VerifySessionConsistencyOptions): boolean {
  try {
    if (!SHA256_REF_PATTERN.test(opts.firstRoot) || !SHA256_REF_PATTERN.test(opts.secondRoot)) {
      return false
    }
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

// ---------------------------------------------------------------------------
// Consecutive-checkpoint consistency and equivocation (§1.2.10.2)
// ---------------------------------------------------------------------------

/**
 * Equivocation evidence per §1.2.10.2: two signed checkpoints from the same
 * creator_key on the same context claiming the same prior (or overlapping
 * ranges) with provably inconsistent roots. The pair itself is the
 * evidence; both signatures are genuine.
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

function recordHashRef(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

function evidenceSummary(cp: SessionCheckpoint): {
  session_root: string
  tree_size: number
  first_index: number
} {
  return { session_root: cp.session_root, tree_size: cp.tree_size, first_index: cp.first_index }
}

/**
 * Detect the direct §1.2.10.2 equivocation pair: same creator_key, same
 * context_id, same prior_checkpoint claim (or overlapping covered ranges)
 * with the same tree_size but divergent session_root values. Pairs with
 * different tree sizes need leaf material to prove divergence — use
 * `checkConsecutiveSessionCheckpoints` with `secondLeaves` for those.
 * Returns undefined when the pair is not (provably) equivocating.
 */
export function detectSessionCheckpointEquivocation(
  a: SessionCheckpointRecord,
  b: SessionCheckpointRecord,
): SessionCheckpointEquivocationEvidence | undefined {
  if (a.creator_key !== b.creator_key || a.context_id !== b.context_id) return undefined
  const samePrior = a.checkpoint.prior_checkpoint === b.checkpoint.prior_checkpoint
  const overlapping =
    a.checkpoint.first_index <= b.checkpoint.tree_size - 1 &&
    b.checkpoint.first_index <= a.checkpoint.tree_size - 1
  if (!samePrior && !overlapping) return undefined
  if (a.checkpoint.tree_size !== b.checkpoint.tree_size) return undefined
  if (a.checkpoint.session_root === b.checkpoint.session_root) return undefined
  return {
    creator_key: a.creator_key,
    context_id: a.context_id,
    reason: 'divergent-roots-same-claim',
    ...(samePrior && a.checkpoint.prior_checkpoint !== undefined
      ? { prior_checkpoint: a.checkpoint.prior_checkpoint }
      : {}),
    first_record_hash: recordHashRef(a),
    second_record_hash: recordHashRef(b),
    first: evidenceSummary(a.checkpoint),
    second: evidenceSummary(b.checkpoint),
  }
}

export interface CheckConsecutiveSessionCheckpointsOptions {
  /**
   * Ordered raw 32-byte leaves of the SECOND checkpoint's tree. When
   * supplied, the consistency proof is generated and verified from them.
   */
  secondLeaves?: readonly Uint8Array[] | undefined
  /** Pre-generated §2.1.2 consistency proof (used when secondLeaves absent). */
  consistencyProof?: readonly Uint8Array[] | undefined
}

export interface ConsecutiveSessionCheckpointCheck {
  /** second.prior_checkpoint equals the first checkpoint's record hash. */
  priorCheckpointMatches: boolean
  /** second.first_index equals first.tree_size. */
  firstIndexMatchesPriorTreeSize: boolean
  /**
   * RFC 6962 §2.1.4.2 result; undefined when neither leaves nor a proof
   * were supplied (linkage-only check).
   */
  consistencyProofVerifies: boolean | undefined
  /** All checkable §1.2.10.2 constraints hold. */
  consistent: boolean
  /** Populated when linked claims carry provably divergent roots. */
  equivocation?: SessionCheckpointEquivocationEvidence
}

/**
 * Check the §1.2.10.2 consecutive-checkpoint contract for K_i → K_{i+1}:
 * prior_checkpoint linkage, first_index continuation, and (when leaf or
 * proof material is available) the RFC 6962 append-only consistency proof.
 * A linked pair whose proof fails is surfaced as equivocation evidence
 * against the creator_key. Never throws; malformed material degrades to
 * `consistencyProofVerifies: false`.
 */
export function checkConsecutiveSessionCheckpoints(
  first: SessionCheckpointRecord,
  second: SessionCheckpointRecord,
  opts: CheckConsecutiveSessionCheckpointsOptions = {},
): ConsecutiveSessionCheckpointCheck {
  const firstHash = recordHashRef(first)
  const priorCheckpointMatches = second.checkpoint.prior_checkpoint === firstHash
  const firstIndexMatchesPriorTreeSize =
    second.checkpoint.first_index === first.checkpoint.tree_size

  let consistencyProofVerifies: boolean | undefined
  let proof: Uint8Array[] | undefined
  if (opts.secondLeaves !== undefined) {
    try {
      proof = sessionConsistencyProof(first.checkpoint.tree_size, opts.secondLeaves)
    } catch {
      consistencyProofVerifies = false
    }
  } else if (opts.consistencyProof !== undefined) {
    proof = [...opts.consistencyProof]
  }
  if (proof !== undefined) {
    consistencyProofVerifies = verifySessionConsistency({
      firstTreeSize: first.checkpoint.tree_size,
      secondTreeSize: second.checkpoint.tree_size,
      firstRoot: first.checkpoint.session_root,
      secondRoot: second.checkpoint.session_root,
      proof,
    })
    // Self-check when leaves were supplied: the leaves must also reproduce
    // the second checkpoint's own root, otherwise the "proof" was generated
    // over a different tree than the one signed.
    if (opts.secondLeaves !== undefined && consistencyProofVerifies) {
      try {
        consistencyProofVerifies =
          computeSessionRoot(opts.secondLeaves) === second.checkpoint.session_root
      } catch {
        consistencyProofVerifies = false
      }
    }
  }

  const consistent =
    priorCheckpointMatches && firstIndexMatchesPriorTreeSize && consistencyProofVerifies !== false

  let equivocation: SessionCheckpointEquivocationEvidence | undefined
  if (
    priorCheckpointMatches &&
    firstIndexMatchesPriorTreeSize &&
    consistencyProofVerifies === false &&
    first.creator_key === second.creator_key &&
    first.context_id === second.context_id
  ) {
    // A linked, range-continuing pair whose append-only proof fails means
    // the committed prefix diverged: session-scale equivocation (§1.2.10.2).
    equivocation = {
      creator_key: first.creator_key,
      context_id: first.context_id,
      reason: 'append-only-violation',
      ...(second.checkpoint.prior_checkpoint !== undefined
        ? { prior_checkpoint: second.checkpoint.prior_checkpoint }
        : {}),
      first_record_hash: firstHash,
      second_record_hash: recordHashRef(second),
      first: evidenceSummary(first.checkpoint),
      second: evidenceSummary(second.checkpoint),
    }
  } else {
    equivocation = detectSessionCheckpointEquivocation(first, second)
  }

  return {
    priorCheckpointMatches,
    firstIndexMatchesPriorTreeSize,
    consistencyProofVerifies,
    consistent,
    ...(equivocation !== undefined ? { equivocation } : {}),
  }
}
