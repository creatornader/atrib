// SPDX-License-Identifier: Apache-2.0

import { createHash } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { pathToFileURL } from 'node:url'
import {
  BROWSERBASE_ACTION_POLICY_EVENT_TYPE,
  BROWSERBASE_ACTION_POLICY_VERSION,
  normalizeBrowserbaseActionPolicyMode,
  type BrowserbaseActionPolicyMode,
} from '../action-control.js'
import { runBrowserbaseStagehandPacket } from '../browserbase-stagehand-packet-smoke.js'
import type { WrappedMcpPacketResult } from '../../wrapped-mcp-proof-runner.js'

const serviceName = 'atrib-browserbase-stagehand-demo'
const maxStoredRuns = 12

type DemoMode = 'fixture' | 'live'
type RunStatus = 'running' | 'accepted' | 'failed'

export type RateLimitConfig = {
  enabled: boolean
  windowMs: number
  maxRunsPerWindow: number
  maxRunsPerDay: number
}

export type RateLimitBucket = {
  windowStartedAtMs: number
  windowCount: number
  dayKey: string
  dayCount: number
}

export type BrowserbaseDemoRun = {
  run_id: string
  status: RunStatus
  mode: DemoMode
  action_policy_mode: BrowserbaseActionPolicyMode
  started_at: string
  finished_at?: string
  ok?: boolean
  error?: string
  workflow?: BrowserbaseWorkflow
  verifier?: WrappedMcpPacketResult['verifier']
  privacy?: WrappedMcpPacketResult['privacy']
  log?: WrappedMcpPacketResult['log']
  action_policy?: WrappedMcpPacketResult['action_policy']
  operations?: Array<{
    step: string
    record_hash: string
    log_index: number
    explorer_url: string | null
    log_proof_url: string | null
  }>
}

export type DisclosedValue = {
  value?: string
  hash?: string
  disclosure: 'public-fixed' | 'hash-only'
}

export type BrowserbaseWorkflow = {
  name: string
  target_url: DisclosedValue
  upstream: 'hosted' | 'stdio'
  mcp_surface: string
  browserbase_session: {
    lifecycle_tools: string[]
    replay_url: DisclosedValue
    session_url: DisclosedValue
    dashboard_note: string
  }
  stagehand_steps: Array<{
    tool: 'observe' | 'act' | 'extract'
    primitive: 'observe' | 'act' | 'extract'
    instruction: DisclosedValue
  }>
  atrib_receipts: {
    signed_tools: string[]
    public_fields: string[]
    private_fields: string[]
  }
}

type Runner = (options: {
  mode: DemoMode
  publicLog: boolean
  actionPolicyMode: BrowserbaseActionPolicyMode
}) => Promise<WrappedMcpPacketResult>

function numberEnv(name: string, fallback: number, env: NodeJS.ProcessEnv): number {
  const value = env[name]
  if (value === undefined) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function proofRunTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const value = numberEnv('ATRIB_BROWSERBASE_DEMO_RUN_TIMEOUT_MS', 120_000, env)
  return Math.max(10_000, Math.trunc(value))
}

function sha256Text(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function discloseValue(value: string, publicValue: boolean): DisclosedValue {
  return publicValue
    ? { value, disclosure: 'public-fixed' }
    : { hash: sha256Text(value), disclosure: 'hash-only' }
}

export function browserbaseWorkflowFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): BrowserbaseWorkflow {
  const targetUrl = env.ATRIB_BROWSERBASE_DEMO_URL ?? 'https://example.com'
  const observeInstruction = env.ATRIB_BROWSERBASE_DEMO_OBSERVE ?? 'Find the More information link'
  const actAction = env.ATRIB_BROWSERBASE_DEMO_ACT ?? 'Click the More information link'
  const extractInstruction =
    env.ATRIB_BROWSERBASE_DEMO_EXTRACT ?? 'Extract the page title and current URL'
  const exposeTarget =
    env.ATRIB_BROWSERBASE_DEMO_EXPOSE_TARGET === '1' || targetUrl === 'https://example.com'
  const exposeInstructions =
    env.ATRIB_BROWSERBASE_DEMO_EXPOSE_INSTRUCTIONS === '1' ||
    (!env.ATRIB_BROWSERBASE_DEMO_OBSERVE &&
      !env.ATRIB_BROWSERBASE_DEMO_ACT &&
      !env.ATRIB_BROWSERBASE_DEMO_EXTRACT)

  return {
    name: 'Browserbase hosted Stagehand proof flow',
    target_url: discloseValue(targetUrl, exposeTarget),
    upstream: browserbaseUpstreamFromEnv(env),
    mcp_surface:
      browserbaseUpstreamFromEnv(env) === 'hosted'
        ? 'https://mcp.browserbase.com/mcp'
        : 'npx -y @browserbasehq/mcp',
    browserbase_session: {
      lifecycle_tools: ['start', 'navigate', 'end'],
      replay_url: { disclosure: 'hash-only' },
      session_url: { disclosure: 'hash-only' },
      dashboard_note:
        'Raw Browserbase session and replay URLs stay private. The API-key owner can inspect the session in Browserbase.',
    },
    stagehand_steps: [
      {
        tool: 'observe',
        primitive: 'observe',
        instruction: discloseValue(observeInstruction, exposeInstructions),
      },
      {
        tool: 'act',
        primitive: 'act',
        instruction: discloseValue(actAction, exposeInstructions),
      },
      {
        tool: 'extract',
        primitive: 'extract',
        instruction: discloseValue(extractInstruction, exposeInstructions),
      },
    ],
    atrib_receipts: {
      signed_tools: ['start', 'navigate', 'observe', 'act', 'extract', 'end'],
      public_fields: ['tool name', 'args_hash', 'result_hash', 'record hash', 'log index'],
      private_fields: [
        'Browserbase API key',
        'Browserbase project id',
        'session URL',
        'replay URL',
        'page snapshot',
        'selectors',
        'form values',
        'raw extraction payload',
      ],
    },
  }
}

