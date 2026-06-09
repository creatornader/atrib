// SPDX-License-Identifier: Apache-2.0

import { Agent, getAgentByName } from 'agents'
import { McpAgent, RPCClientTransport } from 'agents/mcp'
import { genericObservability } from 'agents/observability'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  EVENT_TYPE_OBSERVATION_URI,
  atrib,
  base64urlDecode,
  base64urlEncode,
  canonicalRecord,
  computeContentId,
  encodeToken,
  genesisChainRoot,
  getPublicKey,
  hexEncode,
  sha256,
  signRecord,
  verifyRecord as verifyAtribRecord,
  type AtribRecord,
  type OnRecordSidecar,
  type ProofBundle,
} from '@atrib/mcp/worker'
import { z } from 'zod'
import { renderApp } from './ui.js'

type WorkflowStatus =
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'changes_requested'
  | 'executing'
  | 'succeeded'
  | 'failed'
type Decision = 'approved' | 'rejected' | 'changes_requested' | null
type SignerRole = 'agent' | 'human' | 'action_mcp'

interface Env {
  ATRIB_AGENT_PRIVATE_KEY: string
  ATRIB_HUMAN_APPROVER_PRIVATE_KEY: string
  ATRIB_ACTION_MCP_PRIVATE_KEY: string
  ATRIB_LOG_ENDPOINT?: string
  ATRIB_AGENT_SERVER_URL?: string
  ATRIB_ACTION_MCP_SERVER_URL?: string
  OPENAI_API_KEY?: string
  OPENAI_BASE_URL?: string
  OPENAI_MODEL?: string
  ApprovalTraceAgent: DurableObjectNamespace<ApprovalTraceAgent>
  ApprovalActionMcp: DurableObjectNamespace<ApprovalActionMcp>
}

interface PlannedAction {
  planner: 'model' | 'fixture'
  action: string
  summary: string
  risk: string
  payload: {
    operation: 'write_file'
    issue_id: string
    repository: string
    labels: string[]
    target_file: string
    version: number
    before: Record<string, unknown>
    after: Record<string, unknown>
    diff: string
  }
}

interface WorkflowRow {
  run_id: string
  status: WorkflowStatus
  prompt: string
  context_id: string
  proposal_record_hash: string
  decision_record_hash: string | null
  outcome_record_hash: string | null
  payload_hash: string
  payload_json: string
  planner: string
  decision: Decision
  decision_reason: string | null
  created_at: number
  updated_at: number
}

interface TraceRecordRow {
  run_id: string
  label: string
  signer: SignerRole
  record_hash: string
  record_json: string
  body_json: string | null
  args_json: string | null
  result_json: string | null
  proof_json: string | null
  created_at: number
}

interface NativeObservabilityRow {
  run_id: string
  idx: number
  channel: string
  type: string
  event_json: string
  created_at: number
}

interface NativeObservabilityEvent {
  channel: string
  type: string
  agent: string
  name: string
  payload: Record<string, unknown>
  timestamp: number
}

interface TraceRecordInput {
  runId: string
  label: string
  signer: SignerRole
  record: AtribRecord
  body?: unknown
  args?: unknown
  result?: unknown
  proof?: ProofBundle | null
}

interface CapturedActionRecord {
  label: string
  signer: SignerRole
  record_hash: string
  record: AtribRecord
  body?: unknown
  args?: unknown
  result?: unknown
  proof?: ProofBundle | null
}

interface ApprovalContext {
  run_id: string
  status: WorkflowStatus
  context_id: string
  approval_record_hash: string
  approval_timestamp: number
  approval_token: string
  traceparent: string
  payload_hash: string
  payload: PlannedAction['payload']
}

interface ExecutionContext {
  run_id: string
  context_id: string
  approval_record_hash: string
  payload_hash: string
  payload: PlannedAction['payload']
  stable_connector_id: string
  mode: 'approved' | 'error'
}

interface ListedActionRecord {
  record_hash: string
  label: string
  signer: SignerRole
  record: AtribRecord
  sidecar: OnRecordSidecar
  body?: unknown
  created_at: number
}

const TEXT_ENCODER = new TextEncoder()
const STABLE_CONNECTOR_ID = 'cloudflare-demo-repository-write-mcp'
const LOG_BASE_URL = 'https://log.atrib.dev/v1'
const DEFAULT_TRIGGER_PROMPT =
  'A GitHub issue webhook reported that /v1/report needs rate limiting before the next traffic spike.'
const TRACE_RECORD_OFFSETS_MS = {
  trigger: 0,
  triage: 275,
  proposal: 650,
  approval: 950,
  rejection: 950,
  changesRequested: 950,
  revision: 1_450,
  reviewDecisionDelay: 1_600,
  handoff: 1_700,
  postApprovalPause: 125,
}

type BaseAgentNamespace = DurableObjectNamespace<Agent<Env, unknown, Record<string, unknown>>>

async function getTraceAgent(env: Env, name: string): Promise<ApprovalTraceAgent> {
  return (await getAgentByName(
    env.ApprovalTraceAgent as unknown as BaseAgentNamespace,
    name,
  )) as unknown as ApprovalTraceAgent
}

function json(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  headers.set('Cache-Control', 'no-store')
  return new Response(`${JSON.stringify(value, null, 2)}\n`, { ...init, headers })
}

function errorJson(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error)
  const status = message.includes('not found')
    ? 404
    : message.includes('not pending approval')
      ? 409
      : 500
  return json({ ok: false, error: message }, { status })
}

