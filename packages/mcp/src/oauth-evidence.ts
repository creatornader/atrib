// SPDX-License-Identifier: Apache-2.0

import { base64urlEncode } from './base64url.js'
import { sha256 } from './hash.js'

export interface CapturedOAuthAccessTokenClaims {
  iss?: string
  sub?: string
  aud?: string | string[]
  exp?: number
  iat?: number
  nbf?: number
  jti?: string
  client_id?: string
  scope?: string
  scp?: string | string[]
  resource?: string | string[]
  authorization_details?: unknown
  cnf?: {
    jkt?: string
    jwk?: unknown
    [key: string]: unknown
  }
  act?: { sub?: string; [key: string]: unknown }
  may_act?: { sub?: string; [key: string]: unknown }
}

export interface CapturedOAuthProtectedResourceMetadata {
  resource?: string
  authorization_servers?: string[]
  scopes_supported?: string[]
}

export interface CapturedOAuthAuthorizationDetailConstraint {
  type: string
  actions?: string[]
  locations?: string[]
}

export interface CapturedDpopProofEvidence {
  proofJwt: string
  method: string
  url: string
  expectedAth?: string
  expectedNonce?: string
  requiredCnfJkt?: string
  nowSeconds?: number
  maxAgeSeconds?: number
  clockSkewSeconds?: number
}

export interface CapturedMcpOAuthEvidence {
  protocol: 'mcp_oauth'
  claimsVerified: true
  claims: CapturedOAuthAccessTokenClaims
  token_hash?: string
  protectedResourceMetadata?: CapturedOAuthProtectedResourceMetadata
  requiredScopes?: string[]
  requiredAuthorizationDetails?: CapturedOAuthAuthorizationDetailConstraint[]
  issuer?: string
  audience?: string | string[]
  resource?: string
  expectedSubject?: string
  expectedClientId?: string
  expectedActorSubject?: string
  requiredCnfJkt?: string
  requireCnf?: boolean
  dpopProof?: CapturedDpopProofEvidence
}

export interface McpOAuthEvidenceCaptureOptions {
  requiredScopes?: string[]
  requiredAuthorizationDetails?: CapturedOAuthAuthorizationDetailConstraint[]
  protectedResourceMetadata?: CapturedOAuthProtectedResourceMetadata
  issuer?: string
  audience?: string | string[]
  resource?: string
  expectedSubject?: string
  expectedClientId?: string
  expectedActorSubject?: string
  requiredCnfJkt?: string
  requireCnf?: boolean
  claimSource?: 'minimal' | 'extraClaims'
  includeTokenHash?: boolean
  includeDpopProof?: boolean
  requestMethod?: string
  expectedDpopNonce?: string
  dpopNowSeconds?: number
  dpopMaxAgeSeconds?: number
  dpopClockSkewSeconds?: number
}

interface McpAuthInfoLike {
  token?: string
  clientId?: string
  scopes?: string[]
  expiresAt?: number
  resource?: URL | string
  extra?: Record<string, unknown>
}

interface McpRequestInfoLike {
  headers?: unknown
  url?: URL | string
}

export interface McpRequestExtraLike {
  authInfo?: McpAuthInfoLike
  requestInfo?: McpRequestInfoLike
}

