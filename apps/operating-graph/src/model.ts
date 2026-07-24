// SPDX-License-Identifier: Apache-2.0

import type { AtribRecord, ProofBundle } from '@atrib/mcp'

export const OPERATING_EVENT_SCHEMA = 'atrib.operating-event.v1'
export const OPERATING_VIEW_SCHEMA = 'atrib.operating-view.v1'

export type OperatingEventKind =
  'accepted_state' | 'decision' | 'outcome' | 'handoff' | 'resolution'

export interface NamedRef {
  id: string
  name: string
}

export interface AgentRef extends NamedRef {
  role: string
}

export interface OperatingEvent {
  schema: typeof OPERATING_EVENT_SCHEMA
  kind: OperatingEventKind
  workspace: NamedRef
  task?: NamedRef
  team?: NamedRef
  agent?: AgentRef
  subject: string
  value?: unknown
  status?: string
  source?: string
  from_agent?: AgentRef
  to_agent?: AgentRef
  accepted_head?: string
  resolves?: string[]
}

export interface OperatingEnvelope {
  record: AtribRecord
  proof?: ProofBundle | null
  written_at?: number
  _local?: {
    content?: Record<string, unknown>
    producer?: string
  }
}

export interface OperatingEntry {
  record_hash: string
  record: AtribRecord
  event: OperatingEvent
  signature_verified: boolean
  proof_supplied: boolean
  producer: string | null
}

export interface OperatingViewQuery {
  workspace_id: string
  task_id?: string
  team_id?: string
  agent_id?: string
  trusted_creator_keys?: string[]
  cell_limit?: number
  head_limit?: number
  event_limit?: number
}

export interface OperatingCell {
  key: string
  kind: Exclude<OperatingEventKind, 'handoff' | 'resolution'>
  subject: string
  status: 'accepted' | 'conflict' | 'resolved'
  heads: OperatingEntry[]
  accepted_head: string | null
  resolution: OperatingEntry | null
  total_heads: number
  heads_truncated: boolean
}

export interface OperatingView {
  schema: typeof OPERATING_VIEW_SCHEMA
  scope: {
    workspace_id: string
    task_id: string | null
    team_id: string | null
    agent_id: string | null
  }
  identities: AgentRef[]
  visible_task_ids: string[]
  cells: OperatingCell[]
  handoffs: OperatingEntry[]
  activity: OperatingEntry[]
  counts: {
    records_considered: number
    cells_total: number
    cells_returned: number
    conflicts: number
    resolutions: number
    handoffs: number
  }
  truncated: {
    cells: boolean
    activity: boolean
  }
}

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/
const DEFAULT_CELL_LIMIT = 200
const DEFAULT_HEAD_LIMIT = 20
const DEFAULT_EVENT_LIMIT = 500

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function namedRef(value: unknown): NamedRef | undefined {
  if (
    !isRecord(value) ||
    typeof value['id'] !== 'string' ||
    value['id'].trim() === '' ||
    typeof value['name'] !== 'string' ||
    value['name'].trim() === ''
  ) {
    return undefined
  }
  return { id: value['id'], name: value['name'] }
}

function agentRef(value: unknown): AgentRef | undefined {
  const named = namedRef(value)
  if (!named || !isRecord(value) || typeof value['role'] !== 'string') return undefined
  return { ...named, role: value['role'] }
}

