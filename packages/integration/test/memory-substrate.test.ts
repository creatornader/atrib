// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { verifyRecord } from '@atrib/verify'
import { signMemoryItems, retrieveMemory, type MemoryItem } from '../src/memory-substrate/build-memory-substrate.js'

const ITEMS: MemoryItem[] = [
  { type: 'preference', statement: 'Loves podcasting about music trends', reason: 'positive listener feedback', topic: 'music', msg_start: 3, msg_end: 5 },
  { type: 'fact', statement: 'Works as a software engineer', topic: 'career', msg_start: 8, msg_end: 8 },
  { type: 'preference', statement: 'Enjoys morning trail runs', topic: 'fitness', msg_start: 12, msg_end: 14 },
  { type: 'revision', prior: 'Loves podcasting about music trends', new: 'No longer enjoys podcasting', reason: 'it began to feel like a chore rather than a passion', topic: 'music', msg_start: 40, msg_end: 44 },
]

describe('memory substrate', () => {
  it('signs verifiable records and links revisions to the superseded record', async () => {
    const signed = await signMemoryItems(ITEMS, 'ctx-test')
    expect(signed.length).toBe(4)
    for (const s of signed) expect((await verifyRecord(s.record)).signatureOk).toBe(true)
    const rev = signed[3]!
    expect(rev.record.event_type).toBe('https://atrib.dev/v1/types/revision')
    expect(rev.revises).toBe(signed[0]!.hash)
    // observations never carry revises (require/forbid invariant)
    for (const s of signed.slice(0, 3)) expect('revises' in s.record).toBe(false)
  })

  it('chain expansion surfaces the reason for a change when querying the new position', async () => {
    const signed = await signMemoryItems(ITEMS, 'ctx-test')
    const out = retrieveMemory(signed, 'user says they do not enjoy podcasting anymore', { budgetTokens: 400 })
    expect(out).toContain('BECAUSE')
    expect(out).toContain('chore')
    // and the superseded prior is named
    expect(out).toContain('podcasting about music trends')
  })

  it('--no-chains ablation drops the expansion but keeps BM25 hits', async () => {
    const signed = await signMemoryItems(ITEMS, 'ctx-test')
    const withChains = retrieveMemory(signed, 'podcasting', { budgetTokens: 400, expandChains: true })
    const noChains = retrieveMemory(signed, 'trail runs', { budgetTokens: 60, expandChains: false })
    expect(withChains).toContain('BECAUSE')
    expect(noChains).toContain('trail runs')
    expect(noChains).not.toContain('BECAUSE')
  })

  it('windowing hides records at or after windowEnd', async () => {
    const signed = await signMemoryItems(ITEMS, 'ctx-test')
    const before = retrieveMemory(signed, 'podcasting', { budgetTokens: 400, windowEnd: 20 })
    expect(before).not.toContain('BECAUSE') // the revision (msg_end 44) is not visible yet
    expect(before).toContain('podcasting')
    const after = retrieveMemory(signed, 'podcasting', { budgetTokens: 400, windowEnd: 100 })
    expect(after).toContain('BECAUSE')
  })
})
