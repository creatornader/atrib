// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  buildSession1Records,
  assemblePacket,
  verifyPacket,
  renderPacket,
  type FactsDoc,
} from '../src/continuation/build-continuation-packet.js'

const DOC: FactsDoc = {
  context_label: 'inc_test_1',
  chain_fact_ids: ['F1', 'F2', 'F3'],
  facts: [
    { id: 'F1', query: 'when did it start?', result: 'at 18:50', kind: 'chain', hop: 0 },
    { id: 'F2', query: 'what deployed before 18:50?', result: 'commit abc1234', kind: 'chain', hop: 1 },
    { id: 'F3', query: 'what did abc1234 change?', result: 'flag_zzz', kind: 'chain', hop: 2 },
    { id: 'F4', query: 'unrelated?', result: 'a cache tweak, ruled out', kind: 'distractor' },
  ],
}

describe('continuation packet', () => {
  it('signs a real chained, informed_by-linked record per fact', async () => {
    const { records, chainTail } = await buildSession1Records(DOC)
    expect(records.length).toBe(4)
    for (const r of records) expect(r.signature.length).toBeGreaterThan(0)
    // chain fact hop>0 carries informed_by to its causal predecessor.
    const linked = records.filter((r) => Array.isArray((r as { informed_by?: string[] }).informed_by))
    expect(linked.length).toBe(2) // F2 informed by F1, F3 informed by F2
    expect(chainTail.startsWith('sha256:')).toBe(true)
  })

  it('assembles a packet that passes the real §5.5.5 verification', async () => {
    const { records, bodyByHash } = await buildSession1Records(DOC)
    const v = await verifyPacket(assemblePacket(records, bodyByHash))
    expect(v.ok).toBe(true)
    expect(v.accepted).toBe(4)
    expect(v.rejected).toBe(0)
  })

  it('renders an ablation ladder: full > no_lineage > hashes_only', async () => {
    const { records, bodyByHash, contextId, chainTail } = await buildSession1Records(DOC)
    const full = renderPacket('full', records, bodyByHash, contextId, chainTail)
    const noLin = renderPacket('no_lineage', records, bodyByHash, contextId, chainTail)
    const hashes = renderPacket('hashes_only', records, bodyByHash, contextId, chainTail)
    // full and no_lineage both carry the bodies (exact identifiers).
    expect(full).toContain('commit abc1234')
    expect(noLin).toContain('commit abc1234')
    // only full shows informed_by lineage.
    expect(full).toContain('informed_by:')
    expect(noLin).not.toContain('informed_by:')
    // hashes_only carries no bodies at all (Tier 1).
    expect(hashes).not.toContain('commit abc1234')
    expect(hashes).toContain('Tier 1')
  })
})
