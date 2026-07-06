// SPDX-License-Identifier: Apache-2.0

/**
 * Verifier-side session-checkpoint unit tests (D139, spec §1.2.10).
 *
 * Complements the conformance suite (which consumes the committed corpus)
 * with the punch-list inclusion-proof cases the corpus does not carry as
 * fixtures — valid proof / wrong index / wrong root / truncated path —
 * plus structural-validator edge cases, freshness boundary behavior,
 * consistency negatives, equivocation-detector scoping, and the composed
 * verifySessionCheckpointRecord over a freshly signed record.
 */

import { describe, it, expect } from 'vitest'
import {
  computeInclusionProof,
  computeRoot,
  getPublicKey,
  base64urlEncode,
  genesisChainRoot,
  hexEncode,
  sha256,
  signRecord,
  type AtribRecord,
} from '@atrib/mcp'
import {
  DEFAULT_SESSION_CHECKPOINT_STALENESS_BOUND_MS,
  SESSION_CHECKPOINT_EVENT_TYPE_URI,
  checkConsecutiveSessionCheckpoints,
  detectSessionCheckpointEquivocation,
  recomputeSessionRoot,
  sessionCheckpointArgsHash,
  sessionCheckpointFreshness,
  sessionCheckpointRecordHash,
  validateSessionCheckpointStructural,
  verifySessionCheckpointRecord,
  verifySessionConsistencyProof,
  verifySessionInclusionProof,
  type SessionCheckpointBody,
  type SessionCheckpointRecord,
} from '../src/session-checkpoint.js'

const OBSERVATION_URI = 'https://atrib.dev/v1/types/observation'
const CONTEXT = 'ab'.repeat(16)
const ROOT_64 = 'cd'.repeat(32)
const PRIOR_REF = `sha256:${'ef'.repeat(32)}`

function fakeLeaves(n: number): Uint8Array[] {
  return Array.from({ length: n }, (_, i) => sha256(new TextEncoder().encode(`v-leaf-${i}`)))
}

function leafRefs(leaves: readonly Uint8Array[]): string[] {
  return leaves.map((l) => `sha256:${hexEncode(l)}`)
}

function rootRef(leaves: readonly Uint8Array[]): string {
  return `sha256:${hexEncode(computeRoot([...leaves]))}`
}

function checkpointRecord(
  checkpoint: SessionCheckpointBody | undefined,
  overrides: Partial<AtribRecord> = {},
): SessionCheckpointRecord {
  return {
    spec_version: 'atrib/1.0',
    content_id: `sha256:${'11'.repeat(32)}`,
    creator_key: 'k'.repeat(43),
    chain_root: `sha256:${'22'.repeat(32)}`,
    event_type: SESSION_CHECKPOINT_EVENT_TYPE_URI,
    context_id: CONTEXT,
    timestamp: 1_782_000_000_000,
    signature: 's'.repeat(86),
    ...(checkpoint !== undefined ? { checkpoint } : {}),
    ...overrides,
  } as SessionCheckpointRecord
}

function body(overrides: Partial<SessionCheckpointBody> = {}): SessionCheckpointBody {
  return {
    first_index: 0,
    session_root: `sha256:${ROOT_64}`,
    tree_size: 2,
    ...overrides,
  }
}

