// SPDX-License-Identifier: Apache-2.0

import { env, exports as workerExports } from 'cloudflare:workers'
import {
  createExecutionContext,
  reset,
  runInDurableObject,
  waitOnExecutionContext,
} from 'cloudflare:test'
import { afterEach, describe, expect, it } from 'vitest'
import {
  canonicalRecord,
  hexEncode,
  sha256,
  verifyRecord,
  type AtribRecord,
  type ProofBundle,
} from '@atrib/mcp/worker'

type WorkflowStatus =
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'executing'
  | 'succeeded'
  | 'failed'
type SignerRole = 'agent' | 'human' | 'action_mcp'

interface TraceRecord {
  label: string
  signer: SignerRole
  record_hash: string
  record: AtribRecord
  body: unknown
  args: unknown
  result: unknown
  proof: ProofBundle | null
}

interface TraceResponse {
  run_id: string
  status: WorkflowStatus
  context_id: string
  trace_packet: {
    answer: {
      decision: 'approved' | 'rejected' | null
      executed: boolean
      outcome: 'not_run' | 'success' | 'error' | 'pending'
      changed: string[]
      diagnostic: string | null
    }
    differentiators: Array<{ name: string; evidence_labels: string[] }>
    handoff: { public_context_url: string | null; record_hash: string | null }
    timeline: Array<{
      label: string
      signer: SignerRole
      record_hash: string
      informed_by: string[]
    }>
  }
  native_observability: Array<{ channel: string; type: string }>
  records: TraceRecord[]
}

interface TestEnv {
  ApprovalTraceAgent: DurableObjectNamespace
  ApprovalActionMcp: DurableObjectNamespace
}

interface FetchHandler {
  fetch(request: Request, env: unknown, ctx: ExecutionContext): Promise<Response>
}

interface RunReader {
  getRun(runId: string): Promise<TraceResponse>
}

interface ActionTargetReader {
  getTargetRows(ruleId: string): Promise<Array<Record<string, unknown>>>
}

const worker = (workerExports as unknown as { default: FetchHandler }).default
const testEnv = env as unknown as TestEnv
const defaultPrompt =
  'A GitHub issue webhook reported that /v1/report needs rate limiting before the next traffic spike.'

afterEach(async () => {
  await reset()
})

async function dispatch(path: string, init: RequestInit = {}): Promise<Response> {
  const ctx = createExecutionContext()
  try {
    const response = await worker.fetch(new Request(`https://approval.test${path}`, init), env, ctx)
    await waitOnExecutionContext(ctx)
    return response
  } catch (error) {
    await waitOnExecutionContext(ctx).catch(() => undefined)
    throw error
  }
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await dispatch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`)
  return (await response.json()) as T
}

async function getJson<T>(path: string): Promise<T> {
  const response = await dispatch(path)
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`)
  return (await response.json()) as T
}