export function parseOperatingEvent(value: unknown): OperatingEvent | null {
  if (
    !isRecord(value) ||
    value['schema'] !== OPERATING_EVENT_SCHEMA ||
    !['accepted_state', 'decision', 'outcome', 'handoff', 'resolution'].includes(
      String(value['kind']),
    ) ||
    typeof value['subject'] !== 'string' ||
    value['subject'].trim() === ''
  ) {
    return null
  }
  const workspace = namedRef(value['workspace'])
  if (!workspace) return null
  const kind = value['kind'] as OperatingEventKind
  const event: OperatingEvent = {
    schema: OPERATING_EVENT_SCHEMA,
    kind,
    workspace,
    subject: value['subject'],
  }
  const task = namedRef(value['task'])
  const team = namedRef(value['team'])
  const agent = agentRef(value['agent'])
  const fromAgent = agentRef(value['from_agent'])
  const toAgent = agentRef(value['to_agent'])
  if (task) event.task = task
  if (team) event.team = team
  if (agent) event.agent = agent
  if (fromAgent) event.from_agent = fromAgent
  if (toAgent) event.to_agent = toAgent
  if ('value' in value) event.value = value['value']
  if (typeof value['status'] === 'string') event.status = value['status']
  if (typeof value['source'] === 'string') event.source = value['source']
  if (typeof value['accepted_head'] === 'string') event.accepted_head = value['accepted_head']
  if (
    Array.isArray(value['resolves']) &&
    value['resolves'].every((entry) => typeof entry === 'string' && HASH_PATTERN.test(entry))
  ) {
    event.resolves = [...value['resolves']]
  }
  if (
    kind === 'handoff' &&
    (!event.task ||
      !event.from_agent ||
      !event.to_agent ||
      event.from_agent.id === event.to_agent.id)
  ) {
    return null
  }
  if (kind === 'resolution') {
    const resolves = event.resolves ?? []
    if (
      !event.accepted_head ||
      !HASH_PATTERN.test(event.accepted_head) ||
      resolves.length < 2 ||
      new Set(resolves).size !== resolves.length ||
      !resolves.includes(event.accepted_head)
    ) {
      return null
    }
  }
  return event
}

function inBaseScope(entry: OperatingEntry, query: OperatingViewQuery): boolean {
  const event = entry.event
  if (event.workspace.id !== query.workspace_id) return false
  if (query.task_id && event.task?.id !== query.task_id) return false
  if (query.team_id && event.team?.id !== query.team_id) return false
  if (
    query.trusted_creator_keys &&
    !query.trusted_creator_keys.includes(entry.record.creator_key)
  ) {
    return false
  }
  return entry.signature_verified
}

function scopedEntries(entries: OperatingEntry[], query: OperatingViewQuery): OperatingEntry[] {
  const base = entries.filter((entry) => inBaseScope(entry, query))
  if (!query.agent_id) return base
  const handedOffTasks = new Set(
    base
      .filter(
        (entry) =>
          entry.event.kind === 'handoff' &&
          entry.event.to_agent?.id === query.agent_id &&
          entry.event.task,
      )
      .map((entry) => entry.event.task!.id),
  )
  return base.filter((entry) => {
    const direct = entry.event.agent?.id === query.agent_id
    const receivedHandoff =
      entry.event.kind === 'handoff' && entry.event.to_agent?.id === query.agent_id
    const handedOffTask = entry.event.task !== undefined && handedOffTasks.has(entry.event.task.id)
    return direct || receivedHandoff || handedOffTask
  })
}

function cellKey(entry: OperatingEntry): string {
  const task = entry.event.task?.id ?? '_'
  return `${task}:${entry.event.kind}:${entry.event.subject}`
}

function activeHeads(entries: OperatingEntry[]): OperatingEntry[] {
  const revised = new Set(
    entries
      .map((entry) => entry.record.revises)
      .filter((value): value is string => typeof value === 'string'),
  )
  return entries.filter((entry) => !revised.has(entry.record_hash))
}

function latest(entries: OperatingEntry[]): OperatingEntry | null {
  return (
    [...entries].sort(
      (left, right) =>
        right.record.timestamp - left.record.timestamp ||
        right.record_hash.localeCompare(left.record_hash),
    )[0] ?? null
  )
}

