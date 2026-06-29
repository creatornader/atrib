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
import type { PacketToolResultEvent, WrappedMcpPacketResult } from '../../wrapped-mcp-proof-runner.js'
import { renderBrowserbaseProofApp } from './ui.js'

const serviceName = 'atrib-browserbase-stagehand-demo'
const maxStoredRuns = 12
const targetRoute = '/target'

type DemoMode = 'fixture' | 'live'
type RunStatus = 'running' | 'accepted' | 'failed'
type VisualStage = 'idle' | 'running' | 'replay' | 'failed'
type VisualEventStatus = 'pending' | 'running' | 'signed' | 'blocked' | 'skipped'
type BrowserbaseMediaSource = 'env' | 'tool-result' | 'none'

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
  visual?: BrowserbaseVisualState
  operations?: Array<{
    step: string
    record_hash: string
    log_index: number
    explorer_url: string | null
    log_proof_url: string | null
  }>
}

export type BrowserbasePrivateSessionMedia = {
  source: Exclude<BrowserbaseMediaSource, 'none'>
  session_id?: string | undefined
  live_view_url?: string | undefined
  replay_url?: string | undefined
  session_url?: string | undefined
  detected_from: string[]
}

export type BrowserbaseDemoRunnerResult =
  | WrappedMcpPacketResult
  | {
      result: WrappedMcpPacketResult
      private_media?: BrowserbasePrivateSessionMedia
    }

export type BrowserbaseVisualEvent = {
  step: string
  label: string
  at_ms: number
  status: VisualEventStatus
  cursor: {
    x_pct: number
    y_pct: number
  }
  target_action: 'none' | 'approve' | 'hold'
  caption: string
  record_hash?: string | undefined
}

export type BrowserbaseVisualState = {
  schema: 'atrib.browserbase.visual_run.v1'
  stage: VisualStage
  source: 'fixture-simulation' | 'browserbase-live'
  current_step: string
  playback_ms: number
  media: {
    primary: 'simulated' | 'live' | 'replay'
    source: BrowserbaseMediaSource
    session: {
      available: boolean
      id_hash?: string
      disclosure: 'not-available' | 'hash-only'
    }
    live_view: {
      available: boolean
      url?: string
      url_hash?: string
      disclosure: 'not-available' | 'ui-only-ephemeral'
    }
    replay: {
      available: boolean
      url?: string
      url_hash?: string
      proxy_path?: string
      disclosure: 'not-available' | 'ui-only-ephemeral' | 'server-proxy'
    }
    note: string
  }
  events: BrowserbaseVisualEvent[]
  privacy: {
    public_records: 'hash-only'
    ui_only_fields: string[]
  }
}

export type DisclosedValue = {
  value?: string
  hash?: string
  disclosure: 'public-fixed' | 'hash-only'
}

export type BrowserbaseWorkflow = {
  name: string
  target_url: DisclosedValue
  target_page: {
    route: string
    shape: 'webapp'
    native_webmcp_api: 'document.modelContext'
    tools: WebMcpToolDescriptor[]
    boundary: string
  }
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

export type WebMcpToolDescriptor = {
  name: string
  description: string
  input_schema: Record<string, unknown>
  output_schema: Record<string, unknown>
}

type Runner = (options: {
  mode: DemoMode
  publicLog: boolean
  actionPolicyMode: BrowserbaseActionPolicyMode
}) => Promise<BrowserbaseDemoRunnerResult>

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

function mergePrivateSessionMedia(
  current: BrowserbasePrivateSessionMedia | undefined,
  next: BrowserbasePrivateSessionMedia | undefined,
): BrowserbasePrivateSessionMedia | undefined {
  if (!next) return current
  if (!current) return next
  return {
    source: current.source === 'tool-result' ? current.source : next.source,
    session_id: current.session_id ?? next.session_id,
    live_view_url: current.live_view_url ?? next.live_view_url,
    replay_url: current.replay_url ?? next.replay_url,
    session_url: current.session_url ?? next.session_url,
    detected_from: [...new Set([...current.detected_from, ...next.detected_from])],
  }
}

function cleanExtractedUrl(value: string): string | undefined {
  const cleaned = value.replace(/[),.;\]}]+$/u, '')
  return safeVisualUrl(cleaned)
}

