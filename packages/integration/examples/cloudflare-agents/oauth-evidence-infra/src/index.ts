// SPDX-License-Identifier: Apache-2.0

import { DurableObject } from 'cloudflare:workers'

export interface Env {
  DPOP_REPLAY_CACHE: DurableObjectNamespace<DpopReplayCacheDurableObject>
  DPOP_REPLAY_CACHE_BEARER_TOKEN?: string
  INTROSPECTION_PROXY_BEARER_TOKEN?: string
  OAUTH_INTROSPECTION_ENDPOINT?: string
  OAUTH_INTROSPECTION_AUTH_MODE?: 'none' | 'basic' | 'bearer'
  OAUTH_INTROSPECTION_CLIENT_ID?: string
  OAUTH_INTROSPECTION_CLIENT_SECRET?: string
  OAUTH_INTROSPECTION_BEARER_TOKEN?: string
  EXPECTED_ISSUER?: string
  EXPECTED_AUDIENCE?: string
  EXPECTED_RESOURCE?: string
  ENABLE_TEST_UPSTREAM?: string
}

export interface DpopReplayCacheRequest {
  key_id: string
  key: Record<string, unknown>
  expires_at_seconds: number
}

export interface DpopReplayCacheResponse {
  accepted: boolean
}

interface IntrospectionResponse {
  active: boolean
  [key: string]: unknown
}

interface ProblemBody {
  error: string
  detail?: string
  errors?: string[]
}

const JSON_TYPE = 'application/json; charset=utf-8'
const MAX_JSON_BODY_BYTES = 16 * 1024
const MAX_FORM_BODY_BYTES = 16 * 1024
const MAX_INTROSPECTION_RESPONSE_BYTES = 64 * 1024
const INTROSPECTION_TIMEOUT_MS = 5000
const REPLAY_SHARD_HEX = 16
const BEARER_PREFIX = 'Bearer '

export class DpopReplayCacheDurableObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS dpop_replay_entries (
          key_id TEXT PRIMARY KEY,
          key_json TEXT NOT NULL,
          expires_at_seconds INTEGER NOT NULL,
          remembered_at_ms INTEGER NOT NULL
        )
      `)
      this.ctx.storage.sql.exec(`
        CREATE INDEX IF NOT EXISTS idx_dpop_replay_expires
        ON dpop_replay_entries (expires_at_seconds)
      `)
    })
  }

  checkAndRemember(input: DpopReplayCacheRequest): DpopReplayCacheResponse {
    const nowSeconds = Math.floor(Date.now() / 1000)
    this.ctx.storage.sql.exec(
      'DELETE FROM dpop_replay_entries WHERE expires_at_seconds <= ?',
      nowSeconds,
    )

    const existing = this.ctx.storage.sql
      .exec<{
        expires_at_seconds: number
      }>('SELECT expires_at_seconds FROM dpop_replay_entries WHERE key_id = ?', input.key_id)
      .toArray()[0]

    if (existing && existing.expires_at_seconds > nowSeconds) {
      return { accepted: false }
    }

    this.ctx.storage.sql.exec(
      `
        INSERT OR REPLACE INTO dpop_replay_entries
          (key_id, key_json, expires_at_seconds, remembered_at_ms)
        VALUES (?, ?, ?, ?)
      `,
      input.key_id,
      JSON.stringify(input.key),
      Math.max(input.expires_at_seconds, nowSeconds + 1),
      Date.now(),
    )
    return { accepted: true }
  }

  countEntries(): number {
    const row = this.ctx.storage.sql
      .exec<{ count: number }>('SELECT COUNT(*) AS count FROM dpop_replay_entries')
      .toArray()[0]
    return row?.count ?? 0
  }
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url)
      if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
        return jsonResponse({
          ok: true,
          service: 'atrib-cloudflare-oauth-evidence-infra',
          endpoints: ['/v1/dpop/check', '/v1/oauth/introspect'],
        })
      }

      if (request.method === 'POST' && url.pathname === '/v1/dpop/check') {
        return handleDpopCheck(request, env)
      }

      if (request.method === 'POST' && url.pathname === '/v1/oauth/introspect') {
        return handleIntrospectionProxy(request, env, ctx)
      }

      return problem(404, { error: 'not_found' })
    } catch {
      return problem(500, { error: 'internal_error' })
    }
  },
}

export default worker

async function handleDpopCheck(request: Request, env: Env): Promise<Response> {
  if (!requireBearer(request, env.DPOP_REPLAY_CACHE_BEARER_TOKEN)) {
    return problem(401, { error: 'unauthorized' })
  }

  const body = await readJson(request, MAX_JSON_BODY_BYTES)
  if (!isDpopReplayCacheRequest(body)) {
    return problem(400, { error: 'invalid_replay_cache_request' })
  }

  const nowSeconds = Math.floor(Date.now() / 1000)
  if (body.expires_at_seconds <= nowSeconds) {
    return problem(400, { error: 'expired_replay_cache_request' })
  }

  const shard = await shardName(body.key_id)
  const id = env.DPOP_REPLAY_CACHE.idFromName(shard)
  const stub = env.DPOP_REPLAY_CACHE.get(id)
  const result = await stub.checkAndRemember(body)
  return jsonResponse(result)
}

async function handleIntrospectionProxy(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (!requireBearer(request, env.INTROSPECTION_PROXY_BEARER_TOKEN)) {
    return problem(401, { error: 'unauthorized' })
  }
  if (!env.OAUTH_INTROSPECTION_ENDPOINT) {
    return problem(503, { error: 'introspection_endpoint_not_configured' })
  }

  const form = new URLSearchParams(await readBoundedText(request, MAX_FORM_BODY_BYTES))
  const token = form.get('token')
  if (!token) return problem(400, { error: 'missing_token' })

  const upstream = await fetchIntrospectionResponse(form, env)
  if (!upstream.response) {
    return problem(upstream.status, { error: upstream.error, detail: upstream.detail })
  }

  const sanitized = sanitizeIntrospectionResponse(upstream.response)
  const expectationErrors = validateExpectedClaims(sanitized, env)
  if (expectationErrors.length > 0) {
    return problem(502, {
      error: 'introspection_expectation_mismatch',
      errors: expectationErrors,
    })
  }

  ctx.waitUntil(Promise.resolve())
  return jsonResponse(sanitized)
}

async function fetchIntrospectionResponse(
  form: URLSearchParams,
  env: Env,
): Promise<
  | { response: IntrospectionResponse; status: 200 }
  | { response?: undefined; status: number; error: string; detail?: string }
> {
  if (env.ENABLE_TEST_UPSTREAM === '1' && env.OAUTH_INTROSPECTION_ENDPOINT === 'test-fixture') {
    return { status: 200, response: testIntrospectionFixture(form) }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), INTROSPECTION_TIMEOUT_MS)
  try {
    const response = await fetch(env.OAUTH_INTROSPECTION_ENDPOINT!, {
      method: 'POST',
      headers: introspectionHeaders(env),
      body: form,
      signal: controller.signal,
    })
    if (!response.ok) {
      return {
        status: 502,
        error: 'introspection_endpoint_error',
        detail: `upstream returned ${response.status}`,
      }
    }
    const parsed = JSON.parse(await readBoundedText(response, MAX_INTROSPECTION_RESPONSE_BYTES))
    if (!isIntrospectionResponse(parsed)) {
      return { status: 502, error: 'invalid_introspection_response' }
    }
    return { status: 200, response: parsed }
  } catch {
    return {
      status: 502,
      error: 'introspection_request_failed',
    }
  } finally {
    clearTimeout(timeout)
  }
}

function introspectionHeaders(env: Env): Record<string, string> {
  const headers: Record<string, string> = {
    accept: JSON_TYPE,
    'content-type': 'application/x-www-form-urlencoded',
  }
  const mode = env.OAUTH_INTROSPECTION_AUTH_MODE ?? 'none'
  if (mode === 'basic') {
    if (!env.OAUTH_INTROSPECTION_CLIENT_ID || !env.OAUTH_INTROSPECTION_CLIENT_SECRET) {
      throw new Error('basic introspection auth requires client id and secret')
    }
    headers.authorization = `Basic ${btoa(
      `${env.OAUTH_INTROSPECTION_CLIENT_ID}:${env.OAUTH_INTROSPECTION_CLIENT_SECRET}`,
    )}`
  } else if (mode === 'bearer') {
    if (!env.OAUTH_INTROSPECTION_BEARER_TOKEN) {
      throw new Error('bearer introspection auth requires bearer token')
    }
    headers.authorization = `Bearer ${env.OAUTH_INTROSPECTION_BEARER_TOKEN}`
  }
  return headers
}

function testIntrospectionFixture(form: URLSearchParams): IntrospectionResponse {
  return {
    active: true,
    iss: 'https://issuer.example',
    aud: 'mcp-client',
    resource: 'mcp://files.example',
    scope: 'files.read files.write',
    sub: 'agent-123',
    client_id: 'mcp-client',
    exp: 1_893_456_000,
    token: form.get('token'),
    access_token: form.get('token'),
  }
}

function sanitizeIntrospectionResponse(response: IntrospectionResponse): IntrospectionResponse {
  const sanitized: IntrospectionResponse = { ...response }
  delete sanitized.token
  delete sanitized.access_token
  delete sanitized.refresh_token
  delete sanitized.id_token
  return sanitized
}

function validateExpectedClaims(response: IntrospectionResponse, env: Env): string[] {
  const errors: string[] = []
  if (env.EXPECTED_ISSUER && response.iss !== env.EXPECTED_ISSUER) {
    errors.push('issuer mismatch')
  }
  if (env.EXPECTED_AUDIENCE) {
    const audience = asStringArray(response.aud)
    if (!audience.includes(env.EXPECTED_AUDIENCE)) errors.push('audience mismatch')
  }
  if (env.EXPECTED_RESOURCE) {
    const resources = asStringArray(response.resource)
    if (!resources.includes(env.EXPECTED_RESOURCE)) errors.push('resource mismatch')
  }
  return errors
}

async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  const text = await readBoundedText(request, maxBytes)
  return JSON.parse(text)
}

async function readBoundedText(source: Request | Response, maxBytes: number): Promise<string> {
  const reader = source.body?.getReader()
  if (!reader) return ''
  const decoder = new TextDecoder()
  let text = ''
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) throw new Error('request body too large')
    text += decoder.decode(value, { stream: true })
  }
  text += decoder.decode()
  return text
}

function requireBearer(request: Request, expected: string | undefined): boolean {
  if (!expected) return false
  const actual = request.headers.get('authorization')
  if (!actual?.startsWith(BEARER_PREFIX)) return false
  return constantTimeEqual(actual.slice(BEARER_PREFIX.length), expected)
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a)
  const right = new TextEncoder().encode(b)
  let diff = left.length ^ right.length
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0)
  }
  return diff === 0
}

async function shardName(keyId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(keyId))
  return `dpop:${hex(new Uint8Array(digest)).slice(0, REPLAY_SHARD_HEX)}`
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers: {
      'content-type': JSON_TYPE,
      ...init.headers,
    },
  })
}

function problem(status: number, body: ProblemBody): Response {
  return jsonResponse(body, { status })
}

function isDpopReplayCacheRequest(value: unknown): value is DpopReplayCacheRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const input = value as Partial<DpopReplayCacheRequest>
  return (
    typeof input.key_id === 'string' &&
    input.key_id.length > 0 &&
    input.key_id.length <= 4096 &&
    input.key !== null &&
    typeof input.key === 'object' &&
    !Array.isArray(input.key) &&
    Number.isInteger(input.expires_at_seconds)
  )
}

function isIntrospectionResponse(value: unknown): value is IntrospectionResponse {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof (value as { active?: unknown }).active === 'boolean'
  )
}

function asStringArray(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value))
    return value.filter((entry): entry is string => typeof entry === 'string')
  return []
}
