// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import type { AtribRecord } from '@atrib/mcp'
import {
  OPERATING_EVENT_SCHEMA,
  parseOperatingEvent,
  projectOperatingView,
  searchOperatingEntries,
  taskIdsVisibleToAgent,
  type AgentRef,
  type OperatingEntry,
  type OperatingEvent,
} from '../src/model.js'

const WORKSPACE = { id: 'workspace-1', name: 'Apollo' }
const TASK = { id: 'task-1', name: 'Launch reference client' }
const TEAM = { id: 'team-1', name: 'Protocol' }
const ALICE: AgentRef = { id: 'agent-alice', name: 'Alice', role: 'implementer' }
const BOB: AgentRef = { id: 'agent-bob', name: 'Bob', role: 'reviewer' }

function hash(character: string): string {
  return `sha256:${character.repeat(64)}`
}

function entry(
  character: string,
  kind: OperatingEvent['kind'],
  subject: string,
  options: {
    value?: unknown
    agent?: AgentRef
    revises?: string
    informed_by?: string[]
    from_agent?: AgentRef
    to_agent?: AgentRef
    accepted_head?: string
    resolves?: string[]
    timestamp?: number
  } = {},
): OperatingEntry {
  const event: OperatingEvent = {
    schema: OPERATING_EVENT_SCHEMA,
    kind,
    workspace: WORKSPACE,
    task: TASK,
    team: TEAM,
    agent: options.agent ?? ALICE,
    subject,
    ...(options.value !== undefined ? { value: options.value } : {}),
    ...(options.from_agent ? { from_agent: options.from_agent } : {}),
    ...(options.to_agent ? { to_agent: options.to_agent } : {}),
    ...(options.accepted_head ? { accepted_head: options.accepted_head } : {}),
    ...(options.resolves ? { resolves: options.resolves } : {}),
  }
  return {
    record_hash: hash(character),
    record: {
      spec_version: 'atrib/1.0',
      content_id: hash('f'),
      creator_key: options.agent?.id ?? ALICE.id,
      chain_root: hash('0'),
      event_type: 'https://atrib.dev/v1/types/observation',
      context_id: '1'.repeat(32),
      timestamp: options.timestamp ?? character.charCodeAt(0),
      signature: 'sig',
      ...(options.revises ? { revises: options.revises } : {}),
      ...(options.informed_by ? { informed_by: options.informed_by } : {}),
    } as AtribRecord,
    event,
    signature_verified: true,
    proof_supplied: false,
    producer: 'test',
  }
}