export function projectOperatingView(
  entries: OperatingEntry[],
  query: OperatingViewQuery,
): OperatingView {
  const cellLimit = Math.max(1, Math.min(query.cell_limit ?? DEFAULT_CELL_LIMIT, 1_000))
  const headLimit = Math.max(1, Math.min(query.head_limit ?? DEFAULT_HEAD_LIMIT, 100))
  const eventLimit = Math.max(1, Math.min(query.event_limit ?? DEFAULT_EVENT_LIMIT, 2_000))
  const scoped = scopedEntries(entries, query)
  const handoffs = scoped.filter((entry) => entry.event.kind === 'handoff')
  const resolutions = scoped.filter((entry) => entry.event.kind === 'resolution')
  const stateEntries = scoped.filter(
    (entry) => entry.event.kind !== 'handoff' && entry.event.kind !== 'resolution',
  )
  const byCell = new Map<string, OperatingEntry[]>()
  for (const entry of stateEntries) {
    const key = cellKey(entry)
    const group = byCell.get(key) ?? []
    group.push(entry)
    byCell.set(key, group)
  }

  const allCells: OperatingCell[] = []
  for (const [key, group] of byCell) {
    const heads = activeHeads(group)
    const headHashes = new Set(heads.map((entry) => entry.record_hash))
    const resolution =
      latest(
        resolutions.filter((entry) => {
          const claimed = entry.event.resolves ?? []
          const claimedHeads = new Set(claimed)
          return (
            entry.event.accepted_head !== undefined &&
            headHashes.has(entry.event.accepted_head) &&
            claimedHeads.size === headHashes.size &&
            [...headHashes].every((hash) => claimedHeads.has(hash)) &&
            [...claimedHeads].every((hash) => entry.record.informed_by?.includes(hash) === true)
          )
        }),
      ) ?? null
    const acceptedHead =
      resolution?.event.accepted_head ?? (heads.length === 1 ? heads[0]?.record_hash : null)
    allCells.push({
      key,
      kind: group[0]!.event.kind as OperatingCell['kind'],
      subject: group[0]!.event.subject,
      status: resolution ? 'resolved' : heads.length > 1 ? 'conflict' : 'accepted',
      heads: heads.slice(0, headLimit),
      accepted_head: acceptedHead ?? null,
      resolution,
      total_heads: heads.length,
      heads_truncated: heads.length > headLimit,
    })
  }
  allCells.sort((left, right) => left.key.localeCompare(right.key))

  const identityMap = new Map<string, AgentRef>()
  for (const entry of scoped) {
    for (const agent of [entry.event.agent, entry.event.from_agent, entry.event.to_agent]) {
      if (agent) identityMap.set(agent.id, agent)
    }
  }
  const activity = [...scoped].sort(
    (left, right) =>
      right.record.timestamp - left.record.timestamp ||
      right.record_hash.localeCompare(left.record_hash),
  )
  const cells = allCells.slice(0, cellLimit)

  return {
    schema: OPERATING_VIEW_SCHEMA,
    scope: {
      workspace_id: query.workspace_id,
      task_id: query.task_id ?? null,
      team_id: query.team_id ?? null,
      agent_id: query.agent_id ?? null,
    },
    identities: [...identityMap.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
    visible_task_ids:
      query.agent_id !== undefined
        ? taskIdsVisibleToAgent(entries, query.workspace_id, query.agent_id)
        : [],
    cells,
    handoffs: handoffs.slice(0, eventLimit),
    activity: activity.slice(0, eventLimit),
    counts: {
      records_considered: scoped.length,
      cells_total: allCells.length,
      cells_returned: cells.length,
      conflicts: allCells.filter((cell) => cell.status === 'conflict').length,
      resolutions: allCells.filter((cell) => cell.status === 'resolved').length,
      handoffs: handoffs.length,
    },
    truncated: {
      cells: allCells.length > cellLimit,
      activity: activity.length > eventLimit,
    },
  }
}

export function searchOperatingEntries(
  entries: OperatingEntry[],
  query: OperatingViewQuery & { text: string; limit?: number },
): OperatingEntry[] {
  const needle = query.text.trim().toLocaleLowerCase()
  if (!needle) return []
  const limit = Math.max(1, Math.min(query.limit ?? 50, 200))
  return scopedEntries(entries, query)
    .filter((entry) => JSON.stringify(entry.event).toLocaleLowerCase().includes(needle))
    .sort(
      (left, right) =>
        right.record.timestamp - left.record.timestamp ||
        right.record_hash.localeCompare(left.record_hash),
    )
    .slice(0, limit)
}

/**
 * Agent views include incoming handoff tasks even when prior task records were
 * signed by another agent.
 */
export function taskIdsVisibleToAgent(
  entries: OperatingEntry[],
  workspaceId: string,
  agentId: string,
): string[] {
  const taskIds = new Set<string>()
  for (const entry of entries) {
    if (!entry.signature_verified || entry.event.workspace.id !== workspaceId) continue
    if (entry.event.agent?.id === agentId && entry.event.task) taskIds.add(entry.event.task.id)
    if (
      entry.event.kind === 'handoff' &&
      entry.event.to_agent?.id === agentId &&
      entry.event.task
    ) {
      taskIds.add(entry.event.task.id)
    }
  }
  return [...taskIds].sort()
}
