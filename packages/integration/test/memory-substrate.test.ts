// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { verifyRecord } from '@atrib/verify'
import { signMemoryItems, retrieveMemory, type MemoryItem } from '../src/memory-substrate/build-memory-substrate.js'
import { retrieveMemoryDetailed } from '../src/memory-substrate/build-memory-substrate.js'
import { selectMemory, expandMemory } from '../src/memory-substrate/build-memory-substrate.js'

const ITEMS: MemoryItem[] = [
  { type: 'preference', statement: 'Loves podcasting about music trends', reason: 'positive listener feedback', topic: 'music', msg_start: 3, msg_end: 5 },
  { type: 'fact', statement: 'Works as a software engineer', topic: 'career', msg_start: 8, msg_end: 8 },
  { type: 'preference', statement: 'Enjoys morning trail runs', topic: 'fitness', msg_start: 12, msg_end: 14 },
  { type: 'revision', prior: 'Loves podcasting about music trends', new: 'No longer enjoys podcasting', reason: 'it began to feel like a chore rather than a passion', topic: 'music', msg_start: 40, msg_end: 44 },
]

const SATURATION_QUERY = 'saffron pilot recall field recorder'
const SATURATION_BUDGET = 125
const SATURATION_ITEMS: MemoryItem[] = [
  { type: 'preference', statement: 'Catalogs nebula cadet repair notes', reason: 'amberwhy98 marker explains the old repair choice', topic: 'saturation', msg_start: 1, msg_end: 2 },
  { type: 'revision', prior: 'Catalogs nebula cadet repair notes', new: 'Uses field recorder for saffron pilot recall', reason: 'hands needed to stay free during repairs', topic: 'saturation', msg_start: 3, msg_end: 4 },
  { type: 'fact', statement: 'TOPSEED saffron pilot recall field recorder priority alpha', topic: 'saturation', msg_start: 5, msg_end: 6 },
  { type: 'fact', statement: 'SECOND saffron pilot recall field recorder beta', topic: 'saturation', msg_start: 7, msg_end: 8 },
  { type: 'fact', statement: 'THIRD saffron pilot recall field notes gamma', topic: 'saturation', msg_start: 9, msg_end: 10 },
  { type: 'fact', statement: 'FOURTH saffron pilot recall checklist delta', topic: 'saturation', msg_start: 11, msg_end: 12 },
  { type: 'fact', statement: 'FIFTH saffron pilot review epsilon', topic: 'saturation', msg_start: 13, msg_end: 14 },
  { type: 'fact', statement: 'SIXTH saffron recall zeta', topic: 'saturation', msg_start: 15, msg_end: 16 },
  { type: 'fact', statement: 'SEVENTH pilot recall eta', topic: 'saturation', msg_start: 17, msg_end: 18 },
  { type: 'fact', statement: 'EIGHTH saffron theta', topic: 'saturation', msg_start: 19, msg_end: 20 },
]

const CHAINLESS_QUERY = 'cobalt orchard recall field recorder'
const CHAINLESS_BUDGET = 85
const CHAINLESS_ITEMS: MemoryItem[] = [
  { type: 'fact', statement: 'TOPCHAINLESS cobalt orchard recall field recorder alpha', topic: 'chainless', msg_start: 1, msg_end: 2 },
  { type: 'fact', statement: 'SECONDCHAINLESS cobalt orchard recall field recorder beta', topic: 'chainless', msg_start: 3, msg_end: 4 },
  { type: 'fact', statement: 'THIRDCHAINLESS cobalt orchard recall field notes gamma', topic: 'chainless', msg_start: 5, msg_end: 6 },
  { type: 'fact', statement: 'FOURTHCHAINLESS cobalt orchard recall checklist delta', topic: 'chainless', msg_start: 7, msg_end: 8 },
  { type: 'fact', statement: 'FIFTHCHAINLESS cobalt orchard review epsilon', topic: 'chainless', msg_start: 9, msg_end: 10 },
  { type: 'fact', statement: 'SIXTHCHAINLESS cobalt recall zeta', topic: 'chainless', msg_start: 11, msg_end: 12 },
]