function html(value: string): Response {
  return new Response(value, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

function requestRegion(request: Request): string {
  const cf = (request as Request & { cf?: { colo?: unknown } }).cf
  return typeof cf?.colo === 'string' && cf.colo ? cf.colo : 'IAD'
}

function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  )
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`
}

function hashUnknown(value: unknown): string {
  return `sha256:${hexEncode(sha256(TEXT_ENCODER.encode(stableStringify(value))))}`
}

function recordHash(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

function privateKey(secret: string): Uint8Array {
  return base64urlDecode(secret)
}

function randomContextId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return hexEncode(bytes)
}

function randomParentId(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  if (bytes.every((byte) => byte === 0)) bytes[0] = 1
  return hexEncode(bytes)
}

function serverUrl(env: Env, role: SignerRole): string {
  if (role === 'action_mcp') {
    return env.ATRIB_ACTION_MCP_SERVER_URL ?? 'mcp://atrib-cloudflare/action'
  }
  return env.ATRIB_AGENT_SERVER_URL ?? 'mcp://atrib-cloudflare/agent'
}

function runTimestamp(baseTimestamp: number, offsetMs: number): number {
  return Math.max(Date.now(), baseTimestamp + offsetMs)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function logEndpoint(env: Env): string | undefined {
  const endpoint = env.ATRIB_LOG_ENDPOINT?.trim()
  return endpoint ? endpoint : undefined
}

async function submitRecord(env: Env, record: AtribRecord): Promise<ProofBundle | null> {
  const endpoint = logEndpoint(env)
  if (!endpoint) return null
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-atrib-Priority': 'normal',
      },
      body: JSON.stringify(record),
    })
    if (!response.ok) {
      console.warn(`atrib log submit failed: ${response.status} ${await response.text()}`)
      return null
    }
    return (await response.json()) as ProofBundle
  } catch (error) {
    console.warn('atrib log submit failed', error)
    return null
  }
}

async function signObservation(input: {
  env: Env
  role: SignerRole
  key: Uint8Array
  contextId: string
  chainRoot: string
  toolName: string
  body: unknown
  informedBy?: string[]
  timestamp?: number
}): Promise<AtribRecord> {
  const creatorKey = base64urlEncode(await getPublicKey(input.key))
  const unsigned = {
    spec_version: 'atrib/1.0',
    content_id: computeContentId(serverUrl(input.env, input.role), input.toolName),
    creator_key: creatorKey,
    chain_root: input.chainRoot,
    event_type: EVENT_TYPE_OBSERVATION_URI,
    context_id: input.contextId,
    timestamp: input.timestamp ?? Date.now(),
    signature: '',
    result_hash: hashUnknown(input.body),
    tool_name: input.toolName,
    ...(input.informedBy?.length ? { informed_by: [...input.informedBy].sort() } : {}),
  } satisfies AtribRecord
  return signRecord(unsigned, input.key)
}

function emitNativeEvent(input: {
  channel: string
  type: string
  agent: string
  name: string
  payload: Record<string, unknown>
  timestamp?: number
}): NativeObservabilityEvent {
  const event = {
    channel: input.channel,
    type: input.type,
    agent: input.agent,
    name: input.name,
    payload: input.payload,
    timestamp: input.timestamp ?? Date.now(),
  }
  genericObservability.emit({
    type: input.type,
    agent: input.agent,
    name: input.name,
    payload: input.payload,
    timestamp: event.timestamp,
  } as Parameters<typeof genericObservability.emit>[0])
  return event
}

function fixturePlan(prompt: string): PlannedAction {
  const diff = `@@ -1,17 +1,27 @@
 import { NextFunction, Request, Response } from 'express';
 import { getConfig } from '../config';

 import { logRequest } from '../observability/logging';
 import { reportMetrics } from '../observability/metrics';
 import { resolveTenant } from '../tenant';

+import rateLimit from 'express-rate-limit';
+
+const limiter = rateLimit({
+  windowMs: 60 * 1000,
+  max: 100,
+  standardHeaders: true,
+  legacyHeaders: false,
+});

 const config = getConfig();

-export function reportHandler(req: Request, res: Response, next: NextFunction) {
+export const reportHandler = [limiter, (req: Request, res: Response, next: NextFunction) => {
   // existing logic
   next();
-}
+}];

 export function reportHealth(req: Request, res: Response) {
   const tenant = resolveTenant(req);
   reportMetrics('report.health', { tenant });
   res.json({ ok: true, tenant });
 }

 export function reportAudit(req: Request, res: Response) {
   logRequest(req, 'report.audit');
   res.status(204).end();
 }`
  return {
    planner: 'fixture',
    action: 'Update file in repository',
    summary:
      'Respond to a GitHub issue webhook by preparing a small repository file update that adds request limiting to the reported route.',
    risk: 'Introduces rate limiting which may impact client traffic if misconfigured.',
    payload: {
      operation: 'write_file',
      issue_id: 'workers-issue-4821',
      repository: 'cloudflare/agents-demo',
      labels: ['bug', 'workers', 'help'],
      target_file: 'server/middleware/rate_limit.ts',
      version: 4,
      before: {
        file: 'server/middleware/rate_limit.ts',
        imports: ['NextFunction', 'Request', 'Response', 'getConfig'],
        handler: 'reportHandler',
        rate_limit: null,
        issue: prompt.slice(0, 120),
      },
      after: {
        file: 'server/middleware/rate_limit.ts',
        imports: ['NextFunction', 'Request', 'Response', 'getConfig', 'rateLimit'],
        handler: 'reportHandler',
        rate_limit: {
          window_ms: 60_000,
          max: 100,
          standard_headers: true,
          legacy_headers: false,
        },
        note: 'Approved for this demo repository file only.',
      },
      diff,
    },
  }
}

function revisedPlanFromFeedback(
  priorPayload: PlannedAction['payload'],
  feedback: string,
): PlannedAction {
  const diff = `@@ -1,17 +1,30 @@
 import { NextFunction, Request, Response } from 'express';
 import { getConfig } from '../config';

 import { logRequest } from '../observability/logging';
 import { reportMetrics } from '../observability/metrics';
 import { resolveTenant } from '../tenant';

+import rateLimit from 'express-rate-limit';
+
+const reportLimiter = rateLimit({
+  windowMs: 60 * 1000,
+  max: 60,
+  standardHeaders: true,
+  legacyHeaders: false,
+  skip: (req) => req.path !== '/v1/report',
+});

 const config = getConfig();

-export function reportHandler(req: Request, res: Response, next: NextFunction) {
+export const reportHandler = [reportLimiter, (req: Request, res: Response, next: NextFunction) => {
   // existing logic
   next();
-}
+}];

 export function reportHealth(req: Request, res: Response) {
   const tenant = resolveTenant(req);
   reportMetrics('report.health', { tenant });
   res.json({ ok: true, tenant });
 }

 export function reportAudit(req: Request, res: Response) {
   logRequest(req, 'report.audit');
   res.status(204).end();
 }`
  return {
    planner: 'fixture',
    action: 'Update file in repository',
    summary:
      'Revise the repository file update after human feedback by keeping the guard scoped to the reported route.',
    risk: 'Narrows the limiter to /v1/report and lowers the default cap before any MCP write runs.',
    payload: {
      ...priorPayload,
      version: priorPayload.version + 1,
      after: {
        ...priorPayload.after,
        rate_limit: {
          window_ms: 60_000,
          max: 60,
          standard_headers: true,
          legacy_headers: false,
          scope: '/v1/report',
        },
        note: `Revised after human feedback: ${feedback.slice(0, 140)}`,
      },
      diff,
    },
  }
}

async function planAction(env: Env, prompt: string): Promise<PlannedAction> {
  if (!env.OPENAI_API_KEY) return fixturePlan(prompt)
  const baseUrl = env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'
  const model = env.OPENAI_MODEL ?? 'gpt-5.1'
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/u, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content:
              'Return compact JSON for a safe Cloudflare Workers repository file-change approval proposal. Do not include markdown.',
          },
          {
            role: 'user',
            content: `Prompt: ${prompt}\nReturn fields action, summary, risk, after_note.`,
          },
        ],
        response_format: { type: 'json_object' },
      }),
    })
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`)
    const parsed = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = parsed.choices?.[0]?.message?.content
    if (!content) throw new Error('model returned no content')
    const data = JSON.parse(content) as {
      action?: string
      summary?: string
      risk?: string
      after_note?: string
    }
    const fallback = fixturePlan(prompt)
    return {
      ...fallback,
      planner: 'model',
      action: data.action ?? fallback.action,
      summary: data.summary ?? fallback.summary,
      risk: data.risk ?? fallback.risk,
      payload: {
        ...fallback.payload,
        after: {
          ...fallback.payload.after,
          note: data.after_note ?? String(fallback.payload.after.note),
        },
      },
    }
  } catch (error) {
    console.warn('planner model failed, falling back to fixture', error)
    return fixturePlan(prompt)
  }
}

function parseToolResult(result: unknown): Record<string, unknown> {
  const content = (result as { content?: Array<{ type?: string; text?: string }> }).content
  const text = content?.find((item) => item.type === 'text')?.text
  if (typeof text !== 'string') return {}
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return {}
  }
}

function getTextResult(result: unknown): string {
  const content = (result as { content?: Array<{ type?: string; text?: string }> }).content
  const text = content?.find((item) => item.type === 'text')?.text
  if (!text) throw new Error(`MCP result did not include text: ${JSON.stringify(result)}`)
  return text
}