function extractHttpsUrls(text: string): string[] {
  return [
    ...new Set(
      [...text.matchAll(/https:\/\/[^\s"'<>\\]+/gu)]
        .map((match) => cleanExtractedUrl(match[0]))
        .filter((value): value is string => Boolean(value)),
    ),
  ]
}

function classifyBrowserbaseUrl(url: string): 'live_view' | 'replay' | 'session' | undefined {
  const lower = url.toLowerCase()
  if (lower.includes('replays') || lower.includes('replay') || lower.includes('.m3u8')) {
    return 'replay'
  }
  if (
    lower.includes('debugger') ||
    lower.includes('devtools') ||
    lower.includes('live-view') ||
    lower.includes('liveview')
  ) {
    return 'live_view'
  }
  if (lower.includes('/sessions/')) return 'session'
  return undefined
}

function sessionIdFromBrowserbaseText(toolName: string, text: string, urls: string[]): string | undefined {
  for (const url of urls) {
    const match = url.match(/\/(?:v1\/)?sessions\/([^/?#]+)/u)
    if (match?.[1]) return match[1]
  }
  if (toolName !== 'start') return undefined
  const patterns = [
    /["'](?:sessionId|session_id|sessionID)["']\s*:\s*["']([A-Za-z0-9_-]{8,})["']/u,
    /["']id["']\s*:\s*["']([A-Za-z0-9_-]{8,})["']/u,
    /\b(?:sessionId|session_id|sessionID)\b\s*[:=]\s*["']?([A-Za-z0-9_-]{8,})["']?/u,
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) return match[1]
  }
  return undefined
}

export function browserbasePrivateMediaFromToolResult(
  event: Pick<PacketToolResultEvent, 'name' | 'result_text'>,
): BrowserbasePrivateSessionMedia | undefined {
  const urls = extractHttpsUrls(event.result_text)
  const media: BrowserbasePrivateSessionMedia = {
    source: 'tool-result',
    detected_from: [event.name],
  }
  for (const url of urls) {
    const kind = classifyBrowserbaseUrl(url)
    if (kind === 'live_view' && !media.live_view_url) media.live_view_url = url
    if (kind === 'replay' && !media.replay_url) media.replay_url = url
    if (kind === 'session' && !media.session_url) media.session_url = url
  }
  media.session_id = sessionIdFromBrowserbaseText(event.name, event.result_text, urls)
  if (!media.session_id && !media.live_view_url && !media.replay_url && !media.session_url) {
    return undefined
  }
  return media
}

function privateMediaFromEnv(env: NodeJS.ProcessEnv): BrowserbasePrivateSessionMedia | undefined {
  const liveViewUrl = safeVisualUrl(env.ATRIB_BROWSERBASE_DEMO_LIVE_VIEW_URL)
  const replayUrl = safeVisualUrl(env.ATRIB_BROWSERBASE_DEMO_REPLAY_URL)
  if (!liveViewUrl && !replayUrl) return undefined
  return {
    source: 'env',
    live_view_url: liveViewUrl,
    replay_url: replayUrl,
    detected_from: ['env'],
  }
}

function webMcpTools(): WebMcpToolDescriptor[] {
  return [
    {
      name: 'read_vendor_risk',
      description: 'Read the visible renewal risk summary before taking action.',
      input_schema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      output_schema: {
        type: 'object',
        properties: {
          vendor: { type: 'string' },
          renewal_id: { type: 'string' },
          risk_level: { type: 'string' },
          amount_usd: { type: 'number' },
        },
        required: ['vendor', 'renewal_id', 'risk_level', 'amount_usd'],
      },
    },
    {
      name: 'approve_vendor_renewal',
      description: 'Approve the fixed Northstar data-room renewal and return a confirmation id.',
      input_schema: {
        type: 'object',
        properties: {
          operator_note: { type: 'string' },
        },
        additionalProperties: false,
      },
      output_schema: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          confirmation_id: { type: 'string' },
        },
        required: ['status', 'confirmation_id'],
      },
    },
    {
      name: 'request_human_review',
      description: 'Route the renewal to a human reviewer without approving it.',
      input_schema: {
        type: 'object',
        properties: {
          reason: { type: 'string' },
        },
        additionalProperties: false,
      },
      output_schema: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          routed_to: { type: 'string' },
        },
        required: ['status', 'routed_to'],
      },
    },
  ]
}

export function browserbaseDemoTargetUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (env.ATRIB_BROWSERBASE_DEMO_URL) return env.ATRIB_BROWSERBASE_DEMO_URL
  const publicBaseUrl = env.ATRIB_BROWSERBASE_DEMO_PUBLIC_BASE_URL?.replace(/\/+$/u, '')
  if (publicBaseUrl) return `${publicBaseUrl}${targetRoute}`
  return 'https://example.com'
}

function discloseValue(value: string, publicValue: boolean): DisclosedValue {
  return publicValue
    ? { value, disclosure: 'public-fixed' }
    : { hash: sha256Text(value), disclosure: 'hash-only' }
}

export function browserbaseWorkflowFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): BrowserbaseWorkflow {
  const targetUrl = browserbaseDemoTargetUrl(env)
  const observeInstruction =
    env.ATRIB_BROWSERBASE_DEMO_OBSERVE ??
    'Find the vendor renewal panel and the WebMCP tools available on the page'
  const actAction =
    env.ATRIB_BROWSERBASE_DEMO_ACT ?? 'Click Approve renewal for the Northstar data room renewal'
  const extractInstruction =
    env.ATRIB_BROWSERBASE_DEMO_EXTRACT ??
    'Extract the confirmation id, approval status, and WebMCP tool names'
  const exposeTarget =
    env.ATRIB_BROWSERBASE_DEMO_EXPOSE_TARGET === '1' ||
    targetUrl === 'https://example.com' ||
    targetUrl.endsWith(targetRoute)
  const exposeInstructions =
    env.ATRIB_BROWSERBASE_DEMO_EXPOSE_INSTRUCTIONS === '1' ||
    (!env.ATRIB_BROWSERBASE_DEMO_OBSERVE &&
      !env.ATRIB_BROWSERBASE_DEMO_ACT &&
      !env.ATRIB_BROWSERBASE_DEMO_EXTRACT)

  return {
    name: 'Browserbase Stagehand WebMCP proof flow',
    target_url: discloseValue(targetUrl, exposeTarget),
    target_page: {
      route: targetRoute,
      shape: 'webapp',
      native_webmcp_api: 'document.modelContext',
      tools: webMcpTools(),
      boundary:
        'The target page exposes first-party WebMCP tools. atrib signs Browserbase MCP calls and policy gate records around the action boundary.',
    },
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
  if (!env.ATRIB_BROWSERBASE_DEMO_URL && !env.ATRIB_BROWSERBASE_DEMO_PUBLIC_BASE_URL) {
    issues.push('ATRIB_BROWSERBASE_DEMO_URL or ATRIB_BROWSERBASE_DEMO_PUBLIC_BASE_URL is required')
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

function visualMedia(input: {
  env: NodeJS.ProcessEnv
  mode: DemoMode
  runId?: string | undefined
  privateMedia?: BrowserbasePrivateSessionMedia | undefined
}): BrowserbaseVisualState['media'] {
  const runPrivateMedia = input.mode === 'live' ? input.privateMedia : undefined
  const privateMedia = mergePrivateSessionMedia(privateMediaFromEnv(input.env), runPrivateMedia)
  const liveViewUrl = safeVisualUrl(privateMedia?.live_view_url)
  const replayUrl = safeVisualUrl(privateMedia?.replay_url)
  const hasSession = Boolean(privateMedia?.session_id)
  const replayProxyPath = hasSession && input.runId ? `/api/runs/${input.runId}/browserbase/replays` : undefined
  const source: BrowserbaseMediaSource = privateMedia?.source ?? 'none'
  const primary = liveViewUrl ? 'live' : replayUrl || replayProxyPath ? 'replay' : 'simulated'
  return {
    primary,
    source,
    session: hasSession
      ? { available: true, id_hash: sha256Text(privateMedia!.session_id!), disclosure: 'hash-only' }
      : { available: false, disclosure: 'not-available' },
    live_view: liveViewUrl
      ? {
          available: true,
          url: liveViewUrl,
          url_hash: sha256Text(liveViewUrl),
          disclosure: 'ui-only-ephemeral',
        }
      : { available: false, disclosure: 'not-available' },
    replay:
      replayUrl || replayProxyPath
        ? {
            available: true,
            ...(replayUrl ? { url: replayUrl, url_hash: sha256Text(replayUrl) } : {}),
            ...(replayProxyPath ? { proxy_path: replayProxyPath } : {}),
            disclosure: replayUrl ? 'ui-only-ephemeral' : 'server-proxy',
          }
        : { available: false, disclosure: 'not-available' },
    note:
      input.mode === 'live'
        ? primary === 'replay'
          ? 'Browserbase session media is kept UI-only. Public records keep hashes and verifier results.'
          : 'Live Browserbase proof ran through the MCP path. Replay is available when the run exposes a session ref.'
        : 'Fixture mode uses deterministic playback because no Browserbase cloud session exists.',
  }
}

function safeVisualUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

function visualEventsForMode(
  actionPolicyMode: BrowserbaseActionPolicyMode,
  operations: Array<{ step: string; record_hash?: string }> = [],
): BrowserbaseVisualEvent[] {
  const byStep = new Map(operations.map((operation) => [operation.step, operation.record_hash]))
  const blocked = actionPolicyMode !== 'allow'
  const base: BrowserbaseVisualEvent[] = [
    {
      step: 'start',
      label: 'Start Browserbase session',
      at_ms: 0,
      status: byStep.has('start') ? 'signed' : 'pending',
      cursor: { x_pct: 12, y_pct: 12 },
      target_action: 'none',
      caption: 'Opening the remote browser session.',
      record_hash: byStep.get('start'),
    },
    {
      step: 'navigate',
      label: 'Navigate to vendor portal',
      at_ms: 900,
      status: byStep.has('navigate') ? 'signed' : 'pending',
      cursor: { x_pct: 42, y_pct: 7 },
      target_action: 'none',
      caption: 'Stagehand navigates to the fixed WebMCP target.',
      record_hash: byStep.get('navigate'),
    },
    {
      step: 'observe',
      label: 'Observe renewal state',
      at_ms: 1900,
      status: byStep.has('observe') ? 'signed' : 'pending',
      cursor: { x_pct: 31, y_pct: 55 },
      target_action: 'none',
      caption: 'Stagehand reads the risk panel and WebMCP tool list.',
      record_hash: byStep.get('observe'),
    },
    {
      step: 'policy_decision',
      label: blocked ? 'Policy decision stops act' : 'Policy decision allows act',
      at_ms: 2800,
      status: blocked ? 'blocked' : 'signed',
      cursor: { x_pct: 63, y_pct: 68 },
      target_action: blocked ? 'hold' : 'none',
      caption: blocked
        ? 'The action gate stops before the browser click.'
        : 'The action gate signs allow before the browser click.',
    },
    {
      step: 'act',
      label: blocked ? 'Act withheld' : 'Click approve renewal',
      at_ms: 3900,
      status: blocked ? 'skipped' : byStep.has('act') ? 'signed' : 'pending',
      cursor: { x_pct: 69, y_pct: 79 },
      target_action: blocked ? 'hold' : 'approve',
      caption: blocked
        ? 'No act call is made. The approval button is not clicked.'
        : 'Stagehand clicks the approval action after policy allow.',
      record_hash: byStep.get('act'),
    },
    {
      step: 'policy_outcome',
      label: blocked ? 'Policy outcome: stopped' : 'Policy outcome: executed',
      at_ms: 4700,
      status: blocked ? 'blocked' : 'signed',
      cursor: { x_pct: 69, y_pct: 79 },
      target_action: 'none',
      caption: blocked
        ? 'The signed outcome says execution stopped before act.'
        : 'The signed outcome links the allow decision to the act record.',
    },
    {
      step: 'extract',
      label: 'Extract confirmation fields',
      at_ms: 5600,
      status: blocked ? 'skipped' : byStep.has('extract') ? 'signed' : 'pending',
      cursor: { x_pct: 63, y_pct: 56 },
      target_action: 'none',
      caption: blocked
        ? 'Extraction is skipped because the action did not run.'
        : 'Stagehand extracts the confirmation and visible tool names.',
      record_hash: byStep.get('extract'),
    },
    {
      step: 'end',
      label: 'End session',
      at_ms: 6500,
      status: byStep.has('end') ? 'signed' : 'pending',
      cursor: { x_pct: 9, y_pct: 12 },
      target_action: 'none',
      caption: 'Cleanup closes the browser session boundary.',
      record_hash: byStep.get('end'),
    },
  ]
  return base
}

function buildVisualState(input: {
  runId?: string | undefined
  mode: DemoMode
  actionPolicyMode: BrowserbaseActionPolicyMode
  stage: VisualStage
  operations?: BrowserbaseDemoRun['operations'] | undefined
  env?: NodeJS.ProcessEnv | undefined
  privateMedia?: BrowserbasePrivateSessionMedia | undefined
}): BrowserbaseVisualState {
  const operations = input.operations?.map((operation) => ({
    step: operation.step,
    record_hash: operation.record_hash,
  }))
  const events = visualEventsForMode(input.actionPolicyMode, operations)
  const current =
    input.stage === 'running'
      ? events.find((event) => event.status === 'pending') ?? events[0]
      : events.at(-1)
  return {
    schema: 'atrib.browserbase.visual_run.v1',
    stage: input.stage,
    source: input.mode === 'live' ? 'browserbase-live' : 'fixture-simulation',
    current_step: current?.step ?? 'start',
    playback_ms: events.at(-1)?.at_ms ?? 0,
    media: visualMedia({
      env: input.env ?? process.env,
      mode: input.mode,
      runId: input.runId,
      privateMedia: input.privateMedia,
    }),
    events,
    privacy: {
      public_records: 'hash-only',
      ui_only_fields: [
        'Browserbase Live View URL',
        'Browserbase Replay URL',
        'session id',
        'page pixels',
        'cursor positions',
      ],
    },
  }
}

export function summarizePacketResult(input: {
  runId: string
  startedAt: string
  finishedAt: string
  result: WrappedMcpPacketResult
  workflow?: BrowserbaseWorkflow
  actionPolicyMode: BrowserbaseActionPolicyMode
  env?: NodeJS.ProcessEnv
  privateMedia?: BrowserbasePrivateSessionMedia | undefined
}): BrowserbaseDemoRun {
  const run: BrowserbaseDemoRun = {
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
  return {
    ...run,
    visual: buildVisualState({
      runId: input.runId,
      mode: input.result.mode,
      actionPolicyMode: input.actionPolicyMode,
      stage: 'replay',
      operations: run.operations,
      env: input.env,
      privateMedia: input.privateMedia,
    }),
  }
}

export async function runBrowserbaseProof(options: {
  mode: DemoMode
  publicLog: boolean
  actionPolicyMode: BrowserbaseActionPolicyMode
}): Promise<WrappedMcpPacketResult> {
  return (await runBrowserbaseProofWithMedia(options)).result
}

export async function runBrowserbaseProofWithMedia(options: {
  mode: DemoMode
  publicLog: boolean
  actionPolicyMode: BrowserbaseActionPolicyMode
}): Promise<{ result: WrappedMcpPacketResult; private_media?: BrowserbasePrivateSessionMedia }> {
  const targetUrl = browserbaseDemoTargetUrl(process.env)
  let privateMedia: BrowserbasePrivateSessionMedia | undefined
  const result = await runBrowserbaseStagehandPacket({
    env: process.env,
    liveMode: options.mode === 'live',
    publicLog: options.publicLog,
    proofUrl: targetUrl,
    observeInstruction:
      process.env.ATRIB_BROWSERBASE_DEMO_OBSERVE ??
      'Find the vendor renewal panel and the WebMCP tools available on the page',
    actAction:
      process.env.ATRIB_BROWSERBASE_DEMO_ACT ??
      'Click Approve renewal for the Northstar data room renewal',
    extractInstruction:
      process.env.ATRIB_BROWSERBASE_DEMO_EXTRACT ??
      'Extract the confirmation id, approval status, and WebMCP tool names',
    actionPolicyMode: options.actionPolicyMode,
    timeoutMs: proofRunTimeoutMs(process.env),
    onToolResult(event) {
      if (options.mode !== 'live') return
      privateMedia = mergePrivateSessionMedia(
        privateMedia,
        browserbasePrivateMediaFromToolResult(event),
      )
    },
  }).catch((error: unknown) => {
    throw new Error(redactError(error instanceof Error ? error.message : String(error)))
  })
  return privateMedia ? { result, private_media: privateMedia } : { result }
}

export function createBrowserbaseDemoServer(
  options: { runner?: Runner; env?: NodeJS.ProcessEnv } = {},
) {
  const runs = new Map<string, BrowserbaseDemoRun>()
  const privateMediaByRun = new Map<string, BrowserbasePrivateSessionMedia>()
  const rateLimits = new Map<string, RateLimitBucket>()
  let activeRun: Promise<BrowserbaseDemoRun> | undefined
  const runner = options.runner ?? runBrowserbaseProofWithMedia
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

      if (request.method === 'GET' && url.pathname === targetRoute) {
        writeTargetHtml(response, renderTargetApp())
        return
      }

      if (request.method === 'GET' && url.pathname === '/favicon.ico') {
        writeNoFavicon(response)
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
          visual: buildVisualState({
            mode,
            actionPolicyMode: actionPolicyModeFromEnv(env),
            stage: 'idle',
            env,
          }),
          action_policy: {
            mode: actionPolicyModeFromEnv(env),
            modes: ['allow', 'block', 'escalate'],
            event_type: BROWSERBASE_ACTION_POLICY_EVENT_TYPE,
            policy_version: BROWSERBASE_ACTION_POLICY_VERSION,
          },
          target_route: targetRoute,
          webmcp_tools: webMcpTools(),
          fixed_flow: ['start', 'navigate', 'observe', 'act', 'extract', 'end'],
          public_fields: [
            'tool name',
            'args_hash',
            'result_hash',
            'record hash',
            'log index',
            'Action Gate decision hash',
            'Action Gate outcome hash',
          ],
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
          privateMediaByRun,
          workflow: browserbaseWorkflowFromEnv(env),
          env,
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

      const replayRoute = matchBrowserbaseReplayRoute(url.pathname)
      if (request.method === 'GET' && replayRoute) {
        await writeBrowserbaseReplayResponse({
          response,
          env,
          runId: replayRoute.runId,
          pageId: replayRoute.pageId,
          privateMediaByRun,
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
        endpoints: [
          'GET /',
          'GET /health',
          'GET /api/config',
          'GET /api/runs',
          'POST /api/runs',
          'GET /api/runs/:runId/browserbase/replays',
          'GET /api/runs/:runId/browserbase/replays/:pageId',
        ],
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
  privateMediaByRun: Map<string, BrowserbasePrivateSessionMedia>
  workflow: BrowserbaseWorkflow
  env: NodeJS.ProcessEnv
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
    visual: buildVisualState({
      mode: options.mode,
      actionPolicyMode: options.actionPolicyMode,
      stage: 'running',
      env: options.env,
    }),
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
  privateMediaByRun: Map<string, BrowserbasePrivateSessionMedia>
  running: BrowserbaseDemoRun
  startedAt: string
  workflow: BrowserbaseWorkflow
  env: NodeJS.ProcessEnv
}): Promise<BrowserbaseDemoRun> {
  try {
    const runnerOutput = await options.runner({
      mode: options.mode,
      publicLog: options.publicLog,
      actionPolicyMode: options.actionPolicyMode,
    })
    const { result, privateMedia } = normalizeRunnerOutput(runnerOutput)
    if (privateMedia) options.privateMediaByRun.set(options.running.run_id, privateMedia)
    const accepted = summarizePacketResult({
      runId: options.running.run_id,
      startedAt: options.startedAt,
      finishedAt: new Date().toISOString(),
      result,
      workflow: options.workflow,
      actionPolicyMode: options.actionPolicyMode,
      env: options.env,
      privateMedia,
    })
    rememberRun(options.runs, accepted)
    prunePrivateMedia(options.privateMediaByRun, options.runs)
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
      visual: buildVisualState({
        mode: options.mode,
        actionPolicyMode: options.actionPolicyMode,
        stage: 'failed',
        operations: options.running.operations,
        env: options.env,
      }),
    }
    rememberRun(options.runs, failed)
    prunePrivateMedia(options.privateMediaByRun, options.runs)
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

function prunePrivateMedia(
  privateMediaByRun: Map<string, BrowserbasePrivateSessionMedia>,
  runs: Map<string, BrowserbaseDemoRun>,
): void {
  for (const runId of privateMediaByRun.keys()) {
    if (!runs.has(runId)) privateMediaByRun.delete(runId)
  }
}

function normalizeRunnerOutput(output: BrowserbaseDemoRunnerResult): {
  result: WrappedMcpPacketResult
  privateMedia?: BrowserbasePrivateSessionMedia | undefined
} {
  const maybeEnvelope = output as {
    result?: unknown
    private_media?: BrowserbasePrivateSessionMedia
  }
  if (
    typeof output === 'object' &&
    output !== null &&
    'result' in maybeEnvelope &&
    typeof maybeEnvelope.result === 'object' &&
    maybeEnvelope.result !== null
  ) {
    return {
      result: maybeEnvelope.result as WrappedMcpPacketResult,
      privateMedia: maybeEnvelope.private_media,
    }
  }
  return { result: output as WrappedMcpPacketResult }
}

function runIdFromPath(pathname: string): string | undefined {
  const match = /^\/api\/runs\/([^/]+)$/u.exec(pathname)
  return match?.[1]
}

function matchBrowserbaseReplayRoute(
  pathname: string,
): { runId: string; pageId?: string | undefined } | undefined {
  const match = /^\/api\/runs\/([^/]+)\/browserbase\/replays(?:\/([^/]+))?$/u.exec(pathname)
  if (!match?.[1]) return undefined
  return {
    runId: decodeURIComponent(match[1]),
    ...(match[2] ? { pageId: decodeURIComponent(match[2]) } : {}),
  }
}

async function writeBrowserbaseReplayResponse(input: {
  response: ServerResponse
  env: NodeJS.ProcessEnv
  runId: string
  pageId?: string | undefined
  privateMediaByRun: Map<string, BrowserbasePrivateSessionMedia>
}): Promise<void> {
  const media = input.privateMediaByRun.get(input.runId)
  if (!media?.session_id) {
    writeJson(input.response, 404, {
      ok: false,
      error: 'browserbase_session_ref_not_available',
      run_id: input.runId,
    })
    return
  }
  const apiKey = input.env.BROWSERBASE_API_KEY
  if (!apiKey) {
    writeJson(input.response, 503, { ok: false, error: 'browserbase_api_key_not_configured' })
    return
  }

  const sessionId = encodeURIComponent(media.session_id)
  const pagePath = input.pageId ? `/${encodeURIComponent(input.pageId)}` : ''
  const upstreamUrl = `https://api.browserbase.com/v1/sessions/${sessionId}/replays${pagePath}`
  const upstream = await fetch(upstreamUrl, {
    headers: {
      'X-BB-API-Key': apiKey,
    },
  })
  const body = await upstream.text()
  if (!upstream.ok) {
    const detail = redactError(body.slice(0, 500)).split(media.session_id).join('[redacted-browserbase-session]')
    writeJson(input.response, upstream.status, {
      ok: false,
      error: 'browserbase_replay_fetch_failed',
      status: upstream.status,
      detail,
    })
    return
  }

  input.response.writeHead(upstream.status, {
    'content-type': input.pageId
      ? 'application/vnd.apple.mpegurl; charset=utf-8'
      : 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
  })
  input.response.end(body)
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

function writeTargetHtml(response: ServerResponse, html: string): void {
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'x-content-type-options': 'nosniff',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-embedder-policy': 'credentialless',
    'origin-agent-cluster': '?1',
  })
  response.end(html)
}

function writeNoFavicon(response: ServerResponse): void {
  response.writeHead(204, {
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  response.end()
}

function renderTargetApp(): string {
  const tools = JSON.stringify(webMcpTools())
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" href="data:," />
    <title>atrib action gate target</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f4f7fb;
        --nav: #081527;
        --nav-soft: #10233d;
        --panel: #ffffff;
        --text: #0f172a;
        --muted: #5d697b;
        --line: #d7dee8;
        --blue: #2458d3;
        --blue-soft: #e8efff;
        --green: #147a54;
        --green-soft: #e8f6ef;
        --amber: #946200;
        --amber-soft: #fff4dc;
        --shadow: 0 14px 34px rgba(15, 23, 42, 0.08);
      }
      * { box-sizing: border-box; }
      body {
        background: var(--bg);
        color: var(--text);
        font-family: "Geist", "Aptos", "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-variant-numeric: tabular-nums;
        -moz-osx-font-smoothing: grayscale;
        -webkit-font-smoothing: antialiased;
        margin: 0;
      }
      h1,
      h2,
      h3 {
        text-wrap: balance;
      }
      button,
      input,
      textarea {
        font: inherit;
      }
      button:focus-visible,
      a:focus-visible,
      textarea:focus-visible {
        outline: 3px solid rgba(36, 88, 211, 0.34);
        outline-offset: 2px;
      }
      .portal {
        display: grid;
        grid-template-columns: 182px minmax(0, 1fr);
        min-height: 760px;
      }
      .sidebar {
        background: linear-gradient(180deg, var(--nav), #07111f);
        color: #dce7f7;
        display: grid;
        grid-template-rows: auto 1fr auto;
        padding: 22px 18px;
      }
      .brand {
        display: grid;
        gap: 2px;
        margin-bottom: 24px;
      }
      h1 {
        color: #fff;
        font-size: 24px;
        letter-spacing: 0;
        line-height: 1;
        margin: 0;
      }
      .brand span,
      .user span,
      p {
        color: var(--muted);
        font-size: 14px;
        line-height: 1.45;
        margin: 0;
      }
      .brand span,
      .user span {
        color: #9fb0c7;
        font-size: 12px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      .nav {
        display: grid;
        gap: 8px;
        align-content: start;
      }
      .nav a,
      .user {
        align-items: center;
        border-radius: 8px;
        color: #dce7f7;
        display: flex;
        gap: 9px;
        min-height: 44px;
        min-width: 0;
        overflow: hidden;
        padding: 0 10px;
        text-decoration: none;
      }
      .user div {
        min-width: 0;
      }
      .user strong,
      .user span {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .nav a.active {
        background: #1e5dd8;
        color: #fff;
      }
      .nav .glyph,
      .user .avatar {
        align-items: center;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.16);
        border-radius: 999px;
        display: inline-flex;
        height: 22px;
        justify-content: center;
        width: 22px;
      }
      .workspace {
        display: grid;
        gap: 16px;
        padding: 22px;
      }
      .topline {
        align-items: center;
        display: flex;
        gap: 12px;
        justify-content: space-between;
      }
      .back-link {
        align-items: center;
        color: var(--blue);
        display: inline-flex;
        font-size: 13px;
        font-weight: 740;
        min-height: 44px;
        text-decoration: none;
      }
      .renewal-id {
        color: var(--muted);
        font-size: 12px;
      }
      .renewal-id strong {
        color: var(--text);
      }
      .page-title h2 {
        font-size: 24px;
        letter-spacing: 0;
        margin: 0;
      }
      .page-grid {
        display: grid;
        gap: 14px;
        grid-template-columns: minmax(0, 1fr) minmax(280px, 0.92fr);
      }
      .card {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 8px;
        box-shadow: var(--shadow);
        min-width: 0;
        padding: 16px;
        transition-duration: 260ms;
        transition-property: box-shadow, transform, border-color, background-color;
        transition-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
      }
      body[data-stage-step="observe"] section[aria-label="Risk assessment"],
      body[data-stage-step="observe"] section[aria-label="WebMCP tools"],
      body[data-stage-step="policy_decision"] section[aria-label="Approval action"],
      body[data-stage-step="act"] section[aria-label="Approval action"],
      body[data-stage-step="policy_outcome"] section[aria-label="Approval action"],
      body[data-stage-step="extract"] .confirmation {
        border-color: rgba(36, 88, 211, 0.42);
        box-shadow:
          0 0 0 3px rgba(36, 88, 211, 0.11),
          0 20px 44px rgba(15, 23, 42, 0.14);
        transform: translateY(-2px);
      }
      body[data-stage-step="act"] #approve-renewal {
        box-shadow: 0 0 0 5px rgba(20, 122, 84, 0.16);
      }
      body[data-stage-step="policy_decision"] #approve-renewal,
      body[data-stage-step="policy_outcome"] #approve-renewal {
        box-shadow: 0 0 0 5px rgba(36, 88, 211, 0.13);
      }
      .card h3 {
        font-size: 16px;
        margin: 0 0 14px;
      }
      .facts {
        display: grid;
        gap: 10px;
      }
      .facts div {
        align-items: center;
        display: flex;
        justify-content: space-between;
      }
      .facts span:first-child {
        color: #334155;
        font-size: 13px;
        font-weight: 760;
      }
      .facts span:last-child {
        font-size: 13px;
        text-align: right;
      }
      .risk-score {
        align-items: baseline;
        color: var(--green);
        display: flex;
        gap: 4px;
        font-size: 34px;
        font-weight: 760;
      }
      .risk-score small {
        color: var(--muted);
        font-size: 16px;
        font-weight: 500;
      }
      .status {
        align-items: center;
        background: var(--amber-soft);
        border: 1px solid #ffd894;
        border-radius: 999px;
        color: var(--amber);
        display: inline-flex;
        font-size: 12px;
        font-weight: 760;
        min-height: 26px;
        padding: 4px 9px;
        width: fit-content;
      }
      body[data-approved="true"] .status {
        background: var(--green-soft);
        border-color: #b6dfc9;
        color: var(--green);
      }
      .tool-list {
        display: grid;
        gap: 10px;
      }
      .tool {
        align-items: center;
        border: 1px solid var(--line);
        border-radius: 8px;
        display: grid;
        gap: 10px;
        grid-template-columns: 34px minmax(0, 1fr) auto;
        padding: 10px;
      }
      .tool::before {
        align-items: center;
        background: var(--blue-soft);
        border: 1px solid #bbccfb;
        border-radius: 8px;
        color: var(--blue);
        content: attr(data-index);
        display: inline-flex;
        font-size: 12px;
        font-weight: 780;
        height: 30px;
        justify-content: center;
        width: 30px;
      }
      .tool code {
        color: var(--text);
        display: block;
        font-size: 13px;
        font-weight: 760;
      }
      .tool p {
        font-size: 12px;
      }
      .tool button {
        background: #fff;
        border: 1px solid var(--line);
        color: var(--blue);
        min-height: 44px;
        padding: 0 9px;
      }
      .approval {
        display: grid;
        gap: 10px;
      }
      .policy-line {
        align-items: center;
        display: flex;
        gap: 8px;
        justify-content: space-between;
      }
      .policy-chip {
        background: var(--green-soft);
        border: 1px solid #b6dfc9;
        border-radius: 999px;
        color: var(--green);
        font-size: 12px;
        font-weight: 760;
        padding: 4px 9px;
      }
      textarea {
        border: 1px solid var(--line);
        border-radius: 8px;
        min-height: 64px;
        padding: 10px;
        resize: none;
        width: 100%;
      }
      button {
        background: var(--blue);
        border: 1px solid var(--blue);
        border-radius: 8px;
        color: white;
        cursor: pointer;
        font: inherit;
        font-weight: 760;
        min-height: 44px;
        padding: 0 14px;
        transition-duration: 160ms;
        transition-property: background-color, border-color, color, transform;
        transition-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
      }
      button.secondary {
        background: #fff;
        border-color: var(--line);
        color: var(--text);
      }
      button:active {
        transform: scale(0.97);
      }
      .actions {
        display: grid;
        gap: 10px;
        grid-template-columns: 1fr 0.72fr;
      }
      .confirmation {
        background: var(--green-soft);
        border: 1px solid #b6dfc9;
        border-radius: 8px;
        color: var(--green);
        display: none;
        padding: 10px;
      }
      body[data-approved="true"] .confirmation {
        display: block;
      }
      .footer {
        color: var(--muted);
        display: flex;
        font-size: 12px;
        gap: 18px;
        justify-content: center;
        padding: 8px;
      }
      @media (max-width: 760px) {
        .portal { grid-template-columns: 1fr; }
        .sidebar { display: none; }
        .workspace { padding: 16px; }
        .page-grid { grid-template-columns: 1fr; }
        .topline {
          align-items: start;
          display: grid;
          gap: 8px;
        }
        .tool {
          align-items: start;
          grid-template-columns: 34px minmax(0, 1fr);
        }
        .tool button {
          grid-column: 1 / -1;
          width: 100%;
        }
        .actions { grid-template-columns: 1fr; }
      }
      @media (prefers-reduced-motion: reduce) {
        *,
        *::before,
        *::after {
          animation-duration: 0.001ms !important;
          animation-iteration-count: 1 !important;
          scroll-behavior: auto !important;
          transition-duration: 0.001ms !important;
        }
      }
    </style>
  </head>
  <body data-approved="false" data-review-routed="false" data-stage-step="idle">
    <main class="portal">
      <aside class="sidebar" aria-label="Vendor portal navigation">
        <div>
          <div class="brand">
            <h1>Northstar</h1>
            <span>Vendor portal</span>
          </div>
          <nav class="nav">
            <a href="#"><span class="glyph">D</span><span>Dashboard</span></a>
            <a href="#"><span class="glyph">V</span><span>Vendors</span></a>
            <a class="active" href="#"><span class="glyph">R</span><span>Renewals</span></a>
            <a href="#"><span class="glyph">C</span><span>Contracts</span></a>
            <a href="#"><span class="glyph">S</span><span>Settings</span></a>
          </nav>
        </div>
        <div></div>
        <div class="user"><span class="avatar">M</span><div><strong>Mira Shah</strong><span>Procurement</span></div></div>
      </aside>
      <section class="workspace" aria-label="Vendor renewal workspace">
        <div class="topline">
          <a class="back-link" href="#">Back to renewals</a>
          <span class="renewal-id">Renewal ID <strong>NS-2026-447</strong></span>
        </div>
        <div class="page-title">
          <h2>Renewal details</h2>
        </div>
        <div class="page-grid">
          <section class="card" aria-label="Pending renewal">
            <div class="topline">
              <h3>Pending renewal</h3>
              <span id="approval-status" class="status">pending approval</span>
            </div>
            <div class="facts">
              <div><span>Vendor</span><span>Northstar Data Room</span></div>
              <div><span>Contract</span><span>MSA-2023-078</span></div>
              <div><span>Start date</span><span>Jun 1, 2025</span></div>
              <div><span>End date</span><span>May 31, 2026</span></div>
              <div><span>Contract value</span><span>$12,400</span></div>
              <div><span>Auto-renewal</span><span>Disabled</span></div>
            </div>
          </section>
          <section class="card" aria-label="Risk assessment">
            <h3>Risk assessment</h3>
            <div class="risk-score">32 <small>/100</small></div>
            <div class="facts">
              <div><span>Risk level</span><span class="policy-chip">Low risk</span></div>
              <div><span>Last assessed</span><span>May 20, 2026</span></div>
            </div>
          </section>
          <section class="card" aria-label="WebMCP tools">
            <h3>WebMCP tools <span class="renewal-id">Available to agent</span></h3>
            <div id="tool-list" class="tool-list"></div>
          </section>
          <section class="card approval" aria-label="Approval action">
            <h3>Approval</h3>
            <div class="policy-line"><strong>Policy</strong><span class="policy-chip">Auto-approval eligible</span></div>
            <p>Risk score below 40 and no policy exceptions.</p>
            <label>
              <strong>Notes (optional)</strong>
              <textarea placeholder="Add notes for the approval."></textarea>
            </label>
            <div class="actions">
              <button id="approve-renewal" type="button" data-webmcp-action="approve_vendor_renewal">Approve renewal</button>
              <button id="route-review" class="secondary" type="button" data-webmcp-action="request_human_review">Request review</button>
            </div>
            <div id="confirmation" class="confirmation" data-confirmation-id="atrib-browserbase-webmcp-001">
              Approved. Confirmation id: atrib-browserbase-webmcp-001
            </div>
          </section>
        </div>
        <div class="footer"><span>Privacy policy</span><span>Terms of service</span></div>
      </section>
    </main>
    <script type="application/json" id="atrib-webmcp-tools">${tools.replace(/</gu, '\\u003c')}</script>
    <script>
      const tools = JSON.parse(document.getElementById('atrib-webmcp-tools').textContent || '[]');
      window.__atribWebMcpTools = tools;

      function renewalSnapshot() {
        return {
          vendor: 'Northstar Data Room',
          renewal_id: 'NS-2026-447',
          risk_level: 'medium',
          amount_usd: 12400,
          status: document.body.dataset.approved === 'true' ? 'approved' : 'pending',
          confirmation_id:
            document.body.dataset.approved === 'true' ? 'atrib-browserbase-webmcp-001' : null,
        };
      }

      async function approveVendorRenewal() {
        document.body.dataset.approved = 'true';
        document.getElementById('approval-status').textContent = 'approved';
        return { status: 'approved', confirmation_id: 'atrib-browserbase-webmcp-001' };
      }

      async function requestHumanReview(input) {
        document.body.dataset.reviewRouted = 'true';
        document.getElementById('approval-status').textContent = 'human review requested';
        return { status: 'review_requested', routed_to: 'finance-ops', reason: input && input.reason ? input.reason : 'operator request' };
      }

      const handlers = {
        read_vendor_risk: renewalSnapshot,
        approve_vendor_renewal: approveVendorRenewal,
        request_human_review: requestHumanReview,
      };

      function renderTools() {
        document.getElementById('tool-list').innerHTML = tools.map((tool, index) =>
          '<div class="tool" data-index="' +
          escapeHtml(String(index + 1)) +
          '"><div><code>' +
          escapeHtml(tool.name) +
          '</code><p>' +
          escapeHtml(tool.description) +
          '</p></div><button type="button" data-tool-preview="' +
          escapeHtml(tool.name) +
          '">Use tool</button></div>'
        ).join('');
      }

      async function registerNativeWebMcp() {
        const modelContext = document.modelContext;
        if (!modelContext || typeof modelContext.registerTool !== 'function') {
          document.body.dataset.webmcp = 'manifest-fallback';
          return;
        }
        for (const tool of tools) {
          await modelContext.registerTool({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.input_schema,
            outputSchema: tool.output_schema,
            execute: handlers[tool.name],
          });
        }
        document.body.dataset.webmcp = 'native-registered';
      }

      function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
      }

      document.getElementById('approve-renewal').addEventListener('click', () => {
        void approveVendorRenewal();
      });
      document.getElementById('route-review').addEventListener('click', () => {
        void requestHumanReview({ reason: 'manual target-page click' });
      });
      renderTools();
      void registerNativeWebMcp();
    </script>
  </body>
</html>`
}

function renderApp(): string {
  return renderBrowserbaseProofApp()
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
