// SPDX-License-Identifier: Apache-2.0

import { env, exports as workerExports } from 'cloudflare:workers'
import {
  createExecutionContext,
  reset,
  runInDurableObject,
  waitOnExecutionContext,
} from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  canonicalRecord,
  computeContentId,
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
  | 'changes_requested'
  | 'executing'
  | 'succeeded'
  | 'failed'
type SignerRole = 'agent' | 'human' | 'action_mcp' | 'codemode_runtime'

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
      decision: 'approved' | 'rejected' | 'changes_requested' | null
      executed: boolean
      outcome: 'not_run' | 'revision_requested' | 'success' | 'error' | 'pending'
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
  getRepositoryRows(filePath: string): Promise<Array<Record<string, unknown>>>
}

const worker = (workerExports as unknown as { default: FetchHandler }).default
const testEnv = env as unknown as TestEnv
const defaultPrompt =
  'A GitHub issue webhook reported that /v1/report needs rate limiting before the next traffic spike.'

beforeEach(async () => {
  await reset()
})

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

function uniqueRunId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
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

async function createRun(runId: string, simulateError = false): Promise<TraceResponse> {
  return postJson<TraceResponse>('/api/runs', {
    run_id: runId,
    prompt: defaultPrompt,
    simulate_error: simulateError,
    code_mode_executor: 'local-test',
  })
}

async function approveRun(runId: string): Promise<TraceResponse> {
  return postJson<TraceResponse>(`/api/runs/${runId}/approve`, {
    reason: 'Payload matches the issue scope and expected Cloudflare repository target.',
  })
}

async function rejectRun(runId: string): Promise<TraceResponse> {
  return postJson<TraceResponse>(`/api/runs/${runId}/reject`, {
    reason: 'The reviewer decided this issue reply should not be published.',
  })
}

async function requestChanges(runId: string): Promise<TraceResponse> {
  return postJson<TraceResponse>(`/api/runs/${runId}/request-changes`, {
    feedback: 'The reviewer requested a smaller repository file update.',
  })
}

async function getAgentRun(runId: string): Promise<TraceResponse> {
  const stub = testEnv.ApprovalTraceAgent.get(testEnv.ApprovalTraceAgent.idFromName(runId))
  return runInDurableObject(stub, (instance) => (instance as unknown as RunReader).getRun(runId))
}

