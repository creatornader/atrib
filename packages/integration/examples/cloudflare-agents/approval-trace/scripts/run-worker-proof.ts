// SPDX-License-Identifier: Apache-2.0
/* eslint-disable no-console */

import { execFile as execFileCallback } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import {
  canonicalRecord,
  hexEncode,
  sha256,
  verifyInclusion,
  verifyRecord,
  type AtribRecord,
  type ProofBundle,
} from '@atrib/mcp/worker'
import { buildGraph } from '@atrib/graph-node'

const execFile = promisify(execFileCallback)
const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT_DIR = resolve(HERE, '..')
const PREPARE_SECRETS_SCRIPT = resolve(HERE, 'prepare-demo-secrets.mjs')
const RUNS_DIR = resolve(PROJECT_DIR, 'runs')

type WorkflowStatus =
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'changes_requested'
  | 'executing'
  | 'succeeded'
  | 'failed'
type SignerRole = 'agent' | 'human' | 'action_mcp' | 'codemode_runtime'

const APPROVAL_POLICY_ID = 'cloudflare-workers-payment-route-write'
const APPROVAL_POLICY_VERSION = '2026-06-26.1'
const CODEMODE_RUNTIME_VERSION = '@cloudflare/codemode@0.4.1'

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
      outcome: 'not_run' | 'revision_requested' | 'success' | 'error' | 'pending'
      changed: string[]
    }
    differentiators: Array<{ name: string; evidence_labels: string[] }>
    handoff?: {
      receipt_head?: Record<string, unknown> | null
      record_hash?: string | null
      public_context_url?: string | null
    }
    receipt_state: {
      head_record_hash: string | null
      proposal_record_hash: string | null
      decision_record_hash: string | null
      runtime_record_hash: string | null
      outcome_record_hash: string | null
      handoff_record_hash: string | null
      policy: Record<string, unknown> | null
      continuation: Record<string, unknown> | null
      latest_receipt_check: Record<string, unknown> | null
    }
    timeline: Array<{
      label: string
      signer: SignerRole
      record_hash: string
      informed_by: string[]
    }>
  }
  records: TraceRecord[]
}

interface ParsedCheckpoint {
  treeSize: number
  rootHash: string
}

interface GraphEdgeLike {
  type: string
  source: string
  target: string
}

interface GraphNodeLike {
  id: string
  verification_state?: string
}

interface GraphResponseLike {
  nodes: GraphNodeLike[]
  edges: GraphEdgeLike[]
}

interface Check {
  name: string
  ok: boolean
  detail?: string
}

function recordHash(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

function parseCheckpoint(checkpoint: string): ParsedCheckpoint {
  const body = checkpoint.split('\n\n')[0]
  const lines = body?.trimEnd().split('\n') ?? []
  const treeSize = Number(lines[1])
  const rootHash = lines[2]
  if (!Number.isInteger(treeSize) || treeSize < 1 || !rootHash) {
    throw new Error(`Malformed checkpoint body: ${body}`)
  }
  return { treeSize, rootHash }
}

function verifyProof(proof: ProofBundle): boolean {
  const checkpoint = parseCheckpoint(proof.checkpoint)
  const rootHash = new Uint8Array(Buffer.from(checkpoint.rootHash, 'base64'))
  const leafHash = new Uint8Array(Buffer.from(proof.leaf_hash, 'base64'))
  const proofHashes = proof.inclusion_proof.map(
    (item: string) => new Uint8Array(Buffer.from(item, 'base64')),
  )
  return verifyInclusion(proof.log_index, checkpoint.treeSize, leafHash, proofHashes, rootHash)
}

async function ensureSecretFile(): Promise<void> {
  await execFile(process.execPath, [PREPARE_SECRETS_SCRIPT], {
    cwd: PROJECT_DIR,
    maxBuffer: 1024 * 1024,
  })
}

async function runWranglerDeploy(): Promise<string> {
  const { stdout, stderr } = await execFile(
    'pnpm',
    ['exec', 'wrangler', 'deploy', '--secrets-file', '.tmp/secrets.json'],
    { cwd: PROJECT_DIR, maxBuffer: 1024 * 1024 * 10 },
  )
  const combined = `${stdout}\n${stderr}`
  const urls = combined.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev/giu)
  const workerUrl = urls?.at(-1)
  if (!workerUrl) throw new Error(`Could not find workers.dev URL in wrangler output:\n${combined}`)
  return workerUrl.replace(/\/$/u, '')
}

