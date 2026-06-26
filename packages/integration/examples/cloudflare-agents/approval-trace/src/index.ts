// SPDX-License-Identifier: Apache-2.0

import { Agent, getAgentByName } from 'agents'
import { McpAgent, RPCClientTransport } from 'agents/mcp'
import { genericObservability } from 'agents/observability'
import {
  CodemodeConnector,
  CodemodeRuntime as CloudflareCodemodeRuntime,
  DynamicWorkerExecutor,
  createCodemodeRuntime,
  type CodemodeRuntimeHandle,
  type ConnectorTools,
  type ExecuteOptions,
  type ExecuteResult,
  type ExecutionState,
  type Executor,
  type PendingAction,
  type ProxyToolOutput,
  type ResolvedProvider,
} from '@cloudflare/codemode'
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
type SignerRole = 'agent' | 'human' | 'action_mcp' | 'codemode_runtime'
type CodeModeExecutorMode = 'dynamic-worker' | 'local-test'

interface Env {
  ATRIB_AGENT_PRIVATE_KEY: string
  ATRIB_HUMAN_APPROVER_PRIVATE_KEY: string
  ATRIB_ACTION_MCP_PRIVATE_KEY: string
  ATRIB_LOG_ENDPOINT?: string
  ATRIB_AGENT_SERVER_URL?: string
  ATRIB_ACTION_MCP_SERVER_URL?: string
  ATRIB_CODEMODE_SERVER_URL?: string
  OPENAI_API_KEY?: string
  OPENAI_BASE_URL?: string
  OPENAI_MODEL?: string
  ATRIB_CODEMODE_EXECUTOR?: string
  LOADER: WorkerLoader
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
    incident_id: string
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

interface ReceiptVerification {
  ok: boolean
  checked_at: string
  checked_record_hashes: string[]
  head_record_hash: string | null
  head_label: string | null
  signature_failures: string[]
  hash_failures: string[]
  missing_record_hashes: string[]
}

type RecoveryGateKind =
  | 'human_review'
  | 'codemode_resume'
  | 'revised_human_review'
  | 'terminal_rejection'
  | 'handoff_ready'

interface ReceiptRecoveryGate {
  ok: boolean
  kind: 'codemode_receipt_recovery_gate'
  run_id: string
  context_id: string
  status: WorkflowStatus
  gate: RecoveryGateKind
  next_step: string
  allows_write: boolean
  source: 'durable_object_sqlite_trace_records'
  required_record_hashes: string[]
  recovered_head: Record<string, unknown>
  policy: Record<string, unknown> | null
  policy_ok: boolean
  continuation: Record<string, unknown> | null
  continuation_ok: boolean
  verification: ReceiptVerification
  durable_object_boundary: {
    deterministic_fixture: true
    forced_eviction: false
    recovery_model: 'persisted_receipt_head'
    note: string
  }
}

const TEXT_ENCODER = new TextEncoder()
const STABLE_CONNECTOR_ID = 'cloudflare-demo-repository-write-mcp'
const CODEMODE_RUNTIME_ID = 'cloudflare-demo-codemode-runtime'
const CODEMODE_RUNTIME_VERSION = '@cloudflare/codemode@0.4.1'
const AGENTS_SDK_VERSION = 'agents@0.16.2'
const APPROVAL_POLICY_ID = 'cloudflare-workers-payment-route-write'
const APPROVAL_POLICY_VERSION = '2026-06-26.1'
const LOG_BASE_URL = 'https://log.atrib.dev/v1'
const DEFAULT_TRIGGER_PROMPT =
  'Workers Observability detected checkout 500s after deploy; Browser Run reproduced the failure and Code Mode proposed a guarded Workers patch.'
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
    : message.includes('not pending approval') ||
        message.includes('already has a requested revision')
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

function requestColo(request: Request): string {
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

function approvalPolicy() {
  return {
    policy_id: APPROVAL_POLICY_ID,
    policy_version: APPROVAL_POLICY_VERSION,
    approval_boundary: 'codemode_pending_action',
    rule: 'Payment-impacting Workers writes require a signed human decision before Code Mode executes the write.',
    requires_human_review: true,
  }
}

function codeModeRuntimeContext(runId: string, executor: CodeModeExecutorMode) {
  return {
    runtime: 'CodemodeRuntime',
    runtime_version: CODEMODE_RUNTIME_VERSION,
    runtime_name: codeModeRuntimeName(runId),
    agents_sdk_version: AGENTS_SDK_VERSION,
    executor,
  }
}

function codeModeContinuation(input: {
  runId: string
  pendingAction: PendingAction
  payloadHash: string
  executor: CodeModeExecutorMode
}) {
  return {
    ...codeModeRuntimeContext(input.runId, input.executor),
    continuation_id: `${input.pendingAction.executionId}:${input.pendingAction.seq}`,
    execution_id: input.pendingAction.executionId,
    seq: input.pendingAction.seq,
    connector: input.pendingAction.connector,
    method: input.pendingAction.method,
    requires_approval: true,
    stable_connector_id: CODEMODE_RUNTIME_ID,
    input_digest: hashUnknown(input.pendingAction.args),
    payload_hash: input.payloadHash,
  }
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

function policyFromBody(body: unknown): Record<string, unknown> | null {
  return objectField(body, 'policy') ?? objectField(objectField(body, 'receipt_head'), 'policy')
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
    body?.approval_boundary === 'codemode_pending_action' &&
    body?.requires_human_review === true
  )
}

function continuationMatches(continuation: unknown, expectedPayloadHash: string | null): boolean {
  const body = asObject(continuation)
  const continuationId = stringField(body, 'continuation_id')
  const executionId = stringField(body, 'execution_id')
  const payloadHash = stringField(body, 'payload_hash')
  const seq = body?.seq
  return (
    typeof continuationId === 'string' &&
    typeof executionId === 'string' &&
    typeof seq === 'number' &&
    continuationId === `${executionId}:${seq}` &&
    body?.runtime === 'CodemodeRuntime' &&
    body?.connector === 'repository' &&
    body?.method === 'write_file' &&
    body?.requires_approval === true &&
    body?.stable_connector_id === CODEMODE_RUNTIME_ID &&
    (expectedPayloadHash === null || payloadHash === expectedPayloadHash)
  )
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
  if (role === 'codemode_runtime') {
    return env.ATRIB_CODEMODE_SERVER_URL ?? 'codemode://atrib-cloudflare/runtime'
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
  const diff = `@@ -1,34 +1,44 @@
import { verifyCheckoutSession } from '../lib/checkout';
import { recordMetric } from '../observability';
import { json } from '../responses';
import type { Env } from '../types';

const CHECKOUT_ROUTE = '/checkout';

function isCheckoutPost(request: Request): boolean {
  return request.method === 'POST' && new URL(request.url).pathname === CHECKOUT_ROUTE;
}

function checkoutHeaders(env: Env): HeadersInit {
  return {
    'cache-control': 'no-store',
    'x-checkout-region': env.CF_COLO ?? 'unknown',
  };
}

+import { normalizeCartId } from '../lib/cart';
+
+const CHECKOUT_RECOVERY_SOURCE = 'browser-run-checkout-smoke';

export async function checkoutHandler(request: Request, env: Env) {
  if (!isCheckoutPost(request)) {
    return json({ error: 'method_not_allowed' }, { status: 405 });
  }

  const session = await verifyCheckoutSession(request, env);

+  const cartId = normalizeCartId(session.cartId);
+  if (!cartId) {
+    recordMetric('checkout.recovered_missing_cart', {
+      source: CHECKOUT_RECOVERY_SOURCE,
+    });
+    return json({ error: 'missing_cart' }, { status: 400, headers: checkoutHeaders(env) });
+  }

  return json({
    ok: true,
+    cartId,
    checkoutId: session.checkoutId,
    region: env.CF_COLO,
  }, {
    headers: checkoutHeaders(env),
  });
}

export function checkoutRouteName(): string {
  return CHECKOUT_ROUTE;
}`
  return {
    planner: 'fixture',
    action: 'Update file in repository',
    summary:
      'Respond to a Workers Observability alert by preparing a guarded checkout-route patch from Browser Run evidence and Think workspace context.',
    risk: 'Changes checkout error handling for a payment-impacting Workers route.',
    payload: {
      operation: 'write_file',
      incident_id: 'obs-alert-4821',
      repository: 'cloudflare/agents-commerce-demo',
      labels: ['workers', 'browser-run', 'codemode', 'checkout'],
      target_file: 'workers/checkout/session.ts',
      version: 4,
      before: {
        file: 'workers/checkout/session.ts',
        imports: ['verifyCheckoutSession', 'recordMetric', 'json'],
        handler: 'checkoutHandler',
        browser_run: {
          session: 'brw_checkout_smoke_4821',
          finding: 'checkout POST returned 500 after deploy',
        },
        ai_search: {
          corpus: 'workers-checkout-runbooks',
          match: 'missing cart id should return 400 before payment intent creation',
        },
        think_workspace: 'think_checkout_incident_4821',
        alert_summary: prompt.slice(0, 120),
      },
      after: {
        file: 'workers/checkout/session.ts',
        imports: ['verifyCheckoutSession', 'recordMetric', 'json', 'normalizeCartId'],
        handler: 'checkoutHandler',
        checkout_guard: {
          missing_cart_response: 400,
          metric: 'checkout.recovered_missing_cart',
          source: 'browser-run-checkout-smoke',
        },
        artifact: {
          kind: 'think_workspace_handoff',
          id: 'art_checkout_incident_4821',
        },
        note: 'Approved for this demo Workers checkout file only.',
      },
      diff,
    },
  }
}

function revisedPlanFromFeedback(
  priorPayload: PlannedAction['payload'],
  feedback: string,
): PlannedAction {
  const diff = `@@ -1,34 +1,47 @@
import { verifyCheckoutSession } from '../lib/checkout';
import { recordMetric } from '../observability';
import { json } from '../responses';
import type { Env } from '../types';

const CHECKOUT_ROUTE = '/checkout';

function isCheckoutPost(request: Request): boolean {
  return request.method === 'POST' && new URL(request.url).pathname === CHECKOUT_ROUTE;
}

function checkoutHeaders(env: Env): HeadersInit {
  return {
    'cache-control': 'no-store',
    'x-checkout-region': env.CF_COLO ?? 'unknown',
  };
}

+import { normalizeCartId } from '../lib/cart';
+
+const CHECKOUT_RECOVERY_SOURCE = 'browser-run-checkout-smoke';

export async function checkoutHandler(request: Request, env: Env) {
  if (!isCheckoutPost(request)) {
    return json({ error: 'method_not_allowed' }, { status: 405 });
  }

  const session = await verifyCheckoutSession(request, env);

+  const cartId = normalizeCartId(session.cartId);
+  if (!cartId) {
+    recordMetric('checkout.recovered_missing_cart', {
+      source: CHECKOUT_RECOVERY_SOURCE,
+      browserRunId: 'brw_checkout_smoke_4821',
+    });
+    return json({ error: 'missing_cart' }, { status: 400, headers: checkoutHeaders(env) });
+  }

  return json({
    ok: true,
+    cartId,
    checkoutId: session.checkoutId,
    region: env.CF_COLO,
  }, {
    headers: checkoutHeaders(env),
  });
}

export function checkoutRouteName(): string {
  return CHECKOUT_ROUTE;
}`
  return {
    planner: 'fixture',
    action: 'Update revised file in repository',
    summary:
      'Revise the Workers checkout patch after human feedback while preserving the Browser Run evidence and Think workspace handoff.',
    risk: 'Narrows the checkout guard before Code Mode writes the payment-impacting route.',
    payload: {
      ...priorPayload,
      version: priorPayload.version + 1,
      after: {
        ...priorPayload.after,
        checkout_guard: {
          missing_cart_response: 400,
          metric: 'checkout.recovered_missing_cart',
          source: 'browser-run-checkout-smoke',
          browser_run_id: 'brw_checkout_smoke_4821',
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
              'Return compact JSON for a safe Cloudflare Workers checkout incident approval proposal. Do not include markdown.',
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
  const latestRuntimeRejection = [...parsed]
    .reverse()
    .find((entry) => entry.label === 'runtime_rejection')
  const outcome = get('outcome')
  const handoff = get('handoff')
  const outcomeBody = outcome?.body as {
    status?: string
    changed_rows?: string[]
    diagnostic?: string
  } | null
  const handoffBody = handoff?.body as {
    receipt_head?: Record<string, unknown>
    summary?: string
  } | null
  const activeDecision = get('approval') ?? get('rejection') ?? get('change_request')
  const activeRuntime = execution ?? latestRuntimeRejection
  const activeRuntimeBody = activeRuntime?.body as {
    continuation?: unknown
    policy?: unknown
    pre_resume_receipt_check?: unknown
  } | null
  const activeProposalBody = latestProposal?.body as {
    decision_scope?: { continuation?: unknown }
    policy?: unknown
    pre_revision_receipt_check?: unknown
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
          'The trace starts with the Workers Observability alert, Browser Run evidence, and incident workspace that caused the agent to work before human review.',
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
        name: 'Signed decision chain',
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
          'Agent, human reviewer, and CodemodeRuntime records use separate keys so autonomy and approval do not blur.',
        evidence_labels: [...new Set(parsed.map((entry) => entry.signer))],
      },
    ],
    handoff: {
      summary: handoffBody?.summary ?? null,
      public_context_url: publicContextUrl,
      record_hash: handoff?.record_hash ?? null,
      receipt_head: handoffBody?.receipt_head ?? null,
    },
    receipt_state: {
      head_record_hash:
        (handoffBody?.receipt_head as { head_record_hash?: string } | undefined)
          ?.head_record_hash ??
        handoff?.record_hash ??
        outcome?.record_hash ??
        latestRuntimeRejection?.record_hash ??
        activeDecision?.record_hash ??
        latestProposal?.record_hash ??
        null,
      proposal_record_hash: latestProposal?.record_hash ?? null,
      decision_record_hash: activeDecision?.record_hash ?? null,
      runtime_record_hash: activeRuntime?.record_hash ?? null,
      outcome_record_hash: outcome?.record_hash ?? null,
      handoff_record_hash: handoff?.record_hash ?? null,
      policy: activeProposalBody?.policy ?? activeRuntimeBody?.policy ?? null,
      continuation:
        activeProposalBody?.decision_scope?.continuation ?? activeRuntimeBody?.continuation ?? null,
      latest_receipt_check:
        (handoffBody?.receipt_head as { receipt_state_check?: unknown } | undefined)
          ?.receipt_state_check ??
        activeRuntimeBody?.pre_resume_receipt_check ??
        activeProposalBody?.pre_revision_receipt_check ??
        null,
    },
    observability: {
      native_events: nativeEvents,
      coverage: [
        'prior workflow trigger',
        'message lifecycle',
        'human approval gate',
        'Code Mode tool execution',
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

interface CodeModeRunInput {
  runId: string
  payload: PlannedAction['payload']
  payloadHash: string
  forceError?: boolean
  executorMode?: CodeModeExecutorMode
}

interface StartedCodeModeRun {
  output: ProxyToolOutput
  pendingAction: PendingAction
  executionState: ExecutionState | null
  codeHash: string
  executorMode: CodeModeExecutorMode
}

interface CodeModeToolArgs {
  run_id: string
  stable_connector_id: string
  payload_digest: string
  payload: PlannedAction['payload']
  force_error?: boolean
}

interface CodeModeValidationError extends Record<string, unknown> {
  status: 'error'
  error: string
  diagnostic: string
  changed_rows: []
}

function codeModeScript(input: CodeModeRunInput): string {
  const args = {
    run_id: input.runId,
    stable_connector_id: CODEMODE_RUNTIME_ID,
    payload_digest: input.payloadHash.replace(/^sha256:/u, ''),
    payload: input.payload,
    force_error: input.forceError === true,
  }
  return `async () => {
  const args = ${JSON.stringify(args, null, 2)};
  const preview = await repository.preview_file_update(args);
  if (preview.status !== "ready") {
    throw new Error("Repository preview failed: " + JSON.stringify(preview));
  }
  const execution = await repository.write_file(args);
  return {
    preview,
    execution,
    changed_rows: execution.changed_rows ?? [],
  };
}`
}

function parseCodeModeScriptArgs(code: string): CodeModeToolArgs | null {
  const match = code.match(/const args = ([\s\S]*?);\n\s*const preview/u)
  if (!match?.[1]) return null
  const parsed = JSON.parse(match[1]) as unknown
  return isCodeModeToolArgs(parsed) ? parsed : null
}

function isCodeModeToolArgs(value: unknown): value is CodeModeToolArgs {
  const args = value as Partial<CodeModeToolArgs>
  return (
    typeof args === 'object' &&
    args !== null &&
    typeof args.run_id === 'string' &&
    typeof args.stable_connector_id === 'string' &&
    typeof args.payload_digest === 'string' &&
    typeof args.payload === 'object' &&
    args.payload !== null
  )
}

function isCodeModeValidationError(value: unknown): value is CodeModeValidationError {
  return (value as { status?: unknown }).status === 'error'
}

function codeModeRuntimeName(runId: string): string {
  return `approval-trace.${runId}`
}

function codeModeExecutorForRequest(
  requestUrl: URL,
  requestedMode?: CodeModeExecutorMode,
): CodeModeExecutorMode {
  if (requestedMode === 'dynamic-worker' || requestedMode === 'local-test') return requestedMode
  return requestUrl.hostname.endsWith('.workers.dev') ? 'dynamic-worker' : 'local-test'
}

function codeModeLogSummary(state: ExecutionState | null): Array<Record<string, unknown>> {
  return (state?.log ?? []).map((entry) => ({
    seq: entry.seq,
    connector: entry.connector,
    method: entry.method,
    state: entry.state,
    requires_approval: entry.requiresApproval,
    args_hash: hashUnknown(entry.args),
    result_hash: entry.result === undefined ? null : hashUnknown(entry.result),
  }))
}

function codeModePendingActionFromBody(body: unknown): PendingAction | null {
  const pending = (body as { codemode?: { pending_action?: unknown } } | null)?.codemode
    ?.pending_action
  if (!pending || typeof pending !== 'object') return null
  const candidate = pending as Partial<PendingAction>
  if (
    typeof candidate.executionId !== 'string' ||
    typeof candidate.seq !== 'number' ||
    typeof candidate.connector !== 'string' ||
    typeof candidate.method !== 'string'
  ) {
    return null
  }
  return candidate as PendingAction
}

function codeModeResultBody(output: ProxyToolOutput): Record<string, unknown> {
  if (output.status === 'completed') {
    const result = output.result as { execution?: Record<string, unknown>; changed_rows?: unknown }
    const execution = result?.execution
    return {
      status: execution?.status ?? 'success',
      diagnostic:
        execution?.diagnostic ??
        'CodemodeRuntime resumed the approved repository update and completed.',
      error: execution?.error ?? null,
      changed_rows: Array.isArray(execution?.changed_rows)
        ? execution.changed_rows
        : Array.isArray(result?.changed_rows)
          ? result.changed_rows
          : [],
      execution_result: result,
    }
  }
  if (output.status === 'error') {
    return {
      status: 'error',
      diagnostic: output.error,
      changed_rows: [],
      error: output.error,
    }
  }
  return {
    status: 'paused',
    diagnostic: 'CodemodeRuntime paused again for another approval.',
    changed_rows: [],
    pending: output.pending,
  }
}

class LocalCodeModeExecutor implements Executor {
  async execute(
    code: string,
    _providersOrFns: ResolvedProvider[] | Record<string, (...args: unknown[]) => Promise<unknown>>,
    options?: ExecuteOptions,
  ): Promise<ExecuteResult> {
    const repository = options?.connectors?.find(
      (connector) => connector.name === 'repository',
    )?.binding
    if (!repository) return { result: undefined, error: 'repository connector unavailable' }
    try {
      const args = parseCodeModeScriptArgs(code)
      if (!args) return { result: undefined, error: 'unsupported local Code Mode script' }
      const preview = await repository.callTool('preview_file_update', args)
      const previewControl = codeModeControl(preview)
      if (previewControl === 'pause') return { result: undefined, error: '__CODEMODE_PAUSE__' }
      if (previewControl === 'error')
        return { result: undefined, error: codeModeControlMessage(preview) }
      const execution = await repository.callTool('write_file', args)
      const executionControl = codeModeControl(execution)
      if (executionControl === 'pause') return { result: undefined, error: '__CODEMODE_PAUSE__' }
      if (executionControl === 'error') {
        return { result: undefined, error: codeModeControlMessage(execution) }
      }
      return {
        result: {
          preview,
          execution,
          changed_rows:
            typeof execution === 'object' &&
            execution !== null &&
            Array.isArray((execution as { changed_rows?: unknown }).changed_rows)
              ? (execution as { changed_rows: unknown[] }).changed_rows
              : [],
        },
        logs: ['local deterministic Code Mode executor'],
      }
    } catch (error) {
      return {
        result: undefined,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

function codeModeControl(value: unknown): 'pause' | 'error' | null {
  const control = (value as { __codemode_control__?: unknown } | null)?.__codemode_control__
  if (control === 'pause' || control === 'error') return control
  return null
}

function codeModeControlMessage(value: unknown): string {
  const message = (value as { message?: unknown } | null)?.message
  return typeof message === 'string' ? message : 'Code Mode connector returned an error'
}

class RepositoryCodeModeConnector extends CodemodeConnector<Env> {
  name(): string {
    return 'repository'
  }

  protected instructions(): string {
    return [
      'Use this connector for the demo Workers checkout patch.',
      'Call preview_file_update before write_file.',
      'write_file pauses for human approval through CodemodeRuntime before it mutates storage.',
    ].join(' ')
  }

  protected tools(): ConnectorTools {
    return {
      preview_file_update: {
        description: 'Preview the Workers checkout patch before the approval-required write.',
        inputSchema: repositoryActionSchema(),
        execute: (args) => this.previewFileUpdate(args),
      },
      write_file: {
        description: 'Apply the approved Workers checkout patch to Durable Object SQLite.',
        inputSchema: repositoryActionSchema(),
        requiresApproval: true,
        execute: (args, ctx) => this.writeFile(args, ctx?.executionId ?? 'unknown'),
      },
    }
  }

  private previewFileUpdate(args: unknown): Record<string, unknown> {
    const validation = this.validateArgs(args)
    if (isCodeModeValidationError(validation)) return validation
    const p = validation.payload
    return {
      status: 'ready',
      diagnostic: 'Preview confirms one Workers checkout file would change.',
      changed_rows: [`repo_files.${p.target_file}`],
      before: p.before,
      after: p.after,
      diff: p.diff,
    }
  }

  private writeFile(args: unknown, executionId: string): Record<string, unknown> {
    const validation = this.validateArgs(args)
    if (isCodeModeValidationError(validation)) return validation
    const workflow = this.workflow(validation.run_id)
    if (!workflow) {
      return {
        status: 'error',
        error: 'workflow_missing',
        diagnostic: 'CodemodeRuntime could not find the workflow row for this run.',
        changed_rows: [],
      }
    }
    if (workflow.payload_hash !== `sha256:${validation.payload_digest}`) {
      return {
        status: 'error',
        error: 'workflow_payload_hash_mismatch',
        diagnostic: 'The workflow payload hash does not match the paused Code Mode action.',
        changed_rows: [],
        expected_hash: workflow.payload_hash,
      }
    }
    if (!workflow.decision_record_hash || workflow.decision !== 'approved') {
      return {
        status: 'error',
        error: 'approval_missing',
        diagnostic: 'The repository write resumed before a human approval record existed.',
        changed_rows: [],
      }
    }
    if (validation.force_error === true) {
      return {
        status: 'error',
        error: 'repository_file_version_conflict',
        diagnostic: 'The Workers checkout file changed after approval.',
        changed_rows: [],
        approval_record_hash: workflow.decision_record_hash,
        execution_id: executionId,
      }
    }
    const p = validation.payload
    this.ensureRepoSchema()
    const existingApply = this.appliedDecision(workflow.decision_record_hash)
    if (existingApply) {
      return {
        status: 'success',
        diagnostic:
          'Exact-once fence found this signed decision was already applied; no duplicate write ran.',
        changed_rows: [],
        approval_record_hash: workflow.decision_record_hash,
        execution_id: executionId,
        exact_once: {
          applied: false,
          previously_applied: true,
          decision_record_hash: workflow.decision_record_hash,
          first_execution_id: existingApply.execution_id,
          first_seq: existingApply.seq,
          applied_at: existingApply.applied_at,
        },
      }
    }
    this.storage.exec(
      `
        INSERT OR REPLACE INTO repo_files
          (file_path, repository, operation, state_json, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `,
      p.target_file,
      p.repository,
      p.operation,
      JSON.stringify(p.after),
      Date.now(),
    )
    this.storage.exec(
      `
        INSERT INTO applied_decisions
          (
            decision_record_hash,
            run_id,
            execution_id,
            seq,
            payload_hash,
            file_path,
            applied_at
          )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      workflow.decision_record_hash,
      workflow.run_id,
      executionId,
      this.pendingSeqForPayload(validation.run_id, validation.payload_digest),
      workflow.payload_hash,
      p.target_file,
      Date.now(),
    )
    return {
      status: 'success',
      diagnostic: 'Durable Object SQLite demo checkout file row updated.',
      changed_rows: [`repo_files.${p.target_file}`],
      approval_record_hash: workflow.decision_record_hash,
      execution_id: executionId,
      exact_once: {
        applied: true,
        previously_applied: false,
        decision_record_hash: workflow.decision_record_hash,
      },
      after: p.after,
    }
  }

  private validateArgs(args: unknown): CodeModeToolArgs | CodeModeValidationError {
    if (!isCodeModeToolArgs(args)) {
      return {
        status: 'error',
        error: 'invalid_args',
        diagnostic: 'Code Mode repository action args did not match the expected schema.',
        changed_rows: [],
      }
    }
    if (args.stable_connector_id !== CODEMODE_RUNTIME_ID) {
      return {
        status: 'error',
        error: 'stable_connector_mismatch',
        diagnostic: 'The Code Mode connector id did not match the signed approval trace.',
        changed_rows: [],
      }
    }
    const expectedHash = hashUnknown(args.payload)
    if (expectedHash.replace(/^sha256:/u, '') !== args.payload_digest) {
      return {
        status: 'error',
        error: 'payload_hash_mismatch',
        diagnostic: 'The payload no longer matches the paused Code Mode action.',
        changed_rows: [],
      }
    }
    return args
  }

  private workflow(runId: string): WorkflowRow | null {
    const rows = this.storage
      .exec<Record<string, SqlStorageValue>>(
        `
          SELECT *
          FROM workflows
          WHERE run_id = ?
          LIMIT 1
        `,
        runId,
      )
      .toArray()
    return (rows[0] as unknown as WorkflowRow | undefined) ?? null
  }

  private ensureRepoSchema(): void {
    this.storage.exec(`
      CREATE TABLE IF NOT EXISTS repo_files (
        file_path TEXT PRIMARY KEY,
        repository TEXT NOT NULL,
        operation TEXT NOT NULL,
        state_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)
    this.storage.exec(`
      CREATE TABLE IF NOT EXISTS applied_decisions (
        decision_record_hash TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        execution_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        payload_hash TEXT NOT NULL,
        file_path TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      )
    `)
    this.storage.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_applied_decisions_execution_seq
      ON applied_decisions (execution_id, seq)
    `)
  }

  private appliedDecision(decisionRecordHash: string): {
    execution_id: string
    seq: number
    applied_at: number
  } | null {
    const rows = this.storage
      .exec<Record<string, SqlStorageValue>>(
        `
          SELECT execution_id, seq, applied_at
          FROM applied_decisions
          WHERE decision_record_hash = ?
          LIMIT 1
        `,
        decisionRecordHash,
      )
      .toArray()
    return (
      (rows[0] as unknown as
        | { execution_id: string; seq: number; applied_at: number }
        | undefined) ?? null
    )
  }

  private pendingSeqForPayload(runId: string, payloadDigest: string): number {
    const workflow = this.workflow(runId)
    if (!workflow) return -1
    const proposalRows = this.storage
      .exec<Record<string, SqlStorageValue>>(
        `
          SELECT body_json
          FROM trace_records
          WHERE run_id = ?
            AND record_hash = ?
          LIMIT 1
        `,
        runId,
        workflow.proposal_record_hash,
      )
      .toArray()
    const body = proposalRows[0]?.body_json
      ? (JSON.parse(String(proposalRows[0].body_json)) as Record<string, unknown>)
      : null
    const pending = codeModePendingActionFromBody(body)
    if (!pending) return -1
    const args = pending.args as Partial<CodeModeToolArgs>
    return args.payload_digest === payloadDigest ? pending.seq : -1
  }

  private get storage(): SqlStorage {
    return (this.ctx as unknown as DurableObjectState).storage.sql
  }
}

function repositoryActionSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      run_id: { type: 'string' },
      stable_connector_id: { type: 'string' },
      payload_digest: { type: 'string' },
      payload: { type: 'object' },
      force_error: { type: 'boolean' },
    },
    required: ['run_id', 'stable_connector_id', 'payload_digest', 'payload'],
    additionalProperties: false,
  }
}

export class CodemodeRuntime extends CloudflareCodemodeRuntime {}

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

  async createProposal(input: {
    prompt: string
    runId?: string
    forceError?: boolean
    codeModeExecutor?: CodeModeExecutorMode
  }): Promise<unknown> {
    this.ensureSchema()
    const runId = input.runId ?? crypto.randomUUID()
    const contextId = randomContextId()
    const runStartedAt = Date.now()
    const triggerTimestamp = runStartedAt
    const triageTimestamp = runTimestamp(runStartedAt, TRACE_RECORD_OFFSETS_MS.triage)
    const proposalTimestamp = runTimestamp(runStartedAt, TRACE_RECORD_OFFSETS_MS.proposal)
    const triggerBody = {
      kind: 'workflow_trigger',
      source: 'workers_observability_alert',
      scheduled_task: 'workflow.checkout_recovery_triage',
      event: {
        repository: 'cloudflare/agents-commerce-demo',
        alert_id: 'obs-alert-4821',
        labels: ['workers', 'browser-run', 'codemode', 'checkout'],
        title: input.prompt,
        alert: 'checkout_5xx_rate_spike',
        affected_route: '/checkout',
        browser_run_id: 'brw_checkout_smoke_4821',
        think_workspace_id: 'think_checkout_incident_4821',
      },
      autonomous_phase: [
        'correlated Workers Observability alert',
        'reviewed Browser Run failure evidence',
        'searched the checkout runbook with AI Search',
        'opened a Think workspace for the incident',
        'prepared a Code Mode repository patch',
      ],
      halt_condition: 'writing payment-impacting Workers code requires human approval',
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
          alertId: triggerBody.event.alert_id,
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
      repository: 'cloudflare/agents-commerce-demo',
      alert_id: 'obs-alert-4821',
      route: '/checkout',
      intent: 'fix checkout 500s before payment intent creation',
      policy_result: 'human_review_required',
      gathered_context: [
        'Workers Observability alert payload',
        'Browser Run screenshot and network failure summary',
        'AI Search checkout runbook match',
        'Think workspace incident notes',
        'Code Mode repository write policy',
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
    const codeMode = await this.startCodeModeExecution({
      runId,
      payload: plan.payload,
      payloadHash,
      forceError: input.forceError,
      executorMode: input.codeModeExecutor,
    })
    const continuation = codeModeContinuation({
      runId,
      pendingAction: codeMode.pendingAction,
      payloadHash,
      executor: codeMode.executorMode,
    })
    const body = {
      kind: 'agent_proposal',
      prompt: input.prompt,
      trigger_record_hash: triggerHash,
      planner: plan.planner,
      action: plan.action,
      summary: plan.summary,
      risk: plan.risk,
      stable_connector_id: CODEMODE_RUNTIME_ID,
      proposed_payload_hash: payloadHash,
      proposed_payload: plan.payload,
      policy: approvalPolicy(),
      decision_scope: {
        kind: 'codemode_pending_action',
        continuation,
      },
      codemode: {
        runtime: 'CodemodeRuntime',
        runtime_version: CODEMODE_RUNTIME_VERSION,
        runtime_name: codeModeRuntimeName(runId),
        agents_sdk_version: AGENTS_SDK_VERSION,
        execution_id: codeMode.output.executionId,
        execution_status: codeMode.output.status,
        executor: codeMode.executorMode,
        pending_action: codeMode.pendingAction,
        continuation,
        code_hash: codeMode.codeHash,
        log: codeModeLogSummary(codeMode.executionState),
      },
      approval_question:
        'Should the agent write this Workers checkout patch and resume Code Mode execution?',
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

  private codeModeRuntime(
    runId: string,
    executorMode: CodeModeExecutorMode = 'local-test',
  ): CodemodeRuntimeHandle {
    const executor =
      executorMode === 'local-test'
        ? new LocalCodeModeExecutor()
        : new DynamicWorkerExecutor({ loader: this.env.LOADER })
    return createCodemodeRuntime({
      ctx: this.ctx,
      name: codeModeRuntimeName(runId),
      executor,
      connectors: [new RepositoryCodeModeConnector(this.ctx, this.env)],
    })
  }

  private async startCodeModeExecution(input: CodeModeRunInput): Promise<StartedCodeModeRun> {
    const executorMode = input.executorMode ?? 'local-test'
    const runtime = this.codeModeRuntime(input.runId, executorMode)
    const code = codeModeScript(input)
    const tool = runtime.tool({
      connectorHints: {
        repository: 'Preview and apply the Cloudflare Workers checkout patch.',
      },
    }) as unknown as {
      execute?: (args: { code: string }) => Promise<ProxyToolOutput>
    }
    if (!tool.execute) throw new Error('CodemodeRuntime tool execute function is unavailable')
    const output = await tool.execute({ code })
    if (output.status !== 'paused') {
      throw new Error(`Code Mode run did not pause for approval: ${JSON.stringify(output)}`)
    }
    const pendingAction = output.pending.find(
      (action) => action.connector === 'repository' && action.method === 'write_file',
    )
    if (!pendingAction) {
      throw new Error(
        `Code Mode run paused without repository.write_file: ${JSON.stringify(output)}`,
      )
    }
    return {
      output,
      pendingAction,
      executionState: await this.getCodeModeExecution(runtime, output.executionId),
      codeHash: hashUnknown(code),
      executorMode,
    }
  }

  private async getCodeModeExecution(
    runtime: CodemodeRuntimeHandle,
    executionId: string,
  ): Promise<ExecutionState | null> {
    const executions = await runtime.executions(25)
    return executions.find((execution) => execution.id === executionId) ?? null
  }

  private async verifyReceiptState(input: {
    runId: string
    requiredRecordHashes?: string[]
    headRecordHash?: string | null
  }): Promise<ReceiptVerification> {
    const rows = this.getRecordRows(input.runId)
    const byHash = new Map(rows.map((row) => [row.record_hash, row]))
    const headIndex = input.headRecordHash
      ? rows.findIndex((row) => row.record_hash === input.headRecordHash)
      : -1
    const checkedRows = input.headRecordHash && headIndex >= 0 ? rows.slice(0, headIndex + 1) : rows
    const signatureFailures: string[] = []
    const hashFailures: string[] = []
    for (const row of checkedRows) {
      const record = JSON.parse(row.record_json) as AtribRecord
      if (recordHash(record) !== row.record_hash) hashFailures.push(row.record_hash)
      if (!(await verifyAtribRecord(record))) signatureFailures.push(row.record_hash)
    }
    const missingRecordHashes = (input.requiredRecordHashes ?? []).filter(
      (hash) => !byHash.has(hash),
    )
    const headRow = input.headRecordHash ? byHash.get(input.headRecordHash) : rows.at(-1)
    return {
      ok:
        signatureFailures.length === 0 &&
        hashFailures.length === 0 &&
        missingRecordHashes.length === 0 &&
        (!input.headRecordHash || Boolean(headRow)),
      checked_at: new Date().toISOString(),
      checked_record_hashes: checkedRows.map((row) => row.record_hash),
      head_record_hash: headRow?.record_hash ?? null,
      head_label: headRow?.label ?? null,
      signature_failures: signatureFailures,
      hash_failures: hashFailures,
      missing_record_hashes: missingRecordHashes,
    }
  }

  private currentProposalBody(workflow: WorkflowRow): Record<string, unknown> | null {
    const row = this.getRecordRows(workflow.run_id).find(
      (record) => record.record_hash === workflow.proposal_record_hash,
    )
    if (!row?.body_json) return null
    return JSON.parse(row.body_json) as Record<string, unknown>
  }

  private currentCodeModePendingAction(workflow: WorkflowRow): PendingAction | null {
    return codeModePendingActionFromBody(this.currentProposalBody(workflow))
  }

  private currentCodeModeExecutor(workflow: WorkflowRow): CodeModeExecutorMode {
    const executor = (
      this.currentProposalBody(workflow) as {
        codemode?: { executor?: unknown }
      } | null
    )?.codemode?.executor
    return executor === 'local-test' ? 'local-test' : 'dynamic-worker'
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
    const pending = this.currentCodeModePendingAction(workflow)
    if (!pending) throw new Error('run has no Code Mode pending action to approve')
    const continuation = codeModeContinuation({
      runId: input.runId,
      pendingAction: pending,
      payloadHash: workflow.payload_hash,
      executor: this.currentCodeModeExecutor(workflow),
    })
    const body = {
      kind: 'human_approval',
      reviewer_id: 'browser-demo-human',
      decision: 'approved',
      reason: input.reason,
      proposal_record_hash: workflow.proposal_record_hash,
      approved_payload_hash: workflow.payload_hash,
      stable_connector_id: CODEMODE_RUNTIME_ID,
      policy: approvalPolicy(),
      continuation,
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

  async executeApprovedCodeModeRun(input: { runId: string }): Promise<{ failed: boolean }> {
    this.ensureSchema()
    const workflow = this.getWorkflowRow(input.runId)
    if (!workflow) throw new Error(`run not found: ${input.runId}`)
    if (workflow.decision !== 'approved' || !workflow.decision_record_hash) {
      throw new Error('run has no signed approval for Code Mode resume')
    }
    const pending = this.currentCodeModePendingAction(workflow)
    if (!pending) throw new Error('run has no Code Mode pending action to approve')
    const continuation = codeModeContinuation({
      runId: input.runId,
      pendingAction: pending,
      payloadHash: workflow.payload_hash,
      executor: this.currentCodeModeExecutor(workflow),
    })
    const preResumeReceiptCheck = await this.verifyReceiptState({
      runId: input.runId,
      requiredRecordHashes: [workflow.proposal_record_hash, workflow.decision_record_hash],
      headRecordHash: workflow.decision_record_hash,
    })
    if (!preResumeReceiptCheck.ok) {
      throw new Error(
        `receipt state failed before Code Mode resume: ${jsonText(preResumeReceiptCheck)}`,
      )
    }
    const runtime = this.codeModeRuntime(input.runId, this.currentCodeModeExecutor(workflow))
    const output = await runtime.approve({ executionId: pending.executionId })
    const state = await this.getCodeModeExecution(runtime, pending.executionId)
    const executionTimestamp = runTimestamp(workflow.updated_at, 125)
    const executionBody = {
      kind: 'codemode_execution_resumed',
      runtime: 'CodemodeRuntime',
      runtime_version: CODEMODE_RUNTIME_VERSION,
      runtime_name: codeModeRuntimeName(input.runId),
      agents_sdk_version: AGENTS_SDK_VERSION,
      execution_id: pending.executionId,
      pending_action: pending,
      policy: approvalPolicy(),
      continuation,
      proposal_record_hash: workflow.proposal_record_hash,
      approval_record_hash: workflow.decision_record_hash,
      approved_payload_hash: workflow.payload_hash,
      pre_resume_receipt_check: preResumeReceiptCheck,
      output,
      execution_state: state
        ? {
            id: state.id,
            status: state.status,
            created_at: state.createdAt,
            updated_at: state.updatedAt,
            log: codeModeLogSummary(state),
            error: state.error,
          }
        : null,
    }
    const executionRecord = await signObservation({
      env: this.env,
      role: 'codemode_runtime',
      key: privateKey(this.env.ATRIB_ACTION_MCP_PRIVATE_KEY),
      contextId: workflow.context_id,
      chainRoot: workflow.decision_record_hash,
      toolName: 'codemode_execution',
      body: executionBody,
      informedBy: [workflow.proposal_record_hash, workflow.decision_record_hash],
      timestamp: executionTimestamp,
    })
    const executionHash = recordHash(executionRecord)
    await this.saveTraceRecord({
      runId: input.runId,
      label: 'execution',
      signer: 'codemode_runtime',
      record: executionRecord,
      body: executionBody,
      args: pending.args,
      result: output,
      proof: await submitRecord(this.env, executionRecord),
    })

    const resultBody = codeModeResultBody(output)
    const outcomeTimestamp = runTimestamp(executionTimestamp, 125)
    const outcomeBody = {
      kind: 'execution_outcome',
      ...resultBody,
      runtime: 'CodemodeRuntime',
      runtime_version: CODEMODE_RUNTIME_VERSION,
      execution_id: pending.executionId,
      execution_record_hash: executionHash,
      policy: approvalPolicy(),
      continuation,
      receipt_links: {
        proposal_record_hash: workflow.proposal_record_hash,
        decision_record_hash: workflow.decision_record_hash,
        execution_record_hash: executionHash,
      },
    }
    const outcomeRecord = await signObservation({
      env: this.env,
      role: 'codemode_runtime',
      key: privateKey(this.env.ATRIB_ACTION_MCP_PRIVATE_KEY),
      contextId: workflow.context_id,
      chainRoot: executionHash,
      toolName: 'record_outcome',
      body: outcomeBody,
      informedBy: [executionHash],
      timestamp: outcomeTimestamp,
    })
    await this.saveTraceRecord({
      runId: input.runId,
      label: 'outcome',
      signer: 'codemode_runtime',
      record: outcomeRecord,
      body: outcomeBody,
      proof: await submitRecord(this.env, outcomeRecord),
    })
    this.saveNativeEvent(
      input.runId,
      emitNativeEvent({
        channel: 'agents:codemode',
        type: output.status === 'completed' ? 'codemode:execution_completed' : 'codemode:error',
        agent: 'ApprovalTraceAgent',
        name: input.runId,
        payload: {
          executionId: pending.executionId,
          status: output.status,
          executionRecordHash: executionHash,
        },
        timestamp: outcomeTimestamp,
      }),
    )
    return {
      failed: output.status !== 'completed' || resultBody.status === 'error',
    }
  }

  async rejectCurrentCodeModeRun(input: {
    runId: string
    reason: 'rejected' | 'changes_requested'
  }): Promise<string | null> {
    this.ensureSchema()
    const workflow = this.getWorkflowRow(input.runId)
    if (!workflow) throw new Error(`run not found: ${input.runId}`)
    if (!workflow.decision_record_hash) return null
    const pending = this.currentCodeModePendingAction(workflow)
    if (!pending) return null
    const runtime = this.codeModeRuntime(input.runId, this.currentCodeModeExecutor(workflow))
    const terminated = await runtime.reject({
      executionId: pending.executionId,
      seq: pending.seq,
    })
    const state = await this.getCodeModeExecution(runtime, pending.executionId)
    const timestamp = runTimestamp(workflow.updated_at, 125)
    const continuation = codeModeContinuation({
      runId: input.runId,
      pendingAction: pending,
      payloadHash: workflow.payload_hash,
      executor: this.currentCodeModeExecutor(workflow),
    })
    const body = {
      kind: 'codemode_runtime_rejection',
      runtime: 'CodemodeRuntime',
      runtime_version: CODEMODE_RUNTIME_VERSION,
      runtime_name: codeModeRuntimeName(input.runId),
      agents_sdk_version: AGENTS_SDK_VERSION,
      reason: input.reason,
      terminated,
      execution_id: pending.executionId,
      pending_action: pending,
      policy: approvalPolicy(),
      continuation,
      proposal_record_hash: workflow.proposal_record_hash,
      decision_record_hash: workflow.decision_record_hash,
      payload_hash: workflow.payload_hash,
      execution_status: state?.status ?? (terminated ? 'rejected' : 'unknown'),
      log: codeModeLogSummary(state),
    }
    const record = await signObservation({
      env: this.env,
      role: 'codemode_runtime',
      key: privateKey(this.env.ATRIB_ACTION_MCP_PRIVATE_KEY),
      contextId: workflow.context_id,
      chainRoot: workflow.decision_record_hash,
      toolName: 'codemode_reject',
      body,
      informedBy: [workflow.decision_record_hash],
      timestamp,
    })
    await this.saveTraceRecord({
      runId: input.runId,
      label: 'runtime_rejection',
      signer: 'codemode_runtime',
      record,
      body,
      proof: await submitRecord(this.env, record),
    })
    const rejectionHash = recordHash(record)
    this.saveNativeEvent(
      input.runId,
      emitNativeEvent({
        channel: 'agents:codemode',
        type: 'codemode:execution_rejected',
        agent: 'ApprovalTraceAgent',
        name: input.runId,
        payload: {
          executionId: pending.executionId,
          terminated,
          reason: input.reason,
        },
        timestamp,
      }),
    )
    return rejectionHash
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
    const pending = this.currentCodeModePendingAction(workflow)
    if (!pending) throw new Error('run has no Code Mode pending action to reject')
    const continuation = codeModeContinuation({
      runId: input.runId,
      pendingAction: pending,
      payloadHash: workflow.payload_hash,
      executor: this.currentCodeModeExecutor(workflow),
    })
    const body = {
      kind: 'human_approval',
      reviewer_id: 'browser-demo-human',
      decision: 'rejected',
      reason: input.reason,
      proposal_record_hash: workflow.proposal_record_hash,
      approved_payload_hash: workflow.payload_hash,
      stable_connector_id: CODEMODE_RUNTIME_ID,
      policy: approvalPolicy(),
      continuation,
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
    const existingRevision = this.sql<{ count: number }>`
      SELECT COUNT(*) AS count
      FROM trace_records
      WHERE run_id = ${input.runId}
        AND (label = ${'change_request'} OR label = ${'revision'})
    `
    if ((existingRevision[0]?.count ?? 0) > 0) {
      throw new Error(`run already has a requested revision: ${input.runId}`)
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
    const feedback = input.feedback.trim() || 'Request a narrower Workers checkout patch.'
    const pending = this.currentCodeModePendingAction(workflow)
    if (!pending) throw new Error('run has no Code Mode pending action for feedback')
    const continuation = codeModeContinuation({
      runId: input.runId,
      pendingAction: pending,
      payloadHash: workflow.payload_hash,
      executor: this.currentCodeModeExecutor(workflow),
    })
    const body = {
      kind: 'human_review_feedback',
      reviewer_id: 'browser-demo-human',
      decision: 'changes_requested',
      feedback,
      requested_changes: [
        'Keep the checkout guard scoped to missing cart ids only.',
        'Return a revised proposal before Code Mode writes the Workers checkout file.',
      ],
      proposal_record_hash: workflow.proposal_record_hash,
      approved_payload_hash: workflow.payload_hash,
      stable_connector_id: CODEMODE_RUNTIME_ID,
      policy: approvalPolicy(),
      continuation,
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
    this.sql`
      UPDATE workflows
      SET status = ${'changes_requested'},
          decision = ${'changes_requested'},
          decision_reason = ${feedback},
          decision_record_hash = ${feedbackHash},
          updated_at = ${reviewFeedbackTimestamp}
      WHERE run_id = ${input.runId}
    `
    const runtimeRejectionHash = await this.rejectCurrentCodeModeRun({
      runId: input.runId,
      reason: 'changes_requested',
    })
    const preRevisionReceiptCheck = await this.verifyReceiptState({
      runId: input.runId,
      requiredRecordHashes: [
        workflow.proposal_record_hash,
        feedbackHash,
        ...(runtimeRejectionHash ? [runtimeRejectionHash] : []),
      ],
      headRecordHash: runtimeRejectionHash ?? feedbackHash,
    })
    const priorPayload = JSON.parse(workflow.payload_json) as PlannedAction['payload']
    const revision = revisedPlanFromFeedback(priorPayload, feedback)
    const revisionPayloadHash = hashUnknown(revision.payload)
    const codeMode = await this.startCodeModeExecution({
      runId: input.runId,
      payload: revision.payload,
      payloadHash: revisionPayloadHash,
      executorMode: this.currentCodeModeExecutor(workflow),
    })
    const revisionContinuation = codeModeContinuation({
      runId: input.runId,
      pendingAction: codeMode.pendingAction,
      payloadHash: revisionPayloadHash,
      executor: codeMode.executorMode,
    })
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
      stable_connector_id: CODEMODE_RUNTIME_ID,
      proposed_payload_hash: revisionPayloadHash,
      proposed_payload: revision.payload,
      policy: approvalPolicy(),
      pre_revision_receipt_check: preRevisionReceiptCheck,
      decision_scope: {
        kind: 'codemode_pending_action',
        supersedes_proposal_record_hash: workflow.proposal_record_hash,
        prior_terminal_receipt_hash: runtimeRejectionHash,
        continuation: revisionContinuation,
      },
      codemode: {
        runtime: 'CodemodeRuntime',
        runtime_version: CODEMODE_RUNTIME_VERSION,
        runtime_name: codeModeRuntimeName(input.runId),
        agents_sdk_version: AGENTS_SDK_VERSION,
        execution_id: codeMode.output.executionId,
        execution_status: codeMode.output.status,
        executor: codeMode.executorMode,
        pending_action: codeMode.pendingAction,
        continuation: revisionContinuation,
        code_hash: codeMode.codeHash,
        log: codeModeLogSummary(codeMode.executionState),
      },
      approval_question:
        'Should the agent write this revised Workers checkout patch and resume Code Mode execution?',
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
    const now = Date.now()
    this.sql`
      UPDATE workflows
      SET status = ${'executing'},
          updated_at = CASE WHEN updated_at > ${now} THEN updated_at ELSE ${now} END
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
    const execution = rows.find((row) => row.label === 'execution')
    const outcome = rows.find((row) => row.label === 'outcome')
    if (!approval || !execution || !outcome) {
      throw new Error('approval, execution, and outcome records are required')
    }
    const outcomeRecord = JSON.parse(outcome.record_json) as AtribRecord
    const executionBody = execution.body_json
      ? (JSON.parse(execution.body_json) as Record<string, unknown>)
      : {}
    const finalReceiptCheck = await this.verifyReceiptState({
      runId: input.runId,
      requiredRecordHashes: [
        workflow.proposal_record_hash,
        approval.record_hash,
        execution.record_hash,
        outcome.record_hash,
      ],
      headRecordHash: outcome.record_hash,
    })
    if (!finalReceiptCheck.ok) {
      throw new Error(`receipt state failed before handoff: ${jsonText(finalReceiptCheck)}`)
    }
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
      receipt_head: {
        kind: 'codemode_decision_receipt_head',
        head_record_hash: outcome.record_hash,
        head_label: 'outcome',
        run_id: input.runId,
        context_id: workflow.context_id,
        proposal_record_hash: workflow.proposal_record_hash,
        decision_record_hash: approval.record_hash,
        execution_record_hash: execution.record_hash,
        outcome_record_hash: outcome.record_hash,
        payload_hash: workflow.payload_hash,
        policy: approvalPolicy(),
        runtime: executionBody.runtime ?? 'CodemodeRuntime',
        runtime_version: executionBody.runtime_version ?? CODEMODE_RUNTIME_VERSION,
        agents_sdk_version: executionBody.agents_sdk_version ?? AGENTS_SDK_VERSION,
        continuation: executionBody.continuation ?? null,
        receipt_state_check: finalReceiptCheck,
      },
      approval_record_hash: approval.record_hash,
      execution_record_hash: execution.record_hash,
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

  async getRecoveryGate(runId: string): Promise<ReceiptRecoveryGate> {
    this.ensureSchema()
    const workflow = this.getWorkflowRow(runId)
    if (!workflow) throw new Error(`run not found: ${runId}`)
    const rows = this.getRecordRows(runId)
    if (rows.length === 0) throw new Error(`run has no trace records: ${runId}`)

    const byHash = new Map(rows.map((row) => [row.record_hash, row]))
    const latest = (label: string) => [...rows].reverse().find((row) => row.label === label)
    const rowBody = (row: TraceRecordRow | undefined | null): Record<string, unknown> | null =>
      row?.body_json ? (JSON.parse(row.body_json) as Record<string, unknown>) : null

    const proposal =
      byHash.get(workflow.proposal_record_hash) ?? latest('revision') ?? latest('proposal')
    if (!proposal) throw new Error(`run has no active proposal record: ${runId}`)

    const approval = latest('approval')
    const rejection = latest('rejection')
    const changeRequest = latest('change_request')
    const execution = latest('execution')
    const outcome = latest('outcome')
    const handoff = latest('handoff')
    const latestRuntimeRejection = latest('runtime_rejection')
    const decision = workflow.decision_record_hash
      ? byHash.get(workflow.decision_record_hash)
      : (approval ?? rejection ?? changeRequest)
    const activeRuntime = execution ?? latestRuntimeRejection
    const proposalBody = rowBody(proposal)
    const decisionBody = rowBody(decision)
    const runtimeBody = rowBody(activeRuntime)
    const handoffBody = rowBody(handoff)
    const receiptHead = objectField(handoffBody, 'receipt_head')

    let gate: RecoveryGateKind
    let head = proposal
    let requiredRecordHashes: string[] = [proposal.record_hash]
    let nextStep = 'Wait for human review before any Code Mode write can resume.'

    if (handoff && outcome && execution && approval) {
      gate = 'handoff_ready'
      head = handoff
      requiredRecordHashes = [
        proposal.record_hash,
        approval.record_hash,
        execution.record_hash,
        outcome.record_hash,
        handoff.record_hash,
      ]
      nextStep =
        'Handoff to a runtime or debug surface using the verified receipt head.'
    } else if (workflow.status === 'rejected' && decision && latestRuntimeRejection) {
      gate = 'terminal_rejection'
      head = latestRuntimeRejection
      requiredRecordHashes = [
        proposal.record_hash,
        decision.record_hash,
        latestRuntimeRejection.record_hash,
      ]
      nextStep = 'Stop. The pending Code Mode action is closed and no write is allowed.'
    } else if (proposal.label === 'revision' && workflow.status === 'pending_approval') {
      gate = 'revised_human_review'
      head = proposal
      const decisionScope = objectField(proposalBody, 'decision_scope')
      requiredRecordHashes = [
        stringField(proposalBody, 'prior_proposal_record_hash'),
        stringField(proposalBody, 'feedback_record_hash'),
        stringField(decisionScope, 'prior_terminal_receipt_hash'),
        proposal.record_hash,
      ].filter((hash): hash is string => typeof hash === 'string')
      nextStep =
        'Wait for human review of the revised proposal. The earlier pending action is closed.'
    } else if (
      (workflow.status === 'approved' || workflow.status === 'executing') &&
      decision &&
      workflow.decision === 'approved'
    ) {
      gate = 'codemode_resume'
      head = decision
      requiredRecordHashes = [proposal.record_hash, decision.record_hash]
      nextStep =
        'Resume the paused Code Mode write only after the proposal and human decision verify.'
    } else {
      gate = 'human_review'
    }

    const verification = await this.verifyReceiptState({
      runId,
      requiredRecordHashes,
      headRecordHash: head.record_hash,
    })
    const policy =
      policyFromBody(proposalBody) ??
      policyFromBody(decisionBody) ??
      policyFromBody(runtimeBody) ??
      objectField(receiptHead, 'policy')
    const continuation =
      continuationFromBody(proposalBody) ??
      continuationFromBody(decisionBody) ??
      continuationFromBody(runtimeBody) ??
      objectField(receiptHead, 'continuation')
    const policyOk = policyMatches(policy)
    const continuationOk = continuationMatches(continuation, workflow.payload_hash)
    const allowsWrite =
      gate === 'codemode_resume' &&
      workflow.decision === 'approved' &&
      verification.ok &&
      policyOk &&
      continuationOk
    const recoveredHead = {
      kind: 'codemode_recovery_receipt_head',
      run_id: runId,
      context_id: workflow.context_id,
      status: workflow.status,
      gate,
      head_record_hash: head.record_hash,
      head_label: head.label,
      proposal_record_hash: proposal.record_hash,
      decision_record_hash: workflow.decision_record_hash ?? null,
      change_request_record_hash: changeRequest?.record_hash ?? null,
      runtime_record_hash: activeRuntime?.record_hash ?? null,
      outcome_record_hash: outcome?.record_hash ?? null,
      handoff_record_hash: handoff?.record_hash ?? null,
      source_receipt_head: receiptHead ?? null,
      payload_hash: workflow.payload_hash,
      policy,
      continuation,
      receipt_state_check: verification,
      trace_record_count: rows.length,
    }

    return {
      ok: verification.ok && policyOk && continuationOk,
      kind: 'codemode_receipt_recovery_gate',
      run_id: runId,
      context_id: workflow.context_id,
      status: workflow.status,
      gate,
      next_step: nextStep,
      allows_write: allowsWrite,
      source: 'durable_object_sqlite_trace_records',
      required_record_hashes: requiredRecordHashes,
      recovered_head: recoveredHead,
      policy,
      policy_ok: policyOk,
      continuation,
      continuation_ok: continuationOk,
      verification,
      durable_object_boundary: {
        deterministic_fixture: true,
        forced_eviction: false,
        recovery_model: 'persisted_receipt_head',
        note:
          'This fixture reconstructs the gate from persisted Durable Object rows. It does not force Cloudflare to evict or restart the object.',
      },
    }
  }

  getRepositoryRows(filePath: string): Array<Record<string, unknown>> {
    this.ensureSchema()
    this.ensureRepoSchema()
    return [
      ...this.sql<{
        file_path: string
        repository: string
        operation: string
        state_json: string
        updated_at: number
      }>`
      SELECT file_path, repository, operation, state_json, updated_at
      FROM repo_files
      WHERE file_path = ${filePath}
      ORDER BY updated_at ASC
    `,
    ].map((row) => ({
      file: row.file_path,
      repository: row.repository,
      operation: row.operation,
      state: JSON.parse(row.state_json),
      updated_at: row.updated_at,
    }))
  }

  getAppliedDecisionRows(runId: string): Array<Record<string, unknown>> {
    this.ensureSchema()
    this.ensureRepoSchema()
    return [
      ...this.sql<{
        decision_record_hash: string
        execution_id: string
        seq: number
        payload_hash: string
        file_path: string
        applied_at: number
      }>`
      SELECT decision_record_hash, execution_id, seq, payload_hash, file_path, applied_at
      FROM applied_decisions
      WHERE run_id = ${runId}
      ORDER BY applied_at ASC
    `,
    ]
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
        created_at ASC,
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
        END ASC
    `,
    ]
  }

  private ensureRepoSchema(): void {
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
      CREATE TABLE IF NOT EXISTS applied_decisions (
        decision_record_hash TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        execution_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        payload_hash TEXT NOT NULL,
        file_path TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      )
    `
    this.sql`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_applied_decisions_execution_seq
      ON applied_decisions (execution_id, seq)
    `
  }

  private currentProposalTimestamp(workflow: WorkflowRow): number {
    const row = this.getRecordRows(workflow.run_id).find(
      (record) => record.record_hash === workflow.proposal_record_hash,
    )
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
        description: 'Preview the approved Cloudflare Workers checkout patch before mutation.',
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
                diagnostic: 'Preview confirms one Workers checkout file would change.',
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
        description:
          'Apply the approved Cloudflare Workers checkout patch to Durable Object SQLite.',
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
                  diagnostic: 'The Workers checkout file changed after approval.',
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
                diagnostic: 'Durable Object SQLite demo checkout file row updated.',
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
      sidecar?.toolName === 'write_file' ? 'execution' : (sidecar?.toolName ?? 'tool_call')
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
        input.approval.approval_timestamp + TRACE_RECORD_OFFSETS_MS.postApprovalPause - Date.now(),
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
        return html(renderApp({ colo: requestColo(request) }))
      }
      if (url.pathname.startsWith('/action-mcp')) return actionMcpHandler.fetch(request, env, ctx)

      if (url.pathname === '/api/runs' && request.method === 'POST') {
        const body = (await request.json()) as {
          prompt?: string
          run_id?: string
          simulate_error?: boolean
          code_mode_executor?: CodeModeExecutorMode
        }
        const runId = body.run_id ?? crypto.randomUUID()
        const agent = await getTraceAgent(env, runId)
        return json(
          await agent.createProposal({
            runId,
            prompt: body.prompt ?? DEFAULT_TRIGGER_PROMPT,
            forceError: body.simulate_error === true,
            codeModeExecutor: codeModeExecutorForRequest(url, body.code_mode_executor),
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

      const recoveryGateMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/recovery-gate$/u)
      if (recoveryGateMatch && request.method === 'GET') {
        const runId = decodeURIComponent(recoveryGateMatch[1]!)
        const agent = await getTraceAgent(env, runId)
        return json(await agent.getRecoveryGate(runId))
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
        const executed = await agent.executeApprovedCodeModeRun({ runId: approval.run_id })
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
        await agent.rejectRun({
          runId,
          reason: body.reason ?? 'Rejected in the browser approval gate.',
        })
        await agent.rejectCurrentCodeModeRun({ runId, reason: 'rejected' })
        return json(await agent.getRun(runId))
      }

      const requestChangesMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/request-changes$/u)
      if (requestChangesMatch && request.method === 'POST') {
        const runId = decodeURIComponent(requestChangesMatch[1]!)
        const body = (await request.json()) as { feedback?: string }
        const agent = await getTraceAgent(env, runId)
        const current = (await agent.getRun(runId)) as {
          status: WorkflowStatus | null
          records?: Array<{ label: string }>
        }
        if (current.status === null) return errorJson(new Error(`run not found: ${runId}`))
        if (current.status !== 'pending_approval') {
          return errorJson(new Error(`run is not pending approval: ${current.status}`))
        }
        if (
          current.records?.some(
            (record) => record.label === 'change_request' || record.label === 'revision',
          )
        ) {
          return errorJson(new Error(`run already has a requested revision: ${runId}`))
        }
        return json(
          await agent.requestChanges({
            runId,
            feedback: body.feedback ?? 'Request a narrower Workers checkout patch.',
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
          '/api/runs/:runId/recovery-gate',
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