export function demoModeFromEnv(env: NodeJS.ProcessEnv = process.env): DemoMode {
  return env.ATRIB_BROWSERBASE_DEMO_MODE === 'live' ? 'live' : 'fixture'
}

export function actionPolicyModeFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): BrowserbaseActionPolicyMode {
  return normalizeBrowserbaseActionPolicyMode(
    env.ATRIB_BROWSERBASE_DEMO_ACTION_POLICY ?? env.ATRIB_BROWSERBASE_ACTION_POLICY,
  )
}

export function publicLogFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.ATRIB_BROWSERBASE_DEMO_PUBLIC_LOG === '0') return false
  return demoModeFromEnv(env) === 'live'
}

export function browserbaseUpstreamFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): 'hosted' | 'stdio' {
  return env.ATRIB_BROWSERBASE_UPSTREAM === 'hosted' ? 'hosted' : 'stdio'
}

export function missingLiveEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const required =
    browserbaseUpstreamFromEnv(env) === 'hosted'
      ? ['BROWSERBASE_API_KEY']
      : ['BROWSERBASE_API_KEY', 'BROWSERBASE_PROJECT_ID', 'GEMINI_API_KEY']
  return required.filter((name) => !env[name])
}

export function deployedDemoFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ATRIB_BROWSERBASE_DEMO_DEPLOYED === '1'
}

export function rateLimitConfigFromEnv(env: NodeJS.ProcessEnv = process.env): RateLimitConfig {
  return {
    enabled: env.ATRIB_BROWSERBASE_DEMO_RATE_LIMIT !== '0',
    windowMs: numberEnv('ATRIB_BROWSERBASE_DEMO_RATE_LIMIT_WINDOW_MS', 60 * 60 * 1000, env),
    maxRunsPerWindow: numberEnv('ATRIB_BROWSERBASE_DEMO_MAX_RUNS_PER_WINDOW', 3, env),
    maxRunsPerDay: numberEnv('ATRIB_BROWSERBASE_DEMO_MAX_RUNS_PER_DAY', 12, env),
  }
}

export function deploymentGuardIssues(env: NodeJS.ProcessEnv = process.env): string[] {
  if (!deployedDemoFromEnv(env)) return []

  const issues: string[] = []
  if (demoModeFromEnv(env) !== 'live') {
    issues.push('ATRIB_BROWSERBASE_DEMO_MODE must be live')
  }
  if (browserbaseUpstreamFromEnv(env) !== 'hosted') {
    issues.push('ATRIB_BROWSERBASE_UPSTREAM must be hosted')
  }
  if (!publicLogFromEnv(env)) {
    issues.push('ATRIB_BROWSERBASE_DEMO_PUBLIC_LOG must enable public log publication')
  }
  for (const name of missingLiveEnv(env)) {
    issues.push(`${name} is required`)
  }
  if (env.ATRIB_BROWSERBASE_DEMO_CREDENTIAL_SCOPE !== 'demo-only') {
    issues.push('ATRIB_BROWSERBASE_DEMO_CREDENTIAL_SCOPE must be demo-only')
  }
  if (!env.ATRIB_BROWSERBASE_DEMO_URL) {
    issues.push('ATRIB_BROWSERBASE_DEMO_URL is required')
  }

  const rateLimit = rateLimitConfigFromEnv(env)
  if (!rateLimit.enabled) {
    issues.push('ATRIB_BROWSERBASE_DEMO_RATE_LIMIT must be enabled')
  }
  if (rateLimit.windowMs <= 0) {
    issues.push('ATRIB_BROWSERBASE_DEMO_RATE_LIMIT_WINDOW_MS must be greater than 0')
  }
  if (rateLimit.maxRunsPerWindow <= 0) {
    issues.push('ATRIB_BROWSERBASE_DEMO_MAX_RUNS_PER_WINDOW must be greater than 0')
  }
  if (rateLimit.maxRunsPerDay <= 0) {
    issues.push('ATRIB_BROWSERBASE_DEMO_MAX_RUNS_PER_DAY must be greater than 0')
  }

  return issues
}

export function clientKeyFromRequest(request: IncomingMessage): string {
  const forwardedFor = request.headers['x-forwarded-for']
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0]?.trim() || 'unknown'
  }
  if (Array.isArray(forwardedFor) && forwardedFor[0]) {
    return forwardedFor[0].split(',')[0]?.trim() || 'unknown'
  }
  return request.socket.remoteAddress ?? 'unknown'
}