const COMPACT_CHAIN_QUERY = 'terminal current state marker'
const COMPACT_CHAIN_ITEMS: MemoryItem[] = [
  { type: 'revision', prior: 'node000', new: 'node001', reason: 'reason01 extra admission padding', topic: 'deep-chain', msg_start: 1, msg_end: 2 },
  { type: 'revision', prior: 'node001', new: 'node002', reason: 'reason02 extra admission padding', topic: 'deep-chain', msg_start: 3, msg_end: 4 },
  { type: 'revision', prior: 'node002', new: 'node003', reason: 'reason03 extra admission padding', topic: 'deep-chain', msg_start: 5, msg_end: 6 },
  { type: 'revision', prior: 'node003', new: 'node004', reason: 'reason04 extra admission padding', topic: 'deep-chain', msg_start: 7, msg_end: 8 },
  { type: 'revision', prior: 'node004', new: 'node005', reason: 'reason05 extra admission padding', topic: 'deep-chain', msg_start: 9, msg_end: 10 },
  { type: 'revision', prior: 'node005', new: 'node006', reason: 'reason06 extra admission padding', topic: 'deep-chain', msg_start: 11, msg_end: 12 },
  { type: 'revision', prior: 'node006', new: 'node007', reason: 'reason07 extra admission padding', topic: 'deep-chain', msg_start: 13, msg_end: 14 },
  { type: 'revision', prior: 'node007', new: 'node008', reason: 'reason08 extra admission padding', topic: 'deep-chain', msg_start: 15, msg_end: 16 },
  { type: 'revision', prior: 'node008', new: 'node009', reason: 'reason09 extra admission padding', topic: 'deep-chain', msg_start: 17, msg_end: 18 },
  { type: 'revision', prior: 'node009', new: 'node010 terminal current state', reason: 'reason10 terminal marker padding', topic: 'deep-chain', msg_start: 19, msg_end: 20 },
]

const EXPECTED_SATURATION_HEADROOM = `- SECOND saffron pilot recall field recorder beta [saturation]
- TOPSEED saffron pilot recall field recorder priority alpha [saturation]
- THIRD saffron pilot recall field notes gamma [saturation]
- [REVISED] was: "Catalogs nebula cadet repair notes" -> now: "Uses field recorder for saffron pilot recall" BECAUSE: "hands needed to stay free during repairs" (saturation)
- FOURTH saffron pilot recall checklist delta [saturation]
- SEVENTH pilot recall eta [saturation]`

const EXPECTED_CHAINLESS_HEADROOM = `- TOPCHAINLESS cobalt orchard recall field recorder alpha [chainless]
- SECONDCHAINLESS cobalt orchard recall field recorder beta [chainless]
- THIRDCHAINLESS cobalt orchard recall field notes gamma [chainless]
- FOURTHCHAINLESS cobalt orchard recall checklist delta [chainless]
- SIXTHCHAINLESS cobalt recall zeta [chainless]`

const EXPECTED_SATURATION_COMPOSED = `- SECOND saffron pilot recall field recorder beta [saturation]
- TOPSEED saffron pilot recall field recorder priority alpha [saturation]
- THIRD saffron pilot recall field notes gamma [saturation]
- [chain: saturation, 2 steps]
  step 1/2: - Catalogs nebula cadet repair notes (reason: amberwhy98 marker explains the old repair choice) [saturation]
  step 2/2: - [REVISED] was: "Catalogs nebula cadet repair notes" -> now: "Uses field recorder for saffron pilot recall" BECAUSE: "hands needed to stay free during repairs" (saturation)`

