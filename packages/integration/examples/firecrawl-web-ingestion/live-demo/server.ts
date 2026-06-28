// SPDX-License-Identifier: Apache-2.0

import { createHash } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { pathToFileURL } from 'node:url'
import {
  CRAWL_CAP,
  LIVE_DEFAULT_EXTRACT_PROMPT,
  LIVE_DEFAULT_QUERY,
  LIVE_DEFAULT_URL,
  runFirecrawlWebIngestionPacket,
  type FirecrawlWebIngestionPacketRun,
} from '../firecrawl-web-ingestion-packet-smoke.js'

const serviceName = 'atrib-firecrawl-web-ingestion-demo'
const maxStoredRuns = 12

type DemoMode = 'fixture' | 'live'
type RunStatus = 'running' | 'accepted' | 'failed'

export type FirecrawlDemoRun = {
  run_id: string
  status: RunStatus
  mode: DemoMode
  started_at: string
  finished_at?: string
  ok?: boolean
  error?: string
  workflow: FirecrawlWorkflow
  policy_decision?: {
    decision: string
    decision_status: string
    decision_hash: string
    rule_results: Array<{ id: string; outcome: string }>
  }
  operations?: Array<{
    step: string
    record_hash: string
    log_index: number
    explorer_url: string | null
    log_proof_url: string | null
  }>
}

export type FirecrawlWorkflow = {
  name: string
  input_policy: 'fixed-public'
  upstream: string
  query: string
  source_url: string
  extract_prompt: string
  crawl_cap: typeof CRAWL_CAP
  public_fields: string[]
  private_fields: string[]
}

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

type Runner = (options: {
  mode: DemoMode
  publicLog: boolean
}) => Promise<FirecrawlWebIngestionPacketRun>

function numberEnv(name: string, fallback: number, env: NodeJS.ProcessEnv): number {
  const value = env[name]
  if (value === undefined) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function sha256Text(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function proofRunTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const value = numberEnv('ATRIB_FIRECRAWL_DEMO_RUN_TIMEOUT_MS', 90_000, env)
  return Math.max(10_000, Math.trunc(value))
}

export function demoModeFromEnv(env: NodeJS.ProcessEnv = process.env): DemoMode {
  return env.ATRIB_FIRECRAWL_DEMO_MODE === 'live' ? 'live' : 'fixture'
}

export function publicLogFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.ATRIB_FIRECRAWL_DEMO_PUBLIC_LOG === '0') return false
  return demoModeFromEnv(env) === 'live'
}

export function missingLiveEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  return env.FIRECRAWL_API_KEY || env.FIRECRAWL_API_URL ? [] : ['FIRECRAWL_API_KEY']
}

export function deployedDemoFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ATRIB_FIRECRAWL_DEMO_DEPLOYED === '1'
}

export function firecrawlWorkflowFromEnv(env: NodeJS.ProcessEnv = process.env): FirecrawlWorkflow {
  return {
    name: 'Firecrawl fixed ingestion gate',
    input_policy: 'fixed-public',
    upstream: 'npx -y firecrawl-mcp',
    query: env.ATRIB_FIRECRAWL_DEMO_QUERY ?? LIVE_DEFAULT_QUERY,
    source_url: env.ATRIB_FIRECRAWL_DEMO_URL ?? LIVE_DEFAULT_URL,
    extract_prompt: env.ATRIB_FIRECRAWL_DEMO_EXTRACT_PROMPT ?? LIVE_DEFAULT_EXTRACT_PROMPT,
    crawl_cap: CRAWL_CAP,
    public_fields: [
      'tool name',
      'args_hash',
      'result_hash',
      'record hash',
      'log index',
      'crawl cap',
      'policy decision hash',
    ],
    private_fields: [
      'Firecrawl API key',
      'raw scraped content',
      'extracted page text',
      'crawl job id',
      'auth token',
    ],
  }
}

