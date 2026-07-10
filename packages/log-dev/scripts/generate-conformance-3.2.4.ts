// SPDX-License-Identifier: Apache-2.0

/**
 * Generate spec §3.2.4 full edge-derivation conformance fixtures.
 *
 * Run with:
 *   pnpm --filter @atrib/log-dev exec tsx scripts/generate-conformance-3.2.4.ts
 *
 * Output: spec/conformance/3.2.4/cases/*.json + manifest.json
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import {
  SESSION_CHECKPOINT_EVENT_TYPE_URI,
  base64urlEncode,
  buildCheckpointBody,
  canonicalRecord,
  genesisChainRoot,
  getPublicKey,
  hexEncode,
  sha256,
  signRecord,
  type AtribRecord,
  type SessionCheckpoint,
} from '@atrib/mcp'

const ALICE_SEED = new Uint8Array(32).fill(0x11)
const BOB_SEED = new Uint8Array(32).fill(0x22)
const REFERENCE_TIME_MS = Date.UTC(2026, 0, 1, 0, 0, 0)
const HERE = dirname(fileURLToPath(import.meta.url))
const CORPUS_ROOT = resolve(HERE, '../../../spec/conformance/3.2.4')
const CASES_DIR = join(CORPUS_ROOT, 'cases')

type EdgeType =
  | 'CHAIN_PRECEDES'
  | 'SESSION_PRECEDES'
  | 'SESSION_PARALLEL'
  | 'CONVERGES_ON'
  | 'CROSS_SESSION'
  | 'INFORMED_BY'
  | 'PROVENANCE_OF'
  | 'ANNOTATES'
  | 'REVISES'

interface ExpectedEdge {
  type: EdgeType
  source_record_index: number
  target_record_index?: number
  target_node_id?: string
  directed: boolean
  dangling?: boolean
  reference_status?: 'unresolved' | 'external' | 'missing'
  reference_hash?: string
  reference_token?: string
  reason?: string
}

type GraphConformanceRecord = AtribRecord & { checkpoint?: SessionCheckpoint }

interface CaseBody {
  name: string
  spec_section: '3.2.4'
  description: string
  input: {
    records: GraphConformanceRecord[]
    options?: {
      includeCrossSession?: boolean
      compactIntraSessionEdges?: boolean
    }
  }
  expected: {
    edges: ExpectedEdge[]
    edge_count_by_type: Record<EdgeType, number>
    calculation_input_record_indices?: number[]
  }
}

function zeroCounts(): Record<EdgeType, number> {
  return {
    CHAIN_PRECEDES: 0,
    SESSION_PRECEDES: 0,
    SESSION_PARALLEL: 0,
    CONVERGES_ON: 0,
    CROSS_SESSION: 0,
    INFORMED_BY: 0,
    PROVENANCE_OF: 0,
    ANNOTATES: 0,
    REVISES: 0,
  }
}

function countEdges(edges: ExpectedEdge[]): Record<EdgeType, number> {
  const counts = zeroCounts()
  for (const edge of edges) counts[edge.type]++
  return counts
}

function recordHash(record: GraphConformanceRecord): string {
  return hexEncode(sha256(canonicalRecord(record)))
}

function token16(record: GraphConformanceRecord): string {
  return base64urlEncode(sha256(canonicalRecord(record)).slice(0, 16))
}

function contentId(label: string): string {
  return `sha256:${label.padEnd(64, '0')}`
}

async function makeRecord(opts: {
  contextId: string
  timestamp: number
  contentId: string
  eventType?: string
  chainRoot?: string
  sessionToken?: string
  informedBy?: string[]
  provenanceToken?: string
  annotates?: string
  revises?: string
  checkpoint?: SessionCheckpoint
  seed?: Uint8Array
}): Promise<GraphConformanceRecord> {
  const seed = opts.seed ?? ALICE_SEED
  const pubkey = await getPublicKey(seed)
  const record = {
    spec_version: 'atrib/1.0' as const,
    ...(opts.annotates ? { annotates: opts.annotates } : {}),
    ...(opts.checkpoint ? { checkpoint: opts.checkpoint } : {}),
    content_id: opts.contentId,
    creator_key: base64urlEncode(pubkey),
    chain_root: opts.chainRoot ?? genesisChainRoot(opts.contextId),
    event_type: opts.eventType ?? 'https://atrib.dev/v1/types/tool_call',
    context_id: opts.contextId,
    timestamp: opts.timestamp,
    signature: '',
    ...(opts.informedBy ? { informed_by: opts.informedBy } : {}),
    ...(opts.provenanceToken ? { provenance_token: opts.provenanceToken } : {}),
    ...(opts.revises ? { revises: opts.revises } : {}),
    ...(opts.sessionToken ? { session_token: opts.sessionToken } : {}),
  } satisfies GraphConformanceRecord
  return (await signRecord(record, seed)) as GraphConformanceRecord
}

function caseBody(opts: {
  name: string
  description: string
  records: GraphConformanceRecord[]
  edges: ExpectedEdge[]
  calculationInputRecordIndices?: number[]
  options?: CaseBody['input']['options']
}): CaseBody {
  return {
    name: opts.name,
    spec_section: '3.2.4',
    description: opts.description,
    input: { records: opts.records, ...(opts.options ? { options: opts.options } : {}) },
    expected: {
      edges: opts.edges,
      edge_count_by_type: countEdges(opts.edges),
      ...(opts.calculationInputRecordIndices
        ? { calculation_input_record_indices: opts.calculationInputRecordIndices }
        : {}),
    },
  }
}

async function allNineEdgeTypes(): Promise<CaseBody> {
  const sessionToken = 'edge-derivation-session-token'
  const ctxA = 'a'.repeat(32)
  const ctxB = 'b'.repeat(32)

  const txA = await makeRecord({
    contextId: ctxA,
    eventType: 'https://atrib.dev/v1/types/transaction',
    timestamp: REFERENCE_TIME_MS + 1000,
    contentId: contentId('01'),
    sessionToken,
  })
  const toolA1 = await makeRecord({
    contextId: ctxA,
    timestamp: REFERENCE_TIME_MS + 1500,
    contentId: contentId('02'),
  })
  const toolA1Hash = recordHash(toolA1)
  const toolA2 = await makeRecord({
    contextId: ctxA,
    timestamp: REFERENCE_TIME_MS + 2000,
    contentId: contentId('03'),
    chainRoot: `sha256:${toolA1Hash}`,
  })
  const toolB = await makeRecord({
    contextId: ctxB,
    timestamp: REFERENCE_TIME_MS + 3000,
    contentId: contentId('04'),
    sessionToken,
    informedBy: [`sha256:${toolA1Hash}`],
  })
  const genB = await makeRecord({
    contextId: 'd'.repeat(32),
    timestamp: REFERENCE_TIME_MS + 4000,
    contentId: contentId('05'),
    provenanceToken: token16(txA),
  })
  const toolB2 = await makeRecord({
    contextId: ctxB,
    timestamp: REFERENCE_TIME_MS + 3500,
    contentId: contentId('06'),
  })
  const toolB3 = await makeRecord({
    contextId: ctxB,
    timestamp: REFERENCE_TIME_MS + 3500,
    contentId: contentId('07'),
  })
  const txAHash = recordHash(txA)
  const annotation = await makeRecord({
    contextId: 'e'.repeat(32),
    eventType: 'https://atrib.dev/v1/types/annotation',
    timestamp: REFERENCE_TIME_MS + 5000,
    contentId: contentId('08'),
    annotates: `sha256:${txAHash}`,
  })
  const revision = await makeRecord({
    contextId: 'f'.repeat(32),
    eventType: 'https://atrib.dev/v1/types/revision',
    timestamp: REFERENCE_TIME_MS + 6000,
    contentId: contentId('09'),
    revises: `sha256:${toolA1Hash}`,
  })

  const records = [txA, toolA1, toolA2, toolB, genB, toolB2, toolB3, annotation, revision]
  const edges: ExpectedEdge[] = [
    { type: 'CHAIN_PRECEDES', source_record_index: 1, target_record_index: 2, directed: true },
    { type: 'SESSION_PRECEDES', source_record_index: 0, target_record_index: 1, directed: true },
    { type: 'SESSION_PRECEDES', source_record_index: 0, target_record_index: 2, directed: true },
    { type: 'SESSION_PRECEDES', source_record_index: 3, target_record_index: 5, directed: true },
    { type: 'SESSION_PRECEDES', source_record_index: 3, target_record_index: 6, directed: true },
    { type: 'SESSION_PARALLEL', source_record_index: 5, target_record_index: 6, directed: false },
    { type: 'CONVERGES_ON', source_record_index: 1, target_record_index: 0, directed: true },
    { type: 'CONVERGES_ON', source_record_index: 2, target_record_index: 0, directed: true },
    { type: 'CROSS_SESSION', source_record_index: 3, target_record_index: 0, directed: true },
    { type: 'INFORMED_BY', source_record_index: 3, target_record_index: 1, directed: true },
    { type: 'PROVENANCE_OF', source_record_index: 4, target_record_index: 0, directed: true },
    { type: 'ANNOTATES', source_record_index: 7, target_record_index: 0, directed: true },
    { type: 'REVISES', source_record_index: 8, target_record_index: 1, directed: true },
  ]

  return caseBody({
    name: 'all-nine-edge-types',
    description:
      'A single fixture that exercises every normative §3.2.4 edge type in full derivation mode. This is the language-neutral smoke test for the complete graph substrate.',
    records,
    edges,
  })
}

async function fullPairwiseSessionPrecedes(): Promise<CaseBody> {
  const ctx = '1'.repeat(32)
  const records = await Promise.all(
    Array.from({ length: 4 }, (_, i) =>
      makeRecord({
        contextId: ctx,
        timestamp: REFERENCE_TIME_MS + i,
        contentId: contentId(`1${i}`),
      }),
    ),
  )
  const edges: ExpectedEdge[] = []
  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      edges.push({
        type: 'SESSION_PRECEDES',
        source_record_index: i,
        target_record_index: j,
        directed: true,
      })
    }
  }
  return caseBody({
    name: 'full-pairwise-session-precedes',
    description:
      'Four isolated records in one context with strictly increasing timestamps. Full §3.2.4 derivation emits every pairwise SESSION_PRECEDES edge, not the compact adjacent-only form.',
    records,
    edges,
  })
}

async function equalTimestampParallelAllPairs(): Promise<CaseBody> {
  const ctx = '2'.repeat(32)
  const records = await Promise.all(
    Array.from({ length: 4 }, (_, i) =>
      makeRecord({
        contextId: ctx,
        timestamp: REFERENCE_TIME_MS,
        contentId: contentId(`2${i}`),
      }),
    ),
  )
  const edges: ExpectedEdge[] = []
  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      edges.push({
        type: 'SESSION_PARALLEL',
        source_record_index: i,
        target_record_index: j,
        directed: false,
      })
    }
  }
  return caseBody({
    name: 'equal-timestamp-parallel-all-pairs',
    description:
      'Four isolated records in one context with equal timestamps. Full §3.2.4 derivation emits every pairwise SESSION_PARALLEL edge and no SESSION_PRECEDES edges.',
    records,
    edges,
  })
}

async function danglingClaimEdges(): Promise<CaseBody> {
  const missingInformed = `sha256:${'d1'.repeat(32)}`
  const missingAnnotates = `sha256:${'d2'.repeat(32)}`
  const missingRevises = `sha256:${'d3'.repeat(32)}`
  const missingToken = 'AAAAAAAAAAAAAAAAAAAAAA'
  const records = [
    await makeRecord({
      contextId: '3'.repeat(32),
      timestamp: REFERENCE_TIME_MS,
      contentId: contentId('30'),
      informedBy: [missingInformed],
    }),
    await makeRecord({
      contextId: '4'.repeat(32),
      eventType: 'https://atrib.dev/v1/types/annotation',
      timestamp: REFERENCE_TIME_MS + 1,
      contentId: contentId('40'),
      annotates: missingAnnotates,
    }),
    await makeRecord({
      contextId: '5'.repeat(32),
      eventType: 'https://atrib.dev/v1/types/revision',
      timestamp: REFERENCE_TIME_MS + 2,
      contentId: contentId('50'),
      revises: missingRevises,
    }),
    await makeRecord({
      contextId: '6'.repeat(32),
      timestamp: REFERENCE_TIME_MS + 3,
      contentId: contentId('60'),
      provenanceToken: missingToken,
    }),
  ]
  const edges: ExpectedEdge[] = [
    {
      type: 'INFORMED_BY',
      source_record_index: 0,
      target_node_id: `dangling:${missingInformed}`,
      directed: true,
      dangling: true,
      reference_status: 'unresolved',
      reference_hash: missingInformed,
    },
    {
      type: 'PROVENANCE_OF',
      source_record_index: 3,
      target_node_id: `dangling:provenance:${missingToken}`,
      directed: true,
      dangling: true,
      reference_status: 'unresolved',
      reference_token: missingToken,
      reason: 'no_token_source_in_record_set',
    },
    {
      type: 'ANNOTATES',
      source_record_index: 1,
      target_node_id: `dangling:${missingAnnotates}`,
      directed: true,
      dangling: true,
      reference_status: 'unresolved',
      reference_hash: missingAnnotates,
    },
    {
      type: 'REVISES',
      source_record_index: 2,
      target_node_id: `dangling:${missingRevises}`,
      directed: true,
      dangling: true,
      reference_status: 'unresolved',
      reference_hash: missingRevises,
    },
  ]
  return caseBody({
    name: 'dangling-claim-edges',
    description:
      'Producer-declared references that do not resolve inside the record set still produce dangling INFORMED_BY, PROVENANCE_OF, ANNOTATES, and REVISES edges so the signed claim stays visible.',
    records,
    edges,
  })
}

async function sessionCheckpointChainSpine(): Promise<CaseBody> {
  const contextId = '7'.repeat(32)
  const firstTool = await makeRecord({
    contextId,
    timestamp: REFERENCE_TIME_MS,
    contentId: contentId('70'),
  })
  const firstToolHash = recordHash(firstTool)
  const checkpoint = await makeRecord({
    contextId,
    timestamp: REFERENCE_TIME_MS + 1,
    contentId: contentId('71'),
    eventType: SESSION_CHECKPOINT_EVENT_TYPE_URI,
    chainRoot: `sha256:${firstToolHash}`,
    checkpoint: buildCheckpointBody({
      recordHashes: [sha256(canonicalRecord(firstTool))],
      firstIndex: 0,
    }),
    seed: BOB_SEED,
  })
  const checkpointHash = recordHash(checkpoint)
  const secondTool = await makeRecord({
    contextId,
    timestamp: REFERENCE_TIME_MS + 2,
    contentId: contentId('72'),
    chainRoot: `sha256:${checkpointHash}`,
  })
  const secondToolHash = recordHash(secondTool)
  const transaction = await makeRecord({
    contextId,
    timestamp: REFERENCE_TIME_MS + 3,
    contentId: contentId('73'),
    eventType: 'https://atrib.dev/v1/types/transaction',
    chainRoot: `sha256:${secondToolHash}`,
  })

  const records = [firstTool, checkpoint, secondTool, transaction]
  const edges: ExpectedEdge[] = [
    { type: 'CHAIN_PRECEDES', source_record_index: 0, target_record_index: 1, directed: true },
    { type: 'CHAIN_PRECEDES', source_record_index: 1, target_record_index: 2, directed: true },
    { type: 'CHAIN_PRECEDES', source_record_index: 2, target_record_index: 3, directed: true },
    { type: 'SESSION_PRECEDES', source_record_index: 0, target_record_index: 2, directed: true },
    { type: 'SESSION_PRECEDES', source_record_index: 0, target_record_index: 3, directed: true },
    { type: 'SESSION_PRECEDES', source_record_index: 1, target_record_index: 3, directed: true },
    { type: 'CONVERGES_ON', source_record_index: 0, target_record_index: 3, directed: true },
    { type: 'CONVERGES_ON', source_record_index: 2, target_record_index: 3, directed: true },
  ]

  return caseBody({
    name: 'session-checkpoint-chain-spine',
    description:
      'A session_checkpoint links the surrounding records through CHAIN_PRECEDES but does not converge on the transaction and does not enter the calculation input projection.',
    records,
    edges,
    calculationInputRecordIndices: [0, 2],
  })
}

async function main(): Promise<void> {
  mkdirSync(CASES_DIR, { recursive: true })

  const cases = [
    await allNineEdgeTypes(),
    await fullPairwiseSessionPrecedes(),
    await equalTimestampParallelAllPairs(),
    await danglingClaimEdges(),
    await sessionCheckpointChainSpine(),
  ]

  for (const c of cases) {
    writeFileSync(join(CASES_DIR, `${c.name}.json`), JSON.stringify(c, null, 2) + '\n')
  }

  const manifest = {
    spec_section: '3.2.4',
    spec_title: 'Full edge derivation rules',
    decision_link: 'D101',
    generated_at: REFERENCE_TIME_MS,
    generator: 'packages/log-dev/scripts/generate-conformance-3.2.4.ts',
    cases: cases.map((c) => ({ file: `cases/${c.name}.json`, name: c.name })),
    keys: {
      alice_pubkey: base64urlEncode(await getPublicKey(ALICE_SEED)),
      bob_pubkey: base64urlEncode(await getPublicKey(BOB_SEED)),
    },
    note: 'Full §3.2.4 corpus covering all nine edge types, all-pairs SESSION_PRECEDES, all-pairs SESSION_PARALLEL, dangling producer-declared references, and session_checkpoint chain-spine-only behavior. The companion graph-node property tests exercise generated families of ordered, equal-timestamp, chained, compacted, and input-order-invariant record sets.',
  }
  writeFileSync(join(CORPUS_ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')

  console.log(`generated ${cases.length} cases at ${CORPUS_ROOT}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