function tracePacket(
  workflow: WorkflowRow | null,
  records: TraceRecordRow[],
  nativeRows: NativeObservabilityRow[],
) {
  const parsed = records.map((row) => ({
    label: row.label,
    signer: row.signer,
    record_hash: row.record_hash,
    record: JSON.parse(row.record_json) as AtribRecord,
    body: row.body_json ? JSON.parse(row.body_json) : null,
    args: row.args_json ? JSON.parse(row.args_json) : null,
    result: row.result_json ? JSON.parse(row.result_json) : null,
    proof: row.proof_json ? (JSON.parse(row.proof_json) as ProofBundle) : null,
    created_at: row.created_at,
  }))
  const get = (label: string) => parsed.find((entry) => entry.label === label)
  const trigger = get('trigger')
  const triage = get('triage')
  const latestProposal =
    [...parsed].reverse().find((entry) => entry.label === 'revision') ?? get('proposal')
  const execution = get('execution')
  const outcome = get('outcome')
  const handoff = get('handoff')
  const outcomeBody = outcome?.body as {
    status?: string
    changed_rows?: string[]
    diagnostic?: string
  } | null
  const publicContextUrl = workflow?.context_id
    ? `${LOG_BASE_URL}/by-context/${workflow.context_id}`
    : null
  const nativeEvents = nativeRows.map(
    (row) => JSON.parse(row.event_json) as NativeObservabilityEvent,
  )

  return {
    answer: {
      question: 'Can I approve this, and can I verify what happened later?',
      status: workflow?.status ?? null,
      decision: workflow?.decision ?? null,
      executed: Boolean(execution),
      outcome:
        workflow?.status === 'changes_requested'
          ? 'revision_requested'
          : workflow?.status === 'rejected'
          ? 'not_run'
          : outcomeBody?.status === 'error'
            ? 'error'
            : outcomeBody?.status === 'success'
              ? 'success'
              : 'pending',
      changed: Array.isArray(outcomeBody?.changed_rows) ? outcomeBody.changed_rows : [],
      diagnostic: outcomeBody?.diagnostic ?? null,
    },
    differentiators: [
      {
        name: 'Autonomous trigger context',
        evidence:
          'The trace starts with the issue or schedule trigger that caused the agent to work before human review.',
        evidence_labels: [trigger ? 'trigger' : null, triage ? 'triage' : null].filter(
          Boolean,
        ) as string[],
      },
      {
        name: 'Decision context',
        evidence:
          'The proposal signs the exact Cloudflare-shaped payload before the reviewer approves.',
        evidence_labels: [latestProposal?.label ?? 'proposal'],
      },
      {
        name: 'Semantic causal chain',
        evidence:
          'Each transition points at the signed record it depended on, from proposal to approval to execution to outcome.',
        evidence_labels: parsed.map((entry) => entry.label),
      },
      {
        name: 'Trustless audit',
        evidence:
          'Records carry Ed25519 signatures and public log proof bundles when log submission succeeds.',
        evidence_labels: parsed.filter((entry) => entry.proof).map((entry) => entry.label),
      },
      {
        name: 'Signer separation',
        evidence:
          'Agent, human reviewer, and action MCP records use separate keys so autonomy and approval do not blur.',
        evidence_labels: [...new Set(parsed.map((entry) => entry.signer))],
      },
    ],
    handoff: {
      summary: (handoff?.body as { summary?: string } | null)?.summary ?? null,
      public_context_url: publicContextUrl,
      record_hash: handoff?.record_hash ?? null,
    },
    observability: {
      native_events: nativeEvents,
      coverage: [
        'prior workflow trigger',
        'message lifecycle',
        'human approval gate',
        'MCP tool execution',
        'tool result and diagnostic',
        'public verification',
      ],
    },
    timeline: parsed.map((entry) => ({
      label: entry.label,
      signer: entry.signer,
      record_hash: entry.record_hash,
      context_id: entry.record.context_id,
      informed_by: entry.record.informed_by ?? [],
    })),
  }
}

export class ApprovalTraceAgent extends Agent<Env> {
  private ensureSchema(): void {
    this.sql`
      CREATE TABLE IF NOT EXISTS workflows (
        run_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        prompt TEXT NOT NULL,
        context_id TEXT NOT NULL,
        proposal_record_hash TEXT NOT NULL,
        decision_record_hash TEXT,
        outcome_record_hash TEXT,
        payload_hash TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        planner TEXT NOT NULL,
        decision TEXT,
        decision_reason TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `
    this.sql`
      CREATE TABLE IF NOT EXISTS trace_records (
        run_id TEXT NOT NULL,
        label TEXT NOT NULL,
        signer TEXT NOT NULL,
        record_hash TEXT NOT NULL,
        record_json TEXT NOT NULL,
        body_json TEXT,
        args_json TEXT,
        result_json TEXT,
        proof_json TEXT,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (run_id, record_hash)
      )
    `
    this.sql`
      CREATE TABLE IF NOT EXISTS observability_events (
        run_id TEXT NOT NULL,
        idx INTEGER NOT NULL,
        channel TEXT NOT NULL,
        type TEXT NOT NULL,
        event_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (run_id, idx)
      )
    `
  }

  async createProposal(input: { prompt: string; runId?: string }): Promise<unknown> {
    this.ensureSchema()
    const runId = input.runId ?? crypto.randomUUID()
    const contextId = randomContextId()
    const runStartedAt = Date.now()
    const triggerTimestamp = runStartedAt
    const triageTimestamp = runTimestamp(runStartedAt, TRACE_RECORD_OFFSETS_MS.triage)
    const proposalTimestamp = runTimestamp(runStartedAt, TRACE_RECORD_OFFSETS_MS.proposal)
    const triggerBody = {
      kind: 'workflow_trigger',
      source: 'github_issue_webhook',
      scheduled_task: 'agent.follow_up_after_triage',
      event: {
        repository: 'cloudflare/agents-demo',
        issue_id: 'workers-issue-4821',
        labels: ['bug', 'workers', 'help'],
        title: input.prompt,
      },
      autonomous_phase: [
        'classified issue intent',
        'checked the affected Workers route',
        'prepared a repository file update',
      ],
      halt_condition: 'writing repository code requires human approval',
    }
    this.saveNativeEvent(
      runId,
      emitNativeEvent({
        channel: 'agents:workflow',
        type: 'workflow:triggered',
        agent: 'ApprovalTraceAgent',
        name: runId,
        payload: {
          source: triggerBody.source,
          issueId: triggerBody.event.issue_id,
          haltCondition: triggerBody.halt_condition,
        },
        timestamp: triggerTimestamp,
      }),
    )
    const triggerRecord = await signObservation({
      env: this.env,
      role: 'agent',
      key: privateKey(this.env.ATRIB_AGENT_PRIVATE_KEY),
      contextId,
      chainRoot: genesisChainRoot(contextId),
      toolName: 'workflow_trigger',
      body: triggerBody,
      timestamp: triggerTimestamp,
    })
    const triggerHash = recordHash(triggerRecord)
    await this.saveTraceRecord({
      runId,
      label: 'trigger',
      signer: 'agent',
      record: triggerRecord,
      body: triggerBody,
      proof: await submitRecord(this.env, triggerRecord),
    })
    const triageBody = {
      kind: 'autonomous_triage',
      trigger_record_hash: triggerHash,
      repository: 'cloudflare/agents-demo',
      issue_id: 'workers-issue-4821',
      route: '/v1/report',
      intent: 'add rate limiting',
      policy_result: 'human_review_required',
      gathered_context: [
        'GitHub issue webhook payload',
        'Cloudflare Workers route target',
        'repository write policy',
      ],
    }
    this.saveNativeEvent(
      runId,
      emitNativeEvent({
        channel: 'agents:workflow',
        type: 'workflow:triage_completed',
        agent: 'ApprovalTraceAgent',
        name: runId,
        payload: {
          route: triageBody.route,
          intent: triageBody.intent,
          policyResult: triageBody.policy_result,
        },
        timestamp: triageTimestamp,
      }),
    )
    const triageRecord = await signObservation({
      env: this.env,
      role: 'agent',
      key: privateKey(this.env.ATRIB_AGENT_PRIVATE_KEY),
      contextId,
      chainRoot: triggerHash,
      toolName: 'autonomous_triage',
      body: triageBody,
      informedBy: [triggerHash],
      timestamp: triageTimestamp,
    })
    const triageHash = recordHash(triageRecord)
    await this.saveTraceRecord({
      runId,
      label: 'triage',
      signer: 'agent',
      record: triageRecord,
      body: triageBody,
      proof: await submitRecord(this.env, triageRecord),
    })
    const plan = await planAction(this.env, input.prompt)
    const payloadHash = hashUnknown(plan.payload)
    const body = {
      kind: 'agent_proposal',
      prompt: input.prompt,
      trigger_record_hash: triggerHash,
      planner: plan.planner,
      action: plan.action,
      summary: plan.summary,
      risk: plan.risk,
      stable_connector_id: STABLE_CONNECTOR_ID,
      proposed_payload_hash: payloadHash,
      proposed_payload: plan.payload,
      approval_question:
        'Should the agent write this repository file update and resume MCP execution?',
    }
    this.saveNativeEvent(
      runId,
      emitNativeEvent({
        channel: 'agents:message',
        type: 'message:request',
        agent: 'ApprovalTraceAgent',
        name: runId,
        payload: { prompt: input.prompt },
        timestamp: proposalTimestamp,
      }),
    )
    const record = await signObservation({
      env: this.env,
      role: 'agent',
      key: privateKey(this.env.ATRIB_AGENT_PRIVATE_KEY),
      contextId,
      chainRoot: triageHash,
      toolName: 'proposal',
      body,
      informedBy: [triageHash],
      timestamp: proposalTimestamp,
    })
    const proposalHash = recordHash(record)
    await this.saveTraceRecord({
      runId,
      label: 'proposal',
      signer: 'agent',
      record,
      body,
      proof: await submitRecord(this.env, record),
    })
    this.sql`
      INSERT OR REPLACE INTO workflows
        (
          run_id,
          status,
          prompt,
          context_id,
          proposal_record_hash,
          decision_record_hash,
          outcome_record_hash,
          payload_hash,
          payload_json,
          planner,
          decision,
          decision_reason,
          created_at,
          updated_at
        )
      VALUES
        (
          ${runId},
          ${'pending_approval'},
          ${input.prompt},
          ${contextId},
          ${proposalHash},
          ${null},
          ${null},
          ${payloadHash},
          ${JSON.stringify(plan.payload)},
          ${plan.planner},
          ${null},
          ${null},
          ${runStartedAt},
          ${proposalTimestamp}
        )
    `
    this.saveNativeEvent(
      runId,
      emitNativeEvent({
        channel: 'agents:message',
        type: 'submission:create',
        agent: 'ApprovalTraceAgent',
        name: runId,
        payload: { runId, proposalRecordHash: proposalHash, payloadHash },
        timestamp: proposalTimestamp,
      }),
    )
    return this.getRun(runId)
  }