export function checkRateLimit(
  key: string,
  config: RateLimitConfig,
  buckets: Map<string, RateLimitBucket>,
  nowMs = Date.now(),
): { ok: true } | { ok: false; reason: 'window' | 'day'; retry_after_seconds: number } {
  if (!config.enabled) return { ok: true }

  const dayKey = new Date(nowMs).toISOString().slice(0, 10)
  let bucket = buckets.get(key)
  if (!bucket) {
    bucket = { windowStartedAtMs: nowMs, windowCount: 0, dayKey, dayCount: 0 }
    buckets.set(key, bucket)
  }
  if (nowMs - bucket.windowStartedAtMs >= config.windowMs) {
    bucket.windowStartedAtMs = nowMs
    bucket.windowCount = 0
  }
  if (bucket.dayKey !== dayKey) {
    bucket.dayKey = dayKey
    bucket.dayCount = 0
  }

  if (bucket.windowCount >= config.maxRunsPerWindow) {
    return {
      ok: false,
      reason: 'window',
      retry_after_seconds: Math.max(
        1,
        Math.ceil((bucket.windowStartedAtMs + config.windowMs - nowMs) / 1000),
      ),
    }
  }
  if (bucket.dayCount >= config.maxRunsPerDay) {
    const nextDay = new Date(`${dayKey}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000
    return {
      ok: false,
      reason: 'day',
      retry_after_seconds: Math.max(1, Math.ceil((nextDay - nowMs) / 1000)),
    }
  }

  bucket.windowCount += 1
  bucket.dayCount += 1
  return { ok: true }
}

export function summarizePacketResult(input: {
  runId: string
  startedAt: string
  finishedAt: string
  result: WrappedMcpPacketResult
  workflow?: BrowserbaseWorkflow
  actionPolicyMode: BrowserbaseActionPolicyMode
}): BrowserbaseDemoRun {
  return {
    run_id: input.runId,
    status: 'accepted',
    mode: input.result.mode,
    action_policy_mode: input.actionPolicyMode,
    started_at: input.startedAt,
    finished_at: input.finishedAt,
    ok: input.result.ok,
    verifier: input.result.verifier,
    privacy: input.result.privacy,
    log: input.result.log,
    ...(input.workflow ? { workflow: input.workflow } : {}),
    ...(input.result.action_policy ? { action_policy: input.result.action_policy } : {}),
    operations: input.result.operations.map((step, index) => {
      const recordHash = input.result.record_hashes[index] ?? ''
      const recordHex = recordHash.startsWith('sha256:') ? recordHash.slice('sha256:'.length) : ''
      return {
        step,
        record_hash: recordHash,
        log_index: input.result.log_indexes[index] ?? -1,
        explorer_url: recordHash ? `https://explore.atrib.dev/action/${recordHash}` : null,
        log_proof_url:
          input.result.log.mode === 'public' && recordHex
            ? `https://log.atrib.dev/v1/proof/${recordHex}`
            : null,
      }
    }),
  }
}

export async function runBrowserbaseProof(options: {
  mode: DemoMode
  publicLog: boolean
  actionPolicyMode: BrowserbaseActionPolicyMode
}): Promise<WrappedMcpPacketResult> {
  return runBrowserbaseStagehandPacket({
    env: process.env,
    liveMode: options.mode === 'live',
    publicLog: options.publicLog,
    proofUrl: process.env.ATRIB_BROWSERBASE_DEMO_URL ?? 'https://example.com',
    observeInstruction:
      process.env.ATRIB_BROWSERBASE_DEMO_OBSERVE ?? 'Find the More information link',
    actAction: process.env.ATRIB_BROWSERBASE_DEMO_ACT ?? 'Click the More information link',
    extractInstruction:
      process.env.ATRIB_BROWSERBASE_DEMO_EXTRACT ?? 'Extract the page title and current URL',
    actionPolicyMode: options.actionPolicyMode,
    timeoutMs: proofRunTimeoutMs(process.env),
  }).catch((error: unknown) => {
    throw new Error(redactError(error instanceof Error ? error.message : String(error)))
  })
}