describe('validateSessionCheckpointStructural (§1.2.10 validator rules)', () => {
  it('accepts a well-formed first checkpoint and a linked continuation', () => {
    expect(validateSessionCheckpointStructural(checkpointRecord(body()))).toBeUndefined()
    expect(
      validateSessionCheckpointStructural(
        checkpointRecord(body({ first_index: 2, tree_size: 5, prior_checkpoint: PRIOR_REF })),
      ),
    ).toBeUndefined()
    expect(
      validateSessionCheckpointStructural(checkpointRecord(body({ retroactive: true }))),
    ).toBeUndefined()
  })

  it('enforces the required-on / forbidden-elsewhere presence discipline', () => {
    expect(validateSessionCheckpointStructural(checkpointRecord(undefined))).toBe(
      'checkpoint missing on session_checkpoint record',
    )
    expect(
      validateSessionCheckpointStructural(
        checkpointRecord(body(), { event_type: OBSERVATION_URI }),
      ),
    ).toBe('checkpoint on non-session_checkpoint event_type')
    // A plain observation without a checkpoint is out of scope entirely.
    expect(
      validateSessionCheckpointStructural(
        checkpointRecord(undefined, { event_type: OBSERVATION_URI }),
      ),
    ).toBeUndefined()
  })

  it('rejects malformed session_root forms', () => {
    for (const bad of ['', ROOT_64, `sha256:${ROOT_64.toUpperCase()}`, 'sha256:zz', undefined]) {
      expect(
        validateSessionCheckpointStructural(
          checkpointRecord(body({ session_root: bad as unknown as string })),
        ),
      ).toBe('malformed session_root')
    }
  })

  it('rejects tree_size and first_index violations', () => {
    expect(validateSessionCheckpointStructural(checkpointRecord(body({ tree_size: 0 })))).toBe(
      'tree_size < 1',
    )
    expect(validateSessionCheckpointStructural(checkpointRecord(body({ tree_size: 2.5 })))).toBe(
      'tree_size < 1',
    )
    expect(
      validateSessionCheckpointStructural(
        checkpointRecord(body({ tree_size: '2' as unknown as number })),
      ),
    ).toBe('tree_size < 1')
    expect(validateSessionCheckpointStructural(checkpointRecord(body({ first_index: -1 })))).toBe(
      'malformed first_index',
    )
    expect(validateSessionCheckpointStructural(checkpointRecord(body({ first_index: 0.5 })))).toBe(
      'malformed first_index',
    )
    expect(
      validateSessionCheckpointStructural(
        checkpointRecord(body({ first_index: 2, prior_checkpoint: PRIOR_REF })),
      ),
    ).toBe('first_index >= tree_size')
  })

  it('rejects prior_checkpoint coupling violations and malformed refs', () => {
    expect(
      validateSessionCheckpointStructural(
        checkpointRecord(body({ prior_checkpoint: PRIOR_REF })),
      ),
    ).toBe('prior_checkpoint present with first_index == 0')
    expect(
      validateSessionCheckpointStructural(
        checkpointRecord(body({ first_index: 1, tree_size: 3 })),
      ),
    ).toBe('prior_checkpoint absent with first_index > 0')
    expect(
      validateSessionCheckpointStructural(
        checkpointRecord(body({ first_index: 1, tree_size: 3, prior_checkpoint: 'bogus' })),
      ),
    ).toBe('malformed prior_checkpoint')
  })

  it('rejects retroactive: false (present-only-when-true)', () => {
    expect(
      validateSessionCheckpointStructural(checkpointRecord(body({ retroactive: false }))),
    ).toBe('retroactive: false emitted')
  })
})

describe('sessionCheckpointFreshness (§1.2.10.3)', () => {
  const leafTs = 1_782_000_000_000

  it('tiers exactly at the bound: within → contemporaneous, beyond → stale-undeclared', () => {
    const bound = DEFAULT_SESSION_CHECKPOINT_STALENESS_BOUND_MS
    const atBound = checkpointRecord(body(), { timestamp: leafTs + bound })
    expect(sessionCheckpointFreshness(atBound, leafTs)).toBe('contemporaneous')
    const pastBound = checkpointRecord(body(), { timestamp: leafTs + bound + 1 })
    expect(sessionCheckpointFreshness(pastBound, leafTs)).toBe('stale-undeclared')
  })

  it('declared-retroactive wins regardless of staleness', () => {
    const record = checkpointRecord(body({ retroactive: true }), {
      timestamp: leafTs + 90 * 24 * 60 * 60 * 1000,
    })
    expect(sessionCheckpointFreshness(record, leafTs)).toBe('declared-retroactive')
  })

  it('honors a custom bound', () => {
    const record = checkpointRecord(body(), { timestamp: leafTs + 5000 })
    expect(sessionCheckpointFreshness(record, leafTs, 4000)).toBe('stale-undeclared')
    expect(sessionCheckpointFreshness(record, leafTs, 6000)).toBe('contemporaneous')
  })
})