  async approveRun(input: { runId: string; reason: string }): Promise<ApprovalContext> {
    this.ensureSchema()
    const workflow = this.getWorkflowRow(input.runId)
    if (!workflow) throw new Error(`run not found: ${input.runId}`)
    if (workflow.status !== 'pending_approval') {
      throw new Error(`run is not pending approval: ${workflow.status}`)
    }
    const proposalTimestamp = this.currentProposalTimestamp(workflow)
    const approvalTimestamp = Math.max(
      runTimestamp(workflow.created_at, TRACE_RECORD_OFFSETS_MS.approval),
      proposalTimestamp + TRACE_RECORD_OFFSETS_MS.reviewDecisionDelay,
    )
    const body = {
      kind: 'human_approval',
      reviewer_id: 'browser-demo-human',
      decision: 'approved',
      reason: input.reason,
      approved_payload_hash: workflow.payload_hash,
      stable_connector_id: STABLE_CONNECTOR_ID,
      expires_at: new Date(approvalTimestamp + 1000 * 60 * 30).toISOString(),
    }
    const record = await signObservation({
      env: this.env,
      role: 'human',
      key: privateKey(this.env.ATRIB_HUMAN_APPROVER_PRIVATE_KEY),
      contextId: workflow.context_id,
      chainRoot: workflow.proposal_record_hash,
      toolName: 'approval',
      body,
      informedBy: [workflow.proposal_record_hash],
      timestamp: approvalTimestamp,
    })
    const approvalHash = recordHash(record)
    await this.saveTraceRecord({
      runId: input.runId,
      label: 'approval',
      signer: 'human',
      record,
      body,
      proof: await submitRecord(this.env, record),
    })
    this.sql`
      UPDATE workflows
      SET status = ${'approved'},
          decision = ${'approved'},
          decision_reason = ${input.reason},
          decision_record_hash = ${approvalHash},
          updated_at = ${approvalTimestamp}
      WHERE run_id = ${input.runId}
    `
    this.saveNativeEvent(
      input.runId,
      emitNativeEvent({
        channel: 'agents:message',
        type: 'tool:approval',
        agent: 'ApprovalTraceAgent',
        name: input.runId,
        payload: {
          approved: true,
          approvalRecordHash: approvalHash,
          reason: input.reason,
        },
        timestamp: approvalTimestamp,
      }),
    )
    return {
      run_id: input.runId,
      status: 'approved',
      context_id: workflow.context_id,
      approval_record_hash: approvalHash,
      approval_timestamp: approvalTimestamp,
      approval_token: encodeToken(record),
      traceparent: `00-${workflow.context_id}-${randomParentId()}-01`,
      payload_hash: workflow.payload_hash,
      payload: JSON.parse(workflow.payload_json) as PlannedAction['payload'],
    }
  }

  async rejectRun(input: { runId: string; reason: string }): Promise<unknown> {
    this.ensureSchema()
    const workflow = this.getWorkflowRow(input.runId)
    if (!workflow) throw new Error(`run not found: ${input.runId}`)
    if (workflow.status !== 'pending_approval') {
      throw new Error(`run is not pending approval: ${workflow.status}`)
    }
    const proposalTimestamp = this.currentProposalTimestamp(workflow)
    const rejectionTimestamp = Math.max(
      runTimestamp(workflow.created_at, TRACE_RECORD_OFFSETS_MS.rejection),
      proposalTimestamp + TRACE_RECORD_OFFSETS_MS.reviewDecisionDelay,
    )
    const body = {
      kind: 'human_approval',
      reviewer_id: 'browser-demo-human',
      decision: 'rejected',
      reason: input.reason,
      approved_payload_hash: workflow.payload_hash,
      stable_connector_id: STABLE_CONNECTOR_ID,
    }
    const record = await signObservation({
      env: this.env,
      role: 'human',
      key: privateKey(this.env.ATRIB_HUMAN_APPROVER_PRIVATE_KEY),
      contextId: workflow.context_id,
      chainRoot: workflow.proposal_record_hash,
      toolName: 'rejection',
      body,
      informedBy: [workflow.proposal_record_hash],
      timestamp: rejectionTimestamp,
    })
    const rejectionHash = recordHash(record)
    await this.saveTraceRecord({
      runId: input.runId,
      label: 'rejection',
      signer: 'human',
      record,
      body,
      proof: await submitRecord(this.env, record),
    })
    this.sql`
      UPDATE workflows
      SET status = ${'rejected'},
          decision = ${'rejected'},
          decision_reason = ${input.reason},
          decision_record_hash = ${rejectionHash},
          updated_at = ${rejectionTimestamp}
      WHERE run_id = ${input.runId}
    `
    this.saveNativeEvent(
      input.runId,
      emitNativeEvent({
        channel: 'agents:message',
        type: 'tool:approval',
        agent: 'ApprovalTraceAgent',
        name: input.runId,
        payload: {
          approved: false,
          approvalRecordHash: rejectionHash,
          reason: input.reason,
        },
        timestamp: rejectionTimestamp,
      }),
    )
    return this.getRun(input.runId)
  }