export function createBrowserbaseDemoServer(
  options: { runner?: Runner; env?: NodeJS.ProcessEnv } = {},
) {
  const runs = new Map<string, BrowserbaseDemoRun>()
  const rateLimits = new Map<string, RateLimitBucket>()
  let activeRun: Promise<BrowserbaseDemoRun> | undefined
  const runner = options.runner ?? runBrowserbaseProof
  const env = options.env ?? process.env

  const server = createServer((request, response) => {
    void handleRequest(request, response)
  })

  async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      setCorsHeaders(response)
      if (request.method === 'OPTIONS') {
        response.writeHead(204)
        response.end()
        return
      }

      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
      if (request.method === 'GET' && url.pathname === '/') {
        writeHtml(response, renderApp())
        return
      }

      if (request.method === 'GET' && url.pathname === '/health') {
        writeJson(response, 200, { ok: true, service: serviceName })
        return
      }

      if (request.method === 'GET' && url.pathname === '/api/config') {
        const mode = demoModeFromEnv(env)
        const guardIssues = deploymentGuardIssues(env)
        writeJson(response, 200, {
          ok: true,
          service: serviceName,
          deployed: deployedDemoFromEnv(env),
          deployment_ready: guardIssues.length === 0,
          deployment_guard_issues: guardIssues,
          mode,
          upstream: browserbaseUpstreamFromEnv(env),
          public_log: publicLogFromEnv(env),
          live_ready: missingLiveEnv(env).length === 0,
          missing_live_env: mode === 'live' ? missingLiveEnv(env) : [],
          rate_limit: rateLimitConfigFromEnv(env),
          max_attempts: env.ATRIB_BROWSERBASE_LIVE_MAX_ATTEMPTS ?? '3',
          run_timeout_ms: proofRunTimeoutMs(env),
          workflow: browserbaseWorkflowFromEnv(env),
          action_policy: {
            mode: actionPolicyModeFromEnv(env),
            modes: ['allow', 'block', 'escalate'],
            event_type: BROWSERBASE_ACTION_POLICY_EVENT_TYPE,
            policy_version: BROWSERBASE_ACTION_POLICY_VERSION,
          },
          fixed_flow: ['start', 'navigate', 'observe', 'act', 'extract', 'end'],
          public_fields: ['tool name', 'args_hash', 'result_hash', 'record hash', 'log index'],
          private_fields: [
            'Browserbase API key',
            'Browserbase project id',
            'session URL',
            'replay URL',
            'page snapshot',
            'selectors',
            'form values',
            'raw extraction payload',
          ],
        })
        return
      }

      if (request.method === 'GET' && url.pathname === '/api/runs') {
        writeJson(response, 200, {
          ok: true,
          runs: [...runs.values()].sort((left, right) =>
            right.started_at.localeCompare(left.started_at),
          ),
        })
        return
      }

      if (request.method === 'POST' && url.pathname === '/api/runs') {
        const runRequest = await readRunRequest(request, env)
        const guardIssues = deploymentGuardIssues(env)
        if (guardIssues.length > 0) {
          writeJson(response, 503, {
            ok: false,
            error: 'deployment_guard_failed',
            issues: guardIssues,
          })
          return
        }

        if (activeRun) {
          writeJson(response, 409, { ok: false, error: 'run_already_active' })
          return
        }

        const rateLimit = checkRateLimit(
          clientKeyFromRequest(request),
          rateLimitConfigFromEnv(env),
          rateLimits,
        )
        if (!rateLimit.ok) {
          writeJson(response, 429, {
            ok: false,
            error: 'rate_limited',
            reason: rateLimit.reason,
            retry_after_seconds: rateLimit.retry_after_seconds,
          })
          return
        }

        const mode = demoModeFromEnv(env)
        const missing = mode === 'live' ? missingLiveEnv(env) : []
        if (missing.length > 0) {
          writeJson(response, 409, { ok: false, error: 'missing_live_env', missing })
          return
        }

        const queued = startRun({
          mode,
          publicLog: publicLogFromEnv(env),
          actionPolicyMode: runRequest.actionPolicyMode,
          runner,
          runs,
          workflow: browserbaseWorkflowFromEnv(env),
        })
        activeRun = queued.promise.finally(() => {
          activeRun = undefined
        })
        writeJson(response, 202, {
          ok: true,
          run: queued.run,
          status_url: `/api/runs/${queued.run.run_id}`,
        })
        return
      }

      const runId = runIdFromPath(url.pathname)
      if (request.method === 'GET' && runId) {
        const run = runs.get(runId)
        if (!run) {
          writeJson(response, 404, { ok: false, error: 'run_not_found', run_id: runId })
          return
        }
        writeJson(response, 200, { ok: true, run })
        return
      }

      writeJson(response, 404, {
        ok: false,
        error: 'not_found',
        endpoints: ['GET /', 'GET /health', 'GET /api/config', 'GET /api/runs', 'POST /api/runs'],
      })
    } catch (error) {
      writeJson(response, 500, {
        ok: false,
        error: redactError(error instanceof Error ? error.message : String(error)),
      })
    }
  }

  return { server, runs }
}