export function rateLimitConfigFromEnv(env: NodeJS.ProcessEnv = process.env): RateLimitConfig {
  return {
    enabled: env.ATRIB_FIRECRAWL_DEMO_RATE_LIMIT !== '0',
    windowMs: numberEnv('ATRIB_FIRECRAWL_DEMO_RATE_LIMIT_WINDOW_MS', 60 * 60 * 1000, env),
    maxRunsPerWindow: numberEnv('ATRIB_FIRECRAWL_DEMO_MAX_RUNS_PER_WINDOW', 2, env),
    maxRunsPerDay: numberEnv('ATRIB_FIRECRAWL_DEMO_MAX_RUNS_PER_DAY', 8, env),
  }
}

export function deploymentGuardIssues(env: NodeJS.ProcessEnv = process.env): string[] {
  if (!deployedDemoFromEnv(env)) return []

  const issues: string[] = []
  if (demoModeFromEnv(env) !== 'live') issues.push('ATRIB_FIRECRAWL_DEMO_MODE must be live')
  if (!publicLogFromEnv(env)) {
    issues.push('ATRIB_FIRECRAWL_DEMO_PUBLIC_LOG must enable public log publication')
  }
  for (const name of missingLiveEnv(env)) issues.push(`${name} is required`)
  if (env.ATRIB_FIRECRAWL_DEMO_CREDENTIAL_SCOPE !== 'demo-only') {
    issues.push('ATRIB_FIRECRAWL_DEMO_CREDENTIAL_SCOPE must be demo-only')
  }
  if (env.ATRIB_FIRECRAWL_DEMO_INPUT_SCOPE !== 'fixed-public') {
    issues.push('ATRIB_FIRECRAWL_DEMO_INPUT_SCOPE must be fixed-public')
  }

  const workflow = firecrawlWorkflowFromEnv(env)
  if (workflow.query !== LIVE_DEFAULT_QUERY) {
    issues.push('ATRIB_FIRECRAWL_DEMO_QUERY must stay fixed for deployed mode')
  }
  if (workflow.source_url !== LIVE_DEFAULT_URL) {
    issues.push('ATRIB_FIRECRAWL_DEMO_URL must stay fixed for deployed mode')
  }
  if (workflow.extract_prompt !== LIVE_DEFAULT_EXTRACT_PROMPT) {
    issues.push('ATRIB_FIRECRAWL_DEMO_EXTRACT_PROMPT must stay fixed for deployed mode')
  }

  const rateLimit = rateLimitConfigFromEnv(env)
  if (!rateLimit.enabled) issues.push('ATRIB_FIRECRAWL_DEMO_RATE_LIMIT must be enabled')
  if (rateLimit.windowMs <= 0) {
    issues.push('ATRIB_FIRECRAWL_DEMO_RATE_LIMIT_WINDOW_MS must be greater than 0')
  }
  if (rateLimit.maxRunsPerWindow <= 0) {
    issues.push('ATRIB_FIRECRAWL_DEMO_MAX_RUNS_PER_WINDOW must be greater than 0')
  }
  if (rateLimit.maxRunsPerDay <= 0) {
    issues.push('ATRIB_FIRECRAWL_DEMO_MAX_RUNS_PER_DAY must be greater than 0')
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
  workflow: FirecrawlWorkflow
  packet: FirecrawlWebIngestionPacketRun
}): FirecrawlDemoRun {
  const result = input.packet.result
  return {
    run_id: input.runId,
    status: 'accepted',
    mode: result.mode,
    started_at: input.startedAt,
    finished_at: input.finishedAt,
    ok: result.ok,
    workflow: input.workflow,
    policy_decision: {
      decision: input.packet.policyDecision.decision,
      decision_status: input.packet.policyDecision.decision_status,
      decision_hash: input.packet.policyDecision.decision_hash,
      rule_results: input.packet.policyDecision.rule_results.map((rule) => ({
        id: rule.id,
        outcome: rule.outcome,
      })),
    },
    operations: result.operations.map((step, index) => {
      const recordHash = result.record_hashes[index] ?? ''
      const recordHex = recordHash.startsWith('sha256:') ? recordHash.slice('sha256:'.length) : ''
      return {
        step,
        record_hash: recordHash,
        log_index: result.log_indexes[index] ?? -1,
        explorer_url: recordHash ? `https://explore.atrib.dev/action/${recordHash}` : null,
        log_proof_url:
          result.log.mode === 'public' && recordHex
            ? `https://log.atrib.dev/v1/proof/${recordHex}`
            : null,
      }
    }),
  }
}