const EXPECTED_COMPACT_CHAIN_FULL = `- [chain: deep-chain, 10 steps]
  step 1/10: - [REVISED] was: "node000" -> now: "node001" BECAUSE: "reason01 extra admission padding" (deep-chain)
  step 2/10: - [REVISED] was: "node001" -> now: "node002" BECAUSE: "reason02 extra admission padding" (deep-chain)
  step 3/10: - [REVISED] was: "node002" -> now: "node003" BECAUSE: "reason03 extra admission padding" (deep-chain)
  step 4/10: - [REVISED] was: "node003" -> now: "node004" BECAUSE: "reason04 extra admission padding" (deep-chain)
  step 5/10: - [REVISED] was: "node004" -> now: "node005" BECAUSE: "reason05 extra admission padding" (deep-chain)
  step 6/10: - [REVISED] was: "node005" -> now: "node006" BECAUSE: "reason06 extra admission padding" (deep-chain)
  step 7/10: - [REVISED] was: "node006" -> now: "node007" BECAUSE: "reason07 extra admission padding" (deep-chain)
  step 8/10: - [REVISED] was: "node007" -> now: "node008" BECAUSE: "reason08 extra admission padding" (deep-chain)
  step 9/10: - [REVISED] was: "node008" -> now: "node009" BECAUSE: "reason09 extra admission padding" (deep-chain)
  step 10/10: - [REVISED] was: "node009" -> now: "node010 terminal current state" BECAUSE: "reason10 terminal marker padding" (deep-chain)`

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

  it('bounded transitive chain expansion surfaces the root reason within budget', async () => {
    const chainItems: MemoryItem[] = [
      { type: 'preference', statement: 'Reads print books before bed', reason: 'screens disrupt sleep', topic: 'reading', msg_start: 1, msg_end: 2 },
      { type: 'revision', prior: 'Reads print books before bed', new: 'Listens to audiobooks before bed', reason: 'eye strain in the evening', topic: 'reading', msg_start: 5, msg_end: 6 },
      { type: 'revision', prior: 'Listens to audiobooks before bed', new: 'Practices meditation before bed', reason: 'audiobooks kept mind racing', topic: 'reading', msg_start: 9, msg_end: 10 },
      { type: 'fact', statement: 'Keeps a meditation practice notebook', topic: 'notes', msg_start: 12, msg_end: 13 },
    ]
    const signed = await signMemoryItems(chainItems, 'ctx-chain-walk')

    expect(signed[1]!.revises).toBe(signed[0]!.hash)
    expect(signed[2]!.revises).toBe(signed[1]!.hash)

    const transitiveOut = retrieveMemory(signed, 'meditation mind racing', { budgetTokens: 400 })
    expect(transitiveOut).toContain('audiobooks kept mind racing')
    expect(transitiveOut).toContain('eye strain')
    expect(transitiveOut).toContain('screens disrupt sleep')
    expect(transitiveOut.split('\n')[0]).toBe('- [chain: reading, 3 steps]')
    expect(transitiveOut).toMatch(/step 3\/3: .*meditation/)

    const budgetOut = retrieveMemory(signed, 'meditation notebook', { budgetTokens: 50 })
    expect(budgetOut).toContain('meditation practice notebook')
    expect(budgetOut).toContain('audiobooks kept mind racing')
    expect(budgetOut).not.toContain('screens disrupt sleep')

    const echoItems: MemoryItem[] = [
      { type: 'fact', statement: 'Collects vintage jazz vinyl records', topic: 'vinyl', msg_start: 1, msg_end: 2 },
      { type: 'revision', prior: 'Collects vintage jazz vinyl records', new: 'Sells the vinyl collection now', reason: 'moving abroad soon', topic: 'vinyl', msg_start: 5, msg_end: 6 },
    ]
    const echoSigned = await signMemoryItems(echoItems, 'ctx-echo-skip')
    const echoOut = retrieveMemory(echoSigned, 'sells collection moving abroad', { budgetTokens: 400 })
    expect(echoOut.split('\n').length).toBe(1)
    expect(echoOut).toContain('moving abroad soon')
  })

  it('renders revision chains as ordered connected sequences', async () => {
    const chainItems: MemoryItem[] = [
      { type: 'preference', statement: 'Reads print books before bed', reason: 'screens disrupt sleep', topic: 'reading', msg_start: 1, msg_end: 2 },
      { type: 'revision', prior: 'Reads print books before bed', new: 'Listens to audiobooks before bed', reason: 'eye strain in the evening', topic: 'reading', msg_start: 5, msg_end: 6 },
      { type: 'revision', prior: 'Listens to audiobooks before bed', new: 'Practices meditation before bed', reason: 'audiobooks kept mind racing', topic: 'reading', msg_start: 9, msg_end: 10 },
    ]
    const signed = await signMemoryItems(chainItems, 'ctx-chain-render')

    const out = retrieveMemory(signed, 'meditation mind racing', { budgetTokens: 400 })
    const lines = out.split('\n')
    const headerIndex = lines.findIndex((line) => line === '- [chain: reading, 3 steps]')
    expect(headerIndex).toBeGreaterThanOrEqual(0)
    const block = lines.slice(headerIndex, headerIndex + 4)
    expect(block[1]).toMatch(/step [0-9]+\/[0-9]+/)
    expect(block[1]).toContain('Reads print books before bed')
    expect(block[2]).toMatch(/step [0-9]+\/[0-9]+/)
    expect(block[2]).toContain('Listens to audiobooks before bed')
    expect(block[3]).toMatch(/step [0-9]+\/[0-9]+/)
    expect(block[3]).toContain('Practices meditation before bed')

    const noteOut = retrieveMemory(signed, 'meditation mind racing', { budgetTokens: 400, noteForm: true })
    const noteLines = noteOut.split('\n')
    const noteHeaderIndex = noteLines.findIndex((line) => line === '- [chain: reading, 3 steps]')
    expect(noteHeaderIndex).toBeGreaterThanOrEqual(0)
    const noteBlock = noteLines.slice(noteHeaderIndex, noteHeaderIndex + 4)
    expect(noteBlock[1]).toMatch(/step [0-9]+\/[0-9]+/)
    expect(noteBlock[1]).toContain('Reads print books before bed')
    expect(noteBlock[2]).toMatch(/step [0-9]+\/[0-9]+/)
    expect(noteBlock[2]).toContain('Listens to audiobooks before bed')
    expect(noteBlock[3]).toMatch(/step [0-9]+\/[0-9]+/)
    expect(noteBlock[3]).toContain('Practices meditation before bed')

    const selected = selectMemory(signed, 'meditation mind racing', { budgetTokens: 400 })
    const expanded = expandMemory(signed, selected.seeds.map(({ record }) => record), { budgetTokens: 400 })
    const expandedLines = expanded.text.split('\n')
    const expandedHeaderIndex = expandedLines.findIndex((line) => line === '- [chain: reading, 3 steps]')
    expect(expandedHeaderIndex).toBeGreaterThanOrEqual(0)
    expect(expandedLines[expandedHeaderIndex + 1]).toContain('Reads print books before bed')
    expect(expandedLines[expandedHeaderIndex + 2]).toContain('Listens to audiobooks before bed')
    expect(expandedLines[expandedHeaderIndex + 3]).toContain('Practices meditation before bed')

    const chainless = await signMemoryItems(CHAINLESS_ITEMS, 'ctx-reserved-share-chainless')
    const chainlessOut = retrieveMemory(chainless, CHAINLESS_QUERY, { budgetTokens: CHAINLESS_BUDGET })
    expect(chainlessOut).not.toContain('[chain:')
    expect(chainlessOut).not.toMatch(/step [0-9]+\/[0-9]+/)
  })

  it('preserves dropped chain members as a compact ordered path line', async () => {
    const signed = await signMemoryItems(COMPACT_CHAIN_ITEMS, 'ctx-compact-chain')
    const compactResult = retrieveMemoryDetailed(signed, COMPACT_CHAIN_QUERY, { budgetTokens: 180, chainDepth: 12 })
    const lines = compactResult.text.split('\n')
    const headerIndex = lines.findIndex((line) => line.startsWith('- [chain: deep-chain, '))

    expect(headerIndex).toBeGreaterThanOrEqual(0)
    const earlierLines = lines.filter((line) => /earlier \([0-9]+ steps?\): /.test(line))
    expect(earlierLines).toHaveLength(1)
    expect(lines[headerIndex + 1]).toBe(earlierLines[0])

    const earlierLine = earlierLines[0]!
    const earlierCount = Number(earlierLine.match(/earlier \(([0-9]+) steps?\): /)?.[1] ?? 0)
    expect(earlierCount).toBeGreaterThanOrEqual(4)
    let cursor = -1
    for (const short of ['node001', 'node002', 'node003', 'node004']) {
      const next = earlierLine.indexOf(short)
      expect(next).toBeGreaterThan(cursor)
      cursor = next
    }

    const stepLines = lines.filter((line) => line.startsWith('  step '))
    expect(stepLines.length).toBeGreaterThan(1)
    for (let index = 0; index < stepLines.length; index++) {
      expect(stepLines[index]).toMatch(new RegExp(`^  step ${index + 1}/${stepLines.length}: - \\[REVISED\\]`))
    }
    expect(compactResult.text).toContain('node010 terminal current state')
    expect(compactResult.stats.chains_compacted).toBe(1)

    const fullResult = retrieveMemoryDetailed(signed, COMPACT_CHAIN_QUERY, { budgetTokens: 1000, chainDepth: 12 })
    expect(fullResult.text).toBe(EXPECTED_COMPACT_CHAIN_FULL)
    expect(fullResult.text).not.toMatch(/earlier \([0-9]+ steps?\): /)
    expect(fullResult.stats.chains_compacted).toBe(0)
  })

  it('reserved expansion share admits chain members under seed saturation', async () => {
    const signed = await signMemoryItems(SATURATION_ITEMS, 'ctx-reserved-share-saturation')

    const defaultOut = retrieveMemory(signed, SATURATION_QUERY, { budgetTokens: SATURATION_BUDGET })
    const headroomOnlyOut = retrieveMemory(signed, SATURATION_QUERY, { budgetTokens: SATURATION_BUDGET, expansionShare: 0 })

    expect(defaultOut).toContain('amberwhy98 marker')
    expect(headroomOnlyOut).not.toContain('amberwhy98 marker')
    expect(defaultOut).toContain('SECOND saffron pilot recall')
    expect(headroomOnlyOut).toContain('SECOND saffron pilot recall')
    expect(headroomOnlyOut).toContain('FOURTH saffron pilot recall checklist')
    expect(headroomOnlyOut).toContain('SEVENTH pilot recall eta')
    expect(defaultOut).not.toContain('FOURTH saffron pilot recall checklist')
    expect(defaultOut).not.toContain('SEVENTH pilot recall eta')
  })

  it('expansionShare zero restores headroom-only behavior byte for byte', async () => {
    const chainless = await signMemoryItems(CHAINLESS_ITEMS, 'ctx-reserved-share-chainless')
    const saturation = await signMemoryItems(SATURATION_ITEMS, 'ctx-reserved-share-saturation')

    expect(retrieveMemory(chainless, CHAINLESS_QUERY, { budgetTokens: CHAINLESS_BUDGET, expansionShare: 0 })).toBe(EXPECTED_CHAINLESS_HEADROOM)
    expect(retrieveMemory(saturation, SATURATION_QUERY, { budgetTokens: SATURATION_BUDGET, expansionShare: 0 })).toBe(EXPECTED_SATURATION_HEADROOM)
  })

  it('reserve backfills seeds when no chain members are admissible', async () => {
    const signed = await signMemoryItems(CHAINLESS_ITEMS, 'ctx-reserved-share-chainless')
    const defaultOut = retrieveMemory(signed, CHAINLESS_QUERY, { budgetTokens: CHAINLESS_BUDGET })
    const headroomOnlyOut = retrieveMemory(signed, CHAINLESS_QUERY, { budgetTokens: CHAINLESS_BUDGET, expansionShare: 0 })

    expect(defaultOut).toBe(headroomOnlyOut)
  })

  it('retrieveMemoryDetailed reports engagement stats', async () => {
    const saturation = await signMemoryItems(SATURATION_ITEMS, 'ctx-reserved-share-saturation')
    const saturationResult = retrieveMemoryDetailed(saturation, SATURATION_QUERY, { budgetTokens: SATURATION_BUDGET })

    expect(saturationResult.stats.expansion_engaged).toBe(true)
    expect(saturationResult.stats.chain_members_admitted).toBeGreaterThanOrEqual(1)
    expect(saturationResult.stats.echo_skipped).toBeGreaterThanOrEqual(0)
    expect(saturationResult.stats.budget_chars).toBe(SATURATION_BUDGET * 4)
    expect(saturationResult.stats.rendered_chars).toBe(saturationResult.text.length)
    expect(saturationResult.text).toContain('- [chain: saturation, 2 steps]')

    const chainless = await signMemoryItems(CHAINLESS_ITEMS, 'ctx-reserved-share-chainless')
    const chainlessResult = retrieveMemoryDetailed(chainless, CHAINLESS_QUERY, { budgetTokens: CHAINLESS_BUDGET })

    expect(chainlessResult.stats.expansion_engaged).toBe(false)
  })

  it('selectMemory matches chainless retrieval byte for byte', async () => {
    const cases = [
      {
        items: ITEMS,
        context: 'ctx-test',
        query: 'podcasting',
        opts: { budgetTokens: 400, expandChains: true, expansionShare: 0.9, chainDepth: 1 },
      },
      {
        items: SATURATION_ITEMS,
        context: 'ctx-reserved-share-saturation',
        query: SATURATION_QUERY,
        opts: { budgetTokens: SATURATION_BUDGET, expandChains: true, expansionShare: 0.9, chainDepth: 1 },
      },
      {
        items: CHAINLESS_ITEMS,
        context: 'ctx-reserved-share-chainless',
        query: CHAINLESS_QUERY,
        opts: { budgetTokens: CHAINLESS_BUDGET, expandChains: true, expansionShare: 0.9, chainDepth: 1 },
      },
    ] as const

    for (const testCase of cases) {
      const signed = await signMemoryItems(testCase.items, testCase.context)
      expect(selectMemory(signed, testCase.query, testCase.opts).text).toBe(
        retrieveMemory(signed, testCase.query, { ...testCase.opts, expandChains: false }),
      )
    }
  })

  it('expandMemory walks provided seeds with provenance', async () => {
    const chainItems: MemoryItem[] = [
      { type: 'preference', statement: 'Reads print books before bed', reason: 'screens disrupt sleep', topic: 'reading', msg_start: 1, msg_end: 2 },
      { type: 'revision', prior: 'Reads print books before bed', new: 'Listens to audiobooks before bed', reason: 'eye strain in the evening', topic: 'reading', msg_start: 5, msg_end: 6 },
      { type: 'revision', prior: 'Listens to audiobooks before bed', new: 'Practices meditation before bed', reason: 'audiobooks kept mind racing', topic: 'reading', msg_start: 9, msg_end: 10 },
      { type: 'fact', statement: 'Keeps a meditation practice notebook', topic: 'notes', msg_start: 12, msg_end: 13 },
    ]
    const signed = await signMemoryItems(chainItems, 'ctx-chain-walk')
    const selected = selectMemory(signed, 'meditation mind racing', { budgetTokens: 400 })
    const meditationSeed = selected.seeds.find(({ record }) => record.hash === signed[2]!.hash)

    expect(meditationSeed).toBeDefined()

    const expanded = expandMemory(signed, selected.seeds.map(({ record }) => record), { budgetTokens: 400 })
    const rootMember = expanded.members.find(({ record }) => record.hash === signed[0]!.hash)

    expect(rootMember).toBeDefined()
    expect(rootMember?.from).toBe(meditationSeed?.record.hash)
    expect(expanded.text).toContain('screens disrupt sleep')
  })

  it('composed retrieval is the same before and after the split', async () => {
    const signed = await signMemoryItems(SATURATION_ITEMS, 'ctx-reserved-share-saturation')
    const result = retrieveMemoryDetailed(signed, SATURATION_QUERY, { budgetTokens: SATURATION_BUDGET })

    expect(result.text).toBe(EXPECTED_SATURATION_COMPOSED)
    expect(result.stats).toEqual({
      seeds: 4,
      backfilled_seeds: 0,
      chain_members_considered: 1,
      chain_members_admitted: 1,
      chains_compacted: 0,
      echo_skipped: 0,
      budget_chars: SATURATION_BUDGET * 4,
      rendered_chars: EXPECTED_SATURATION_COMPOSED.length,
      expansion_engaged: true,
    })
  })
})
