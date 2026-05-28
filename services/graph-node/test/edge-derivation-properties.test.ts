// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  base64urlEncode,
  canonicalRecord,
  genesisChainRoot,
  getPublicKey,
  hexEncode,
  sha256,
  signRecord,
  type AtribRecord,
} from '@atrib/mcp'
import { buildGraph } from '../src/graph-builder.js'

const TEST_KEY = new Uint8Array(32).fill(0x5a)
const CONTEXT_ID = '7'.repeat(32)
const BASE_TS = Date.UTC(2026, 0, 1, 0, 0, 0)

function choose2(n: number): number {
  return (n * (n - 1)) / 2
}

function contentIdFor(index: number): string {
  return `sha256:${index.toString(16).padStart(2, '0').repeat(32)}`
}

async function makeRecord(opts: {
  index: number
  chainRoot?: string
  timestamp: number
}): Promise<AtribRecord> {
  const pubkey = await getPublicKey(TEST_KEY)
  return signRecord(
    {
      spec_version: 'atrib/1.0',
      content_id: contentIdFor(opts.index),
      creator_key: base64urlEncode(pubkey),
      chain_root: opts.chainRoot ?? genesisChainRoot(CONTEXT_ID),
      event_type: 'https://atrib.dev/v1/types/tool_call',
      context_id: CONTEXT_ID,
      timestamp: opts.timestamp,
      signature: '',
    },
    TEST_KEY,
  )
}

function edgeCount(records: Awaited<ReturnType<typeof buildGraph>>['edges'], type: string): number {
  return records.filter((e) => e.type === type).length
}

function graphEdgeSet(records: Awaited<ReturnType<typeof buildGraph>>['edges']): string[] {
  return records.map((e) => `${e.type}|${e.directed}|${e.source}|${e.target}`).sort()
}

describe('§3.2.4 edge derivation properties', () => {
  it('full derivation emits all pairwise SESSION_PRECEDES edges for isolated ordered records', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 2, max: 8 }), async (n) => {
        const records = await Promise.all(
          Array.from({ length: n }, (_, i) => makeRecord({ index: i, timestamp: BASE_TS + i })),
        )
        const graph = await buildGraph(records)

        expect(edgeCount(graph.edges, 'CHAIN_PRECEDES')).toBe(0)
        expect(edgeCount(graph.edges, 'SESSION_PRECEDES')).toBe(choose2(n))
        expect(edgeCount(graph.edges, 'SESSION_PARALLEL')).toBe(0)
      }),
      { numRuns: 20 },
    )
  })

  it('full derivation emits all pairwise SESSION_PARALLEL edges for equal timestamps', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 2, max: 8 }), async (n) => {
        const records = await Promise.all(
          Array.from({ length: n }, (_, i) => makeRecord({ index: i, timestamp: BASE_TS })),
        )
        const graph = await buildGraph(records)

        expect(edgeCount(graph.edges, 'CHAIN_PRECEDES')).toBe(0)
        expect(edgeCount(graph.edges, 'SESSION_PRECEDES')).toBe(0)
        expect(edgeCount(graph.edges, 'SESSION_PARALLEL')).toBe(choose2(n))
      }),
      { numRuns: 20 },
    )
  })

  it('linear chains keep immediate chain edges and compact mode drops redundant session edges', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 2, max: 8 }), async (n) => {
        const records: AtribRecord[] = []
        let chainRoot = genesisChainRoot(CONTEXT_ID)
        for (let i = 0; i < n; i++) {
          const record = await makeRecord({
            index: i,
            chainRoot,
            timestamp: BASE_TS + i,
          })
          records.push(record)
          chainRoot = `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
        }

        const full = await buildGraph(records)
        const compact = await buildGraph(records, [], { compactIntraSessionEdges: true })

        expect(edgeCount(full.edges, 'CHAIN_PRECEDES')).toBe(n - 1)
        expect(edgeCount(full.edges, 'SESSION_PRECEDES')).toBe(choose2(n) - (n - 1))
        expect(edgeCount(compact.edges, 'CHAIN_PRECEDES')).toBe(n - 1)
        expect(edgeCount(compact.edges, 'SESSION_PRECEDES')).toBe(0)
      }),
      { numRuns: 20 },
    )
  })

  it('input order does not change the derived full edge set', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 3, max: 8 }), async (n) => {
        const records = await Promise.all(
          Array.from({ length: n }, (_, i) => makeRecord({ index: i, timestamp: BASE_TS + i })),
        )
        const shuffled = [...records].reverse()

        const graphA = await buildGraph(records)
        const graphB = await buildGraph(shuffled)

        expect(graphEdgeSet(graphA.edges)).toEqual(graphEdgeSet(graphB.edges))
      }),
      { numRuns: 20 },
    )
  })
})