async function postJson<T>(
  url: string,
  body: unknown,
  options: { retryServerErrors?: boolean } = {},
): Promise<T> {
  let lastError = ''
  const maxAttempts = options.retryServerErrors === false ? 1 : 6
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (response.ok) return (await response.json()) as T
    lastError = `${response.status} ${await response.text()}`
    if (response.status < 500) break
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
  }
  throw new Error(`${url} failed: ${lastError}`)
}

async function postExpectStatus(
  url: string,
  body: unknown,
  expectedStatus: number,
  expectedBodySnippet: string,
): Promise<Check> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  return {
    name: `${url}: expected ${expectedStatus}`,
    ok: response.status === expectedStatus && text.includes(expectedBodySnippet),
    detail: `${response.status} ${text}`,
  }
}

async function createRun(
  workerUrl: string,
  prefix: string,
  simulateError = false,
): Promise<string> {
  const runId = `${prefix}-${crypto.randomUUID()}`
  await postJson<TraceResponse>(`${workerUrl}/api/runs`, {
    run_id: runId,
    prompt:
      'Workers Observability detected checkout 500s after deploy; Browser Run reproduced the failure and Code Mode proposed a guarded Workers patch.',
    simulate_error: simulateError,
    code_mode_executor: 'dynamic-worker',
  })
  return runId
}

async function approveRun(workerUrl: string, runId: string): Promise<TraceResponse> {
  return postJson<TraceResponse>(
    `${workerUrl}/api/runs/${runId}/approve`,
    {
      reason:
        'Payload matches the observability alert, Browser Run evidence, and expected Workers checkout target.',
    },
    { retryServerErrors: false },
  )
}

async function rejectRun(workerUrl: string, runId: string): Promise<TraceResponse> {
  return postJson<TraceResponse>(
    `${workerUrl}/api/runs/${runId}/reject`,
    {
      reason: 'The reviewer decided this Workers checkout patch should not be applied.',
    },
    { retryServerErrors: false },
  )
}

async function requestChanges(workerUrl: string, runId: string): Promise<TraceResponse> {
  return postJson<TraceResponse>(
    `${workerUrl}/api/runs/${runId}/request-changes`,
    {
      feedback:
        'Keep the checkout guard scoped to missing cart ids, preserve Browser Run evidence, and show me the revised proposal before any Code Mode write.',
    },
    { retryServerErrors: false },
  )
}

async function runApproved(workerUrl: string, simulateError: boolean): Promise<TraceResponse> {
  const runId = await createRun(workerUrl, simulateError ? 'error' : 'approved', simulateError)
  return approveRun(workerUrl, runId)
}

async function runRejected(workerUrl: string): Promise<TraceResponse> {
  const runId = await createRun(workerUrl, 'rejected')
  return rejectRun(workerUrl, runId)
}

async function runChangesPending(workerUrl: string): Promise<{
  trace: TraceResponse
  duplicateConflict: Check
}> {
  const runId = await createRun(workerUrl, 'changes-pending')
  const trace = await requestChanges(workerUrl, runId)
  const duplicateConflict = await postExpectStatus(
    `${workerUrl}/api/runs/${runId}/request-changes`,
    { feedback: 'Please revise the revised proposal again.' },
    409,
    'already has a requested revision',
  )
  return { trace, duplicateConflict }
}

async function runChangesApproved(workerUrl: string): Promise<TraceResponse> {
  const runId = await createRun(workerUrl, 'changes-approved')
  await requestChanges(workerUrl, runId)
  return approveRun(workerUrl, runId)
}

async function runChangesRejected(workerUrl: string): Promise<TraceResponse> {
  const runId = await createRun(workerUrl, 'changes-rejected')
  await requestChanges(workerUrl, runId)
  return rejectRun(workerUrl, runId)
}

function refsEqual(actual: string[] | undefined, expected: string[]): boolean {
  const a = [...(actual ?? [])].sort()
  const e = [...expected].sort()
  return a.length === e.length && a.every((value, index) => value === e[index])
}