describe('operating graph projection', () => {
  it('rejects incomplete handoffs and ambiguous resolution bodies', () => {
    expect(
      parseOperatingEvent({
        schema: OPERATING_EVENT_SCHEMA,
        kind: 'handoff',
        workspace: WORKSPACE,
        task: TASK,
        subject: 'review',
        from_agent: ALICE,
      }),
    ).toBeNull()
    expect(
      parseOperatingEvent({
        schema: OPERATING_EVENT_SCHEMA,
        kind: 'resolution',
        workspace: WORKSPACE,
        task: TASK,
        subject: 'launch-status',
        accepted_head: hash('a'),
        resolves: [hash('a'), hash('a')],
      }),
    ).toBeNull()
  })

  it('preserves conflicts until a signed application resolution cites every head', () => {
    const first = entry('a', 'accepted_state', 'launch-status', { value: 'ready' })
    const second = entry('b', 'accepted_state', 'launch-status', { value: 'blocked' })
    const unresolved = projectOperatingView([first, second], { workspace_id: WORKSPACE.id })

    expect(unresolved.cells).toHaveLength(1)
    expect(unresolved.cells[0]).toMatchObject({
      status: 'conflict',
      accepted_head: null,
      total_heads: 2,
    })

    const resolution = entry('c', 'resolution', 'launch-status', {
      accepted_head: second.record_hash,
      resolves: [first.record_hash, second.record_hash],
      informed_by: [first.record_hash, second.record_hash],
      timestamp: 500,
    })
    const resolved = projectOperatingView([first, second, resolution], {
      workspace_id: WORKSPACE.id,
    })
    expect(resolved.cells[0]).toMatchObject({
      status: 'resolved',
      accepted_head: second.record_hash,
      resolution: { record_hash: resolution.record_hash },
    })
  })

  it('projects task, team, and agent scopes with named identities', () => {
    const aliceDecision = entry('d', 'decision', 'database', {
      value: 'sqlite',
      agent: ALICE,
    })
    const bobOutcome = entry('e', 'outcome', 'review', {
      value: 'approved',
      agent: BOB,
    })
    const bobView = projectOperatingView([aliceDecision, bobOutcome], {
      workspace_id: WORKSPACE.id,
      task_id: TASK.id,
      team_id: TEAM.id,
      agent_id: BOB.id,
    })

    expect(bobView.activity.map((item) => item.record_hash)).toEqual([bobOutcome.record_hash])
    expect(bobView.identities).toEqual([BOB])
  })

  it('makes a handed-off task visible in the receiving agent view', () => {
    const decision = entry('f', 'decision', 'database', {
      value: 'sqlite',
      agent: ALICE,
    })
    expect(taskIdsVisibleToAgent([decision], WORKSPACE.id, BOB.id)).toEqual([])

    const handoff = entry('1', 'handoff', 'review-launch', {
      from_agent: ALICE,
      to_agent: BOB,
      agent: ALICE,
      informed_by: [decision.record_hash],
    })
    expect(taskIdsVisibleToAgent([decision, handoff], WORKSPACE.id, BOB.id)).toEqual([TASK.id])
    const bobView = projectOperatingView([decision, handoff], {
      workspace_id: WORKSPACE.id,
      agent_id: BOB.id,
    })
    expect(bobView.visible_task_ids).toEqual([TASK.id])
    expect(bobView.handoffs[0]?.record_hash).toBe(handoff.record_hash)
    expect(bobView.cells[0]?.heads.map((item) => item.record_hash)).toEqual([decision.record_hash])
    expect(bobView.activity.map((item) => item.record_hash)).toEqual([
      decision.record_hash,
      handoff.record_hash,
    ])
  })

  it('rejects a resolution that duplicates one head and omits another', () => {
    const first = entry('7', 'accepted_state', 'launch-status', { value: 'ready' })
    const second = entry('8', 'accepted_state', 'launch-status', { value: 'blocked' })
    const duplicateResolution = entry('9', 'resolution', 'launch-status', {
      accepted_head: first.record_hash,
      resolves: [first.record_hash, first.record_hash],
      informed_by: [first.record_hash],
      timestamp: 500,
    })
    const view = projectOperatingView([first, second, duplicateResolution], {
      workspace_id: WORKSPACE.id,
    })
    expect(view.cells[0]).toMatchObject({
      status: 'conflict',
      accepted_head: null,
      resolution: null,
    })
  })

  it('searches private body content inside the selected scope', () => {
    const decision = entry('2', 'decision', 'database', {
      value: { selected: 'sqlite', reason: 'single-node deployment' },
    })
    const outcome = entry('3', 'outcome', 'deploy', { value: 'healthy' })
    const results = searchOperatingEntries([decision, outcome], {
      workspace_id: WORKSPACE.id,
      text: 'single-node',
    })
    expect(results.map((item) => item.record_hash)).toEqual([decision.record_hash])
  })

  it('bounds cells, heads, and activity without hiding total counts', () => {
    const entries = [
      entry('4', 'decision', 'one', { value: 1 }),
      entry('5', 'decision', 'one', { value: 2 }),
      entry('6', 'outcome', 'two', { value: 3 }),
    ]
    const view = projectOperatingView(entries, {
      workspace_id: WORKSPACE.id,
      cell_limit: 1,
      head_limit: 1,
      event_limit: 2,
    })
    expect(view.counts).toMatchObject({
      records_considered: 3,
      cells_total: 2,
      cells_returned: 1,
    })
    expect(view.truncated).toEqual({ cells: true, activity: true })
    expect(view.cells[0]?.heads_truncated).toBe(true)
  })
})