  async requestChanges(input: { runId: string; feedback: string }): Promise<unknown> {
    this.ensureSchema()
    const workflow = this.getWorkflowRow(input.runId)
    if (!workflow) throw new Error(`run not found: ${input.runId}`)
    if (workflow.status !== 'pending_approval') {
      throw new Error(`run is not pending approval: ${workflow.status}`)
    }
    const feedbackTimestamp = runTimestamp(
      workflow.created_at,
      TRACE_RECORD_OFFSETS_MS.changesRequested,
    )
    const proposalTimestamp = this.currentProposalTimestamp(workflow)
    const reviewFeedbackTimestamp = Math.max(
      feedbackTimestamp,
      proposalTimestamp + TRACE_RECORD_OFFSETS_MS.reviewDecisionDelay,
    )
    const feedback = input.feedback.trim() || 'Request a narrower repository file update.'
    const body = {
      kind: 'human_review_feedback',
      reviewer_id: 'browser-demo-human',
      decision: 'changes_requested',
      feedback,
      requested_changes: [
        'Keep the rate-limit guard, but narrow the change to /v1/report only.',
        'Return a revised proposal before the action MCP writes repository files.',
      ],
      approved_payload_hash: workflow.payload_hash,
      stable_connector_id: STABLE_CONNECTOR_ID,
      next_step: 'agent_revision',
    }
    const record = await signObservation({
      env: this.env,
      role: 'human',
      key: privateKey(this.env.ATRIB_HUMAN_APPROVER_PRIVATE_KEY),
      contextId: workflow.context_id,
      chainRoot: workflow.proposal_record_hash,
      toolName: 'change_request',
      body,
      informedBy: [workflow.proposal_record_hash],
      timestamp: reviewFeedbackTimestamp,
    })
    const feedbackHash = recordHash(record)
    await this.saveTraceRecord({
      runId: input.runId,
      label: 'change_request',
      signer: 'human',
      record,
      body,
      proof: await submitRecord(this.env, record),
    })
    this.saveNativeEvent(
      input.runId,
      emitNativeEvent({
        channel: 'agents:message',
        type: 'tool:review_feedback',
        agent: 'ApprovalTraceAgent',
        name: input.runId,
        payload: {
          approved: false,
          changesRequested: true,
          feedbackRecordHash: feedbackHash,
          feedback,
        },
        timestamp: reviewFeedbackTimestamp,
      }),
    )
    const priorPayload = JSON.parse(workflow.payload_json) as PlannedAction['payload']
    const revision = revisedPlanFromFeedback(priorPayload, feedback)
    const revisionPayloadHash = hashUnknown(revision.payload)
    const revisionTimestamp = Math.max(
      Date.now(),
      workflow.created_at + TRACE_RECORD_OFFSETS_MS.revision,
      reviewFeedbackTimestamp + 650,
    )
    const revisionBody = {
      kind: 'agent_revised_proposal',
      prompt: workflow.prompt,
      revision_number: 2,
      prior_proposal_record_hash: workflow.proposal_record_hash,
      feedback_record_hash: feedbackHash,
      reviewer_feedback: feedback,
      planner: revision.planner,
      action: revision.action,
      summary: revision.summary,
      risk: revision.risk,
      stable_connector_id: STABLE_CONNECTOR_ID,
      proposed_payload_hash: revisionPayloadHash,
      proposed_payload: revision.payload,
      approval_question:
        'Should the agent write this revised repository file update and resume MCP execution?',
    }
    const revisionRecord = await signObservation({
      env: this.env,
      role: 'agent',
      key: privateKey(this.env.ATRIB_AGENT_PRIVATE_KEY),
      contextId: workflow.context_id,
      chainRoot: feedbackHash,
      toolName: 'revised_proposal',
      body: revisionBody,
      informedBy: [workflow.proposal_record_hash, feedbackHash],
      timestamp: revisionTimestamp,
    })
    const revisionHash = recordHash(revisionRecord)
    await this.saveTraceRecord({
      runId: input.runId,
      label: 'revision',
      signer: 'agent',
      record: revisionRecord,
      body: revisionBody,
      proof: await submitRecord(this.env, revisionRecord),
    })
    this.sql`
      UPDATE workflows
      SET status = ${'pending_approval'},
          proposal_record_hash = ${revisionHash},
          payload_hash = ${revisionPayloadHash},
          payload_json = ${JSON.stringify(revision.payload)},
          planner = ${revision.planner},
          decision = ${null},
          decision_reason = ${feedback},
          decision_record_hash = ${null},
          updated_at = ${revisionTimestamp}
      WHERE run_id = ${input.runId}
    `
    this.saveNativeEvent(
      input.runId,
      emitNativeEvent({
        channel: 'agents:message',
        type: 'message:revision',
        agent: 'ApprovalTraceAgent',
        name: input.runId,
        payload: {
          revisionRecordHash: revisionHash,
          feedbackRecordHash: feedbackHash,
          payloadHash: revisionPayloadHash,
        },
        timestamp: revisionTimestamp,
      }),
    )
    return this.getRun(input.runId)
  }

  async markExecuting(runId: string): Promise<void> {
    this.ensureSchema()
    this.sql`
      UPDATE workflows
      SET status = ${'executing'}, updated_at = ${Date.now()}
      WHERE run_id = ${runId}
    `
  }

  async captureActionRecords(input: {
    runId: string
    records: CapturedActionRecord[]
  }): Promise<void> {
    this.ensureSchema()
    for (const item of input.records) {
      await this.saveTraceRecord({
        runId: input.runId,
        label: item.label,
        signer: item.signer,
        record: item.record,
        body: item.body,
        args: item.args,
        result: item.result,
        proof: item.proof,
      })
      this.saveNativeEvent(
        input.runId,
        emitNativeEvent({
          channel:
            item.label === 'execution' || item.label === 'preview'
              ? 'agents:mcp'
              : 'agents:message',
          type: item.label === 'execution' ? 'tool:result' : 'mcp:client:connect',
          agent: 'ApprovalTraceAgent',
          name: input.runId,
          payload: {
            toolName: item.label,
            recordHash: item.record_hash,
          },
          timestamp: item.record.timestamp,
        }),
      )
    }
  }

  async finishRun(input: { runId: string; failed: boolean }): Promise<unknown> {
    this.ensureSchema()
    const workflow = this.getWorkflowRow(input.runId)
    if (!workflow) throw new Error(`run not found: ${input.runId}`)
    const rows = this.getRecordRows(input.runId)
    const approval = rows.find((row) => row.label === 'approval')
    const outcome = rows.find((row) => row.label === 'outcome')
    if (!approval || !outcome) throw new Error('approval and outcome records are required')
    const outcomeRecord = JSON.parse(outcome.record_json) as AtribRecord
    const handoffTimestamp = Math.max(
      Date.now(),
      workflow.created_at + TRACE_RECORD_OFFSETS_MS.handoff,
      outcomeRecord.timestamp + 250,
    )
    const body = {
      kind: 'handoff_packet',
      summary: input.failed
        ? 'The approved Cloudflare-shaped file action failed with signed diagnostic evidence.'
        : 'The approved Cloudflare-shaped file action completed and produced a signed outcome.',
      approval_record_hash: approval.record_hash,
      outcome_record_hash: outcome.record_hash,
      public_context_url: `${LOG_BASE_URL}/by-context/${workflow.context_id}`,
      next_owner: 'cloudflare-agents-reviewer',
    }
    const record = await signObservation({
      env: this.env,
      role: 'agent',
      key: privateKey(this.env.ATRIB_AGENT_PRIVATE_KEY),
      contextId: workflow.context_id,
      chainRoot: outcome.record_hash,
      toolName: 'handoff',
      body,
      informedBy: [approval.record_hash, outcome.record_hash],
      timestamp: handoffTimestamp,
    })
    const handoffHash = recordHash(record)
    await this.saveTraceRecord({
      runId: input.runId,
      label: 'handoff',
      signer: 'agent',
      record,
      body,
      proof: await submitRecord(this.env, record),
    })
    this.sql`
      UPDATE workflows
      SET status = ${input.failed ? 'failed' : 'succeeded'},
          outcome_record_hash = ${outcome.record_hash},
          updated_at = ${handoffTimestamp}
      WHERE run_id = ${input.runId}
    `
    this.saveNativeEvent(
      input.runId,
      emitNativeEvent({
        channel: 'agents:workflow',
        type: input.failed ? 'workflow:terminated' : 'workflow:approved',
        agent: 'ApprovalTraceAgent',
        name: input.runId,
        payload: { handoffRecordHash: handoffHash },
        timestamp: handoffTimestamp,
      }),
    )
    this.saveNativeEvent(
      input.runId,
      emitNativeEvent({
        channel: 'agents:message',
        type: 'message:response',
        agent: 'ApprovalTraceAgent',
        name: input.runId,
        payload: { status: input.failed ? 'failed' : 'succeeded' },
        timestamp: handoffTimestamp,
      }),
    )
    return this.getRun(input.runId)
  }

