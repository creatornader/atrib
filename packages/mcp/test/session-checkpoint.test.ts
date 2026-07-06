// SPDX-License-Identifier: Apache-2.0

/**
 * Session-checkpoint producer primitives (D139, spec §1.2.10).
 *
 * Pins the src/session-checkpoint.ts helpers against the COMMITTED
 * conformance corpus (roots, consistency proof, full byte-identical record
 * reconstruction of a corpus checkpoint through buildCheckpointBody +
 * buildSessionCheckpointRecord + the existing signRecord owner), and closes
 * the inclusion-proof punch-list gaps that the corpus does not carry as
 * fixtures: valid proof / wrong index / wrong root / truncated path (plus
 * padded path and tampered sibling).
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { canonicalRecord } from '../src/canon.js'
import { sha256, hexEncode, hexDecode } from '../src/hash.js'
import { signRecord, verifyRecord } from '../src/signing.js'
import type { AtribRecord } from '../src/types.js'
import {
  SESSION_CHECKPOINT_EVENT_TYPE_URI,
  SESSION_CHECKPOINT_PROMOTED_EVENT_TYPE_BYTE,
  buildCheckpointBody,
  buildSessionCheckpointRecord,
  checkConsecutiveSessionCheckpoints,
  computeSessionRoot,
  detectSessionCheckpointEquivocation,
  sessionCheckpointArgsHash,
  sessionCheckpointContentId,
  sessionConsistencyProof,
  sessionInclusionProof,
  sessionLeavesFromRefs,
  verifySessionConsistency,
  verifySessionInclusion,
  type SessionCheckpoint,
  type SessionCheckpointRecord,
} from '../src/session-checkpoint.js'

const CORPUS = join(__dirname, '../../../spec/conformance/session-checkpoint/cases')

interface CaseFile {
  input: Record<string, unknown>
  expected: Record<string, unknown>
}

function loadCase(name: string): CaseFile {
  return JSON.parse(readFileSync(join(CORPUS, `${name}.json`), 'utf8')) as CaseFile
}

function recordHashRef(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

/** Deterministic fake 32-byte "record hashes" for proof-shape tests. */
function fakeLeaves(n: number): Uint8Array[] {
  return Array.from({ length: n }, (_, i) => sha256(new TextEncoder().encode(`leaf-${i}`)))
}

describe('computeSessionRoot (§1.2.10.1)', () => {
  it('matches the corpus roots for 1, 2, and 5 leaves', () => {
    for (const name of ['tree-1-leaf', 'tree-2-leaves', 'tree-5-leaves']) {
      const c = loadCase(name)
      const refs = c.input.leaves as string[]
      const expectedRoot = (c.expected as { session_root_hex: string }).session_root_hex
      expect(computeSessionRoot(sessionLeavesFromRefs(refs))).toBe(`sha256:${expectedRoot}`)
    }
  })

  it('rejects empty leaf lists (empty checkpoints prohibited)', () => {
    expect(() => computeSessionRoot([])).toThrow(/empty session checkpoints are prohibited/)
  })

  it('rejects non-32-byte leaves (raw-32-byte-leaf rule)', () => {
    // The UTF-8 bytes of a "sha256:<hex>" display string are 71 bytes, not
    // 32: the trap the corpus pins. The producer API refuses them outright.
    const c = loadCase('tree-2-leaves')
    const refs = c.input.leaves as string[]
    const utf8 = new TextEncoder()
    expect(() => computeSessionRoot(refs.map((r) => utf8.encode(r)))).toThrow(/raw 32-byte/)
  })

  it('rejects malformed refs in sessionLeavesFromRefs', () => {
    expect(() => sessionLeavesFromRefs(['sha256:zz'])).toThrow(/not "sha256:<64-hex>"/)
    expect(() => sessionLeavesFromRefs(['ab'.repeat(32)])).toThrow(/not "sha256:<64-hex>"/)
  })
})

