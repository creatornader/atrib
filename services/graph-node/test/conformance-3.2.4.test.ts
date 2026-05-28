// SPDX-License-Identifier: Apache-2.0

/**
 * §3.2.4 conformance: graph-node's full edge derivation must produce
 * the exact language-neutral edge set in spec/conformance/3.2.4.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { canonicalRecord, hexEncode, sha256, type AtribRecord } from '@atrib/mcp'
import { buildGraph } from '../src/graph-builder.js'

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
  reference_status?: string
  reference_hash?: string
  reference_token?: string
  reason?: string
}

interface CaseFile {
  name: string
  description: string
  input: {
    records: AtribRecord[]
    options?: {
      includeCrossSession?: boolean
      compactIntraSessionEdges?: boolean
    }
  }
  expected: {
    edges: ExpectedEdge[]
    edge_count_by_type: Record<EdgeType, number>
  }
}

interface Manifest {
  cases: { file: string; name: string }[]
}

function loadManifest(): Manifest {
  return JSON.parse(readFileSync(join(CORPUS_ROOT, 'manifest.json'), 'utf8')) as Manifest
}

function loadCase(file: string): CaseFile {
  return JSON.parse(readFileSync(join(CORPUS_ROOT, file), 'utf8')) as CaseFile
}

function nodeIdFor(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

function edgeKey(edge: {
  type: string
  source: string
  target: string
  directed: boolean
  dangling?: boolean
  reference_status?: string
  reference_hash?: string
  reference_token?: string
  reason?: string
}): string {
  return JSON.stringify({
    type: edge.type,
    source: edge.source,
    target: edge.target,
    directed: edge.directed,
    dangling: edge.dangling ?? false,
    reference_status: edge.reference_status ?? null,
    reference_hash: edge.reference_hash ?? null,
    reference_token: edge.reference_token ?? null,
    reason: edge.reason ?? null,
  })
}

function expectedKey(edge: ExpectedEdge, records: AtribRecord[]): string {
  return edgeKey({
    type: edge.type,
    source: nodeIdFor(records[edge.source_record_index]!),
    target:
      edge.target_record_index !== undefined
        ? nodeIdFor(records[edge.target_record_index]!)
        : edge.target_node_id!,
    directed: edge.directed,
    dangling: edge.dangling,
    reference_status: edge.reference_status,
    reference_hash: edge.reference_hash,
    reference_token: edge.reference_token,
    reason: edge.reason,
  })
}

describe('§3.2.4 full edge derivation conformance corpus', () => {
  const manifest = loadManifest()

  for (const entry of manifest.cases) {
    const fixture = loadCase(entry.file)

    it(`${entry.name}: derives the expected edge set`, async () => {
      const graph = await buildGraph(fixture.input.records, [], fixture.input.options ?? {})

      const expected = new Set(
        fixture.expected.edges.map((e) => expectedKey(e, fixture.input.records)),
      )
      const actual = new Set(graph.edges.map(edgeKey))

      expect(actual).toEqual(expected)

      const counts = Object.fromEntries(
        [...actual]
          .map((raw) => JSON.parse(raw) as { type: EdgeType })
          .reduce((acc, e) => {
            acc.set(e.type, (acc.get(e.type) ?? 0) + 1)
            return acc
          }, new Map<EdgeType, number>()),
      )
      for (const type of Object.keys(fixture.expected.edge_count_by_type) as EdgeType[]) {
        expect(counts[type] ?? 0, `${fixture.name} ${type} count`).toBe(
          fixture.expected.edge_count_by_type[type],
        )
      }
    })
  }

  it('manifest enumerates every case file', () => {
    const caseFiles = readdirSync(CASES_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort()
    const manifestFiles = manifest.cases.map((c) => c.file.replace(/^cases\//, '')).sort()
    expect(manifestFiles).toEqual(caseFiles)
  })
})