function hasGraphEdge(
  graph: GraphResponseLike,
  type: string,
  source: string,
  target: string,
): boolean {
  return graph.edges.some(
    (edge) => edge.type === type && edge.source === source && edge.target === target,
  )
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function objectField(value: unknown, key: string): Record<string, unknown> | null {
  return asObject(asObject(value)?.[key])
}

function stringField(value: unknown, key: string): string | null {
  const field = asObject(value)?.[key]
  return typeof field === 'string' ? field : null
}

function numberField(value: unknown, key: string): number | null {
  const field = asObject(value)?.[key]
  return typeof field === 'number' ? field : null
}

function policyFromBody(body: unknown): Record<string, unknown> | null {
  return objectField(body, 'policy')
}

function continuationFromBody(body: unknown): Record<string, unknown> | null {
  return (
    objectField(objectField(body, 'codemode'), 'continuation') ??
    objectField(objectField(body, 'decision_scope'), 'continuation') ??
    objectField(body, 'continuation') ??
    objectField(objectField(body, 'receipt_head'), 'continuation')
  )
}

function policyMatches(policy: unknown): boolean {
  const body = asObject(policy)
  return (
    body?.policy_id === APPROVAL_POLICY_ID &&
    body?.policy_version === APPROVAL_POLICY_VERSION &&
    body?.approval_boundary === 'codemode_pending_action'
  )
}

function continuationMatches(continuation: unknown, expectedPayloadHash: string | null): boolean {
  const body = asObject(continuation)
  const continuationId = stringField(body, 'continuation_id')
  const seq = numberField(body, 'seq')
  const inputDigest = stringField(body, 'input_digest')
  const payloadHash = stringField(body, 'payload_hash')
  return (
    typeof continuationId === 'string' &&
    continuationId.startsWith('exec_') &&
    typeof seq === 'number' &&
    seq >= 0 &&
    body?.runtime === 'CodemodeRuntime' &&
    body?.method === 'write_file' &&
    body?.connector === 'repository' &&
    typeof inputDigest === 'string' &&
    (expectedPayloadHash === null || payloadHash === expectedPayloadHash)
  )
}

function sameContinuationId(left: unknown, right: unknown): boolean {
  const leftId = stringField(left, 'continuation_id')
  const rightId = stringField(right, 'continuation_id')
  return typeof leftId === 'string' && leftId === rightId
}

function receiptCheckOk(value: unknown): boolean {
  const check = asObject(value)
  return (
    check?.ok === true &&
    Array.isArray(check.checked_record_hashes) &&
    check.checked_record_hashes.length > 0
  )
}

async function verifyTrace(trace: TraceResponse): Promise<Check[]> {
  const checks: Check[] = []
  const push = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail })
  const byLabel = new Map(trace.records.map((record) => [record.label, record]))
  const trigger = byLabel.get('trigger')
  const triage = byLabel.get('triage')
  const proposal = byLabel.get('proposal')
  const changeRequest = byLabel.get('change_request')
  const revision = byLabel.get('revision')
  const decision = byLabel.get('approval') ?? byLabel.get('rejection')
  const execution = byLabel.get('execution')
  const outcome = byLabel.get('outcome')
  const handoff = byLabel.get('handoff')
  const runtimeRejections = trace.records.filter((record) => record.label === 'runtime_rejection')
  const latestRuntimeRejection = runtimeRejections[runtimeRejections.length - 1]
  const decisionBase = revision ?? proposal
  const activeRuntime = execution ?? latestRuntimeRejection
  const activeProposalBody = asObject(decisionBase?.body)
  const activePayloadHash = stringField(activeProposalBody, 'proposed_payload_hash')
  const activeContinuation = continuationFromBody(activeProposalBody)
  const receiptState = trace.trace_packet.receipt_state
  const receiptContinuation = receiptState.continuation
  const graph = (await buildGraph(
    trace.records.map((record) => record.record),
    [],
    { compactIntraSessionEdges: true },
  )) as GraphResponseLike
  const graphNodeIds = new Set(graph.nodes.map((node) => node.id))
  const packetTimeline = trace.trace_packet.timeline

  for (const item of trace.records) {
    push(`${trace.run_id}:${item.label}: hash`, recordHash(item.record) === item.record_hash)
    push(`${trace.run_id}:${item.label}: signature`, await verifyRecord(item.record))
    push(`${trace.run_id}:${item.label}: context`, item.record.context_id === trace.context_id)
    push(`${trace.run_id}:${item.label}: proof present`, Boolean(item.proof))
    if (item.proof) push(`${trace.run_id}:${item.label}: inclusion`, verifyProof(item.proof))
  }

  push(`${trace.run_id}: trigger exists`, Boolean(trigger))
  push(`${trace.run_id}: triage exists`, Boolean(triage))
  push(`${trace.run_id}: proposal exists`, Boolean(proposal))
  if (trace.status === 'pending_approval') {
    push(`${trace.run_id}: decision pending`, !decision)
  } else {
    push(`${trace.run_id}: decision exists`, Boolean(decision))
  }
  push(
    `${trace.run_id}: packet timeline order matches records`,
    JSON.stringify(packetTimeline.map((item) => item.label)) ===
      JSON.stringify(trace.records.map((record) => record.label)),
  )
  push(
    `${trace.run_id}: packet timeline mirrors record refs`,
    packetTimeline.length === trace.records.length &&
      packetTimeline.every((item, index) => {
        const record = trace.records[index]
        return (
          record &&
          item.label === record.label &&
          item.signer === record.signer &&
          item.record_hash === record.record_hash &&
          refsEqual(item.informed_by, record.record.informed_by ?? [])
        )
      }),
  )
  if (trace.run_id.startsWith('changes-rejected-')) {
    const runtimeRejections = trace.records.filter((record) => record.label === 'runtime_rejection')
    push(
      `${trace.run_id}: packet preserves both Code Mode rejection records`,
      runtimeRejections.length === 2 &&
        packetTimeline.filter((item) => item.label === 'runtime_rejection').length === 2 &&
        runtimeRejections.every((record) =>
          packetTimeline.some((item) => item.record_hash === record.record_hash),
        ),
    )
  }
  push(
    `${trace.run_id}: graph nodes cover records`,
    trace.records.every((record) => graphNodeIds.has(record.record_hash)),
  )
  push(
    `${trace.run_id}: graph signatures valid`,
    graph.nodes
      .filter((node) => graphNodeIds.has(node.id))
      .every((node) => node.verification_state === 'signature_valid'),
  )
  push(
    `${trace.run_id}: triage points at trigger`,
    Boolean(trigger && triage && refsEqual(triage.record.informed_by, [trigger.record_hash])),
  )
  push(
    `${trace.run_id}: graph trigger-to-triage edge`,
    Boolean(
      trigger &&
      triage &&
      hasGraphEdge(graph, 'INFORMED_BY', triage.record_hash, trigger.record_hash),
    ),
  )
  push(
    `${trace.run_id}: proposal points at triage`,
    Boolean(triage && proposal && refsEqual(proposal.record.informed_by, [triage.record_hash])),
  )
  push(
    `${trace.run_id}: graph triage-to-proposal edge`,
    Boolean(
      triage &&
      proposal &&
      hasGraphEdge(graph, 'INFORMED_BY', proposal.record_hash, triage.record_hash),
    ),
  )
  if (changeRequest || revision) {
    push(`${trace.run_id}: change request exists`, Boolean(changeRequest))
    push(`${trace.run_id}: revision exists`, Boolean(revision))
    push(
      `${trace.run_id}: change request closes first Code Mode action`,
      Boolean(runtimeRejections[0]),
    )
    push(
      `${trace.run_id}: change request points at proposal`,
      Boolean(
        proposal &&
        changeRequest &&
        refsEqual(changeRequest.record.informed_by, [proposal.record_hash]),
      ),
    )
    push(
      `${trace.run_id}: graph proposal-to-change-request edge`,
      Boolean(
        proposal &&
        changeRequest &&
        hasGraphEdge(graph, 'INFORMED_BY', changeRequest.record_hash, proposal.record_hash),
      ),
    )
    push(
      `${trace.run_id}: runtime rejection points at change request`,
      Boolean(
        changeRequest &&
        runtimeRejections[0] &&
        refsEqual(runtimeRejections[0].record.informed_by, [changeRequest.record_hash]),
      ),
    )
    push(
      `${trace.run_id}: revision points at proposal and change request`,
      Boolean(
        proposal &&
        changeRequest &&
        revision &&
        refsEqual(revision.record.informed_by, [proposal.record_hash, changeRequest.record_hash]),
      ),
    )
    push(
      `${trace.run_id}: graph revision edges`,
      Boolean(
        proposal &&
        changeRequest &&
        revision &&
        hasGraphEdge(graph, 'INFORMED_BY', revision.record_hash, proposal.record_hash) &&
        hasGraphEdge(graph, 'INFORMED_BY', revision.record_hash, changeRequest.record_hash),
      ),
    )
  }

  push(
    `${trace.run_id}: proposal carries approval policy`,
    Boolean(proposal && policyMatches(policyFromBody(proposal.body))),
  )
  push(
    `${trace.run_id}: active proposal carries Code Mode runtime version`,
    stringField(objectField(activeProposalBody, 'codemode'), 'runtime_version') ===
      CODEMODE_RUNTIME_VERSION,
  )
  push(
    `${trace.run_id}: active proposal carries pending continuation`,
    continuationMatches(activeContinuation, activePayloadHash),
  )
  push(
    `${trace.run_id}: packet receipt policy matches active proposal`,
    Boolean(
      policyMatches(receiptState.policy) && policyMatches(policyFromBody(activeProposalBody)),
    ),
  )
  push(
    `${trace.run_id}: packet receipt continuation matches active proposal`,
    Boolean(
      continuationMatches(receiptContinuation, activePayloadHash) &&
      sameContinuationId(receiptContinuation, activeContinuation),
    ),
  )
  push(
    `${trace.run_id}: packet receipt proposal hash matches active proposal`,
    receiptState.proposal_record_hash === (decisionBase?.record_hash ?? null),
  )
  push(
    `${trace.run_id}: packet receipt decision hash matches active decision`,
    receiptState.decision_record_hash === ((decision ?? changeRequest)?.record_hash ?? null),
  )
  push(
    `${trace.run_id}: packet receipt runtime hash matches terminal runtime`,
    receiptState.runtime_record_hash === (activeRuntime?.record_hash ?? null),
  )
  push(
    `${trace.run_id}: packet receipt outcome hash matches outcome`,
    receiptState.outcome_record_hash === (outcome?.record_hash ?? null),
  )
  push(
    `${trace.run_id}: packet receipt handoff hash matches handoff`,
    receiptState.handoff_record_hash === (handoff?.record_hash ?? null),
  )
  push(
    `${trace.run_id}: decision points at active proposal`,
    trace.status === 'pending_approval'
      ? !decision
      : Boolean(
          decisionBase && refsEqual(decision?.record.informed_by, [decisionBase.record_hash]),
        ),
  )
  push(
    `${trace.run_id}: graph decision edge`,
    trace.status === 'pending_approval'
      ? !decision
      : Boolean(
          decisionBase &&
          decision &&
          hasGraphEdge(graph, 'INFORMED_BY', decision.record_hash, decisionBase.record_hash),
        ),
  )
  push(
    `${trace.run_id}: differentiators present`,
    [
      'Autonomous trigger context',
      'Decision context',
      'Signed decision chain',
      'Trustless audit',
      'Signer separation',
    ].every((name) => trace.trace_packet.differentiators.some((item) => item.name === name)),
  )

  const agentKey = proposal?.record.creator_key
  const humanKey = (decision ?? changeRequest)?.record.creator_key
  const runtimeKey = (execution ?? latestRuntimeRejection)?.record.creator_key
  push(
    `${trace.run_id}: agent and human signers differ`,
    Boolean(agentKey && humanKey && agentKey !== humanKey),
  )
  if (runtimeKey) {
    push(
      `${trace.run_id}: human and Code Mode signers differ`,
      Boolean(humanKey && humanKey !== runtimeKey),
    )
  }

  if (trace.status === 'rejected') {
    push(`${trace.run_id}: rejected did not execute`, !execution && !outcome && !handoff)
    push(`${trace.run_id}: rejected closed Code Mode action`, Boolean(latestRuntimeRejection))
    push(
      `${trace.run_id}: rejected decision carries approval policy`,
      Boolean(decision && policyMatches(policyFromBody(decision.body))),
    )
    push(
      `${trace.run_id}: rejected decision continuation matches proposal`,
      Boolean(
        decision && sameContinuationId(continuationFromBody(decision.body), activeContinuation),
      ),
    )
    push(
      `${trace.run_id}: rejected runtime closure carries receipt state`,
      Boolean(
        latestRuntimeRejection &&
        policyMatches(policyFromBody(latestRuntimeRejection.body)) &&
        sameContinuationId(continuationFromBody(latestRuntimeRejection.body), activeContinuation),
      ),
    )
    push(
      `${trace.run_id}: rejected runtime closure points at decision`,
      Boolean(
        decision &&
        latestRuntimeRejection &&
        refsEqual(latestRuntimeRejection.record.informed_by, [decision.record_hash]),
      ),
    )
    push(
      `${trace.run_id}: rejected packet decision`,
      trace.trace_packet.answer.decision === 'rejected',
    )
    push(
      `${trace.run_id}: rejected packet outcome`,
      trace.trace_packet.answer.outcome === 'not_run',
    )
  } else if (trace.status === 'pending_approval') {
    push(`${trace.run_id}: pending did not execute`, !execution && !outcome && !handoff)
    push(`${trace.run_id}: pending packet decision`, trace.trace_packet.answer.decision === null)
    push(`${trace.run_id}: pending packet outcome`, trace.trace_packet.answer.outcome === 'pending')
    push(`${trace.run_id}: pending packet executed`, trace.trace_packet.answer.executed === false)
    push(
      `${trace.run_id}: pending revision receipt check passed`,
      revision
        ? receiptCheckOk(revision.body && asObject(revision.body)?.pre_revision_receipt_check)
        : true,
    )
  } else {
    push(`${trace.run_id}: execution exists`, Boolean(execution))
    push(`${trace.run_id}: outcome exists`, Boolean(outcome))
    push(`${trace.run_id}: handoff exists`, Boolean(handoff))
    push(
      `${trace.run_id}: approval carries approval policy`,
      Boolean(decision && policyMatches(policyFromBody(decision.body))),
    )
    push(
      `${trace.run_id}: approval continuation matches proposal`,
      Boolean(
        decision && sameContinuationId(continuationFromBody(decision.body), activeContinuation),
      ),
    )
    push(
      `${trace.run_id}: execution carries pre-resume receipt check`,
      Boolean(execution && receiptCheckOk(asObject(execution.body)?.pre_resume_receipt_check)),
    )
    push(
      `${trace.run_id}: execution continuation matches approval`,
      Boolean(
        decision &&
        execution &&
        sameContinuationId(
          continuationFromBody(execution.body),
          continuationFromBody(decision.body),
        ),
      ),
    )
    push(
      `${trace.run_id}: execution used exact-once decision fence`,
      trace.status === 'failed'
        ? true
        : Boolean(
            asObject(asObject(asObject(asObject(execution?.body)?.output)?.result)?.execution)
              ?.exact_once,
          ),
    )
    push(
      `${trace.run_id}: approved packet decision`,
      trace.trace_packet.answer.decision === 'approved',
    )
    push(
      `${trace.run_id}: execution points at approval`,
      Boolean(
        decisionBase &&
        decision &&
        execution &&
        refsEqual(execution.record.informed_by, [decisionBase.record_hash, decision.record_hash]),
      ),
    )
    push(
      `${trace.run_id}: graph execution edges`,
      Boolean(
        decisionBase &&
        decision &&
        execution &&
        hasGraphEdge(graph, 'INFORMED_BY', execution.record_hash, decisionBase.record_hash) &&
        hasGraphEdge(graph, 'INFORMED_BY', execution.record_hash, decision.record_hash),
      ),
    )
    push(
      `${trace.run_id}: outcome points at execution`,
      Boolean(execution && refsEqual(outcome?.record.informed_by, [execution.record_hash])),
    )
    push(
      `${trace.run_id}: graph outcome edge`,
      Boolean(
        execution &&
        outcome &&
        hasGraphEdge(graph, 'INFORMED_BY', outcome.record_hash, execution.record_hash),
      ),
    )
    push(
      `${trace.run_id}: handoff points at approval and outcome`,
      Boolean(
        decision &&
        outcome &&
        refsEqual(handoff?.record.informed_by, [decision.record_hash, outcome.record_hash]),
      ),
    )
    push(
      `${trace.run_id}: graph handoff edges`,
      Boolean(
        decision &&
        outcome &&
        handoff &&
        hasGraphEdge(graph, 'INFORMED_BY', handoff.record_hash, decision.record_hash) &&
        hasGraphEdge(graph, 'INFORMED_BY', handoff.record_hash, outcome.record_hash),
      ),
    )
    push(
      `${trace.run_id}: handoff receipt head matches final records`,
      Boolean(
        handoff &&
        outcome &&
        execution &&
        decision &&
        asObject(handoff.body)?.receipt_head &&
        stringField(asObject(handoff.body)?.receipt_head, 'head_record_hash') ===
          outcome.record_hash &&
        stringField(asObject(handoff.body)?.receipt_head, 'proposal_record_hash') ===
          decisionBase?.record_hash &&
        stringField(asObject(handoff.body)?.receipt_head, 'decision_record_hash') ===
          decision.record_hash &&
        stringField(asObject(handoff.body)?.receipt_head, 'execution_record_hash') ===
          execution.record_hash &&
        stringField(asObject(handoff.body)?.receipt_head, 'outcome_record_hash') ===
          outcome.record_hash &&
        policyMatches(objectField(asObject(handoff.body)?.receipt_head, 'policy')) &&
        sameContinuationId(
          objectField(asObject(handoff.body)?.receipt_head, 'continuation'),
          activeContinuation,
        ) &&
        receiptCheckOk(objectField(asObject(handoff.body)?.receipt_head, 'receipt_state_check')),
      ),
    )
    push(
      `${trace.run_id}: packet receipt head follows handoff head`,
      Boolean(
        handoff &&
        stringField(asObject(handoff.body)?.receipt_head, 'head_record_hash') ===
          receiptState.head_record_hash,
      ),
    )
    push(
      `${trace.run_id}: final outcome matches status`,
      trace.status === 'failed'
        ? trace.trace_packet.answer.outcome === 'error'
        : trace.trace_packet.answer.outcome === 'success',
    )
  }

  return checks
}