function startRun(options: {
  mode: DemoMode
  publicLog: boolean
  actionPolicyMode: BrowserbaseActionPolicyMode
  runner: Runner
  runs: Map<string, BrowserbaseDemoRun>
  workflow: BrowserbaseWorkflow
}): { run: BrowserbaseDemoRun; promise: Promise<BrowserbaseDemoRun> } {
  const runId = `bb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const startedAt = new Date().toISOString()
  const running: BrowserbaseDemoRun = {
    run_id: runId,
    status: 'running',
    mode: options.mode,
    action_policy_mode: options.actionPolicyMode,
    started_at: startedAt,
    workflow: options.workflow,
  }
  console.log(
    JSON.stringify({
      service: serviceName,
      event: 'run_started',
      run_id: runId,
      mode: options.mode,
      public_log: options.publicLog,
      action_policy_mode: options.actionPolicyMode,
    }),
  )
  rememberRun(options.runs, running)

  return {
    run: running,
    promise: Promise.resolve().then(() =>
      finishRun({
        ...options,
        running,
        startedAt,
      }),
    ),
  }
}

async function finishRun(options: {
  mode: DemoMode
  publicLog: boolean
  actionPolicyMode: BrowserbaseActionPolicyMode
  runner: Runner
  runs: Map<string, BrowserbaseDemoRun>
  running: BrowserbaseDemoRun
  startedAt: string
  workflow: BrowserbaseWorkflow
}): Promise<BrowserbaseDemoRun> {
  try {
    const result = await options.runner({
      mode: options.mode,
      publicLog: options.publicLog,
      actionPolicyMode: options.actionPolicyMode,
    })
    const accepted = summarizePacketResult({
      runId: options.running.run_id,
      startedAt: options.startedAt,
      finishedAt: new Date().toISOString(),
      result,
      workflow: options.workflow,
      actionPolicyMode: options.actionPolicyMode,
    })
    rememberRun(options.runs, accepted)
    console.log(
      JSON.stringify({
        service: serviceName,
        event: 'run_accepted',
        run_id: options.running.run_id,
        records: accepted.operations?.length ?? 0,
        log_indexes: accepted.operations?.map((operation) => operation.log_index) ?? [],
      }),
    )
    return accepted
  } catch (error) {
    const failed: BrowserbaseDemoRun = {
      ...options.running,
      status: 'failed',
      ok: false,
      finished_at: new Date().toISOString(),
      error: redactError(error instanceof Error ? error.message : String(error)),
    }
    rememberRun(options.runs, failed)
    console.log(
      JSON.stringify({
        service: serviceName,
        event: 'run_failed',
        run_id: options.running.run_id,
        error: failed.error,
      }),
    )
    return failed
  }
}

function rememberRun(runs: Map<string, BrowserbaseDemoRun>, run: BrowserbaseDemoRun): void {
  runs.set(run.run_id, run)
  const ordered = [...runs.values()].sort((left, right) =>
    right.started_at.localeCompare(left.started_at),
  )
  for (const stale of ordered.slice(maxStoredRuns)) {
    runs.delete(stale.run_id)
  }
}

function runIdFromPath(pathname: string): string | undefined {
  const match = /^\/api\/runs\/([^/]+)$/u.exec(pathname)
  return match?.[1]
}

async function readBody(request: IncomingMessage): Promise<string> {
  let body = ''
  for await (const chunk of request) body += String(chunk)
  return body
}

async function readRunRequest(
  request: IncomingMessage,
  env: NodeJS.ProcessEnv,
): Promise<{ actionPolicyMode: BrowserbaseActionPolicyMode }> {
  const body = (await readBody(request)).trim()
  if (!body) return { actionPolicyMode: actionPolicyModeFromEnv(env) }

  try {
    const parsed = JSON.parse(body) as { action_policy_mode?: unknown }
    const value =
      typeof parsed.action_policy_mode === 'string' ? parsed.action_policy_mode : undefined
    return { actionPolicyMode: normalizeBrowserbaseActionPolicyMode(value) }
  } catch {
    return { actionPolicyMode: actionPolicyModeFromEnv(env) }
  }
}

function redactError(message: string): string {
  return message
    .replace(/bb_[A-Za-z0-9_-]+/gu, '[redacted-browserbase-session]')
    .replace(/https:\/\/browserbase[^\s"'`<>]+/giu, '[redacted-browserbase-url]')
    .replace(/BROWSERBASE_API_KEY=[^\s]+/gu, 'BROWSERBASE_API_KEY=[redacted]')
    .replace(/BROWSERBASE_PROJECT_ID=[^\s]+/gu, 'BROWSERBASE_PROJECT_ID=[redacted]')
    .replace(/GEMINI_API_KEY=[^\s]+/gu, 'GEMINI_API_KEY=[redacted]')
}

function setCorsHeaders(response: ServerResponse): void {
  response.setHeader('access-control-allow-origin', '*')
  response.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS')
  response.setHeader('access-control-allow-headers', 'content-type')
  response.setHeader('cache-control', 'no-store')
}

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
  })
  response.end(`${JSON.stringify(value, null, 2)}\n`)
}

function writeHtml(response: ServerResponse, html: string): void {
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'x-content-type-options': 'nosniff',
  })
  response.end(html)
}