export interface McpOAuthEvidenceCaptureContext {
  serverUrl: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function tokenHash(token: string): string {
  return `sha256:${base64urlEncode(sha256(new TextEncoder().encode(token)))}`
}

function dpopAth(token: string): string {
  return base64urlEncode(sha256(new TextEncoder().encode(token)))
}

function headerValue(headers: unknown, name: string): string | undefined {
  if (!headers) return undefined
  const lowerName = name.toLowerCase()
  const maybeGet = (headers as { get?: unknown }).get
  if (typeof maybeGet === 'function') {
    const value = maybeGet.call(headers, name) ?? maybeGet.call(headers, lowerName)
    return typeof value === 'string' ? value : undefined
  }
  if (Array.isArray(headers)) {
    const found = headers.find(
      (entry): entry is [string, string] =>
        Array.isArray(entry) &&
        typeof entry[0] === 'string' &&
        typeof entry[1] === 'string' &&
        entry[0].toLowerCase() === lowerName,
    )
    return found?.[1]
  }
  const record = asRecord(headers)
  if (!record) return undefined
  const key = Object.keys(record).find((candidate) => candidate.toLowerCase() === lowerName)
  const value = key ? record[key] : undefined
  return typeof value === 'string' ? value : undefined
}

function copyStringClaim(
  out: CapturedOAuthAccessTokenClaims,
  source: Record<string, unknown>,
  key: keyof CapturedOAuthAccessTokenClaims,
): void {
  const value = source[key]
  if (typeof value === 'string') {
    ;(out as Record<string, unknown>)[key] = value
  }
}

function copyNumberClaim(
  out: CapturedOAuthAccessTokenClaims,
  source: Record<string, unknown>,
  key: keyof CapturedOAuthAccessTokenClaims,
): void {
  const value = source[key]
  if (typeof value === 'number' && Number.isFinite(value)) {
    ;(out as Record<string, unknown>)[key] = value
  }
}

function copyStructuredClaim(
  out: CapturedOAuthAccessTokenClaims,
  source: Record<string, unknown>,
  key: keyof CapturedOAuthAccessTokenClaims,
): void {
  const value = source[key]
  if (value !== undefined) {
    ;(out as Record<string, unknown>)[key] = value
  }
}

function claimsFromAuthInfo(
  authInfo: McpAuthInfoLike,
  options: McpOAuthEvidenceCaptureOptions,
): CapturedOAuthAccessTokenClaims {
  const claims: CapturedOAuthAccessTokenClaims = {}
  if (typeof authInfo.clientId === 'string') claims.client_id = authInfo.clientId
  if (Array.isArray(authInfo.scopes)) claims.scope = authInfo.scopes.join(' ')
  if (typeof authInfo.expiresAt === 'number') claims.exp = authInfo.expiresAt
  if (authInfo.resource) claims.resource = String(authInfo.resource)

  if (options.claimSource === 'extraClaims') {
    const extraClaims = asRecord(authInfo.extra?.['claims'])
    if (extraClaims) {
      copyStringClaim(claims, extraClaims, 'iss')
      copyStringClaim(claims, extraClaims, 'sub')
      copyStringClaim(claims, extraClaims, 'jti')
      copyNumberClaim(claims, extraClaims, 'exp')
      copyNumberClaim(claims, extraClaims, 'iat')
      copyNumberClaim(claims, extraClaims, 'nbf')
      copyStringClaim(claims, extraClaims, 'client_id')
      copyStringClaim(claims, extraClaims, 'scope')
      copyStructuredClaim(claims, extraClaims, 'scp')
      copyStructuredClaim(claims, extraClaims, 'aud')
      copyStructuredClaim(claims, extraClaims, 'resource')
      copyStructuredClaim(claims, extraClaims, 'authorization_details')
      copyStructuredClaim(claims, extraClaims, 'cnf')
      copyStructuredClaim(claims, extraClaims, 'act')
      copyStructuredClaim(claims, extraClaims, 'may_act')
    }
  }

  return claims
}

function normalizeCaptureOptions(
  capture: boolean | McpOAuthEvidenceCaptureOptions | undefined,
): McpOAuthEvidenceCaptureOptions | null {
  if (capture === true) return {}
  if (capture && typeof capture === 'object') return capture
  return null
}

export function buildMcpOAuthEvidenceFromExtra(
  extra: unknown,
  capture: boolean | McpOAuthEvidenceCaptureOptions | undefined,
  context: McpOAuthEvidenceCaptureContext,
): CapturedMcpOAuthEvidence | undefined {
  const options = normalizeCaptureOptions(capture)
  if (!options) return undefined

  const extraRecord = asRecord(extra)
  const authInfo = asRecord(extraRecord?.['authInfo']) as McpAuthInfoLike | null
  if (!authInfo) return undefined

  const requestInfo = asRecord(extraRecord?.['requestInfo']) as McpRequestInfoLike | null
  const claims = claimsFromAuthInfo(authInfo, options)
  const resource = options.resource ?? (authInfo.resource ? String(authInfo.resource) : undefined)
  const protectedResourceMetadata =
    options.protectedResourceMetadata ?? (resource ? { resource } : undefined)
  const expectedClientId = options.expectedClientId ?? authInfo.clientId

  const evidence: CapturedMcpOAuthEvidence = {
    protocol: 'mcp_oauth',
    claimsVerified: true,
    claims,
    ...(resource ? { resource } : {}),
    ...(protectedResourceMetadata ? { protectedResourceMetadata } : {}),
    ...(expectedClientId ? { expectedClientId } : {}),
    ...(options.requiredScopes ? { requiredScopes: options.requiredScopes } : {}),
    ...(options.requiredAuthorizationDetails
      ? { requiredAuthorizationDetails: options.requiredAuthorizationDetails }
      : {}),
    ...(options.issuer ? { issuer: options.issuer } : {}),
    ...(options.audience ? { audience: options.audience } : {}),
    ...(options.expectedSubject ? { expectedSubject: options.expectedSubject } : {}),
    ...(options.expectedActorSubject ? { expectedActorSubject: options.expectedActorSubject } : {}),
    ...(options.requireCnf ? { requireCnf: options.requireCnf } : {}),
  }

  const cnf = asRecord(claims.cnf)
  const claimJkt = typeof cnf?.['jkt'] === 'string' ? cnf['jkt'] : undefined
  const requiredCnfJkt = options.requiredCnfJkt ?? claimJkt
  if (requiredCnfJkt) evidence.requiredCnfJkt = requiredCnfJkt

  if (options.includeTokenHash !== false && typeof authInfo.token === 'string') {
    evidence.token_hash = tokenHash(authInfo.token)
  }

  if (options.includeDpopProof) {
    const proofJwt = headerValue(requestInfo?.headers, 'dpop')
    const url = requestInfo?.url ? String(requestInfo.url) : (resource ?? context.serverUrl)
    if (proofJwt && url) {
      const dpopProof: CapturedDpopProofEvidence = {
        proofJwt,
        method: options.requestMethod ?? 'POST',
        url,
        ...(typeof authInfo.token === 'string' ? { expectedAth: dpopAth(authInfo.token) } : {}),
        ...(options.expectedDpopNonce ? { expectedNonce: options.expectedDpopNonce } : {}),
        ...(requiredCnfJkt ? { requiredCnfJkt } : {}),
        nowSeconds: options.dpopNowSeconds ?? Math.floor(Date.now() / 1000),
        ...(options.dpopMaxAgeSeconds !== undefined
          ? { maxAgeSeconds: options.dpopMaxAgeSeconds }
          : {}),
        ...(options.dpopClockSkewSeconds !== undefined
          ? { clockSkewSeconds: options.dpopClockSkewSeconds }
          : {}),
      }
      evidence.dpopProof = dpopProof
    }
  }

  return evidence
}