  async getExecutionContext(runId: string, mode: 'approved' | 'error'): Promise<ExecutionContext> {
    this.ensureSchema()
    const workflow = this.getWorkflowRow(runId)
    if (!workflow) throw new Error(`run not found: ${runId}`)
    if (!workflow.decision_record_hash) throw new Error('run has no approval record')
    return {
      run_id: runId,
      context_id: workflow.context_id,
      approval_record_hash: workflow.decision_record_hash,
      payload_hash: workflow.payload_hash,
      payload: JSON.parse(workflow.payload_json) as PlannedAction['payload'],
      stable_connector_id: STABLE_CONNECTOR_ID,
      mode,
    }
  }

  async getRun(runId: string): Promise<unknown> {
    this.ensureSchema()
    const workflow = this.getWorkflowRow(runId)
    const records = this.getRecordRows(runId)
    const nativeRows = this.getNativeRows(runId)
    return {
      run_id: runId,
      status: workflow?.status ?? null,
      context_id: workflow?.context_id ?? null,
      trace_packet: tracePacket(workflow, records, nativeRows),
      native_observability: nativeRows.map(
        (row) => JSON.parse(row.event_json) as NativeObservabilityEvent,
      ),
      records: records.map((row) => ({
        label: row.label,
        signer: row.signer,
        record_hash: row.record_hash,
        record: JSON.parse(row.record_json) as AtribRecord,
        body: row.body_json ? JSON.parse(row.body_json) : null,
        args: row.args_json ? JSON.parse(row.args_json) : null,
        result: row.result_json ? JSON.parse(row.result_json) : null,
        proof: row.proof_json ? (JSON.parse(row.proof_json) as ProofBundle) : null,
        created_at: row.created_at,
      })),
    }
  }

  private getWorkflowRow(runId: string): WorkflowRow | null {
    const rows = this.sql<WorkflowRow>`
      SELECT *
      FROM workflows
      WHERE run_id = ${runId}
      LIMIT 1
    `
    return rows[0] ?? null
  }

  private getRecordRows(runId: string): TraceRecordRow[] {
    return [
      ...this.sql<TraceRecordRow>`
      SELECT run_id, label, signer, record_hash, record_json, body_json, args_json, result_json, proof_json, created_at
      FROM trace_records
      WHERE run_id = ${runId}
      ORDER BY
        CASE label
          WHEN 'trigger' THEN 1
          WHEN 'triage' THEN 2
          WHEN 'proposal' THEN 3
          WHEN 'change_request' THEN 4
          WHEN 'revision' THEN 5
          WHEN 'approval' THEN 6
          WHEN 'rejection' THEN 6
          WHEN 'preview' THEN 7
          WHEN 'execution' THEN 8
          WHEN 'outcome' THEN 9
          WHEN 'handoff' THEN 10
          ELSE 99
        END ASC,
        created_at ASC
    `,
    ]
  }

  private currentProposalTimestamp(workflow: WorkflowRow): number {
    const row = this
      .getRecordRows(workflow.run_id)
      .find((record) => record.record_hash === workflow.proposal_record_hash)
    if (!row) return workflow.updated_at
    return (JSON.parse(row.record_json) as AtribRecord).timestamp
  }

  private getNativeRows(runId: string): NativeObservabilityRow[] {
    return [
      ...this.sql<NativeObservabilityRow>`
      SELECT run_id, idx, channel, type, event_json, created_at
      FROM observability_events
      WHERE run_id = ${runId}
      ORDER BY idx ASC
    `,
    ]
  }

  private saveNativeEvent(runId: string, event: NativeObservabilityEvent): void {
    const rows = this.sql<{ count: number }>`
      SELECT COUNT(*) AS count
      FROM observability_events
      WHERE run_id = ${runId}
    `
    const idx = rows[0]?.count ?? 0
    this.sql`
      INSERT OR REPLACE INTO observability_events
        (run_id, idx, channel, type, event_json, created_at)
      VALUES
        (${runId}, ${idx}, ${event.channel}, ${event.type}, ${JSON.stringify(event)}, ${event.timestamp})
    `
  }

  private async saveTraceRecord(input: TraceRecordInput): Promise<void> {
    const hash = recordHash(input.record)
    this.sql`
      INSERT OR REPLACE INTO trace_records
        (run_id, label, signer, record_hash, record_json, body_json, args_json, result_json, proof_json, created_at)
      VALUES
        (
          ${input.runId},
          ${input.label},
          ${input.signer},
          ${hash},
          ${JSON.stringify(input.record)},
          ${input.body === undefined ? null : JSON.stringify(input.body)},
          ${input.args === undefined ? null : JSON.stringify(input.args)},
          ${input.result === undefined ? null : JSON.stringify(input.result)},
          ${input.proof ? JSON.stringify(input.proof) : null},
          ${input.record.timestamp}
        )
    `
  }
}

interface AtribRecordRow {
  record_hash: string
  record_json: string
  sidecar_json: string
  label: string
  signer: SignerRole
  body_json: string | null
  created_at: number
}

export class ApprovalActionMcp extends McpAgent<Env> {
  server = new McpServer({
    name: 'cloudflare-demo-repository-action',
    version: '1.0.0',
  })

