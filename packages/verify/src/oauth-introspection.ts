// SPDX-License-Identifier: Apache-2.0

import type {
  OAuthAuthorizationEvidenceInput,
  OAuthTokenIntrospectionResponse,
} from './authorization-evidence.js'

export type OAuthIntrospectionClientAuthentication =
  | { method: 'none' }
  | { method: 'basic'; clientId: string; clientSecret: string }
  | { method: 'bearer'; token: string }
  | { method: 'headers'; headers: Record<string, string> }

export interface OAuthIntrospectionOptions {
  endpoint: string
  token: string
  tokenTypeHint?: string
  clientAuthentication?: OAuthIntrospectionClientAuthentication
  extraParams?: Record<string, string>
  expectedIssuer?: string
  expectedAudience?: string | string[]
  expectedResource?: string
  timeoutMs?: number
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

export interface OAuthIntrospectionResult {
  ok: boolean
  endpoint: string
  introspection?: OAuthTokenIntrospectionResponse
  introspectionVerified: boolean
  errors: string[]
  warnings: string[]
}

export async function introspectOAuthToken(
  options: OAuthIntrospectionOptions,
): Promise<OAuthIntrospectionResult> {
  const errors: string[] = []
  const warnings: string[] = []
  const fetchImpl = options.fetchImpl ?? fetch
  const body = new URLSearchParams()
  body.set('token', options.token)
  if (options.tokenTypeHint) body.set('token_type_hint', options.tokenTypeHint)
  for (const [key, value] of Object.entries(options.extraParams ?? {})) {
    if (key === 'token') continue
    body.set(key, value)
  }

  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/x-www-form-urlencoded',
  }
  applyClientAuthentication(headers, options.clientAuthentication)

  const ctrl = options.signal ? undefined : new AbortController()
  const timer =
    ctrl && options.timeoutMs !== undefined
      ? setTimeout(() => ctrl.abort(), options.timeoutMs)
      : undefined

  try {
    const requestInit: RequestInit = {
      method: 'POST',
      headers,
      body,
      ...(options.signal || ctrl?.signal ? { signal: options.signal ?? ctrl?.signal ?? null } : {}),
    }
    const response = await fetchImpl(options.endpoint, requestInit)
    if (!response.ok) {
      errors.push(`introspection endpoint returned ${response.status}`)
      return result(options.endpoint, undefined, errors, warnings)
    }
    const parsed = (await response.json()) as unknown
    if (!isIntrospectionResponse(parsed)) {
      errors.push('introspection response missing boolean active field')
      return result(options.endpoint, undefined, errors, warnings)
    }
    validateExpectedClaims(parsed, options, errors)
    return result(options.endpoint, parsed, errors, warnings)
  } catch (err) {
    errors.push(`introspection request failed: ${err instanceof Error ? err.message : String(err)}`)
    return result(options.endpoint, undefined, errors, warnings)
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export function oauthEvidenceFromIntrospectionResult(
  introspection: OAuthIntrospectionResult,
  base: Omit<OAuthAuthorizationEvidenceInput, 'introspection' | 'introspectionVerified'> = {},
): OAuthAuthorizationEvidenceInput {
  if (!introspection.introspection) {
    throw new Error('introspection result has no response body')
  }
  return {
    ...base,
    introspection: introspection.introspection,
    introspectionVerified: introspection.introspectionVerified,
  }
}

function applyClientAuthentication(
  headers: Record<string, string>,
  authentication: OAuthIntrospectionClientAuthentication | undefined,
): void {
  if (!authentication || authentication.method === 'none') return
  if (authentication.method === 'basic') {
    headers.authorization = `Basic ${Buffer.from(
      `${authentication.clientId}:${authentication.clientSecret}`,
    ).toString('base64')}`
    return
  }
  if (authentication.method === 'bearer') {
    headers.authorization = `Bearer ${authentication.token}`
    return
  }
  for (const [key, value] of Object.entries(authentication.headers)) {
    headers[key.toLowerCase()] = value
  }
}

function validateExpectedClaims(
  response: OAuthTokenIntrospectionResponse,
  options: OAuthIntrospectionOptions,
  errors: string[],
): void {
  if (options.expectedIssuer && response.iss !== options.expectedIssuer) {
    errors.push('introspection issuer mismatch')
  }
  const expectedAudience = asArray(options.expectedAudience)
  if (expectedAudience.length > 0) {
    const actualAudience = asArray(response.aud)
    const missing = expectedAudience.filter((entry) => !actualAudience.includes(entry))
    if (missing.length > 0) errors.push(`introspection audience missing: ${missing.join(', ')}`)
  }
  if (options.expectedResource) {
    const actualResources = asArray(response.resource)
    if (!actualResources.includes(options.expectedResource)) {
      errors.push('introspection resource mismatch')
    }
  }
}

function result(
  endpoint: string,
  introspection: OAuthTokenIntrospectionResponse | undefined,
  errors: string[],
  warnings: string[],
): OAuthIntrospectionResult {
  return {
    ok: introspection !== undefined && errors.length === 0,
    endpoint,
    ...(introspection ? { introspection } : {}),
    introspectionVerified: introspection !== undefined && errors.length === 0,
    errors,
    warnings,
  }
}

function isIntrospectionResponse(value: unknown): value is OAuthTokenIntrospectionResponse {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && 'active' in value
    ? typeof (value as { active?: unknown }).active === 'boolean'
    : false
}

function asArray(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value))
    return value.filter((entry): entry is string => typeof entry === 'string')
  return []
}
