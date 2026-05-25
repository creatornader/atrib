// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
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
import { traceBackward, traceForward, buildReverseInformedByIndex } from '../src/trace.js'
import type { IndexedRecord } from '../src/storage.js'
import {
  compactVisited,
  extractRecordHashFieldsFromMcpResult,
  summarizeSidecar,
} from '../src/index.js'

const SEED = new Uint8Array(32).fill(0x42)
const REFERENCE_TIME_MS = Date.now()
const CONTEXT = 'b'.repeat(32)

async function buildSigned(
  contentByte: string,
  timestampOffset: number,
  informedBy?: string[],
): Promise<{ record: AtribRecord; record_hash: string }> {
  const pubKey = base64urlEncode(await getPublicKey(SEED))
  const unsigned = {
    spec_version: 'atrib/1.0' as const,
    content_id: 'sha256:' + contentByte.repeat(32),
    creator_key: pubKey,
    chain_root: genesisChainRoot(CONTEXT),
    event_type: 'https://atrib.dev/v1/types/observation',
    context_id: CONTEXT,
    timestamp: REFERENCE_TIME_MS - timestampOffset,
    signature: '',
    ...(informedBy && informedBy.length > 0 ? { informed_by: informedBy } : {}),
  }
  const record = await signRecord(unsigned as AtribRecord, SEED)
  const record_hash = `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
  return { record, record_hash }
}

function indexize(records: { record: AtribRecord; record_hash: string }[]): Map<string, IndexedRecord> {
  const m = new Map<string, IndexedRecord>()
  for (const { record, record_hash } of records) {
    m.set(record_hash, { record, record_hash, source: 'test' })
  }
  return m
}

describe('traceBackward', () => {
  it('returns empty visited + start_hash in dangling when start_hash is not in index', () => {
    const result = traceBackward(
      'sha256:' + 'f'.repeat(64),
      3,
      new Map(),
    )
    expect(result.visited).toEqual([])
    expect(result.dangling).toEqual(['sha256:' + 'f'.repeat(64)])
    expect(result.warnings.length).toBe(1)
  })

  it('returns just the start record when depth=1 and no informed_by', async () => {
    const r1 = await buildSigned('01', 1000)
    const idx = indexize([r1])

    const result = traceBackward(r1.record_hash, 1, idx)

    expect(result.visited.length).toBe(1)
    expect(result.visited[0]!.record_hash).toBe(r1.record_hash)
    expect(result.visited[0]!.depth).toBe(0)
    expect(result.visited[0]!.parent_hashes).toEqual([])
    expect(result.dangling).toEqual([])
  })

  it('supports depth=0 to return only the start record', async () => {
    const upstream = await buildSigned('01', 2000)
    const downstream = await buildSigned('02', 1000, [upstream.record_hash])
    const idx = indexize([upstream, downstream])

    const result = traceBackward(downstream.record_hash, 0, idx)

    expect(result.visited).toHaveLength(1)
    expect(result.visited[0]!.record_hash).toBe(downstream.record_hash)
    expect(result.depth_reached).toBe(0)
    expect(result.truncated_by_depth).toBe(true)
    expect(result.visited.find((v) => v.record_hash === upstream.record_hash)).toBeUndefined()
  })

  it('walks one hop when depth=1 and start has informed_by', async () => {
    const upstream = await buildSigned('01', 2000)
    const downstream = await buildSigned('02', 1000, [upstream.record_hash])
    const idx = indexize([upstream, downstream])

    const result = traceBackward(downstream.record_hash, 1, idx)

    expect(result.visited.length).toBe(2)
    const visitedHashes = result.visited.map((v) => v.record_hash).sort()
    expect(visitedHashes).toEqual([upstream.record_hash, downstream.record_hash].sort())
    const upVisit = result.visited.find((v) => v.record_hash === upstream.record_hash)!
    expect(upVisit.depth).toBe(1)
    expect(upVisit.parent_hashes).toEqual([downstream.record_hash])
  })

  it('walks multi-hop chain to depth bound', async () => {
    const a = await buildSigned('01', 3000)
    const b = await buildSigned('02', 2000, [a.record_hash])
    const c = await buildSigned('03', 1000, [b.record_hash])
    const idx = indexize([a, b, c])

    const result = traceBackward(c.record_hash, 5, idx)

    expect(result.visited.length).toBe(3)
    expect(result.depth_reached).toBe(2)
    expect(result.truncated_by_depth).toBe(false)
  })

  it('truncates at depth bound', async () => {
    const a = await buildSigned('01', 3000)
    const b = await buildSigned('02', 2000, [a.record_hash])
    const c = await buildSigned('03', 1000, [b.record_hash])
    const idx = indexize([a, b, c])

    const result = traceBackward(c.record_hash, 1, idx)

    expect(result.visited.length).toBe(2) // c (depth 0) + b (depth 1)
    expect(result.truncated_by_depth).toBe(true)
    // a is referenced by b's informed_by but not visited (depth=2 > bound=1)
    expect(result.visited.find((v) => v.record_hash === a.record_hash)).toBeUndefined()
  })

  it('handles diamond fan-in (two parents reference same upstream)', async () => {
    const upstream = await buildSigned('01', 3000)
    const left = await buildSigned('02', 2000, [upstream.record_hash])
    const right = await buildSigned('03', 1500, [upstream.record_hash])
    const tip = await buildSigned('04', 1000, [left.record_hash, right.record_hash].sort())
    const idx = indexize([upstream, left, right, tip])

    const result = traceBackward(tip.record_hash, 5, idx)

    // upstream visited once, but parent_hashes includes both left and right
    expect(result.visited.length).toBe(4)
    const upVisit = result.visited.find((v) => v.record_hash === upstream.record_hash)!
    expect(upVisit.parent_hashes.length).toBe(2)
    expect(upVisit.parent_hashes.sort()).toEqual([left.record_hash, right.record_hash].sort())
  })

  it('surfaces dangling references', async () => {
    const orphanHash = 'sha256:' + 'f'.repeat(64) // not in mirror
    const tip = await buildSigned('02', 1000, [orphanHash])
    const idx = indexize([tip])

    const result = traceBackward(tip.record_hash, 3, idx)

    expect(result.visited.length).toBe(1) // only tip
    expect(result.dangling).toEqual([orphanHash])
  })

  it('respects max_nodes cap', async () => {
    // Build a long chain of 10 records, each referencing the previous.
    const chain: { record: AtribRecord; record_hash: string }[] = []
    let prev: string | undefined
    for (let i = 0; i < 10; i++) {
      const cur = await buildSigned(String(i).padStart(2, '0'), (10 - i) * 100, prev ? [prev] : [])
      chain.push(cur)
      prev = cur.record_hash
    }
    const idx = indexize(chain)

    const tip = chain[chain.length - 1]!
    const result = traceBackward(tip.record_hash, 100, idx, { maxNodes: 4 })

    expect(result.visited.length).toBeLessThanOrEqual(4)
    expect(result.truncated_by_cap).toBe(true)
  })
})

describe('summarizeSidecar — per-event_type content shape handling (D086)', () => {
  function mockLoaded(content: Record<string, unknown> | undefined) {
    return {
      local: {
        // Cast through unknown since SidecarPayload is internal-shaped and
        // we don't want to bring all of D062 envelope semantics into the
        // test surface.
        content,
      } as unknown as import('../src/storage.js').SidecarPayload,
    }
  }

  it('observation: surfaces `what` as the primary text', () => {
    const result = summarizeSidecar(mockLoaded({
      what: 'decided to require TLD for email validation',
      why_noted: 'prevents accepting localhost',
      topics: ['email', 'validation'],
    }))
    expect(result?.what).toBe('decided to require TLD for email validation')
    expect(result?.topics).toEqual(['email', 'validation'])
  })

  it('annotation: surfaces `summary` as the primary text', () => {
    const result = summarizeSidecar(mockLoaded({
      summary: 'this decision was load-bearing for substrate hypothesis',
      importance: 'critical',
      topics: ['design'],
    }))
    expect(result?.what).toBe('this decision was load-bearing for substrate hypothesis')
    expect(result?.importance).toBe('critical')
    expect(result?.topics).toEqual(['design'])
  })

  it('revision: surfaces `new_position` as the primary text (D086 normative field)', () => {
    const result = summarizeSidecar(mockLoaded({
      new_position: 'accept localhost in non-strict mode',
      reason: 'developer feedback during testing',
      importance: 'high',
      topics: ['email', 'strictness'],
    }))
    expect(result?.what).toBe('accept localhost in non-strict mode')
    expect(result?.importance).toBe('high')
    expect(result?.topics).toEqual(['email', 'strictness'])
  })

  it('legacy: falls back to `summary` when no normative field present', () => {
    // Pre-D086 extractor records used summary+rationale on observation.
    // These records are immutable on the log; trace must still surface
    // their text via the legacy fallback path.
    const result = summarizeSidecar(mockLoaded({
      summary: 'legacy extractor-emit text from pre-D086 era',
      rationale: 'because the old hook used summary not what',
    }))
    expect(result?.what).toBe('legacy extractor-emit text from pre-D086 era')
  })

  it('priority: prefers `what` over `new_position` over `summary` when multiple present', () => {
    // Defensive: if a record has multiple text fields (e.g. an extension
    // URI mixing observation+revision shapes), `what` wins because it's
    // the most common case and matches the observation normative.
    const result = summarizeSidecar(mockLoaded({
      what: 'primary-what',
      new_position: 'secondary-new-position',
      summary: 'tertiary-summary',
    }))
    expect(result?.what).toBe('primary-what')
  })

  it('truncates the primary text at 200 chars with ellipsis', () => {
    const long = 'x'.repeat(500)
    const result = summarizeSidecar(mockLoaded({ what: long }))
    expect(result?.what).toBe('x'.repeat(197) + '…')
    expect(result?.what?.length).toBe(198)
  })

  it('returns undefined when sidecar has no recognizable text field', () => {
    const result = summarizeSidecar(mockLoaded({
      lifecycle_event: 'sessionend',
      cwd: '/some/path',
      session_id: 'abc',
    }))
    // No what/new_position/summary present, but also no topics/importance/
    // toolName/producer. summarizeSidecar should return undefined.
    expect(result).toBeUndefined()
  })

  it('returns undefined when local sidecar is absent (legacy bare record)', () => {
    expect(summarizeSidecar({ local: undefined })).toBeUndefined()
    expect(summarizeSidecar(undefined)).toBeUndefined()
  })
})

describe('compact trace payload', () => {
  it('can include signed tool fields and D062 local content', async () => {
    const upstream = await buildSigned('01', 2000)
    const downstream = await buildSigned('02', 1000, [upstream.record_hash])
    ;(downstream.record as AtribRecord & { tool_name?: string; args_hash?: string; result_hash?: string }).tool_name =
      'phase2_config_parser_diagnostics'
    ;(downstream.record as AtribRecord & { tool_name?: string; args_hash?: string; result_hash?: string }).args_hash =
      `sha256:${'1'.repeat(64)}`
    ;(downstream.record as AtribRecord & { tool_name?: string; args_hash?: string; result_hash?: string }).result_hash =
      `sha256:${'2'.repeat(64)}`
    const byHash = indexize([upstream, downstream])
    byHash.set(downstream.record_hash, {
      ...byHash.get(downstream.record_hash)!,
      local: {
        content: {
          passed: false,
          cases: [{ name: 'quoted value preserves interior', passed: false }],
        },
        producer: 'phase2-diagnostic-harness',
      },
    })
    const payload = compactVisited(
      {
        depth: 0,
        record_hash: downstream.record_hash,
        parent_hashes: [],
        record: downstream.record,
        source: 'mirror.jsonl',
        next_informed_by: [upstream.record_hash],
      },
      new Set(),
      byHash,
      true,
    )

    expect(payload.tool_name).toBe('phase2_config_parser_diagnostics')
    expect(payload.args_hash).toBe(`sha256:${'1'.repeat(64)}`)
    expect(payload.result_hash).toBe(`sha256:${'2'.repeat(64)}`)
    expect(payload.informed_by).toEqual([upstream.record_hash])
    expect(payload.local_content).toEqual({
      passed: false,
      cases: [{ name: 'quoted value preserves interior', passed: false }],
    })
    expect(payload.local_producer).toBe('phase2-diagnostic-harness')
  })

  it('read instrumentation samples only record_hash fields', () => {
    const recordHash = `sha256:${'a'.repeat(64)}`
    const argsHash = `sha256:${'b'.repeat(64)}`
    const resultHash = `sha256:${'c'.repeat(64)}`
    const mcpResult = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            visited: [
              {
                record_hash: recordHash,
                args_hash: argsHash,
                result_hash: resultHash,
                local_content: { tested_code_hash: `sha256:${'d'.repeat(64)}` },
              },
            ],
          }),
        },
      ],
    }
    expect(extractRecordHashFieldsFromMcpResult(mcpResult)).toEqual([recordHash])
  })
})

describe('buildReverseInformedByIndex', () => {
  it('returns an empty map for empty index', () => {
    const idx = new Map<string, IndexedRecord>()
    expect(buildReverseInformedByIndex(idx).size).toBe(0)
  })

  it('returns an empty map when no records have informed_by', async () => {
    const { record, record_hash } = await buildSigned('a', 0)
    const idx = indexize([{ record, record_hash }])
    expect(buildReverseInformedByIndex(idx).size).toBe(0)
  })

  it('builds a reverse map: child cites parent → parent → [child]', async () => {
    const parent = await buildSigned('a', 100)
    const child = await buildSigned('b', 50, [parent.record_hash])
    const idx = indexize([parent, child])
    const reverse = buildReverseInformedByIndex(idx)
    expect(reverse.get(parent.record_hash)).toEqual([child.record_hash])
    expect(reverse.has(child.record_hash)).toBe(false)
  })

  it('handles diamond fan-out: parent cited by two children', async () => {
    const parent = await buildSigned('a', 100)
    const c1 = await buildSigned('b', 50, [parent.record_hash])
    const c2 = await buildSigned('c', 40, [parent.record_hash])
    const idx = indexize([parent, c1, c2])
    const reverse = buildReverseInformedByIndex(idx)
    expect(reverse.get(parent.record_hash)?.sort()).toEqual([c1.record_hash, c2.record_hash].sort())
  })

  it('skips non-string informed_by entries silently', async () => {
    const parent = await buildSigned('a', 100)
    const child = await buildSigned('b', 50, [parent.record_hash])
    // Mutate the child's informed_by to include a non-string (defensive parse).
    ;(child.record as { informed_by?: unknown }).informed_by = [parent.record_hash, 42 as unknown as string, null]
    const idx = indexize([parent, child])
    const reverse = buildReverseInformedByIndex(idx)
    // Only the valid string ref makes it in.
    expect(reverse.get(parent.record_hash)).toEqual([child.record_hash])
    expect(reverse.size).toBe(1)
  })
})

describe('traceForward', () => {
  it('returns empty visited + start_hash in dangling when start_hash is not in index', () => {
    const result = traceForward(
      'sha256:' + 'f'.repeat(64),
      3,
      new Map(),
    )
    expect(result.direction).toBe('forward')
    expect(result.visited).toEqual([])
    expect(result.dangling).toEqual(['sha256:' + 'f'.repeat(64)])
    expect(result.warnings[0]).toContain('not in local mirror')
  })

  it('returns just the start record when depth=1 and nothing cites it', async () => {
    const lone = await buildSigned('a', 0)
    const idx = indexize([lone])
    const result = traceForward(lone.record_hash, 1, idx)
    expect(result.visited).toHaveLength(1)
    expect(result.visited[0]?.record_hash).toBe(lone.record_hash)
    expect(result.visited[0]?.next_informed_by).toEqual([])
  })

  it('supports depth=0 to return only the start record on forward walks', async () => {
    const parent = await buildSigned('a', 100)
    const child = await buildSigned('b', 50, [parent.record_hash])
    const idx = indexize([parent, child])

    const result = traceForward(parent.record_hash, 0, idx)

    expect(result.visited).toHaveLength(1)
    expect(result.visited[0]?.record_hash).toBe(parent.record_hash)
    expect(result.depth_reached).toBe(0)
    expect(result.truncated_by_depth).toBe(true)
    expect(result.visited.find((v) => v.record_hash === child.record_hash)).toBeUndefined()
  })

  it('walks one hop when depth=1 and one child cites the start', async () => {
    const parent = await buildSigned('a', 100)
    const child = await buildSigned('b', 50, [parent.record_hash])
    const idx = indexize([parent, child])
    const result = traceForward(parent.record_hash, 1, idx)
    expect(result.visited).toHaveLength(2)
    const hashes = result.visited.map((v) => v.record_hash).sort()
    expect(hashes).toEqual([parent.record_hash, child.record_hash].sort())
    expect(result.visited.find((v) => v.record_hash === parent.record_hash)?.next_informed_by).toEqual([child.record_hash])
    expect(result.visited.find((v) => v.record_hash === child.record_hash)?.parent_hashes).toEqual([parent.record_hash])
  })

  it('walks multi-hop chain forward to depth bound', async () => {
    // a -> b -> c -> d (each cites its parent via informed_by)
    const a = await buildSigned('a', 1000)
    const b = await buildSigned('b', 100, [a.record_hash])
    const c = await buildSigned('c', 50, [b.record_hash])
    const d = await buildSigned('d', 10, [c.record_hash])
    const idx = indexize([a, b, c, d])
    const result = traceForward(a.record_hash, 3, idx)
    expect(result.visited).toHaveLength(4)
    expect(result.depth_reached).toBe(3)
    expect(result.truncated_by_depth).toBe(false)
  })

  it('truncates at depth bound on the forward walk', async () => {
    // a -> b -> c -> d -> e; depth=2 stops at c.
    const a = await buildSigned('a', 1000)
    const b = await buildSigned('b', 100, [a.record_hash])
    const c = await buildSigned('c', 50, [b.record_hash])
    const d = await buildSigned('d', 25, [c.record_hash])
    const e = await buildSigned('e', 10, [d.record_hash])
    const idx = indexize([a, b, c, d, e])
    const result = traceForward(a.record_hash, 2, idx)
    expect(result.depth_reached).toBe(2)
    expect(result.truncated_by_depth).toBe(true)
    const hashes = result.visited.map((v) => v.record_hash)
    expect(hashes).toContain(a.record_hash)
    expect(hashes).toContain(b.record_hash)
    expect(hashes).toContain(c.record_hash)
    expect(hashes).not.toContain(d.record_hash)
    expect(hashes).not.toContain(e.record_hash)
  })

  it('handles diamond fan-out: one parent cited by two siblings', async () => {
    const parent = await buildSigned('a', 100)
    const c1 = await buildSigned('b', 50, [parent.record_hash])
    const c2 = await buildSigned('c', 40, [parent.record_hash])
    const idx = indexize([parent, c1, c2])
    const result = traceForward(parent.record_hash, 1, idx)
    expect(result.visited).toHaveLength(3)
    const parentVisited = result.visited.find((v) => v.record_hash === parent.record_hash)
    expect(parentVisited?.next_informed_by.sort()).toEqual([c1.record_hash, c2.record_hash].sort())
  })

  it('respects max_nodes cap on forward walk', async () => {
    // Build a chain of 8 records; cap at 4.
    const chain: { record: import('@atrib/mcp').AtribRecord; record_hash: string }[] = []
    let prev: string | undefined
    for (let i = 0; i < 8; i++) {
      const r = await buildSigned(String.fromCharCode(97 + i), 1000 - i, prev ? [prev] : undefined)
      chain.push(r)
      prev = r.record_hash
    }
    const idx = indexize(chain)
    const result = traceForward(chain[0]!.record_hash, 100, idx, { maxNodes: 4 })
    expect(result.visited.length).toBeLessThanOrEqual(4)
    expect(result.truncated_by_cap).toBe(true)
  })

  it('respects contextId scope: child in different context_id appears as dangling', async () => {
    // Both records share the test's CONTEXT but the contextId option asks
    // for a different one; the start_hash check rejects the walk.
    const lone = await buildSigned('a', 0)
    const idx = indexize([lone])
    const result = traceForward(lone.record_hash, 1, idx, { contextId: 'z'.repeat(32) })
    expect(result.visited).toEqual([])
    expect(result.warnings[0]).toContain('scoped to')
  })
})