  async init() {
    this.ensureSchema()

    this.server.registerTool(
      'execution_context',
      {
        description: 'Return the signed approval context for a runnable Cloudflare action.',
        inputSchema: {
          run_id: z.string(),
          mode: z.enum(['approved', 'error']).optional(),
        },
      },
      async ({ run_id, mode = 'approved' }) => {
        const agent = await getTraceAgent(this.env, run_id)
        return {
          content: [
            { type: 'text', text: jsonText(await agent.getExecutionContext(run_id, mode)) },
          ],
        }
      },
    )

    this.server.registerTool(
      'preview_file_update',
      {
        description: 'Preview the approved Cloudflare repository file update before mutation.',
        inputSchema: {
          approval_record_hash: z.string(),
          stable_connector_id: z.string(),
          payload_digest: z.string(),
          payload: z.any(),
        },
      },
      async ({ approval_record_hash, stable_connector_id, payload_digest, payload }) => {
        if (stable_connector_id !== STABLE_CONNECTOR_ID) {
          return {
            content: [
              {
                type: 'text',
                text: jsonText({
                  status: 'error',
                  error: 'stable_connector_mismatch',
                  diagnostic: 'The execution connector id did not match the signed approval trace.',
                  changed_rows: [],
                }),
              },
            ],
          }
        }
        const expectedHash = hashUnknown(payload)
        if (expectedHash.replace(/^sha256:/u, '') !== payload_digest) {
          return {
            content: [
              {
                type: 'text',
                text: jsonText({
                  status: 'error',
                  error: 'payload_hash_mismatch',
                  diagnostic: 'The payload no longer matches the approved hash.',
                  changed_rows: [],
                  expected_hash: expectedHash,
                }),
              },
            ],
          }
        }
        const p = payload as PlannedAction['payload']
        return {
          content: [
            {
              type: 'text',
              text: jsonText({
                status: 'ready',
                diagnostic: 'Preview confirms one repository file would change.',
                approval_record_hash,
                changed_rows: [`repo_files.${p.target_file}`],
                before: p.before,
                after: p.after,
                diff: p.diff,
              }),
            },
          ],
        }
      },
    )

    this.server.registerTool(
      'write_file',
      {
        description: 'Apply the approved Cloudflare repository file update to Durable Object SQLite.',
        inputSchema: {
          approval_record_hash: z.string(),
          stable_connector_id: z.string(),
          payload_digest: z.string(),
          payload: z.any(),
          force_error: z.boolean().optional(),
        },
      },
      async ({
        approval_record_hash,
        stable_connector_id,
        payload_digest,
        payload,
        force_error = false,
      }) => {
        const p = payload as PlannedAction['payload']
        if (stable_connector_id !== STABLE_CONNECTOR_ID) {
          return {
            content: [
              {
                type: 'text',
                text: jsonText({
                  status: 'error',
                  error: 'stable_connector_mismatch',
                  diagnostic: 'Execution connector id did not match the signed approval trace.',
                  changed_rows: [],
                }),
              },
            ],
          }
        }
        const expectedHash = hashUnknown(payload)
        if (expectedHash.replace(/^sha256:/u, '') !== payload_digest) {
          return {
            content: [
              {
                type: 'text',
                text: jsonText({
                  status: 'error',
                  error: 'payload_hash_mismatch',
                  diagnostic: 'Execution payload did not match the approved hash.',
                  changed_rows: [],
                  expected_hash: expectedHash,
                }),
              },
            ],
          }
        }
        if (force_error) {
          return {
            content: [
              {
                type: 'text',
                text: jsonText({
                  status: 'error',
                  error: 'repository_file_version_conflict',
                  diagnostic: 'The repository file changed after approval.',
                  changed_rows: [],
                  approval_record_hash,
                }),
              },
            ],
          }
        }
        this.sql`
          INSERT OR REPLACE INTO repo_files
            (file_path, repository, operation, state_json, updated_at)
          VALUES
            (${p.target_file}, ${p.repository}, ${p.operation}, ${JSON.stringify(p.after)}, ${Date.now()})
        `
        return {
          content: [
            {
              type: 'text',
              text: jsonText({
                status: 'success',
                diagnostic: 'Durable Object SQLite demo repository file row updated.',
                changed_rows: [`repo_files.${p.target_file}`],
                approval_record_hash,
                after: p.after,
              }),
            },
          ],
        }
      },
    )

    this.server.registerTool(
      'list_signed_records',
      {
        description: 'Return signed atrib records captured by the action MCP Durable Object.',
        inputSchema: {
          limit: z.number().int().min(1).max(50).optional(),
        },
      },
      async ({ limit = 50 }) => {
        const rows = this.sql<AtribRecordRow>`
          SELECT record_hash, record_json, sidecar_json, label, signer, body_json, created_at
          FROM atrib_records
          ORDER BY created_at ASC
          LIMIT ${limit}
        `
        return {
          content: [
            {
              type: 'text',
              text: jsonText({
                count: rows.length,
                records: rows.map((row) => ({
                  record_hash: row.record_hash,
                  label: row.label,
                  signer: row.signer,
                  record: JSON.parse(row.record_json) as AtribRecord,
                  sidecar: JSON.parse(row.sidecar_json) as OnRecordSidecar,
                  body: row.body_json ? JSON.parse(row.body_json) : undefined,
                  created_at: row.created_at,
                })),
              }),
            },
          ],
        }
      },
    )

    this.server.registerTool(
      'flush_atrib_queue',
      {
        description: 'Flush pending atrib log submissions.',
        inputSchema: {},
      },
      async () => {
        const flush = (this.server as unknown as { flush?: () => Promise<void> }).flush
        if (flush) await flush()
        return { content: [{ type: 'text', text: jsonText({ flushed: Boolean(flush) }) }] }
      },
    )

    const endpoint = logEndpoint(this.env)
    atrib(this.server, {
      creatorKey: this.env.ATRIB_ACTION_MCP_PRIVATE_KEY,
      logEndpoint: endpoint,
      logSubmission: endpoint ? 'enabled' : 'disabled',
      serverUrl: serverUrl(this.env, 'action_mcp'),
      autoChain: true,
      disclosure: {
        tool_name: 'verbatim',
        args: 'plain-sha256',
        result: 'plain-sha256',
      },
      informedBy: (params: Record<string, unknown>) => {
        const args = params.arguments as Record<string, unknown> | undefined
        const approvalHash = args?.approval_record_hash
        return typeof approvalHash === 'string' ? [approvalHash] : undefined
      },
      onRecord: (record, sidecar) => {
        this.persistActionRecord(record, sidecar)
      },
    })
  }

  async getTargetRows(ruleId: string): Promise<Array<Record<string, unknown>>> {
    this.ensureSchema()
    const rows = [
      ...this.sql<{ state_json: string }>`
        SELECT state_json
        FROM repo_files
        WHERE file_path = ${ruleId}
      `,
    ]
    return rows.map((row) => JSON.parse(row.state_json) as Record<string, unknown>)
  }

  private ensureSchema(): void {
    this.sql`
      CREATE TABLE IF NOT EXISTS repo_files (
        file_path TEXT PRIMARY KEY,
        repository TEXT NOT NULL,
        operation TEXT NOT NULL,
        state_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `
    this.sql`
      CREATE TABLE IF NOT EXISTS atrib_records (
        record_hash TEXT PRIMARY KEY,
        record_json TEXT NOT NULL,
        sidecar_json TEXT NOT NULL,
        label TEXT NOT NULL,
        signer TEXT NOT NULL,
        body_json TEXT,
        created_at INTEGER NOT NULL
      )
    `
  }

  private persistActionRecord(record: AtribRecord, sidecar?: OnRecordSidecar): void {
    const hash = recordHash(record)
    const label =
      sidecar?.toolName === 'write_file'
        ? 'execution'
        : (sidecar?.toolName ?? 'tool_call')
    this.storeRecord(hash, record, sidecar ?? {}, label, 'action_mcp')
    if (sidecar?.toolName === 'write_file') {
      void this.signAndStoreOutcome(record, sidecar).catch((error) => {
        console.warn('outcome signing failed', error)
      })
    }
  }

  private async signAndStoreOutcome(record: AtribRecord, sidecar: OnRecordSidecar): Promise<void> {
    const executionHash = recordHash(record)
    const resultBody = parseToolResult(sidecar.result)
    const body = {
      kind: 'execution_outcome',
      status: resultBody.status,
      diagnostic: resultBody.diagnostic,
      execution_record_hash: executionHash,
      changed_rows: Array.isArray(resultBody.changed_rows) ? resultBody.changed_rows : [],
      error: resultBody.error,
    }
    const outcome = await signObservation({
      env: this.env,
      role: 'action_mcp',
      key: privateKey(this.env.ATRIB_ACTION_MCP_PRIVATE_KEY),
      contextId: record.context_id,
      chainRoot: executionHash,
      toolName: 'record_outcome',
      body,
      informedBy: [executionHash],
    })
    await submitRecord(this.env, outcome)
    this.storeRecord(recordHash(outcome), outcome, {}, 'outcome', 'action_mcp', body)
  }

  private storeRecord(
    hash: string,
    record: AtribRecord,
    sidecar: unknown,
    label: string,
    signer: SignerRole,
    body?: unknown,
  ): void {
    this.sql`
      INSERT OR REPLACE INTO atrib_records
        (record_hash, record_json, sidecar_json, label, signer, body_json, created_at)
      VALUES
        (
          ${hash},
          ${JSON.stringify(record)},
          ${JSON.stringify(sidecar)},
          ${label},
          ${signer},
          ${body === undefined ? null : JSON.stringify(body)},
          ${record.timestamp}
        )
    `
  }
}