function renderApp(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Browserbase Atrib Proof</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f6f8fb;
        --panel: #ffffff;
        --text: #111827;
        --muted: #526070;
        --line: #d7dee8;
        --blue: #2558d5;
        --green: #0f6b4f;
        --red: #b91c35;
        --amber: #9a4d00;
      }

      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: var(--bg);
        color: var(--text);
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", sans-serif;
      }
      main {
        margin: 0 auto;
        max-width: 1180px;
        padding: 24px;
      }
      header {
        align-items: start;
        display: flex;
        gap: 18px;
        justify-content: space-between;
        margin-bottom: 18px;
      }
      h1 {
        font-size: 28px;
        letter-spacing: 0;
        line-height: 1.15;
        margin: 0 0 6px;
      }
      p {
        color: var(--muted);
        font-size: 14px;
        line-height: 1.45;
        margin: 0;
      }
      button {
        background: var(--blue);
        border: 0;
        border-radius: 8px;
        color: white;
        cursor: pointer;
        font: inherit;
        font-weight: 750;
        min-height: 42px;
        padding: 0 15px;
      }
      button:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }
      .run-controls {
        align-items: end;
        display: grid;
        gap: 10px;
        justify-items: end;
      }
      .segmented {
        background: #e9eef6;
        border: 1px solid var(--line);
        border-radius: 8px;
        display: inline-flex;
        padding: 3px;
      }
      .segmented button {
        background: transparent;
        border-radius: 6px;
        color: var(--muted);
        min-height: 32px;
        padding: 0 10px;
      }
      .segmented button.active {
        background: white;
        color: var(--text);
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.12);
      }
      .grid {
        display: grid;
        gap: 14px;
        grid-template-columns: minmax(320px, 0.95fr) minmax(0, 1.15fr);
      }
      section {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 16px;
      }
      h2 {
        font-size: 13px;
        letter-spacing: 0.08em;
        margin: 0 0 12px;
        text-transform: uppercase;
      }
      .kv {
        display: grid;
        gap: 9px;
      }
      .kv div {
        display: grid;
        gap: 3px;
      }
      .kv strong {
        font-size: 12px;
        text-transform: uppercase;
      }
      .chip {
        align-items: center;
        border: 1px solid var(--line);
        border-radius: 999px;
        display: inline-flex;
        font-size: 12px;
        font-weight: 760;
        min-height: 28px;
        padding: 5px 9px;
      }
      .chip.ok { border-color: #b6ddce; color: var(--green); }
      .chip.warn { border-color: #facf91; color: var(--amber); }
      .chip.err { border-color: #ffc1ca; color: var(--red); }
      table {
        border-collapse: collapse;
        font-size: 13px;
        width: 100%;
      }
      th, td {
        border-bottom: 1px solid var(--line);
        padding: 9px 8px;
        text-align: left;
        vertical-align: top;
      }
      th {
        color: var(--muted);
        font-size: 12px;
        text-transform: uppercase;
      }
      code {
        overflow-wrap: anywhere;
      }
      a {
        color: var(--blue);
        font-weight: 700;
      }
      .workflow {
        display: grid;
        gap: 14px;
      }
      .workflow-row {
        border-top: 1px solid var(--line);
        display: grid;
        gap: 6px;
        padding-top: 12px;
      }
      .browser-shell {
        border: 1px solid var(--line);
        border-radius: 8px;
        overflow: hidden;
      }
      .browser-bar {
        align-items: center;
        background: #eef2f7;
        display: flex;
        gap: 7px;
        min-height: 34px;
        padding: 0 10px;
      }
      .dot {
        border-radius: 999px;
        display: inline-block;
        height: 8px;
        width: 8px;
      }
      .dot.red { background: #e45a6a; }
      .dot.amber { background: #e5a029; }
      .dot.green { background: #31a36c; }
      .address {
        background: white;
        border: 1px solid var(--line);
        border-radius: 999px;
        color: var(--muted);
        flex: 1;
        font-size: 12px;
        overflow: hidden;
        padding: 5px 9px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .browser-body {
        background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
        min-height: 145px;
        padding: 16px;
      }
      .stagehand-list {
        display: grid;
        gap: 10px;
        margin-top: 12px;
      }
      .stagehand-step {
        border-left: 3px solid var(--blue);
        padding-left: 10px;
      }
      .stagehand-step strong {
        display: block;
        font-size: 13px;
      }
      .state {
        border: 1px solid var(--line);
        border-radius: 999px;
        color: var(--muted);
        display: inline-flex;
        font-size: 11px;
        font-weight: 760;
        margin-left: 6px;
        padding: 2px 7px;
        text-transform: uppercase;
      }
      .state.signed { border-color: #b6ddce; color: var(--green); }
      .state.stopped { border-color: #ffc1ca; color: var(--red); }
      .state.skipped { border-color: #facf91; color: var(--amber); }
      .policy-chain {
        border-top: 1px solid var(--line);
        margin-top: 16px;
        padding-top: 14px;
      }
      .policy-chain h3 {
        font-size: 13px;
        margin: 0 0 8px;
      }
      .subtle {
        color: var(--muted);
        font-size: 12px;
      }
      .receipt-header {
        align-items: center;
        display: flex;
        gap: 10px;
        justify-content: space-between;
        margin-bottom: 12px;
      }
      .empty {
        border: 1px dashed var(--line);
        border-radius: 8px;
        color: var(--muted);
        padding: 18px;
        text-align: center;
      }
      @media (max-width: 820px) {
        header, .grid { display: block; }
        .run-controls { justify-items: stretch; margin-top: 14px; }
        .segmented { width: 100%; }
        .segmented button { flex: 1; }
        header button { width: 100%; }
        section { margin-bottom: 14px; }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div>
          <h1>Browserbase Atrib Proof</h1>
          <p>Run a fixed Stagehand workflow in a Browserbase cloud browser and inspect the signed Atrib receipts beside it.</p>
        </div>
        <div class="run-controls">
          <div class="segmented" aria-label="Action policy mode">
            <button id="policyAllow" type="button" data-policy-mode="allow">Allow</button>
            <button id="policyBlock" type="button" data-policy-mode="block">Block</button>
            <button id="policyEscalate" type="button" data-policy-mode="escalate">Escalate</button>
          </div>
          <button id="runButton" type="button">Run proof</button>
        </div>
      </header>
      <div class="grid">
        <section>
          <h2>Browserbase workflow</h2>
          <div id="workflowPanel" class="workflow">
            <div class="empty">Loading workflow.</div>
          </div>
        </section>
        <section>
          <div class="receipt-header">
            <h2>Atrib receipts</h2>
            <span id="statusChip" class="chip warn">waiting</span>
          </div>
          <div class="kv">
            <div><strong>Mode</strong><span id="mode">loading</span></div>
            <div><strong>Action policy</strong><span id="policyModeLabel">loading</span></div>
            <div><strong>Public fields</strong><span>tool name, args hash, result hash, record hash, log index</span></div>
            <div><strong>Private fields</strong><span>session URL, replay URL, page snapshot, selectors, form values, raw extraction</span></div>
          </div>
          <div style="height: 14px"></div>
          <div id="runPanel" class="empty">No run yet.</div>
        </section>
      </div>
    </main>
    <script>
      const runButton = document.getElementById('runButton');
      const runPanel = document.getElementById('runPanel');
      const modeLabel = document.getElementById('mode');
      const policyModeLabel = document.getElementById('policyModeLabel');
      const statusChip = document.getElementById('statusChip');
      const workflowPanel = document.getElementById('workflowPanel');
      const policyButtons = Array.from(document.querySelectorAll('[data-policy-mode]'));
      let selectedPolicyMode = 'allow';

      async function loadConfig() {
        const response = await fetch('/api/config');
        const config = await response.json();
        renderWorkflow(config.workflow);
        setSelectedPolicyMode((config.action_policy && config.action_policy.mode) || 'allow');
        modeLabel.textContent = config.mode + (config.public_log ? ' with public log' : ' with local log');
        if (config.deployment_guard_issues && config.deployment_guard_issues.length > 0) {
          setStatus('Guard failed', 'err');
          runButton.disabled = true;
          runPanel.className = 'empty';
          runPanel.textContent = config.deployment_guard_issues.join('; ');
          return;
        }
        if (config.mode === 'live' && !config.live_ready) {
          setStatus('Missing live env', 'err');
          runButton.disabled = true;
          return;
        }
        setStatus('Ready', 'ok');
      }

      async function runProof() {
        runButton.disabled = true;
        setStatus('Running', 'warn');
        runPanel.className = 'empty';
        runPanel.textContent = 'Starting proof run.';
        try {
          const response = await fetch('/api/runs', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action_policy_mode: selectedPolicyMode }),
          });
          const body = await response.json();
          if (!response.ok || !body.run) throw new Error(body.error || body.run?.error || 'run failed');
          renderRun(body.run);
          const run = body.run.status === 'running' ? await pollRun(body.run.run_id) : body.run;
          renderRun(run);
          setStatus(run.status === 'accepted' ? 'Accepted' : 'Failed', run.status === 'accepted' ? 'ok' : 'err');
        } catch (error) {
          runPanel.className = 'empty';
          runPanel.textContent = error instanceof Error ? error.message : String(error);
          setStatus('Failed', 'err');
        } finally {
          runButton.disabled = false;
        }
      }

      async function pollRun(runId) {
        const started = Date.now();
        while (Date.now() - started < 135000) {
          await delay(1000);
          const response = await fetch('/api/runs/' + encodeURIComponent(runId));
          const body = await response.json();
          if (!response.ok || !body.run) throw new Error(body.error || 'run lookup failed');
          renderRun(body.run);
          if (body.run.status !== 'running') return body.run;
        }
        throw new Error('proof run timed out');
      }

      function delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
      }

      function renderRun(run) {
        if (run.workflow) renderWorkflow(run.workflow, run);
        runPanel.className = '';
        const table = renderOperationTable(run);
        const policy = renderActionPolicy(run.action_policy);
        const chipClass = run.status === 'accepted' ? 'ok' : run.status === 'running' ? 'warn' : 'err';
        runPanel.innerHTML =
          '<p><span class="chip ' + chipClass + '">' + escapeHtml(run.status) + '</span> ' +
          escapeHtml(run.run_id) + '</p>' +
          '<p class="subtle">Requested policy: ' + escapeHtml(run.action_policy_mode || selectedPolicyMode) + '</p>' +
          table +
          policy;
      }

      function renderOperationTable(run) {
        const rows = (run.operations || []).map((operation) => {
          const explorer = operation.explorer_url ? '<a href="' + operation.explorer_url + '" target="_blank" rel="noreferrer">explorer</a>' : '';
          const proof = operation.log_proof_url ? '<a href="' + operation.log_proof_url + '" target="_blank" rel="noreferrer">log proof</a>' : '';
          return '<tr><td>' + escapeHtml(operation.step) + '</td><td><code>' + escapeHtml(operation.record_hash) + '</code></td><td>' + operation.log_index + '</td><td>' + explorer + ' ' + proof + '</td></tr>';
        }).join('');
        return rows
          ? '<table><thead><tr><th>Step</th><th>Record hash</th><th>Index</th><th>Links</th></tr></thead><tbody>' + rows + '</tbody></table>'
          : '<div class="empty">Proof is running.</div>';
      }

      function renderActionPolicy(policy) {
        if (!policy) {
          return '<div class="policy-chain"><h3>Action gate</h3><div class="empty">Waiting for observe and policy decision records.</div></div>';
        }
        const rows = (policy.decisions || []).map((decision) => {
          const outcome = (policy.outcomes || []).find((candidate) => candidate.tool_name === decision.tool_name);
          const reasons = Array.isArray(decision.content && decision.content.reason_codes)
            ? decision.content.reason_codes.join(', ')
            : '';
          const executed = outcome && outcome.content ? String(outcome.content.executed) : 'pending';
          return '<tr><td>' + escapeHtml(decision.tool_name) + '</td><td>' +
            escapeHtml(String((decision.content && decision.content.decision) || decision.kind)) +
            '</td><td>' + escapeHtml(reasons) + '</td><td><code>' +
            escapeHtml(decision.record_hash) + '</code><br><span class="subtle">index ' +
            escapeHtml(String(decision.proof && decision.proof.log_index)) + '</span></td><td>' +
            escapeHtml(executed) + '</td><td><code>' +
            escapeHtml((outcome && outcome.record_hash) || 'pending') +
            '</code><br><span class="subtle">index ' +
            escapeHtml(String(outcome && outcome.proof ? outcome.proof.log_index : 'pending')) +
            '</span></td></tr>';
        }).join('');
        const stopped = policy.stopped_before || 'none';
        return '<div class="policy-chain"><h3>Action gate</h3>' +
          '<p class="subtle">Stopped before: ' + escapeHtml(stopped) +
          '. Blocked tool executed: ' + escapeHtml(String(policy.blocked_tool_executed)) + '</p>' +
          '<table><thead><tr><th>Tool</th><th>Decision</th><th>Reasons</th><th>Decision record</th><th>Executed</th><th>Outcome record</th></tr></thead><tbody>' +
          rows +
          '</tbody></table></div>';
      }

      function renderWorkflow(workflow, run) {
        if (!workflow) {
          workflowPanel.innerHTML = '<div class="empty">Workflow unavailable.</div>';
          return;
        }
        const target = disclosedValue(workflow.target_url);
        const stagehand = (workflow.stagehand_steps || []).map((step) =>
          '<div class="stagehand-step"><strong>' +
          escapeHtml(step.primitive) +
          '<span class="state ' + stepState(step.tool, run).className + '">' +
          escapeHtml(stepState(step.tool, run).label) +
          '</span>' +
          '</strong><span class="subtle">' +
          escapeHtml(disclosedValue(step.instruction)) +
          '</span></div>'
        ).join('');
        workflowPanel.innerHTML =
          '<div class="browser-shell">' +
          '<div class="browser-bar"><span class="dot red"></span><span class="dot amber"></span><span class="dot green"></span><span class="address">' +
          escapeHtml(target) +
          '</span></div>' +
          '<div class="browser-body">' +
          '<p><strong>' + escapeHtml(workflow.name) + '</strong></p>' +
          '<p class="subtle">MCP surface: ' + escapeHtml(workflow.mcp_surface) + '</p>' +
          '<div class="stagehand-list">' + stagehand + '</div>' +
          '</div></div>' +
          '<div class="workflow-row"><strong>Browserbase session</strong><span class="subtle">Lifecycle tools: ' +
          escapeHtml((workflow.browserbase_session.lifecycle_tools || []).join(' -> ')) +
          '</span><span class="subtle">Replay URL: ' +
          escapeHtml(disclosedValue(workflow.browserbase_session.replay_url)) +
          '</span><span class="subtle">' +
          escapeHtml(workflow.browserbase_session.dashboard_note) +
          '</span></div>';
      }

      function stepState(tool, run) {
        if (!run) return { label: 'ready', className: '' };
        const operations = (run.operations || []).map((operation) => operation.step);
        if (operations.includes(tool)) return { label: 'signed', className: 'signed' };
        if (run.action_policy && run.action_policy.stopped_before === tool) {
          return { label: 'stopped', className: 'stopped' };
        }
        if (run.status === 'accepted') return { label: 'skipped', className: 'skipped' };
        return { label: 'pending', className: '' };
      }

      function disclosedValue(field) {
        if (!field) return 'unavailable';
        if (field.value) return field.value;
        if (field.hash) return 'private hash ' + field.hash;
        return 'private hash-only';
      }

      function setStatus(label, kind) {
        statusChip.textContent = label;
        statusChip.className = 'chip ' + kind;
      }

      function setSelectedPolicyMode(mode) {
        selectedPolicyMode = ['allow', 'block', 'escalate'].includes(mode) ? mode : 'allow';
        policyModeLabel.textContent = selectedPolicyMode + ' before act';
        policyButtons.forEach((button) => {
          button.classList.toggle('active', button.dataset.policyMode === selectedPolicyMode);
        });
      }

      function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
      }

      runButton.addEventListener('click', runProof);
      policyButtons.forEach((button) => {
        button.addEventListener('click', () => setSelectedPolicyMode(button.dataset.policyMode || 'allow'));
      });
      loadConfig().catch((error) => {
        setStatus('Config failed', 'err');
        runPanel.textContent = error instanceof Error ? error.message : String(error);
      });
    </script>
  </body>
</html>`
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? '8788')
  const host = process.env.HOST ?? '127.0.0.1'
  const { server } = createBrowserbaseDemoServer()
  server.listen(port, host, () => {
    const address = server.address()
    const boundPort = address && typeof address !== 'string' ? address.port : port
    const boundHost = address && typeof address !== 'string' ? address.address : host
    console.log(
      JSON.stringify({ ok: true, service: serviceName, host: boundHost, port: boundPort }),
    )
  })
}