describe('buildCheckpointBody (§1.2.10 validator rules, producer side)', () => {
  const leaves = fakeLeaves(3)
  const priorRef = `sha256:${'ab'.repeat(32)}`

  it('builds a valid first-checkpoint body (no prior, no retroactive key)', () => {
    const body = buildCheckpointBody({ recordHashes: leaves, firstIndex: 0 })
    expect(body.first_index).toBe(0)
    expect(body.tree_size).toBe(3)
    expect(body.session_root).toBe(computeSessionRoot(leaves))
    expect('prior_checkpoint' in body).toBe(false)
    expect('retroactive' in body).toBe(false)
  })

  it('includes retroactive only when strictly true (absence-not-null)', () => {
    const flagged = buildCheckpointBody({ recordHashes: leaves, firstIndex: 0, retroactive: true })
    expect(flagged.retroactive).toBe(true)
    const unflagged = buildCheckpointBody({
      recordHashes: leaves,
      firstIndex: 0,
      retroactive: false,
    })
    // retroactive: false MUST NOT be emitted; the canonical non-retroactive
    // form omits the key entirely.
    expect('retroactive' in unflagged).toBe(false)
  })

  it('enforces 0 <= first_index < tree_size', () => {
    expect(() => buildCheckpointBody({ recordHashes: leaves, firstIndex: 3, priorCheckpoint: priorRef })).toThrow(
      /first_index 3 >= tree_size 3/,
    )
    expect(() => buildCheckpointBody({ recordHashes: leaves, firstIndex: -1 })).toThrow(
      /malformed first_index/,
    )
    expect(() => buildCheckpointBody({ recordHashes: leaves, firstIndex: 1.5 })).toThrow(
      /malformed first_index/,
    )
  })

  it('enforces prior_checkpoint present iff first_index > 0', () => {
    expect(() =>
      buildCheckpointBody({ recordHashes: leaves, firstIndex: 0, priorCheckpoint: priorRef }),
    ).toThrow(/prior_checkpoint present with first_index == 0/)
    expect(() => buildCheckpointBody({ recordHashes: leaves, firstIndex: 1 })).toThrow(
      /prior_checkpoint absent with first_index > 0/,
    )
    expect(() =>
      buildCheckpointBody({ recordHashes: leaves, firstIndex: 1, priorCheckpoint: 'nope' }),
    ).toThrow(/malformed prior_checkpoint/)
    const ok = buildCheckpointBody({ recordHashes: leaves, firstIndex: 1, priorCheckpoint: priorRef })
    expect(ok.prior_checkpoint).toBe(priorRef)
  })
})

describe('checkpoint record assembly + existing signing owner', () => {
  it('reconstructs the corpus first checkpoint byte-identically via signRecord', async () => {
    // The strongest producer conformance statement available: assembling
    // the checkpoint through buildCheckpointBody + buildSessionCheckpointRecord
    // and signing through the ONE existing owner reproduces the committed
    // corpus record byte for byte (same canonical form, same signature,
    // same record hash).
    const c = loadCase('schema-first-checkpoint')
    const committed = c.input.record as SessionCheckpointRecord
    const refs = c.input.leaves as string[]
    const seed = hexDecode(c.input.signer_seed_hex as string)

    const body = buildCheckpointBody({
      recordHashes: sessionLeavesFromRefs(refs),
      firstIndex: committed.checkpoint.first_index,
    })
    expect(body).toEqual(committed.checkpoint)

    const unsigned = buildSessionCheckpointRecord({
      creatorKey: committed.creator_key,
      contextId: committed.context_id,
      chainRoot: committed.chain_root,
      checkpoint: body,
      timestamp: committed.timestamp,
      leafRefs: refs,
    })
    expect(unsigned.event_type).toBe(SESSION_CHECKPOINT_EVENT_TYPE_URI)
    expect(unsigned.content_id).toBe(committed.content_id)
    expect(unsigned.args_hash).toBe(committed.args_hash)

    const signed = await signRecord(unsigned, seed)
    expect(signed).toEqual(committed)
    expect(recordHashRef(signed)).toBe(
      `sha256:${(c.expected as { record_hash_hex: string }).record_hash_hex}`,
    )
    expect(await verifyRecord(signed)).toBe(true)
  })

  it('pins the origin-less content_id input "atrib:session_checkpoint"', () => {
    const expected = `sha256:${hexEncode(
      sha256(new TextEncoder().encode('atrib:session_checkpoint')),
    )}`
    expect(sessionCheckpointContentId()).toBe(expected)
  })

  it('self-checks leafRefs against the checkpoint body', () => {
    const leaves = fakeLeaves(2)
    const body = buildCheckpointBody({ recordHashes: leaves, firstIndex: 0 })
    const refs = leaves.map((l) => `sha256:${hexEncode(l)}`)
    const base = {
      creatorKey: 'k'.repeat(43),
      contextId: 'ab'.repeat(16),
      chainRoot: `sha256:${'cd'.repeat(32)}`,
      checkpoint: body,
    }
    // Wrong count.
    expect(() =>
      buildSessionCheckpointRecord({ ...base, leafRefs: refs.slice(0, 1) }),
    ).toThrow(/leafRefs length 1 != tree_size 2/)
    // Wrong order → recomputed root diverges.
    expect(() =>
      buildSessionCheckpointRecord({ ...base, leafRefs: [refs[1]!, refs[0]!] }),
    ).toThrow(/recompute to/)
    // Neither leafRefs nor argsHash → no D099 commitment possible.
    expect(() => buildSessionCheckpointRecord({ ...base })).toThrow(/pass leafRefs or argsHash/)
    // informed_by is sorted per §1.2.5.
    const record = buildSessionCheckpointRecord({
      ...base,
      leafRefs: refs,
      informedBy: [`sha256:${'ff'.repeat(32)}`, `sha256:${'aa'.repeat(32)}`],
    })
    expect(record.informed_by).toEqual([`sha256:${'aa'.repeat(32)}`, `sha256:${'ff'.repeat(32)}`])
    expect(record.args_hash).toBe(sessionCheckpointArgsHash(refs))
    expect(record.signature).toBe('')
  })

  it('exposes the staged 0x08 promotion byte without allocating it', () => {
    expect(SESSION_CHECKPOINT_PROMOTED_EVENT_TYPE_BYTE).toBe(0x08)
  })
})