function recordHash(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

function byLabel(trace: TraceResponse): Map<string, TraceRecord> {
  return new Map(trace.records.map((record) => [record.label, record]))
}

function labels(trace: TraceResponse): string[] {
  return trace.records.map((record) => record.label)
}

function sorted(values: string[] | undefined): string[] {
  return [...(values ?? [])].sort()
}

async function expectSignedTrace(trace: TraceResponse): Promise<void> {
  const hashes = new Set(trace.records.map((record) => record.record_hash))
  for (const item of trace.records) {
    expect(recordHash(item.record), `${item.label} hash`).toBe(item.record_hash)
    expect(await verifyRecord(item.record), `${item.label} signature`).toBe(true)
    expect(item.record.context_id, `${item.label} context`).toBe(trace.context_id)
    expect(item.proof, `${item.label} local proof`).toBeNull()
    for (const ref of item.record.informed_by ?? []) {
      expect(hashes.has(ref), `${item.label} reference ${ref}`).toBe(true)
    }
  }
}

async function createRun(runId: string): Promise<TraceResponse> {
  return postJson<TraceResponse>('/api/runs', {
    run_id: runId,
    prompt: defaultPrompt,
  })
}

async function approveRun(runId: string, simulateError = false): Promise<TraceResponse> {
  return postJson<TraceResponse>(`/api/runs/${runId}/approve`, {
    reason: 'Payload matches the issue scope and expected Cloudflare repository target.',
    simulate_error: simulateError,
  })
}

async function rejectRun(runId: string): Promise<TraceResponse> {
  return postJson<TraceResponse>(`/api/runs/${runId}/reject`, {
    reason: 'The reviewer decided this issue reply should not be published.',
  })
}

async function getAgentRun(runId: string): Promise<TraceResponse> {
  const stub = testEnv.ApprovalTraceAgent.get(testEnv.ApprovalTraceAgent.idFromName(runId))
  return runInDurableObject(stub, (instance) => (instance as unknown as RunReader).getRun(runId))
}

async function getTargetRows(
  runId: string,
  ruleId: string,
): Promise<Array<Record<string, unknown>>> {
  const stub = testEnv.ApprovalActionMcp.get(testEnv.ApprovalActionMcp.idFromName(`rpc:${runId}`))
  return runInDurableObject(stub, (instance) =>
    (instance as unknown as ActionTargetReader).getTargetRows(ruleId),
  )
}

function expectTracePacketBasics(trace: TraceResponse): void {
  expect(trace.trace_packet.timeline.map((entry) => entry.label)).toEqual(labels(trace))
  expect(trace.trace_packet.handoff.public_context_url).toBe(
    `https://log.atrib.dev/v1/by-context/${trace.context_id}`,
  )
  expect(trace.trace_packet.differentiators.map((item) => item.name)).toEqual([
    'Autonomous trigger context',
    'Decision context',
    'Semantic causal chain',
    'Trustless audit',
    'Signer separation',
  ])
}

describe('Cloudflare approval trace Worker', () => {
  it('renders the interactive approval shell and receipt affordances', async () => {
    const response = await dispatch('/')
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain('data-testid="approval-trace-app"')
    expect(html).toContain('id="workflowSteps"')
    expect(html).toContain('id="timeline"')
    expect(html).toContain('id="receipts"')
    expect(html).toContain('View signed record and proof')
    expect(html).toContain('https://github.com/cloudflare/agents/issues/1148')
    expect(html).toContain('https://github.com/cloudflare/agents/issues/1486')
  })

  it('runs the approved path with signed causality, observability, and persisted state', async () => {
    const runId = 'approved-local-e2e'
    const pending = await createRun(runId)

    expect(pending.status).toBe('pending_approval')
    expect(labels(pending)).toEqual(['trigger', 'proposal'])

    const trace = await approveRun(runId)
    const records = byLabel(trace)
    const trigger = records.get('trigger')!
    const proposal = records.get('proposal')!
    const approval = records.get('approval')!
    const preview = records.get('preview')!
    const execution = records.get('execution')!
    const outcome = records.get('outcome')!
    const handoff = records.get('handoff')!

    expect(trace.status).toBe('succeeded')
    expect(labels(trace)).toEqual([
      'trigger',
      'proposal',
      'approval',
      'preview',
      'execution',
      'outcome',
      'handoff',
    ])
    await expectSignedTrace(trace)
    expectTracePacketBasics(trace)

    expect(sorted(proposal.record.informed_by)).toEqual([trigger.record_hash])
    expect(sorted(approval.record.informed_by)).toEqual([proposal.record_hash])
    expect(sorted(preview.record.informed_by)).toEqual([approval.record_hash])
    expect(sorted(execution.record.informed_by)).toEqual([approval.record_hash])
    expect(sorted(outcome.record.informed_by)).toEqual([execution.record_hash])
    expect(sorted(handoff.record.informed_by)).toEqual(
      [approval.record_hash, outcome.record_hash].sort(),
    )

    expect(proposal.record.creator_key).not.toBe(approval.record.creator_key)
    expect(approval.record.creator_key).not.toBe(execution.record.creator_key)
    expect(trace.trace_packet.answer).toMatchObject({
      decision: 'approved',
      executed: true,
      outcome: 'success',
      changed: ['repo_files.server/middleware/rate_limit.ts'],
    })

    const eventTypes = trace.native_observability.map((event) => event.type)
    expect(eventTypes).toEqual(
      expect.arrayContaining([
        'workflow:triggered',
        'message:request',
        'submission:create',
        'tool:approval',
        'mcp:client:connect',
        'tool:result',
        'workflow:approved',
        'message:response',
      ]),
    )

    const targetRows = await getTargetRows(runId, 'server/middleware/rate_limit.ts')
    expect(targetRows).toEqual([
      expect.objectContaining({
        file: 'server/middleware/rate_limit.ts',
        handler: 'reportHandler',
        rate_limit: expect.objectContaining({
          max: 100,
          standard_headers: true,
        }),
      }),
    ])

    const directRun = await getAgentRun(runId)
    expect(labels(directRun)).toEqual(labels(trace))

    const httpRun = await getJson<TraceResponse>(`/api/runs/${runId}`)
    expect(httpRun.status).toBe('succeeded')
    expect(labels(httpRun)).toEqual(labels(trace))
  })

  it('signs a rejection and does not execute the action MCP path', async () => {
    const runId = 'rejected-local-e2e'
    await createRun(runId)
    const trace = await rejectRun(runId)
    const records = byLabel(trace)
    const trigger = records.get('trigger')!
    const proposal = records.get('proposal')!
    const rejection = records.get('rejection')!

    expect(trace.status).toBe('rejected')
    expect(labels(trace)).toEqual(['trigger', 'proposal', 'rejection'])
    await expectSignedTrace(trace)
    expect(sorted(proposal.record.informed_by)).toEqual([trigger.record_hash])
    expect(sorted(rejection.record.informed_by)).toEqual([proposal.record_hash])
    expect(trace.records.some((record) => record.signer === 'action_mcp')).toBe(false)
    expect(trace.trace_packet.answer).toMatchObject({
      decision: 'rejected',
      executed: false,
      outcome: 'not_run',
      changed: [],
    })
    expect(await getTargetRows(runId, 'server/middleware/rate_limit.ts')).toEqual([])
  })

  it('records a diagnostic outcome when the approved action fails', async () => {
    const runId = 'error-local-e2e'
    await createRun(runId)
    const trace = await approveRun(runId, true)
    const records = byLabel(trace)
    const execution = records.get('execution')!
    const outcome = records.get('outcome')!

    expect(trace.status).toBe('failed')
    expect(labels(trace)).toEqual([
      'trigger',
      'proposal',
      'approval',
      'preview',
      'execution',
      'outcome',
      'handoff',
    ])
    await expectSignedTrace(trace)
    expect(sorted(outcome.record.informed_by)).toEqual([execution.record_hash])
    expect(outcome.body).toMatchObject({
      status: 'error',
      error: 'repository_file_version_conflict',
      changed_rows: [],
    })
    expect(trace.trace_packet.answer).toMatchObject({
      decision: 'approved',
      executed: true,
      outcome: 'error',
      changed: [],
      diagnostic: 'The repository file changed after approval.',
    })
    expect(trace.native_observability.map((event) => event.type)).toContain('workflow:terminated')
    expect(await getTargetRows(runId, 'server/middleware/rate_limit.ts')).toEqual([])
  })

  it('rejects stale approval attempts after the run leaves pending review', async () => {
    const runId = 'stale-approval-local-e2e'
    await createRun(runId)
    await approveRun(runId)

    const response = await dispatch(`/api/runs/${runId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reason: 'Duplicate approval should be rejected.',
      }),
    })
    const body = (await response.json()) as { error?: string }

    expect(response.status).toBe(409)
    expect(body.error).toMatch(/run is not pending approval/)
  })
})