describe('verifySessionInclusionProof (punch-list: valid / wrong index / wrong root / truncated)', () => {
  const leaves = fakeLeaves(7)
  const refs = leafRefs(leaves)
  const root = rootRef(leaves)

  it('verifies a valid proof for every index (raw-byte and string-ref leaves)', () => {
    for (let index = 0; index < leaves.length; index++) {
      const proof = computeInclusionProof(index, leaves)
      expect(
        verifySessionInclusionProof({
          index,
          treeSize: leaves.length,
          recordHash: leaves[index]!,
          proof,
          sessionRoot: root,
        }),
      ).toBe(true)
      expect(
        verifySessionInclusionProof({
          index,
          treeSize: leaves.length,
          recordHash: refs[index]!,
          proof,
          sessionRoot: root,
        }),
      ).toBe(true)
    }
  })

  it('rejects the wrong index', () => {
    const proof = computeInclusionProof(3, leaves)
    for (const wrong of [0, 1, 2, 4, 5, 6]) {
      expect(
        verifySessionInclusionProof({
          index: wrong,
          treeSize: leaves.length,
          recordHash: leaves[3]!,
          proof,
          sessionRoot: root,
        }),
      ).toBe(false)
    }
  })

  it('rejects the wrong root', () => {
    const proof = computeInclusionProof(3, leaves)
    expect(
      verifySessionInclusionProof({
        index: 3,
        treeSize: leaves.length,
        recordHash: leaves[3]!,
        proof,
        sessionRoot: rootRef(fakeLeaves(6)),
      }),
    ).toBe(false)
  })

  it('rejects a truncated or padded path', () => {
    const proof = computeInclusionProof(3, leaves)
    expect(proof.length).toBeGreaterThan(1)
    expect(
      verifySessionInclusionProof({
        index: 3,
        treeSize: leaves.length,
        recordHash: leaves[3]!,
        proof: proof.slice(0, proof.length - 1),
        sessionRoot: root,
      }),
    ).toBe(false)
    expect(
      verifySessionInclusionProof({
        index: 3,
        treeSize: leaves.length,
        recordHash: leaves[3]!,
        proof: [...proof, sha256(new Uint8Array([7]))],
        sessionRoot: root,
      }),
    ).toBe(false)
  })

  it('never throws on malformed inputs', () => {
    const proof = computeInclusionProof(0, leaves)
    expect(
      verifySessionInclusionProof({
        index: -1,
        treeSize: leaves.length,
        recordHash: leaves[0]!,
        proof,
        sessionRoot: root,
      }),
    ).toBe(false)
    expect(
      verifySessionInclusionProof({
        index: leaves.length,
        treeSize: leaves.length,
        recordHash: leaves[0]!,
        proof,
        sessionRoot: root,
      }),
    ).toBe(false)
    expect(
      verifySessionInclusionProof({
        index: 0,
        treeSize: leaves.length,
        recordHash: 'not-a-ref',
        proof,
        sessionRoot: root,
      }),
    ).toBe(false)
    expect(
      verifySessionInclusionProof({
        index: 0,
        treeSize: leaves.length,
        recordHash: new Uint8Array(16),
        proof,
        sessionRoot: root,
      }),
    ).toBe(false)
    expect(
      verifySessionInclusionProof({
        index: 0,
        treeSize: leaves.length,
        recordHash: leaves[0]!,
        proof,
        sessionRoot: 'nope',
      }),
    ).toBe(false)
    expect(
      verifySessionInclusionProof({
        index: 0,
        treeSize: 0,
        recordHash: leaves[0]!,
        proof: [],
        sessionRoot: root,
      }),
    ).toBe(false)
  })
})