async function executeThroughActionMcp(input: {
  env: Env
  approval: ApprovalContext
  simulateError: boolean
}): Promise<{ failed: boolean; records: CapturedActionRecord[] }> {
  const client = new Client(
    { name: 'atrib-cloudflare-approval-trace-ui', version: '1.0.0' },
    { capabilities: {} },
  )
  const transport = new RPCClientTransport({
    namespace: input.env.ApprovalActionMcp as unknown as DurableObjectNamespace<ApprovalActionMcp>,
    name: input.approval.run_id,
  })
  await client.connect(transport)
  try {
    await sleep(
      Math.max(
        0,
        input.approval.approval_timestamp +
          TRACE_RECORD_OFFSETS_MS.postApprovalPause -
          Date.now(),
      ),
    )
    const meta = {
      atrib: input.approval.approval_token,
      tracestate: `atrib=${input.approval.approval_token}`,
      traceparent: input.approval.traceparent,
    }
    const contextResult = await client.callTool({
      name: 'execution_context',
      _meta: meta,
      arguments: {
        run_id: input.approval.run_id,
        mode: input.simulateError ? 'error' : 'approved',
      },
    })
    const context = JSON.parse(getTextResult(contextResult)) as ExecutionContext
    const payloadDigest = context.payload_hash.replace(/^sha256:/u, '')
    await sleep(125)
    const preview = await client.callTool({
      name: 'preview_file_update',
      _meta: meta,
      arguments: {
        approval_record_hash: context.approval_record_hash,
        stable_connector_id: STABLE_CONNECTOR_ID,
        payload_digest: payloadDigest,
        payload: context.payload,
      },
    })
    const previewBody = JSON.parse(getTextResult(preview)) as { status?: string }
    if (previewBody.status !== 'ready') {
      throw new Error(`preview failed: ${JSON.stringify(previewBody)}`)
    }
    await sleep(125)
    const execution = await client.callTool({
      name: 'write_file',
      _meta: meta,
      arguments: {
        approval_record_hash: context.approval_record_hash,
        stable_connector_id: STABLE_CONNECTOR_ID,
        payload_digest: payloadDigest,
        payload: context.payload,
        force_error: input.simulateError,
      },
    })
    const executionBody = JSON.parse(getTextResult(execution)) as { status?: string }
    await sleep(125)
    await client.callTool({ name: 'flush_atrib_queue', arguments: {} })
    const records = await waitForActionRecords(client, context.context_id)
    return {
      failed: executionBody.status === 'error',
      records: await Promise.all(
        records.map(async (item) => ({
          label: item.label === 'preview_file_update' ? 'preview' : item.label,
          signer: item.signer,
          record_hash: item.record_hash,
          record: item.record,
          body: item.body,
          args: item.sidecar.args,
          result: item.sidecar.result,
          proof: await submitRecord(input.env, item.record),
        })),
      ),
    }
  } finally {
    await client.close()
  }
}

async function waitForActionRecords(
  client: Client,
  contextId: string,
): Promise<ListedActionRecord[]> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await client.callTool({ name: 'list_signed_records', arguments: { limit: 50 } })
    const body = JSON.parse(getTextResult(result)) as { records?: ListedActionRecord[] }
    const records = (body.records ?? []).filter((record) => record.record.context_id === contextId)
    if (
      records.some((record) => record.label === 'preview_file_update') &&
      records.some((record) => record.label === 'execution') &&
      records.some((record) => record.label === 'outcome')
    ) {
      return records.filter((record) =>
        ['preview_file_update', 'execution', 'outcome'].includes(record.label),
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`timed out waiting for action records in ${contextId}`)
}

const actionMcpHandler = ApprovalActionMcp.serve('/action-mcp', {
  binding: 'ApprovalActionMcp',
})

export default {
  async fetch(request: Request, env: Env, ctx: globalThis.ExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url)
      if (url.pathname === '/' || url.pathname === '/demo') {
        return html(renderApp({ region: requestRegion(request) }))
      }
      if (url.pathname.startsWith('/action-mcp')) return actionMcpHandler.fetch(request, env, ctx)

      if (url.pathname === '/api/runs' && request.method === 'POST') {
        const body = (await request.json()) as { prompt?: string; run_id?: string }
        const runId = body.run_id ?? crypto.randomUUID()
        const agent = await getTraceAgent(env, runId)
        return json(
          await agent.createProposal({
            runId,
            prompt: body.prompt ?? DEFAULT_TRIGGER_PROMPT,
          }),
        )
      }

      if (url.pathname === '/api/verify-record' && request.method === 'POST') {
        const body = (await request.json()) as { record?: AtribRecord; expected_hash?: string }
        if (!body.record) return json({ ok: false, error: 'missing record' }, { status: 400 })
        const actualHash = recordHash(body.record)
        const signatureOk = await verifyAtribRecord(body.record)
        return json({
          ok: signatureOk && (!body.expected_hash || body.expected_hash === actualHash),
          signature_ok: signatureOk,
          hash_ok: !body.expected_hash || body.expected_hash === actualHash,
          record_hash: actualHash,
          expected_hash: body.expected_hash ?? null,
          creator_key: body.record.creator_key,
          timestamp: body.record.timestamp,
        })
      }

      const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/u)
      if (runMatch && request.method === 'GET') {
        const runId = decodeURIComponent(runMatch[1]!)
        const agent = await getTraceAgent(env, runId)
        return json(await agent.getRun(runId))
      }

      const approveMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/approve$/u)
      if (approveMatch && request.method === 'POST') {
        const runId = decodeURIComponent(approveMatch[1]!)
        const body = (await request.json()) as { reason?: string; simulate_error?: boolean }
        const agent = await getTraceAgent(env, runId)
        const current = (await agent.getRun(runId)) as { status: WorkflowStatus | null }
        if (current.status === null) return errorJson(new Error(`run not found: ${runId}`))
        if (current.status !== 'pending_approval') {
          return errorJson(new Error(`run is not pending approval: ${current.status}`))
        }
        const approval = await agent.approveRun({
          runId,
          reason: body.reason ?? 'Approved in the browser approval gate.',
        })
        await agent.markExecuting(runId)
        const executed = await executeThroughActionMcp({
          env,
          approval,
          simulateError: body.simulate_error === true,
        })
        await agent.captureActionRecords({ runId, records: executed.records })
        return json(await agent.finishRun({ runId, failed: executed.failed }))
      }

      const rejectMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/reject$/u)
      if (rejectMatch && request.method === 'POST') {
        const runId = decodeURIComponent(rejectMatch[1]!)
        const body = (await request.json()) as { reason?: string }
        const agent = await getTraceAgent(env, runId)
        const current = (await agent.getRun(runId)) as { status: WorkflowStatus | null }
        if (current.status === null) return errorJson(new Error(`run not found: ${runId}`))
        if (current.status !== 'pending_approval') {
          return errorJson(new Error(`run is not pending approval: ${current.status}`))
        }
        return json(
          await agent.rejectRun({
            runId,
            reason: body.reason ?? 'Rejected in the browser approval gate.',
          }),
        )
      }

      const requestChangesMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/request-changes$/u)
      if (requestChangesMatch && request.method === 'POST') {
        const runId = decodeURIComponent(requestChangesMatch[1]!)
        const body = (await request.json()) as { feedback?: string }
        const agent = await getTraceAgent(env, runId)
        const current = (await agent.getRun(runId)) as { status: WorkflowStatus | null }
        if (current.status === null) return errorJson(new Error(`run not found: ${runId}`))
        if (current.status !== 'pending_approval') {
          return errorJson(new Error(`run is not pending approval: ${current.status}`))
        }
        return json(
          await agent.requestChanges({
            runId,
            feedback: body.feedback ?? 'Request a narrower repository file update.',
          }),
        )
      }

      return json({
        ok: true,
        endpoints: [
          '/',
          '/api/runs',
          '/api/verify-record',
          '/api/runs/:runId',
          '/api/runs/:runId/approve',
          '/api/runs/:runId/reject',
          '/api/runs/:runId/request-changes',
          '/action-mcp',
        ],
      })
    } catch (error) {
      return errorJson(error)
    }
  },
}
