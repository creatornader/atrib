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

  it("renders the revision's own signed prior_position even when the REVISES link is wrong", async () => {
    const items: MemoryItem[] = [
      { type: 'preference', statement: 'Prefers tea with milk in the morning', topic: 'drinks', msg_start: 1, msg_end: 2 },
      { type: 'revision', prior: 'Prefers coffee with milk in the morning', new: 'Drinks only water now', reason: 'doctor recommended cutting caffeine', topic: 'drinks', msg_start: 10, msg_end: 12 },
    ]
    const signed = await signMemoryItems(items, 'ctx-mislink')

    expect(signed[1]!.revises).toBe(signed[0]!.hash)
    expect(signed[1]!.record.event_type).toBe('https://atrib.dev/v1/types/revision')

    const out = retrieveMemory(signed, 'water caffeine', { budgetTokens: 400 })
    const revisedLine = out.split('\n').find((line) => line.includes('[REVISED]'))
    expect(revisedLine).toBeDefined()
    expect(revisedLine).toContain('coffee')
    expect(revisedLine).not.toContain('tea')

    const noteOut = retrieveMemory(signed, 'water caffeine', { budgetTokens: 400, noteForm: true })
    const noteLine = noteOut.split('\n').find((line) => line.includes('User previously'))
    expect(noteLine).toBeDefined()
    expect(noteLine).toContain('coffee')
    expect(noteLine).not.toContain('tea')

    expect(out).toContain('tea')
  })

  it('defaults to compact rendering with verbose opt-in via compact false', async () => {
    const longReason = `${'the same long explanation keeps repeating here '.repeat(6).trim()} final sentinel tail stays visible only in verbose mode`
    const items: MemoryItem[] = [
      {
        type: 'preference',
        statement: 'Prefers azure saffron memory defaults',
        reason: longReason,
        topic: 'compact-rendering',
        msg_start: 21,
        msg_end: 22,
      },
    ]
    const signed = await signMemoryItems(items, 'ctx-compact-default')
    const q = 'azure saffron memory defaults'

    const defaultOut = retrieveMemory(signed, q, { budgetTokens: 400 })
    const explicitCompactOut = retrieveMemory(signed, q, { budgetTokens: 400, compact: true })
    expect(defaultOut).toBe(explicitCompactOut)

    const defaultLine = defaultOut.split('\n').find((line) => line.includes('azure saffron'))
    expect(defaultLine).toBeDefined()
    expect(defaultLine).toContain('…')
    expect(defaultLine).not.toContain('final sentinel tail stays visible only in verbose mode')

    const verboseOut = retrieveMemory(signed, q, { budgetTokens: 400, compact: false })
    const verboseLine = verboseOut.split('\n').find((line) => line.includes('azure saffron'))
    expect(verboseLine).toBeDefined()
    expect(verboseLine).toContain(longReason)
    expect(verboseLine).not.toContain('…')
  })

  it('stopword-only text overlap no longer links a revision to an unrelated record', async () => {
    const stopwordItems: MemoryItem[] = [
      { type: 'fact', statement: 'It was a day with a plan', topic: 'planning', msg_start: 1, msg_end: 2 },
      { type: 'revision', prior: 'Went with a friend', new: 'Goes alone now', reason: 'schedules stopped lining up', msg_start: 5, msg_end: 6 },
    ]
    const stopwordSigned = await signMemoryItems(stopwordItems, 'ctx-stopword-only')
    expect(stopwordSigned[1]!.revises).toBeUndefined()
    expect(stopwordSigned[1]!.record.event_type).toBe('https://atrib.dev/v1/types/observation')
    expect('revises' in stopwordSigned[1]!.record).toBe(false)
    expect(stopwordSigned[1]!.content.prior_position).toBe('Went with a friend')

    const sameTopicItems: MemoryItem[] = [
      { type: 'preference', statement: 'Enjoys hiking mountain trails on weekends', topic: 'fitness', msg_start: 1, msg_end: 2 },
      { type: 'revision', prior: 'Enjoys hiking mountain trails often', new: 'Prefers indoor climbing now', reason: 'knee surgery recovery', topic: 'fitness', msg_start: 5, msg_end: 6 },
    ]
    const sameTopicSigned = await signMemoryItems(sameTopicItems, 'ctx-same-topic-content')
    expect(sameTopicSigned[1]!.revises).toBe(sameTopicSigned[0]!.hash)
    expect(sameTopicSigned[1]!.record.event_type).toBe('https://atrib.dev/v1/types/revision')

    const differentTopicItems: MemoryItem[] = [
      { type: 'fact', statement: 'Tracks daily spending in a notebook', topic: 'finance', msg_start: 1, msg_end: 2 },
      { type: 'revision', prior: 'Tracks daily spending in a notebook', new: 'Uses an app now', reason: 'notebook kept getting lost', topic: 'health', msg_start: 5, msg_end: 6 },
    ]
    const differentTopicSigned = await signMemoryItems(differentTopicItems, 'ctx-different-topic')
    expect(differentTopicSigned[1]!.revises).toBeUndefined()
  })
})