describe('verifySessionConsistencyProof negatives', () => {
  it('rejects malformed roots, out-of-range sizes, and non-empty identity proofs', () => {
    const leaves = fakeLeaves(4)
    const root = rootRef(leaves)
    expect(
      verifySessionConsistencyProof({
        firstTreeSize: 2,
        secondTreeSize: 4,
        firstRoot: 'garbage',
        secondRoot: root,
        proof: [],
      }),
    ).toBe(false)
    expect(
      verifySessionConsistencyProof({
        firstTreeSize: 0,
        secondTreeSize: 4,
        firstRoot: root,
        secondRoot: root,
        proof: [],
      }),
    ).toBe(false)
    expect(
      verifySessionConsistencyProof({
        firstTreeSize: 5,
        secondTreeSize: 4,
        firstRoot: root,
        secondRoot: root,
        proof: [],
      }),
    ).toBe(false)
    expect(
      verifySessionConsistencyProof({
        firstTreeSize: 4,
        secondTreeSize: 4,
        firstRoot: root,
        secondRoot: root,
        proof: [sha256(new Uint8Array([1]))],
      }),
    ).toBe(false)
    expect(
      verifySessionConsistencyProof({
        firstTreeSize: 4,
        secondTreeSize: 4,
        firstRoot: root,
        secondRoot: rootRef(fakeLeaves(3)),
        proof: [],
      }),
    ).toBe(false)
  })
})

describe('detectSessionCheckpointEquivocation scoping', () => {
  const leavesA = fakeLeaves(4)
  const leavesB = [...leavesA.slice(0, 3), sha256(new TextEncoder().encode('divergent'))]

  const a = checkpointRecord(
    body({ first_index: 2, tree_size: 4, prior_checkpoint: PRIOR_REF, session_root: rootRef(leavesA) }),
  )
  const b = checkpointRecord(
    body({ first_index: 2, tree_size: 4, prior_checkpoint: PRIOR_REF, session_root: rootRef(leavesB) }),
  )

  it('flags same key + same prior + same size + divergent roots', () => {
    const evidence = detectSessionCheckpointEquivocation(a, b)
    expect(evidence).toBeDefined()
    expect(evidence!.reason).toBe('divergent-roots-same-claim')
    expect(evidence!.prior_checkpoint).toBe(PRIOR_REF)
    expect(evidence!.first_record_hash).toBe(sessionCheckpointRecordHash(a))
  })

  it('stays quiet for different keys, contexts, disjoint claims, or equal roots', () => {
    expect(
      detectSessionCheckpointEquivocation(a, { ...b, creator_key: 'x'.repeat(43) }),
    ).toBeUndefined()
    expect(
      detectSessionCheckpointEquivocation(a, { ...b, context_id: 'cd'.repeat(16) }),
    ).toBeUndefined()
    expect(detectSessionCheckpointEquivocation(a, { ...a })).toBeUndefined()
    // Different prior AND non-overlapping ranges → not comparable claims.
    const disjoint = checkpointRecord(
      body({
        first_index: 4,
        tree_size: 6,
        prior_checkpoint: `sha256:${'aa'.repeat(32)}`,
        session_root: rootRef(fakeLeaves(6)),
      }),
    )
    // Ranges [2,3] and [4,5] do not overlap and priors differ.
    expect(detectSessionCheckpointEquivocation(a, disjoint)).toBeUndefined()
  })
})

