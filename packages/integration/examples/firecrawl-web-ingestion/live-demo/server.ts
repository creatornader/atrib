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
    signed_policy_record: boolean
    signed_control_record_hash: string | null
    signed_control_record_index: number | null
    signed_outcome_record_hash: string | null
    signed_outcome_record_index: number | null
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

export type FirecrawlDemoSurface = {
  category: 'grounding-pipeline'
  narrative: string
  source_pattern: string[]
  stages: Array<{
    id: string
    title: string
    tool: string
    input: string
    output: string
    disclosure: 'public' | 'hash-only' | 'private'
  }>
  guardrail: {
    next_action: string
    decision: string
    stopped_before: string
  }
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

export function firecrawlDemoSurfaceFromWorkflow(
  workflow: FirecrawlWorkflow = firecrawlWorkflowFromEnv(),
): FirecrawlDemoSurface {
  return {
    category: 'grounding-pipeline',
    narrative:
      'Firecrawl turns live web sources into clean context. atrib signs the ingestion path before that context can influence a sensitive downstream action.',
    source_pattern: [
      'Firecrawl examples center on RAG, AI search, deep research, enrichment, and AI-ready structured data.',
      'Firecrawl agent guidance chains search, scrape, extract, and crawl or map for live web work.',
      'The proof surface should look like a source-to-context pipeline, not a remote browser replay.',
    ],
    stages: [
      {
        id: 'discover',
        title: 'Discover source',
        tool: 'firecrawl_search',
        input: workflow.query,
        output: 'Candidate source set',
        disclosure: 'public',
      },
      {
        id: 'ground',
        title: 'Ground content',
        tool: 'firecrawl_scrape',
        input: workflow.source_url,
        output: 'Clean markdown and HTML hashes',
        disclosure: 'hash-only',
      },
      {
        id: 'structure',
        title: 'Structure fields',
        tool: 'firecrawl_extract',
        input: workflow.extract_prompt,
        output: 'Company and account-note hashes',
        disclosure: 'hash-only',
      },
      {
        id: 'bound',
        title: 'Bound crawl',
        tool: 'firecrawl_crawl',
        input: `maxDepth ${workflow.crawl_cap.maxDepth}, limit ${workflow.crawl_cap.limit}`,
        output: 'Crawl job id hash and capped page set',
        disclosure: 'hash-only',
      },
    ],
    guardrail: {
      next_action: 'customer_email',
      decision: 'escalate_before_customer_email',
      stopped_before: 'customer_email',
    },
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
  const signedDecision = input.packet.policyDecision.signed_control_records.policy_decision
  const signedOutcome = input.packet.policyDecision.signed_control_records.policy_outcome
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
      signed_policy_record: Boolean(signedDecision),
      signed_control_record_hash: signedDecision?.record_hash ?? null,
      signed_control_record_index: signedDecision?.proof.log_index ?? null,
      signed_outcome_record_hash: signedOutcome?.record_hash ?? null,
      signed_outcome_record_index: signedOutcome?.proof.log_index ?? null,
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
          demo_surface: firecrawlDemoSurfaceFromWorkflow(workflow),
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
    <title>Firecrawl web ingestion proof</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #eef2f5;
        --ink: #14202b;
        --muted: #5c6875;
        --faint: #83909c;
        --panel: #ffffff;
        --panel-soft: #f8fafb;
        --line: #d8e0e7;
        --green: #0d7f5c;
        --green-ink: #064533;
        --blue: #2158d1;
        --amber: #a85603;
        --red: #b42337;
        --violet: #6151c9;
        --shadow: 0 18px 50px rgba(18, 32, 43, 0.08);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.82), rgba(238, 242, 245, 0.94)),
          var(--bg);
        color: var(--ink);
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", sans-serif;
      }
      button, input, textarea { font: inherit; }
      button {
        align-items: center;
        background: #111827;
        border: 1px solid #111827;
        border-radius: 8px;
        color: white;
        cursor: pointer;
        display: inline-flex;
        font-weight: 760;
        gap: 8px;
        min-height: 42px;
        padding: 0 15px;
      }
      button:disabled { cursor: not-allowed; opacity: 0.55; }
      main {
        margin: 0 auto;
        max-width: 1320px;
        padding: 20px 20px 28px;
      }
      header {
        align-items: center;
        display: grid;
        gap: 16px;
        grid-template-columns: minmax(0, 1fr) auto;
        margin-bottom: 16px;
      }
      .eyebrow {
        align-items: center;
        color: var(--green-ink);
        display: inline-flex;
        font-size: 12px;
        font-weight: 780;
        gap: 8px;
        letter-spacing: 0.08em;
        margin-bottom: 8px;
        text-transform: uppercase;
      }
      .eyebrow::before {
        background: var(--green);
        border-radius: 999px;
        content: "";
        height: 8px;
        width: 8px;
      }
      h1 {
        font-size: clamp(28px, 4vw, 44px);
        letter-spacing: 0;
        line-height: 1.04;
        margin: 0;
        max-width: 760px;
      }
      h2 {
        font-size: 12px;
        letter-spacing: 0.08em;
        margin: 0 0 12px;
        text-transform: uppercase;
      }
      h3 {
        font-size: 15px;
        letter-spacing: 0;
        margin: 0;
      }
      p {
        color: var(--muted);
        font-size: 14px;
        line-height: 1.48;
        margin: 0;
      }
      code {
        background: #f3f5f7;
        border: 1px solid #e5ebf0;
        border-radius: 5px;
        color: #26313d;
        font-family: "SFMono-Regular", Consolas, monospace;
        font-size: 12px;
        padding: 1px 4px;
        overflow-wrap: anywhere;
      }
      a { color: var(--blue); font-weight: 720; text-decoration: none; }
      a:hover { text-decoration: underline; }
      .hero-copy {
        display: grid;
        gap: 10px;
      }
      .hero-subcopy {
        color: #3d4a56;
        font-size: 16px;
        max-width: 780px;
      }
      .run-stack {
        align-items: end;
        display: grid;
        gap: 8px;
        justify-items: end;
      }
      .run-meta {
        color: var(--faint);
        font-size: 12px;
        text-align: right;
      }
      .layout {
        display: grid;
        gap: 16px;
        grid-template-columns: minmax(780px, 1.45fr) minmax(360px, 0.75fr);
      }
      .panel {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 8px;
        box-shadow: var(--shadow);
        padding: 16px;
      }
      .panel.tight { box-shadow: none; padding: 14px; }
      .source-lane {
        display: grid;
        gap: 12px;
      }
      .source-bar {
        align-items: center;
        background: #101820;
        border-radius: 8px;
        color: white;
        display: grid;
        gap: 10px;
        grid-template-columns: minmax(0, 1fr) auto;
        min-height: 62px;
        padding: 12px 14px;
      }
      .source-title {
        font-size: 14px;
        font-weight: 760;
      }
      .source-detail {
        color: #c9d2dc;
        font-size: 12px;
        overflow-wrap: anywhere;
      }
      .hash-pill {
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.18);
        border-radius: 999px;
        color: #e6edf4;
        font-size: 12px;
        font-weight: 700;
        padding: 6px 8px;
        white-space: nowrap;
      }
      .pipeline {
        display: grid;
        gap: 10px;
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }
      .stage {
        background: var(--panel-soft);
        border: 1px solid var(--line);
        border-radius: 8px;
        display: grid;
        gap: 10px;
        min-height: 230px;
        padding: 12px;
        position: relative;
      }
      .stage::after {
        background: var(--line);
        content: "";
        height: 2px;
        position: absolute;
        right: -11px;
        top: 38px;
        width: 10px;
      }
      .stage:last-child::after { display: none; }
      .stage-head {
        align-items: center;
        display: flex;
        gap: 9px;
      }
      .stage-token {
        align-items: center;
        background: #e9f6f1;
        border: 1px solid #c8e6d9;
        border-radius: 7px;
        color: var(--green-ink);
        display: inline-flex;
        flex: 0 0 auto;
        font-size: 12px;
        font-weight: 800;
        height: 30px;
        justify-content: center;
        width: 30px;
      }
      .stage:nth-child(2) .stage-token { background: #edf3ff; border-color: #d5e2ff; color: #1d4ea7; }
      .stage:nth-child(3) .stage-token { background: #f4f0ff; border-color: #ded7ff; color: #5141ab; }
      .stage:nth-child(4) .stage-token { background: #fff7ed; border-color: #fed7aa; color: #8a3d00; }
      .stage-body {
        display: grid;
        gap: 8px;
      }
      .stage-label {
        color: var(--faint);
        font-size: 11px;
        font-weight: 760;
        letter-spacing: 0.07em;
        text-transform: uppercase;
      }
      .stage-text {
        color: #2c3844;
        font-size: 13px;
        line-height: 1.38;
        overflow-wrap: anywhere;
      }
      .artifact-grid {
        display: grid;
        gap: 12px;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      }
      .artifact {
        background: #fbfcfd;
        border: 1px solid var(--line);
        border-radius: 8px;
        display: grid;
        gap: 8px;
        min-height: 118px;
        padding: 12px;
      }
      .artifact strong {
        font-size: 13px;
      }
      .json-preview {
        background: #111827;
        border-radius: 8px;
        color: #d1fae5;
        font-family: "SFMono-Regular", Consolas, monospace;
        font-size: 12px;
        line-height: 1.48;
        margin: 0;
        overflow: auto;
        padding: 12px;
        white-space: pre-wrap;
      }
      .privacy-strip {
        align-items: stretch;
        display: grid;
        gap: 10px;
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
      .privacy-item {
        background: #fffdf8;
        border: 1px solid #f3d49b;
        border-radius: 8px;
        padding: 10px;
      }
      .privacy-item strong {
        color: #6d3500;
        display: block;
        font-size: 12px;
        margin-bottom: 4px;
        text-transform: uppercase;
      }
      .evidence-stack {
        display: grid;
        gap: 12px;
      }
      .status-row {
        align-items: center;
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .chip {
        align-items: center;
        border: 1px solid var(--line);
        border-radius: 999px;
        color: var(--muted);
        display: inline-flex;
        font-size: 12px;
        font-weight: 760;
        min-height: 28px;
        padding: 5px 9px;
      }
      .chip.ok { background: #edf8f3; border-color: #b9dfce; color: var(--green-ink); }
      .chip.warn { background: #fff8ec; border-color: #f2d098; color: var(--amber); }
      .chip.err { background: #fff1f3; border-color: #ffc4cf; color: var(--red); }
      .chip.neutral { background: #f4f6f8; border-color: #dde4eb; color: #3e4a56; }
      .gate {
        border: 1px solid #d9d4fa;
        border-radius: 8px;
        display: grid;
        gap: 10px;
        grid-template-columns: auto minmax(0, 1fr);
        padding: 12px;
      }
      .gate-badge {
        align-items: center;
        background: #f4f0ff;
        border-radius: 7px;
        color: var(--violet);
        display: inline-flex;
        font-size: 13px;
        font-weight: 840;
        height: 32px;
        justify-content: center;
        width: 32px;
      }
      .record-list {
        display: grid;
        gap: 8px;
      }
      .record-row {
        align-items: start;
        background: #fbfcfd;
        border: 1px solid var(--line);
        border-radius: 8px;
        display: grid;
        gap: 8px;
        grid-template-columns: 128px minmax(0, 1fr) auto;
        padding: 10px;
      }
      .record-tool {
        font-size: 12px;
        font-weight: 760;
      }
      .record-links {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        white-space: nowrap;
      }
      .rule-table {
        border-collapse: collapse;
        width: 100%;
      }
      .rule-table th,
      .rule-table td {
        border-bottom: 1px solid var(--line);
        font-size: 12px;
        padding: 8px 6px;
        text-align: left;
        vertical-align: top;
      }
      .rule-table th {
        color: var(--faint);
        font-weight: 780;
        letter-spacing: 0.07em;
        text-transform: uppercase;
      }
      .empty {
        border: 1px dashed var(--line);
        border-radius: 8px;
        color: var(--muted);
        display: grid;
        min-height: 150px;
        padding: 18px;
        place-items: center;
        text-align: center;
      }
      .small {
        color: var(--faint);
        font-size: 12px;
        line-height: 1.42;
      }
      @media (max-width: 1180px) {
        .layout { grid-template-columns: 1fr; }
      }
      @media (max-width: 820px) {
        main { padding: 16px; }
        header { grid-template-columns: 1fr; }
        .run-stack { align-items: stretch; justify-items: stretch; }
        .run-meta { text-align: left; }
        .pipeline,
        .artifact-grid,
        .privacy-strip { grid-template-columns: 1fr; }
        .stage::after { display: none; }
        .record-row { grid-template-columns: 1fr; }
        .record-links { white-space: normal; }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div class="hero-copy">
          <div>
            <div class="eyebrow">Firecrawl MCP proof</div>
            <h1>Web data in. Signed ingestion and policy evidence out.</h1>
          </div>
          <p class="hero-subcopy">This resettable demo runs a fixed Firecrawl search, scrape, extract, and capped crawl path. The downstream customer-email action is stopped until atrib signs the policy decision and outcome.</p>
        </div>
        <div class="run-stack">
          <button id="runButton" type="button"><span>Run proof</span></button>
          <div class="run-meta" id="modeLine">Loading configuration</div>
        </div>
      </header>
      <div class="layout">
        <div class="source-lane">
          <section class="panel">
            <h2>Source to context pipeline</h2>
            <div id="sourcePanel" class="source-bar">
              <div>
                <div class="source-title">Loading fixed public source</div>
                <div class="source-detail">The hosted demo does not accept arbitrary URLs.</div>
              </div>
              <span class="hash-pill">fixed input</span>
            </div>
            <div style="height: 12px"></div>
            <div id="pipelinePanel" class="pipeline">
              <div class="empty">Loading pipeline.</div>
            </div>
          </section>
          <section class="panel">
            <h2>What the web content becomes</h2>
            <div class="artifact-grid">
              <div class="artifact">
                <strong>Clean context</strong>
                <p>The public proof keeps content hashes. The server does not persist raw markdown, HTML, page text, or crawl job ids.</p>
              </div>
              <div class="artifact">
                <strong>Structured extraction</strong>
                <pre class="json-preview" id="jsonPreview">{
  "company": "hash-only",
  "account_note": "hash-only",
  "source": "fixed public URL"
}</pre>
              </div>
            </div>
          </section>
          <section class="panel">
            <h2>Redaction boundary</h2>
            <div class="privacy-strip" id="privacyPanel">
              <div class="privacy-item"><strong>Private</strong><p>Firecrawl API key and auth token.</p></div>
              <div class="privacy-item"><strong>Hash-only</strong><p>Raw scraped content and extracted page text.</p></div>
              <div class="privacy-item"><strong>Public</strong><p>Tool names, record hashes, log indexes, crawl cap, and verifier result.</p></div>
            </div>
          </section>
        </div>
        <aside class="evidence-stack">
          <section class="panel tight">
            <h2>Run state</h2>
            <div class="status-row">
              <span id="statusChip" class="chip warn">waiting</span>
              <span id="runIdChip" class="chip neutral">no run</span>
            </div>
            <div style="height: 10px"></div>
            <p id="configLine">Reading deployment guard.</p>
          </section>
          <section class="panel tight">
            <h2>Policy gate</h2>
            <div id="policyPanel" class="gate">
              <div class="gate-badge">P</div>
              <div>
                <h3>customer_email is stopped before execution</h3>
                <p>Policy evidence appears here after a run finishes.</p>
              </div>
            </div>
          </section>
          <section class="panel tight">
            <h2>Signed records</h2>
            <div id="recordPanel" class="empty">Start a run to create fresh records.</div>
          </section>
          <section class="panel tight">
            <h2>Verifier checks</h2>
            <div id="rulesPanel" class="empty">Verifier output appears after the proof finishes.</div>
          </section>
        </aside>
      </div>
    </main>
    <script>
      const runButton = document.getElementById('runButton');
      const sourcePanel = document.getElementById('sourcePanel');
      const pipelinePanel = document.getElementById('pipelinePanel');
      const privacyPanel = document.getElementById('privacyPanel');
      const recordPanel = document.getElementById('recordPanel');
      const rulesPanel = document.getElementById('rulesPanel');
      const policyPanel = document.getElementById('policyPanel');
      const statusChip = document.getElementById('statusChip');
      const runIdChip = document.getElementById('runIdChip');
      const modeLine = document.getElementById('modeLine');
      const configLine = document.getElementById('configLine');
      const jsonPreview = document.getElementById('jsonPreview');
      let configState = null;

      async function loadConfig() {
        const response = await fetch('/api/config');
        const config = await response.json();
        configState = config;
        renderWorkflow(config.workflow, config.demo_surface, config.input_hashes);
        modeLine.textContent = config.mode + (config.public_log ? ' with public log writes' : ' with local receipts');
        configLine.textContent = config.deployed ? 'Hosted fixed-input run surface.' : 'Local resettable run surface.';
        if (config.deployment_guard_issues && config.deployment_guard_issues.length > 0) {
          setStatus('Guard failed', 'err');
          runButton.disabled = true;
          recordPanel.className = 'empty';
          recordPanel.textContent = config.deployment_guard_issues.join('; ');
          return;
        }
        if (config.mode === 'live' && !config.live_ready) {
          setStatus('Missing live env', 'err');
          runButton.disabled = true;
          configLine.textContent = 'Live mode needs a Firecrawl credential before it can run.';
          return;
        }
        setStatus('Ready', 'ok');
      }

      async function runProof() {
        runButton.disabled = true;
        setStatus('Running', 'warn');
        runIdChip.textContent = 'queued';
        recordPanel.className = 'empty';
        recordPanel.textContent = 'Running Firecrawl MCP through atrib/mcp-wrap.';
        rulesPanel.className = 'empty';
        rulesPanel.textContent = 'Waiting for verifier output.';
        try {
          const response = await fetch('/api/runs', { method: 'POST' });
          const body = await response.json();
          if (!response.ok || !body.run) throw new Error(body.error || (body.run && body.run.error) || 'run failed');
          renderRun(body.run);
          const run = body.run.status === 'running' ? await pollRun(body.run.run_id) : body.run;
          renderRun(run);
          setStatus(run.status === 'accepted' ? 'Accepted' : 'Failed', run.status === 'accepted' ? 'ok' : 'err');
        } catch (error) {
          recordPanel.className = 'empty';
          recordPanel.textContent = error instanceof Error ? error.message : String(error);
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

      function renderWorkflow(workflow, surface, inputHashes) {
        if (!workflow || !surface) {
          pipelinePanel.innerHTML = '<div class="empty">Pipeline unavailable.</div>';
          return;
        }
        sourcePanel.innerHTML =
          '<div>' +
            '<div class="source-title">' + escapeHtml(workflow.query) + '</div>' +
            '<div class="source-detail">' + escapeHtml(workflow.source_url) + '</div>' +
          '</div>' +
          '<span class="hash-pill">' + shortHash(inputHashes && inputHashes.source_url) + '</span>';
        pipelinePanel.innerHTML = surface.stages.map((stage, index) => stageCard(stage, index)).join('');
        privacyPanel.innerHTML =
          '<div class="privacy-item"><strong>Private</strong><p>' + escapeHtml(workflow.private_fields.join(', ')) + '.</p></div>' +
          '<div class="privacy-item"><strong>Public</strong><p>' + escapeHtml(workflow.public_fields.join(', ')) + '.</p></div>' +
          '<div class="privacy-item"><strong>Cap</strong><p>Crawl uses maxDepth ' + escapeHtml(workflow.crawl_cap.maxDepth) + ' and limit ' + escapeHtml(workflow.crawl_cap.limit) + '.</p></div>';
      }

      function stageCard(stage, index) {
        const token = ['S', 'G', 'E', 'C'][index] || String(index + 1);
        return '<article class="stage">' +
          '<div class="stage-head"><span class="stage-token">' + token + '</span><div><h3>' + escapeHtml(stage.title) + '</h3><p class="small">' + escapeHtml(stage.tool) + '</p></div></div>' +
          '<div class="stage-body">' +
            '<div><div class="stage-label">Input</div><div class="stage-text">' + escapeHtml(stage.input) + '</div></div>' +
            '<div><div class="stage-label">Output</div><div class="stage-text">' + escapeHtml(stage.output) + '</div></div>' +
            '<span class="chip neutral">' + escapeHtml(stage.disclosure) + '</span>' +
          '</div>' +
        '</article>';
      }

      function renderRun(run) {
        if (run.workflow && configState) {
          renderWorkflow(run.workflow, configState.demo_surface, configState.input_hashes);
        }
        runIdChip.textContent = run.run_id || 'no run';
        const chipClass = run.status === 'accepted' ? 'ok' : run.status === 'running' ? 'warn' : 'err';
        setStatus(run.status, chipClass);
        if (run.status === 'failed') {
          recordPanel.className = 'empty';
          recordPanel.textContent = run.error || 'run failed';
          return;
        }
        renderRecords(run);
        renderPolicy(run);
        renderRules(run);
      }

      function renderRecords(run) {
        const operations = run.operations || [];
        if (!operations.length) {
          recordPanel.className = 'empty';
          recordPanel.textContent = 'Proof is running.';
          return;
        }
        recordPanel.className = 'record-list';
        recordPanel.innerHTML = operations.map((operation) => {
          const explorer = operation.explorer_url ? '<a href="' + escapeAttr(operation.explorer_url) + '" target="_blank" rel="noreferrer">Explorer</a>' : '';
          const proof = operation.log_proof_url ? '<a href="' + escapeAttr(operation.log_proof_url) + '" target="_blank" rel="noreferrer">Log proof</a>' : '';
          return '<div class="record-row">' +
            '<div class="record-tool">' + escapeHtml(operation.step) + '<br><span class="small">index ' + escapeHtml(operation.log_index) + '</span></div>' +
            '<code>' + escapeHtml(operation.record_hash) + '</code>' +
            '<div class="record-links">' + explorer + proof + '</div>' +
          '</div>';
        }).join('');
      }

      function renderPolicy(run) {
        const policy = run.policy_decision;
        if (!policy) {
          policyPanel.innerHTML =
            '<div class="gate-badge">P</div><div><h3>customer_email is stopped before execution</h3><p>Policy evidence appears here after a run finishes.</p></div>';
          return;
        }
        jsonPreview.textContent = JSON.stringify({
          company: 'hash-only',
          account_note: 'hash-only',
          source: run.workflow ? run.workflow.source_url : 'fixed public URL',
          decision: policy.decision,
        }, null, 2);
        policyPanel.innerHTML =
          '<div class="gate-badge">P</div>' +
          '<div><h3>' + escapeHtml(policy.decision) + '</h3>' +
          '<p>Status: ' + escapeHtml(policy.decision_status) + '</p>' +
          '<p class="small">Decision record <code>' + escapeHtml(policy.signed_control_record_hash || 'missing') + '</code> at index ' + escapeHtml(policy.signed_control_record_index ?? 'missing') + '.</p>' +
          '<p class="small">Outcome record <code>' + escapeHtml(policy.signed_outcome_record_hash || 'missing') + '</code> at index ' + escapeHtml(policy.signed_outcome_record_index ?? 'missing') + '.</p></div>';
      }

      function renderRules(run) {
        const rules = run.policy_decision ? run.policy_decision.rule_results : [];
        if (!rules.length) {
          rulesPanel.className = 'empty';
          rulesPanel.textContent = 'Verifier output appears after the proof finishes.';
          return;
        }
        rulesPanel.className = '';
        rulesPanel.innerHTML =
          '<table class="rule-table"><thead><tr><th>Check</th><th>Result</th></tr></thead><tbody>' +
          rules.map((rule) => '<tr><td>' + escapeHtml(rule.id) + '</td><td>' + escapeHtml(rule.outcome) + '</td></tr>').join('') +
          '</tbody></table>';
      }

      function delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
      }

      function setStatus(label, kind) {
        statusChip.textContent = label;
        statusChip.className = 'chip ' + kind;
      }

      function shortHash(value) {
        if (!value) return 'hash pending';
        return String(value).slice(0, 18) + '...';
      }

      function escapeAttr(value) {
        return escapeHtml(value).replace(/"/g, '&quot;');
      }

      function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
      }

      runButton.addEventListener('click', runProof);
      loadConfig().catch((error) => {
        setStatus('Config failed', 'err');
        recordPanel.textContent = error instanceof Error ? error.message : String(error);
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