describe('sessionInclusionProof / verifySessionInclusion (§2.7 over 32-byte leaves)', () => {
  // Cover balanced, odd, and single-leaf shapes, including the corpus
  // 5-leaf tree.
  for (const size of [1, 2, 3, 5, 8]) {
    it(`round-trips every index in a ${size}-leaf session tree`, () => {
      const leaves = fakeLeaves(size)
      const root = computeSessionRoot(leaves)
      for (let index = 0; index < size; index++) {
        const proof = sessionInclusionProof(index, leaves)
        expect(
          verifySessionInclusion({
            index,
            treeSize: size,
            recordHash: leaves[index]!,
            proof,
            sessionRoot: root,
          }),
        ).toBe(true)
      }
    })
  }

  it('verifies the corpus 5-leaf tree by ref, including the embedded prior checkpoint leaf', () => {
    const c = loadCase('tree-5-leaves')
    const refs = c.input.leaves as string[]
    const leaves = sessionLeavesFromRefs(refs)
    const root = `sha256:${(c.expected as { session_root_hex: string }).session_root_hex}`
    const priorIndex = (c.expected as { prior_checkpoint_is_leaf_at_index: number })
      .prior_checkpoint_is_leaf_at_index
    const proof = sessionInclusionProof(priorIndex, leaves)
    expect(
      verifySessionInclusion({
        index: priorIndex,
        treeSize: refs.length,
        recordHash: refs[priorIndex]!, // string-ref form
        proof,
        sessionRoot: root,
      }),
    ).toBe(true)
  })

  it('rejects a proof presented at the wrong index', () => {
    const leaves = fakeLeaves(5)
    const root = computeSessionRoot(leaves)
    const proof = sessionInclusionProof(2, leaves)
    for (const wrongIndex of [0, 1, 3, 4]) {
      expect(
        verifySessionInclusion({
          index: wrongIndex,
          treeSize: 5,
          recordHash: leaves[2]!,
          proof,
          sessionRoot: root,
        }),
      ).toBe(false)
    }
    // And the right index with the wrong leaf.
    expect(
      verifySessionInclusion({
        index: 2,
        treeSize: 5,
        recordHash: leaves[3]!,
        proof,
        sessionRoot: root,
      }),
    ).toBe(false)
  })

  it('rejects a proof against the wrong root', () => {
    const leaves = fakeLeaves(5)
    const proof = sessionInclusionProof(2, leaves)
    const otherRoot = computeSessionRoot(fakeLeaves(4))
    expect(
      verifySessionInclusion({
        index: 2,
        treeSize: 5,
        recordHash: leaves[2]!,
        proof,
        sessionRoot: otherRoot,
      }),
    ).toBe(false)
  })

  it('rejects truncated and padded proof paths', () => {
    const leaves = fakeLeaves(5)
    const root = computeSessionRoot(leaves)
    const proof = sessionInclusionProof(2, leaves)
    expect(proof.length).toBeGreaterThan(0)
    expect(
      verifySessionInclusion({
        index: 2,
        treeSize: 5,
        recordHash: leaves[2]!,
        proof: proof.slice(0, proof.length - 1),
        sessionRoot: root,
      }),
    ).toBe(false)
    expect(
      verifySessionInclusion({
        index: 2,
        treeSize: 5,
        recordHash: leaves[2]!,
        proof: [...proof, sha256(new Uint8Array([1]))],
        sessionRoot: root,
      }),
    ).toBe(false)
  })

  it('rejects a tampered sibling hash', () => {
    const leaves = fakeLeaves(8)
    const root = computeSessionRoot(leaves)
    const proof = sessionInclusionProof(4, leaves)
    const tampered = proof.map((p, i) => (i === 1 ? sha256(p) : p))
    expect(
      verifySessionInclusion({
        index: 4,
        treeSize: 8,
        recordHash: leaves[4]!,
        proof: tampered,
        sessionRoot: root,
      }),
    ).toBe(false)
  })

  it('never throws on malformed input (out-of-range index, bad ref, bad root)', () => {
    const leaves = fakeLeaves(3)
    const root = computeSessionRoot(leaves)
    const proof = sessionInclusionProof(0, leaves)
    expect(
      verifySessionInclusion({ index: -1, treeSize: 3, recordHash: leaves[0]!, proof, sessionRoot: root }),
    ).toBe(false)
    expect(
      verifySessionInclusion({ index: 3, treeSize: 3, recordHash: leaves[0]!, proof, sessionRoot: root }),
    ).toBe(false)
    expect(
      verifySessionInclusion({ index: 0, treeSize: 3, recordHash: 'not-a-ref', proof, sessionRoot: root }),
    ).toBe(false)
    expect(
      verifySessionInclusion({ index: 0, treeSize: 3, recordHash: leaves[0]!, proof, sessionRoot: 'sha256:zz' }),
    ).toBe(false)
    expect(() => sessionInclusionProof(9, leaves)).toThrow()
    expect(() => sessionInclusionProof(0, [])).toThrow()
  })
})