describe('checkConsecutiveSessionCheckpoints (verifier-side)', () => {
  it('reports unlinked pairs without inventing equivocation', () => {
    const first = checkpointRecord(body({ session_root: rootRef(fakeLeaves(2)) }))
    const second = checkpointRecord(
      body({
        first_index: 3,
        tree_size: 5,
        prior_checkpoint: PRIOR_REF,
        session_root: rootRef(fakeLeaves(5)),
      }),
    )
    const check = checkConsecutiveSessionCheckpoints(first, second)
    expect(check.priorCheckpointMatches).toBe(false)
    expect(check.firstIndexMatchesPriorTreeSize).toBe(false)
    expect(check.consistencyProofVerifies).toBeUndefined()
    expect(check.appendOnly).toBeUndefined()
    expect(check.consistent).toBe(false)
    expect(check.equivocation).toBeUndefined()
  })

  it('flags a linked pair whose disclosed leaf prefix was rewritten', () => {
    const streamA = fakeLeaves(5)
    const firstBody = body({ tree_size: 2, session_root: rootRef(streamA.slice(0, 2)) })
    const first = checkpointRecord(firstBody)
    const firstHash = sessionCheckpointRecordHash(first)
    // Second checkpoint links correctly but its disclosed stream swaps the
    // first two leaves: the prefix is no longer identical.
    const rewritten = [streamA[1]!, streamA[0]!, ...streamA.slice(2)]
    const second = checkpointRecord(
      body({
        first_index: 2,
        tree_size: 5,
        prior_checkpoint: firstHash,
        session_root: rootRef(rewritten),
      }),
    )
    const check = checkConsecutiveSessionCheckpoints(first, second, {
      firstLeaves: leafRefs(streamA.slice(0, 2)),
      secondLeaves: leafRefs(rewritten),
    })
    expect(check.priorCheckpointMatches).toBe(true)
    expect(check.firstIndexMatchesPriorTreeSize).toBe(true)
    expect(check.firstRootRecomputes).toBe(true)
    expect(check.secondRootRecomputes).toBe(true)
    expect(check.appendOnly).toBe(false)
    expect(check.consistent).toBe(false)
    expect(check.equivocation).toBeDefined()
    expect(check.equivocation!.reason).toBe('append-only-violation')
  })
})

describe('verifySessionCheckpointRecord (composed)', () => {
  it('verifies a freshly signed checkpoint end to end and replays D099 commitments', async () => {
    const seed = Uint8Array.from({ length: 32 }, (_, i) => (i * 13 + 5) & 0xff)
    const creatorKey = base64urlEncode(await getPublicKey(seed))
    const leaves = fakeLeaves(3)
    const refs = leafRefs(leaves)
    const unsigned: SessionCheckpointRecord = {
      spec_version: 'atrib/1.0',
      content_id: `sha256:${hexEncode(sha256(new TextEncoder().encode('atrib:session_checkpoint')))}`,
      creator_key: creatorKey,
      chain_root: genesisChainRoot(CONTEXT),
      checkpoint: {
        first_index: 0,
        session_root: recomputeSessionRoot(refs),
        tree_size: 3,
      },
      event_type: SESSION_CHECKPOINT_EVENT_TYPE_URI,
      context_id: CONTEXT,
      timestamp: 1_782_000_100_000,
      args_hash: sessionCheckpointArgsHash(refs),
      signature: '',
    }
    const record = (await signRecord(unsigned, seed)) as SessionCheckpointRecord

    const verification = await verifySessionCheckpointRecord(record, {
      leaves: refs,
      maxCoveredLeafTimestamp: 1_782_000_000_000,
    })
    expect(verification.signatureOk).toBe(true)
    expect(verification.structuralRejection).toBeUndefined()
    expect(verification.rootMatchesLeaves).toBe(true)
    expect(verification.argsHashMatchesLeaves).toBe(true)
    expect(verification.freshness).toBe('contemporaneous')
    expect(verification.recordHash).toBe(sessionCheckpointRecordHash(record))

    // Wrong leaf order → root and args_hash both fail to replay.
    const reordered = [refs[1]!, refs[0]!, refs[2]!]
    const bad = await verifySessionCheckpointRecord(record, { leaves: reordered })
    expect(bad.signatureOk).toBe(true)
    expect(bad.rootMatchesLeaves).toBe(false)
    expect(bad.argsHashMatchesLeaves).toBe(false)
  })

  it('degrades without leaf material and never throws on garbage', async () => {
    const record = checkpointRecord(body())
    const verification = await verifySessionCheckpointRecord(record)
    expect(verification.signatureOk).toBe(false) // fake signature
    expect(verification.structuralRejection).toBeUndefined()
    expect(verification.rootMatchesLeaves).toBeUndefined()
    expect(verification.argsHashMatchesLeaves).toBeUndefined()
    expect(verification.freshness).toBeUndefined()

    const garbageLeaves = await verifySessionCheckpointRecord(record, {
      leaves: ['not-a-ref'],
      maxCoveredLeafTimestamp: 0,
    })
    expect(garbageLeaves.rootMatchesLeaves).toBe(false)
  })
})