async function getTargetRows(
  runId: string,
  filePath: string,
): Promise<Array<Record<string, unknown>>> {
  const stub = testEnv.ApprovalTraceAgent.get(testEnv.ApprovalTraceAgent.idFromName(runId))
  return runInDurableObject(stub, (instance) =>
    (instance as unknown as RunReader).getRepositoryRows(filePath),
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
    'Signed decision chain',
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
    const runId = uniqueRunId('approved-local-e2e')
    const pending = await createRun(runId)

    expect(pending.status).toBe('pending_approval')
    expect(labels(pending)).toEqual(['trigger', 'triage', 'proposal'])
    const pendingRecords = byLabel(pending)
    const proposalRecord = pendingRecords.get('proposal')!
    const verification = await postJson<{
      ok: boolean
      signature_ok: boolean
      hash_ok: boolean
      record_hash: string
    }>('/api/verify-record', {
      record: proposalRecord.record,
      expected_hash: proposalRecord.record_hash,
    })
    expect(verification).toMatchObject({
      ok: true,
      signature_ok: true,
      hash_ok: true,
      record_hash: proposalRecord.record_hash,
    })

    const trace = await approveRun(runId)
    const records = byLabel(trace)
    const trigger = records.get('trigger')!
    const triage = records.get('triage')!
    const proposal = records.get('proposal')!
    const approval = records.get('approval')!
    const execution = records.get('execution')!
    const outcome = records.get('outcome')!
    const handoff = records.get('handoff')!

    expect(trace.status).toBe('succeeded')
    expect(labels(trace)).toEqual([
      'trigger',
      'triage',
      'proposal',
      'approval',
      'execution',
      'outcome',
      'handoff',
    ])
    await expectSignedTrace(trace)
    expectTracePacketBasics(trace)

    expect(sorted(triage.record.informed_by)).toEqual([trigger.record_hash])
    expect(sorted(proposal.record.informed_by)).toEqual([triage.record_hash])
    expect(sorted(approval.record.informed_by)).toEqual([proposal.record_hash])
    expect(sorted(execution.record.informed_by)).toEqual(
      [proposal.record_hash, approval.record_hash].sort(),
    )
    expect(sorted(outcome.record.informed_by)).toEqual([execution.record_hash])
    expect(sorted(handoff.record.informed_by)).toEqual(
      [approval.record_hash, outcome.record_hash].sort(),
    )

    expect(proposal.record.creator_key).not.toBe(approval.record.creator_key)
    expect(approval.record.creator_key).not.toBe(execution.record.creator_key)
    expect(execution.signer).toBe('codemode_runtime')
    expect(outcome.signer).toBe('codemode_runtime')
    expect(execution.record.content_id).toBe(
      computeContentId('codemode://atrib-cloudflare-test/runtime', 'codemode_execution'),
    )
    expect(outcome.record.content_id).toBe(
      computeContentId('codemode://atrib-cloudflare-test/runtime', 'record_outcome'),
    )
    expect(proposal.body).toMatchObject({
      stable_connector_id: 'cloudflare-demo-codemode-runtime',
      codemode: {
        runtime: 'CodemodeRuntime',
        executor: 'local-test',
        execution_status: 'paused',
        pending_action: expect.objectContaining({
          connector: 'repository',
          method: 'write_file',
        }),
      },
    })
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
        'codemode:execution_completed',
        'workflow:approved',
        'message:response',
      ]),
    )

    const targetRows = await getTargetRows(runId, 'server/middleware/rate_limit.ts')
    expect(targetRows).toEqual([
      expect.objectContaining({
        file: 'server/middleware/rate_limit.ts',
        repository: 'cloudflare/agents-demo',
        operation: 'write_file',
        state: expect.objectContaining({
          rate_limit: expect.objectContaining({
            max: 100,
            standard_headers: true,
          }),
        }),
      }),
    ])

    const directRun = await getAgentRun(runId)
    expect(labels(directRun)).toEqual(labels(trace))

    const httpRun = await getJson<TraceResponse>(`/api/runs/${runId}`)
    expect(httpRun.status).toBe('succeeded')
    expect(labels(httpRun)).toEqual(labels(trace))
  })

  it('signs a rejection and closes the pending Code Mode action', async () => {
    const runId = uniqueRunId('rejected-local-e2e')
    await createRun(runId)
    const trace = await rejectRun(runId)
    const records = byLabel(trace)
    const trigger = records.get('trigger')!
    const triage = records.get('triage')!
    const proposal = records.get('proposal')!
    const rejection = records.get('rejection')!
    const runtimeRejection = records.get('runtime_rejection')!

    expect(trace.status).toBe('rejected')
    expect(labels(trace)).toEqual([
      'trigger',
      'triage',
      'proposal',
      'rejection',
      'runtime_rejection',
    ])
    await expectSignedTrace(trace)
    expect(sorted(triage.record.informed_by)).toEqual([trigger.record_hash])
    expect(sorted(proposal.record.informed_by)).toEqual([triage.record_hash])
    expect(sorted(rejection.record.informed_by)).toEqual([proposal.record_hash])
    expect(sorted(runtimeRejection.record.informed_by)).toEqual([rejection.record_hash])
    expect(runtimeRejection.signer).toBe('codemode_runtime')
    expect(runtimeRejection.body).toMatchObject({
      kind: 'codemode_runtime_rejection',
      reason: 'rejected',
      terminated: true,
      execution_status: 'rejected',
    })
    expect(trace.records.some((record) => record.signer === 'action_mcp')).toBe(false)
    expect(trace.trace_packet.answer).toMatchObject({
      decision: 'rejected',
      executed: false,
      outcome: 'not_run',
      changed: [],
    })
    expect(await getTargetRows(runId, 'server/middleware/rate_limit.ts')).toEqual([])
  })

  it('signs requested changes, revises, and waits for second approval', async () => {
    const runId = uniqueRunId('changes-requested-local-e2e')
    await createRun(runId)
    const trace = await requestChanges(runId)
    const records = byLabel(trace)
    const proposal = records.get('proposal')!
    const feedback = records.get('change_request')!
    const runtimeRejection = records.get('runtime_rejection')!
    const revision = records.get('revision')!

    expect(trace.status).toBe('pending_approval')
    expect(labels(trace)).toEqual([
      'trigger',
      'triage',
      'proposal',
      'change_request',
      'runtime_rejection',
      'revision',
    ])
    await expectSignedTrace(trace)
    expect(sorted(feedback.record.informed_by)).toEqual([proposal.record_hash])
    expect(sorted(runtimeRejection.record.informed_by)).toEqual([feedback.record_hash])
    expect(sorted(revision.record.informed_by)).toEqual(
      [proposal.record_hash, feedback.record_hash].sort(),
    )
    expect(trace.records.some((record) => record.label === 'rejection')).toBe(false)
    expect(trace.records.some((record) => record.signer === 'action_mcp')).toBe(false)
    expect(feedback.body).toMatchObject({
      kind: 'human_review_feedback',
      decision: 'changes_requested',
      next_step: 'agent_revision',
    })
    expect(runtimeRejection.body).toMatchObject({
      kind: 'codemode_runtime_rejection',
      reason: 'changes_requested',
      terminated: true,
      execution_status: 'rejected',
    })
    expect(revision.body).toMatchObject({
      kind: 'agent_revised_proposal',
      revision_number: 2,
      feedback_record_hash: feedback.record_hash,
      codemode: expect.objectContaining({
        runtime: 'CodemodeRuntime',
        executor: 'local-test',
        execution_status: 'paused',
        pending_action: expect.objectContaining({
          connector: 'repository',
          method: 'write_file',
        }),
      }),
    })
    expect(trace.trace_packet.answer).toMatchObject({
      decision: null,
      executed: false,
      outcome: 'pending',
      changed: [],
    })
    expect(await getTargetRows(runId, 'server/middleware/rate_limit.ts')).toEqual([])

    const duplicateResponse = await dispatch(`/api/runs/${runId}/request-changes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        feedback: 'Try to request a second revision.',
      }),
    })
    const duplicateBody = (await duplicateResponse.json()) as { error?: string }
    const afterDuplicate = await getAgentRun(runId)

    expect(duplicateResponse.status).toBe(409)
    expect(duplicateBody.error).toMatch(/already has a requested revision/)
    expect(labels(afterDuplicate)).toEqual([
      'trigger',
      'triage',
      'proposal',
      'change_request',
      'runtime_rejection',
      'revision',
    ])
    expect(afterDuplicate.status).toBe('pending_approval')

    const approved = await approveRun(runId)
    const approvedRecords = byLabel(approved)
    const approval = approvedRecords.get('approval')!
    expect(approved.status).toBe('succeeded')
    expect(labels(approved)).toEqual([
      'trigger',
      'triage',
      'proposal',
      'change_request',
      'runtime_rejection',
      'revision',
      'approval',
      'execution',
      'outcome',
      'handoff',
    ])
    expect(sorted(approval.record.informed_by)).toEqual([revision.record_hash])
    expect(await getTargetRows(runId, 'server/middleware/rate_limit.ts')).toEqual([
      expect.objectContaining({
        file: 'server/middleware/rate_limit.ts',
        state: expect.objectContaining({
          rate_limit: expect.objectContaining({
            max: 60,
            scope: '/v1/report',
          }),
        }),
      }),
    ])
  })

  it('lets a reviewer reject the revised proposal without MCP execution', async () => {
    const runId = uniqueRunId('changes-rejected-local-e2e')
    await createRun(runId)
    const revised = await requestChanges(runId)
    const revision = byLabel(revised).get('revision')!
    const trace = await rejectRun(runId)
    const records = byLabel(trace)
    const rejection = records.get('rejection')!
    const runtimeRejections = trace.records.filter((record) => record.label === 'runtime_rejection')

    expect(trace.status).toBe('rejected')
    expect(labels(trace)).toEqual([
      'trigger',
      'triage',
      'proposal',
      'change_request',
      'runtime_rejection',
      'revision',
      'rejection',
      'runtime_rejection',
    ])
    await expectSignedTrace(trace)
    expect(sorted(rejection.record.informed_by)).toEqual([revision.record_hash])
    expect(runtimeRejections).toHaveLength(2)
    expect(runtimeRejections[1]?.body).toMatchObject({
      kind: 'codemode_runtime_rejection',
      reason: 'rejected',
      terminated: true,
      execution_status: 'rejected',
    })
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
    const runId = uniqueRunId('error-local-e2e')
    await createRun(runId, true)
    const trace = await approveRun(runId)
    const records = byLabel(trace)
    const execution = records.get('execution')!
    const outcome = records.get('outcome')!

    expect(trace.status).toBe('failed')
    expect(labels(trace)).toEqual([
      'trigger',
      'triage',
      'proposal',
      'approval',
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
    const runId = uniqueRunId('stale-approval-local-e2e')
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