describe('session consistency proofs (§1.2.10.2, RFC 6962 §2.1.2 / §2.1.4.2)', () => {
  it('reproduces the corpus consistency proof and verifies it', () => {
    const c = loadCase('consistency-valid-extension')
    const k1 = c.input.first_checkpoint as SessionCheckpointRecord
    const k2 = c.input.second_checkpoint as SessionCheckpointRecord
    const secondLeaves = sessionLeavesFromRefs(c.input.second_leaves as string[])
    const committedProof = (c.input.consistency_proof_hex as string[]).map(hexDecode)

    const proof = sessionConsistencyProof(k1.checkpoint.tree_size, secondLeaves)
    expect(proof.map(hexEncode)).toEqual(committedProof.map(hexEncode))
    expect(
      verifySessionConsistency({
        firstTreeSize: k1.checkpoint.tree_size,
        secondTreeSize: k2.checkpoint.tree_size,
        firstRoot: k1.checkpoint.session_root,
        secondRoot: k2.checkpoint.session_root,
        proof,
      }),
    ).toBe(true)
  })

  it('verifies append-only extensions across tree shapes and rejects tampering', () => {
    const all = fakeLeaves(11)
    for (const m of [1, 2, 3, 4, 7, 8, 10]) {
      const n = all.length
      const firstRoot = computeSessionRoot(all.slice(0, m))
      const secondRoot = computeSessionRoot(all)
      const proof = sessionConsistencyProof(m, all)
      expect(
        verifySessionConsistency({ firstTreeSize: m, secondTreeSize: n, firstRoot, secondRoot, proof }),
      ).toBe(true)
      if (proof.length > 0) {
        expect(
          verifySessionConsistency({
            firstTreeSize: m,
            secondTreeSize: n,
            firstRoot,
            secondRoot,
            proof: proof.slice(0, proof.length - 1),
          }),
        ).toBe(false)
      }
      // Divergent prefix: replace leaf 0 and recompute the "first" root.
      const diverged = [sha256(new Uint8Array([9, 9])), ...all.slice(1, m)]
      expect(
        verifySessionConsistency({
          firstTreeSize: m,
          secondTreeSize: n,
          firstRoot: computeSessionRoot(diverged),
          secondRoot,
          proof,
        }),
      ).toBe(false)
    }
  })

  it('handles the m == n identity and rejects out-of-range sizes', () => {
    const leaves = fakeLeaves(4)
    const root = computeSessionRoot(leaves)
    expect(
      verifySessionConsistency({
        firstTreeSize: 4,
        secondTreeSize: 4,
        firstRoot: root,
        secondRoot: root,
        proof: [],
      }),
    ).toBe(true)
    expect(
      verifySessionConsistency({
        firstTreeSize: 5,
        secondTreeSize: 4,
        firstRoot: root,
        secondRoot: root,
        proof: [],
      }),
    ).toBe(false)
    expect(() => sessionConsistencyProof(0, leaves)).toThrow()
    expect(() => sessionConsistencyProof(5, leaves)).toThrow()
  })
})

