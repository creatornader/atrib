// SPDX-License-Identifier: Apache-2.0

/**
 * Generate spec §3.4.1.1 conformance corpus fixtures (intra-session edge
 * compaction).
 *
 * Run with: pnpm --filter @atrib/log-dev exec tsx scripts/generate-conformance-3.4.1.ts
 *
 * Output: spec/conformance/3.4.1/cases/*.json + manifest.json
 *
 * §3.4.1.1 introduces an information-preserving reduction to the
 * SESSION_PRECEDES (§3.2.4 step 2) and SESSION_PARALLEL (§3.2.4 step 3)
 * derivation that any /v1/graph/<context_id> implementation MAY apply
 * (and the reference implementation enables by default). The corpus
 * exercises the four load-bearing properties:
 *
 *   1. Chain-component skip (fully-chained). When N records form a
 *      single CHAIN_PRECEDES connected component, NO SESSION_PRECEDES
 *      or SESSION_PARALLEL edges emit between them — the chain already
 *      encodes the temporal order.
 *   2. Adjacent-only emission (fully-unchained). When N records share
 *      a context_id but no chain links exist between them, only
 *      consecutive-in-time pairs emit SESSION_PRECEDES (N-1 edges,
 *      down from N*(N-1)/2 in the all-pairs derivation).
 *   3. Mixed (two chains, one context). Records split across multiple
 *      CHAIN_PRECEDES connected components emit SESSION_PRECEDES only
 *      at chain-component boundaries when consecutive in time.
 *   4. Equal-timestamp SESSION_PARALLEL across chain components.
 *      Records with equal timestamps in different chain components
 *      emit a single SESSION_PARALLEL edge; records with equal
 *      timestamps inside the same chain component do not.
 *
 * Compaction is information-preserving with respect to the partial
 * order over the resolved record set: any "happens-before" relation
 * derivable from the full pairwise edge set remains derivable from
 * the compacted edge set plus CHAIN_PRECEDES transitivity. Cross-
 * implementation conformance therefore admits both the full and the
 * compacted output as valid responses to ?compact=false / ?compact=true.
 *
 * Seeds and timestamps are hardcoded so successive regenerations
 * produce byte-identical files. Re-run when:
 *   - §3.4.1.1 compaction rule changes
 *   - §3.2.4 step 2 / step 3 derivation changes
 *   - canonical record format (§1.2 / §1.3) changes
 *   - new test cases are needed
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import {
  base64urlEncode,
  canonicalRecord,
  genesisChainRoot,
  getPublicKey,
  hexEncode,
  signRecord,
  type AtribRecord,
} from '@atrib/mcp'
import { sha256 } from '@noble/hashes/sha2.js'

const ALICE_SEED = new Uint8Array(32).fill(0x11)
const REFERENCE_TIME_MS = Date.UTC(2026, 0, 1, 0, 0, 0)
const CTX = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

const HERE = dirname(fileURLToPath(import.meta.url))
const SPEC_ROOT = resolve(HERE, '../../..')
const CASES_DIR = join(SPEC_ROOT, 'spec', 'conformance', '3.4.1', 'cases')

interface ExpectedEdge {
  type: 'CHAIN_PRECEDES' | 'SESSION_PRECEDES' | 'SESSION_PARALLEL'
  source_record_index: number
  target_record_index: number
  directed: boolean
}

interface Case {
  name: string
  description: string
  input: {
    records: AtribRecord[]
    compact: boolean
  }
  expected: {
    edges: ExpectedEdge[]
    edge_count_by_type: Record<string, number>
  }
}

async function makeRecord(opts: {
  contextId: string
  chainRoot: string
  timestamp: number
  contentId: string
}): Promise<AtribRecord> {
  const pub = await getPublicKey(ALICE_SEED)
  const record = {
    spec_version: 'atrib/1.0' as const,
    content_id: opts.contentId,
    creator_key: base64urlEncode(pub),
    chain_root: opts.chainRoot,
    event_type: 'https://atrib.dev/v1/types/tool_call',
    context_id: opts.contextId,
    timestamp: opts.timestamp,
    signature: '',
  }
  return signRecord(record, ALICE_SEED)
}

function recordHash(record: AtribRecord): string {
  return hexEncode(sha256(canonicalRecord(record)))
}

async function buildLinearChain(n: number, startTs: number, label: string) {
  const records: AtribRecord[] = []
  const first = await makeRecord({
    contextId: CTX,
    chainRoot: genesisChainRoot(CTX),
    timestamp: startTs,
    contentId: `sha256:${(label + '00').padEnd(64, '0')}`,
  })
  records.push(first)
  let prev = recordHash(first)
  for (let i = 1; i < n; i++) {
    const r = await makeRecord({
      contextId: CTX,
      chainRoot: `sha256:${prev}`,
      timestamp: startTs + i,
      contentId: `sha256:${(label + i.toString().padStart(2, '0')).padEnd(64, '0')}`,
    })
    records.push(r)
    prev = recordHash(r)
  }
  return records
}

async function buildIsolatedGenesis(n: number, startTs: number, label: string) {
  const records: AtribRecord[] = []
  for (let i = 0; i < n; i++) {
    records.push(await makeRecord({
      contextId: CTX,
      chainRoot: genesisChainRoot(CTX),
      timestamp: startTs + i,
      contentId: `sha256:${(label + i.toString().padStart(2, '0')).padEnd(64, '0')}`,
    }))
  }
  return records
}

async function caseFullyChained(): Promise<Case> {
  const records = await buildLinearChain(5, REFERENCE_TIME_MS, 'aa')
  const edges: ExpectedEdge[] = []
  for (let i = 1; i < records.length; i++) {
    edges.push({
      type: 'CHAIN_PRECEDES',
      source_record_index: i - 1,
      target_record_index: i,
      directed: true,
    })
  }
  return {
    name: 'fully-chained-skip-redundant',
    description:
      'Five records forming one CHAIN_PRECEDES connected component within a single context_id. Compact derivation per §3.4.1.1 emits the four CHAIN_PRECEDES links and zero SESSION_PRECEDES / SESSION_PARALLEL edges (the chain already encodes the temporal order; additional intra-component edges would carry no information).',
    input: { records, compact: true },
    expected: {
      edges,
      edge_count_by_type: {
        CHAIN_PRECEDES: 4,
        SESSION_PRECEDES: 0,
        SESSION_PARALLEL: 0,
      },
    },
  }
}

async function caseFullyUnchained(): Promise<Case> {
  const records = await buildIsolatedGenesis(5, REFERENCE_TIME_MS, 'bb')
  const edges: ExpectedEdge[] = []
  // Sorted by timestamp ascending; emit one SESSION_PRECEDES per consecutive pair.
  for (let i = 0; i < records.length - 1; i++) {
    edges.push({
      type: 'SESSION_PRECEDES',
      source_record_index: i,
      target_record_index: i + 1,
      directed: true,
    })
  }
  return {
    name: 'fully-unchained-adjacent-only',
    description:
      'Five isolated-genesis records sharing one context_id with no chain links between them. Compact derivation per §3.4.1.1 emits SESSION_PRECEDES only between consecutive-in-time pairs (4 edges), down from N*(N-1)/2 = 10 in the all-pairs derivation. The transitive ordering is implied by the emitted adjacent edges.',
    input: { records, compact: true },
    expected: {
      edges,
      edge_count_by_type: {
        CHAIN_PRECEDES: 0,
        SESSION_PRECEDES: 4,
        SESSION_PARALLEL: 0,
      },
    },
  }
}

async function caseMixedChains(): Promise<Case> {
  // Two parallel chains in the same context_id.
  // Chain A: timestamps 1000..1002 (3 records).
  // Chain B: timestamps 2000..2002 (3 records).
  // Time-sorted order: A0, A1, A2, B0, B1, B2.
  // Expected SESSION_PRECEDES at boundary: A2 → B0 (different chain components,
  // adjacent in time). All other adjacencies are within a chain component
  // and skipped (CHAIN_PRECEDES already encodes them).
  const chainA = await buildLinearChain(3, REFERENCE_TIME_MS + 1000, 'a0')
  const chainB = await buildLinearChain(3, REFERENCE_TIME_MS + 2000, 'b0')
  const records = [...chainA, ...chainB]
  const edges: ExpectedEdge[] = []
  // CHAIN_PRECEDES: 2 per chain.
  edges.push({ type: 'CHAIN_PRECEDES', source_record_index: 0, target_record_index: 1, directed: true })
  edges.push({ type: 'CHAIN_PRECEDES', source_record_index: 1, target_record_index: 2, directed: true })
  edges.push({ type: 'CHAIN_PRECEDES', source_record_index: 3, target_record_index: 4, directed: true })
  edges.push({ type: 'CHAIN_PRECEDES', source_record_index: 4, target_record_index: 5, directed: true })
  // SESSION_PRECEDES: A's tail → B's head (cross-component adjacency in time).
  edges.push({ type: 'SESSION_PRECEDES', source_record_index: 2, target_record_index: 3, directed: true })
  return {
    name: 'mixed-chains-cross-component-only',
    description:
      'Two parallel chains in the same context_id (3 records each). Compact derivation emits the four CHAIN_PRECEDES links plus exactly one SESSION_PRECEDES at the cross-component boundary (chain A tail → chain B head), since those are the only consecutive-in-time pairs sitting in different chain-connected-components. All other consecutive pairs are within a single chain component and skipped.',
    input: { records, compact: true },
    expected: {
      edges,
      edge_count_by_type: {
        CHAIN_PRECEDES: 4,
        SESSION_PRECEDES: 1,
        SESSION_PARALLEL: 0,
      },
    },
  }
}

async function caseEqualTimestampParallel(): Promise<Case> {
  // Two unchained-genesis records sharing a single context_id and a single
  // timestamp. Expected:
  //   CHAIN_PRECEDES: 0 (no chain links).
  //   SESSION_PRECEDES: 0 (no records with non-equal timestamps to bridge).
  //   SESSION_PARALLEL: 1 (a0 ↔ b0, equal ts, different chain components —
  //     each genesis record is its own chain-connected-component since
  //     CHAIN_PRECEDES Step 1 skips genesis records).
  //
  // This shape is deterministic regardless of hash-tiebreak ordering in
  // the time-sort: the compact-mode adjacent walk (step 2) skips the
  // equal-timestamp pair, and step 3's byTs grouping puts a0 and b0
  // in the same equal-timestamp bucket. The single emitted edge is
  // undirected, so orientation is irrelevant.
  const a0 = await makeRecord({
    contextId: CTX,
    chainRoot: genesisChainRoot(CTX),
    timestamp: REFERENCE_TIME_MS + 5000,
    contentId: `sha256:${('aa' + '00').padEnd(64, '0')}`,
  })
  const b0 = await makeRecord({
    contextId: CTX,
    chainRoot: genesisChainRoot(CTX),
    timestamp: REFERENCE_TIME_MS + 5000,
    contentId: `sha256:${('bb' + '00').padEnd(64, '0')}`,
  })
  const records = [a0, b0]
  const edges: ExpectedEdge[] = [
    { type: 'SESSION_PARALLEL', source_record_index: 0, target_record_index: 1, directed: false },
  ]
  return {
    name: 'equal-timestamp-parallel-cross-component',
    description:
      'Two unchained-genesis records sharing one context_id and one timestamp. Compact derivation emits one SESSION_PARALLEL edge (equal timestamp, different chain components) and zero SESSION_PRECEDES edges (no records at distinct timestamps to bridge). The shape is deterministic regardless of any hash-tiebreak order applied to the time-sort.',
    input: { records, compact: true },
    expected: {
      edges,
      edge_count_by_type: {
        CHAIN_PRECEDES: 0,
        SESSION_PRECEDES: 0,
        SESSION_PARALLEL: 1,
      },
    },
  }
}

async function main() {
  mkdirSync(CASES_DIR, { recursive: true })

  const cases = [
    await caseFullyChained(),
    await caseFullyUnchained(),
    await caseMixedChains(),
    await caseEqualTimestampParallel(),
  ]

  for (const c of cases) {
    const path = join(CASES_DIR, `${c.name}.json`)
    writeFileSync(path, JSON.stringify(c, null, 2) + '\n', 'utf8')
    console.log(`wrote ${c.name} (${c.expected.edges.length} expected edges)`)
  }

  const manifest = {
    spec_section: '3.4.1.1',
    spec_title: 'Intra-session edge compaction',
    decision_link: '§3.4.1.1 (default-on for /v1/graph/<context_id>)',
    generated_at: REFERENCE_TIME_MS,
    generator: 'packages/log-dev/scripts/generate-conformance-3.4.1.ts',
    cases: cases.map((c) => ({ file: `cases/${c.name}.json`, name: c.name })),
    keys: {
      alice_pubkey: base64urlEncode(await getPublicKey(ALICE_SEED)),
    },
    note:
      "Compaction is information-preserving with respect to the partial order over the resolved record set; ?compact=false MUST also accept the same input records and produce the full all-pairs derivation per §3.2.4 steps 2-3. The corpus only enumerates the compacted edge set; full-derivation conformance is covered by spec/conformance/3.2.4-style cross-implementation tests.",
  }
  writeFileSync(join(SPEC_ROOT, 'spec', 'conformance', '3.4.1', 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  console.log(`wrote manifest.json with ${cases.length} cases`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