async function main() {
  await ensureSecretFile()
  const workerUrl = await runWranglerDeploy()
  await new Promise((resolve) => setTimeout(resolve, 1500))
  const page = await (await fetch(workerUrl)).text()
  const checks: Check[] = [
    {
      name: 'interactive UI renders',
      ok:
        page.includes('data-testid="approval-trace-app"') &&
        page.includes('Cloudflare Agent Trace') &&
        page.includes('Code Mode approval halted') &&
        page.includes('Trigger &amp; progress') &&
        page.includes('write_file') &&
        page.includes('Record timeline') &&
        page.includes('Receipt head') &&
        page.includes('Continuation') &&
        page.includes('Receipt inspector') &&
        page.includes('Approve and resume') &&
        page.includes('Request changes'),
    },
  ]

  const revisionPending = await runChangesPending(workerUrl)
  checks.push(revisionPending.duplicateConflict)
  const traces = [
    revisionPending.trace,
    await runApproved(workerUrl, false),
    await runRejected(workerUrl),
    await runApproved(workerUrl, true),
    await runChangesApproved(workerUrl),
    await runChangesRejected(workerUrl),
  ]
  for (const trace of traces) checks.push(...(await verifyTrace(trace)))

  const ok = checks.every((check) => check.ok)
  const run = {
    ran_at: new Date().toISOString(),
    ok,
    worker_url: workerUrl,
    checks,
    traces,
  }

  await mkdir(RUNS_DIR, { recursive: true })
  const outPath = resolve(
    RUNS_DIR,
    `${new Date().toISOString().replaceAll(':', '').replaceAll('.', '')}.worker.json`,
  )
  await writeFile(outPath, `${JSON.stringify(run, null, 2)}\n`)
  console.log(JSON.stringify(run, null, 2))
  console.error(`wrote ${outPath}`)

  if (!ok) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