describe('consecutive checkpoints and equivocation (§1.2.10.2)', () => {
  it('accepts the corpus valid extension end to end', () => {
    const c = loadCase('consistency-valid-extension')
    const k1 = c.input.first_checkpoint as SessionCheckpointRecord
    const k2 = c.input.second_checkpoint as SessionCheckpointRecord
    const secondLeaves = sessionLeavesFromRefs(c.input.second_leaves as string[])

    const check = checkConsecutiveSessionCheckpoints(k1, k2, { secondLeaves })
    expect(check.priorCheckpointMatches).toBe(true)
    expect(check.firstIndexMatchesPriorTreeSize).toBe(true)
    expect(check.consistencyProofVerifies).toBe(true)
    expect(check.consistent).toBe(true)
    expect(check.equivocation).toBeUndefined()
  })

  it('flags the corpus divergent-root pair as equivocation evidence', () => {
    const c = loadCase('consistency-equivocation-pair')
    const a = c.input.first_variant as SessionCheckpointRecord
    const b = c.input.second_variant as SessionCheckpointRecord

    const evidence = detectSessionCheckpointEquivocation(a, b)
    expect(evidence).toBeDefined()
    expect(evidence!.reason).toBe('divergent-roots-same-claim')
    expect(evidence!.creator_key).toBe(a.creator_key)
    expect(evidence!.prior_checkpoint).toBe(c.input.shared_prior_checkpoint as string)
    expect(evidence!.first.session_root).not.toBe(evidence!.second.session_root)
    expect(evidence!.first_record_hash).toBe(recordHashRef(a))
    expect(evidence!.second_record_hash).toBe(recordHashRef(b))
  })

  it('does not flag pairs from different keys or disjoint ranges', () => {
    const c = loadCase('consistency-equivocation-pair')
    const a = c.input.first_variant as SessionCheckpointRecord
    const b = c.input.second_variant as SessionCheckpointRecord

    const foreign = { ...b, creator_key: 'A'.repeat(43) }
    expect(detectSessionCheckpointEquivocation(a, foreign)).toBeUndefined()

    const identical = { ...b, checkpoint: { ...a.checkpoint } }
    expect(detectSessionCheckpointEquivocation(a, identical)).toBeUndefined()
  })

  it('surfaces a linked pair with a diverged prefix as append-only-violation', () => {
    const c = loadCase('consistency-valid-extension')
    const k1 = c.input.first_checkpoint as SessionCheckpointRecord
    const k2 = c.input.second_checkpoint as SessionCheckpointRecord
    const secondRefs = c.input.second_leaves as string[]
    // Rewrite history: swap the first two committed leaves. Linkage claims
    // still match; the consistency proof over the rewritten stream fails.
    const rewritten = sessionLeavesFromRefs([
      secondRefs[1]!,
      secondRefs[0]!,
      ...secondRefs.slice(2),
    ])
    const forged: SessionCheckpoint = {
      ...k2.checkpoint,
      session_root: computeSessionRoot(rewritten),
    }
    const forgedRecord: SessionCheckpointRecord = { ...k2, checkpoint: forged }
    const check = checkConsecutiveSessionCheckpoints(k1, forgedRecord, {
      secondLeaves: rewritten,
    })
    expect(check.priorCheckpointMatches).toBe(true)
    expect(check.firstIndexMatchesPriorTreeSize).toBe(true)
    expect(check.consistencyProofVerifies).toBe(false)
    expect(check.consistent).toBe(false)
    expect(check.equivocation).toBeDefined()
    expect(check.equivocation!.reason).toBe('append-only-violation')
  })
})