export async function runFirecrawlProof(options: {
  mode: DemoMode
  publicLog: boolean
}): Promise<FirecrawlWebIngestionPacketRun> {
  const workflow = firecrawlWorkflowFromEnv(process.env)
  return runFirecrawlWebIngestionPacket({
    env: process.env,
    liveMode: options.mode === 'live',
    publicLog: options.publicLog,
    query: workflow.query,
    sourceUrl: workflow.source_url,
    extractPrompt: workflow.extract_prompt,
    timeoutMs: proofRunTimeoutMs(process.env),
  }).catch((error: unknown) => {
    throw new Error(redactError(error instanceof Error ? error.message : String(error)))
  })
}

export function createFirecrawlDemoServer(
  options: { runner?: Runner; env?: NodeJS.ProcessEnv } = {},
) {
  const runs = new Map<string, FirecrawlDemoRun>()
  const rateLimits = new Map<string, RateLimitBucket>()
  let activeRun: Promise<FirecrawlDemoRun> | undefined
  const runner = options.runner ?? runFirecrawlProof
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
        const workflow = firecrawlWorkflowFromEnv(env)
        writeJson(response, 200, {
          ok: true,
          service: serviceName,
          deployed: deployedDemoFromEnv(env),
          deployment_ready: guardIssues.length === 0,
          deployment_guard_issues: guardIssues,
          mode,
          public_log: publicLogFromEnv(env),
          live_ready: missingLiveEnv(env).length === 0,
          missing_live_env: mode === 'live' ? missingLiveEnv(env) : [],
          rate_limit: rateLimitConfigFromEnv(env),
          run_timeout_ms: proofRunTimeoutMs(env),
          workflow,
          input_hashes: {
            query: sha256Text(workflow.query),
            source_url: sha256Text(workflow.source_url),
            extract_prompt: sha256Text(workflow.extract_prompt),
          },
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
        await readBody(request)
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
          runner,
          runs,
          workflow: firecrawlWorkflowFromEnv(env),
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
  runner: Runner
  runs: Map<string, FirecrawlDemoRun>
  workflow: FirecrawlWorkflow
}): { run: FirecrawlDemoRun; promise: Promise<FirecrawlDemoRun> } {
  const runId = `fc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const startedAt = new Date().toISOString()
  const running: FirecrawlDemoRun = {
    run_id: runId,
    status: 'running',
    mode: options.mode,
    started_at: startedAt,
    workflow: options.workflow,
  }
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
  runner: Runner
  runs: Map<string, FirecrawlDemoRun>
  running: FirecrawlDemoRun
  startedAt: string
  workflow: FirecrawlWorkflow
}): Promise<FirecrawlDemoRun> {
  try {
    const packet = await options.runner({ mode: options.mode, publicLog: options.publicLog })
    const accepted = summarizePacketResult({
      runId: options.running.run_id,
      startedAt: options.startedAt,
      finishedAt: new Date().toISOString(),
      workflow: options.workflow,
      packet,
    })
    rememberRun(options.runs, accepted)
    return accepted
  } catch (error) {
    const failed: FirecrawlDemoRun = {
      ...options.running,
      status: 'failed',
      ok: false,
      finished_at: new Date().toISOString(),
      error: redactError(error instanceof Error ? error.message : String(error)),
    }
    rememberRun(options.runs, failed)
    return failed
  }
}

function rememberRun(runs: Map<string, FirecrawlDemoRun>, run: FirecrawlDemoRun): void {
  runs.set(run.run_id, run)
  const ordered = [...runs.values()].sort((left, right) =>
    right.started_at.localeCompare(left.started_at),
  )
  for (const stale of ordered.slice(maxStoredRuns)) runs.delete(stale.run_id)
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

function redactError(message: string): string {
  return message
    .replace(/fc-[A-Za-z0-9_-]+/gu, '[redacted-firecrawl-key]')
    .replace(/FIRECRAWL_API_KEY=[^\s]+/gu, 'FIRECRAWL_API_KEY=[redacted]')
    .replace(/Authorization[^\n]+/giu, 'Authorization [redacted]')
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
    <title>Firecrawl Atrib Ingestion Gate</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f7f8fa;
        --panel: #ffffff;
        --text: #17202a;
        --muted: #5a6675;
        --line: #dbe1ea;
        --green: #0f6b4f;
        --blue: #2459d6;
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
      h2 {
        font-size: 13px;
        letter-spacing: 0.08em;
        margin: 0 0 12px;
        text-transform: uppercase;
      }
      p {
        color: var(--muted);
        font-size: 14px;
        line-height: 1.45;
        margin: 0;
      }
      button {
        background: var(--green);
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
      .flow {
        display: grid;
        gap: 10px;
      }
      .flow-step {
        border-left: 3px solid var(--green);
        padding-left: 10px;
      }
      .flow-step strong {
        display: block;
        font-size: 13px;
      }
      .subtle {
        color: var(--muted);
        font-size: 12px;
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
      .empty {
        border: 1px dashed var(--line);
        border-radius: 8px;
        color: var(--muted);
        padding: 18px;
        text-align: center;
      }
      @media (max-width: 820px) {
        header, .grid { display: block; }
        header button { margin-top: 14px; width: 100%; }
        section { margin-bottom: 14px; }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div>
          <h1>Firecrawl Ingestion Gate</h1>
          <p>Run a fixed Firecrawl MCP ingestion path and inspect the Atrib receipts plus the downstream policy decision.</p>
        </div>
        <button id="runButton" type="button">Run ingestion proof</button>
      </header>
      <div class="grid">
        <section>
          <h2>Firecrawl flow</h2>
          <div id="workflowPanel" class="flow">
            <div class="empty">Loading flow.</div>
          </div>
        </section>
        <section>
          <h2>Atrib receipts and policy</h2>
          <div class="kv">
            <div><strong>Status</strong><span id="statusChip" class="chip warn">waiting</span></div>
            <div><strong>Mode</strong><span id="mode">loading</span></div>
            <div><strong>Private fields</strong><span>raw scraped content, extracted text, crawl job id, API key</span></div>
          </div>
          <div style="height: 14px"></div>
          <div id="runPanel" class="empty">No run yet.</div>
        </section>
      </div>
    </main>
    <script>
      const runButton = document.getElementById('runButton');
      const runPanel = document.getElementById('runPanel');
      const workflowPanel = document.getElementById('workflowPanel');
      const modeLabel = document.getElementById('mode');
      const statusChip = document.getElementById('statusChip');

      async function loadConfig() {
        const response = await fetch('/api/config');
        const config = await response.json();
        renderWorkflow(config.workflow);
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
        runPanel.textContent = 'Starting ingestion proof.';
        try {
          const response = await fetch('/api/runs', { method: 'POST' });
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
        while (Date.now() - started < 105000) {
          await delay(1000);
          const response = await fetch('/api/runs/' + encodeURIComponent(runId));
          const body = await response.json();
          if (!response.ok || !body.run) throw new Error(body.error || 'run lookup failed');
          renderRun(body.run);
          if (body.run.status !== 'running') return body.run;
        }
        throw new Error('proof run timed out');
      }

      function renderWorkflow(workflow) {
        if (!workflow) {
          workflowPanel.innerHTML = '<div class="empty">Flow unavailable.</div>';
          return;
        }
        const steps = [
          ['firecrawl_search', workflow.query],
          ['firecrawl_scrape', workflow.source_url],
          ['firecrawl_extract', workflow.extract_prompt],
          ['firecrawl_crawl', 'maxDepth ' + workflow.crawl_cap.maxDepth + ', limit ' + workflow.crawl_cap.limit],
        ].map(([name, detail]) =>
          '<div class="flow-step"><strong>' + escapeHtml(name) + '</strong><span class="subtle">' + escapeHtml(detail) + '</span></div>'
        ).join('');
        workflowPanel.innerHTML =
          '<p><strong>' + escapeHtml(workflow.name) + '</strong></p>' +
          '<p class="subtle">Input policy: ' + escapeHtml(workflow.input_policy) + '</p>' +
          '<p class="subtle">Upstream: ' + escapeHtml(workflow.upstream) + '</p>' +
          '<div class="flow">' + steps + '</div>';
      }

      function renderRun(run) {
        if (run.workflow) renderWorkflow(run.workflow);
        const rows = (run.operations || []).map((operation) => {
          const explorer = operation.explorer_url ? '<a href="' + operation.explorer_url + '" target="_blank" rel="noreferrer">explorer</a>' : '';
          const proof = operation.log_proof_url ? '<a href="' + operation.log_proof_url + '" target="_blank" rel="noreferrer">log proof</a>' : '';
          return '<tr><td>' + escapeHtml(operation.step) + '</td><td><code>' + escapeHtml(operation.record_hash) + '</code></td><td>' + operation.log_index + '</td><td>' + explorer + ' ' + proof + '</td></tr>';
        }).join('');
        const ruleRows = run.policy_decision
          ? run.policy_decision.rule_results.map((rule) => '<tr><td>' + escapeHtml(rule.id) + '</td><td>' + escapeHtml(rule.outcome) + '</td></tr>').join('')
          : '';
        const table = rows
          ? '<table><thead><tr><th>Step</th><th>Record hash</th><th>Index</th><th>Links</th></tr></thead><tbody>' + rows + '</tbody></table>'
          : '<div class="empty">Proof is running.</div>';
        const policy = run.policy_decision
          ? '<p><strong>Policy:</strong> ' + escapeHtml(run.policy_decision.decision) + ' <code>' + escapeHtml(run.policy_decision.decision_hash) + '</code></p><table><thead><tr><th>Rule</th><th>Outcome</th></tr></thead><tbody>' + ruleRows + '</tbody></table>'
          : '';
        const chipClass = run.status === 'accepted' ? 'ok' : run.status === 'running' ? 'warn' : 'err';
        runPanel.className = '';
        runPanel.innerHTML =
          '<p><span class="chip ' + chipClass + '">' + escapeHtml(run.status) + '</span> ' +
          escapeHtml(run.run_id) + '</p>' +
          table +
          '<div style="height: 14px"></div>' +
          policy;
      }

      function delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
      }

      function setStatus(label, kind) {
        statusChip.textContent = label;
        statusChip.className = 'chip ' + kind;
      }

      function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
      }

      runButton.addEventListener('click', runProof);
      loadConfig().catch((error) => {
        setStatus('Config failed', 'err');
        runPanel.textContent = error instanceof Error ? error.message : String(error);
      });
    </script>
  </body>
</html>`
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? '8789')
  const host = process.env.HOST ?? '127.0.0.1'
  const { server } = createFirecrawlDemoServer()
  server.listen(port, host, () => {
    const address = server.address()
    const boundPort = address && typeof address !== 'string' ? address.port : port
    const boundHost = address && typeof address !== 'string' ? address.address : host
    console.log(
      JSON.stringify({ ok: true, service: serviceName, host: boundHost, port: boundPort }),
    )
  })
}
