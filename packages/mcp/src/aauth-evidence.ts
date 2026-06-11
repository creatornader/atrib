// SPDX-License-Identifier: Apache-2.0

import { base64urlDecode, base64urlEncode } from './base64url.js'
import { sha256 } from './hash.js'

export type CapturedAAuthAccessMode = 'agent-token' | 'aauth-access-token' | 'auth-token'
export type CapturedAAuthTokenKind = 'agent_token' | 'resource_token' | 'auth_token'

export interface CapturedAAuthTokenClaims {
  iss?: string
  sub?: string
  aud?: string | string[]
  exp?: number
  iat?: number
  nbf?: number
  jti?: string
  dwk?: string
  agent?: string
  agent_jkt?: string
  scope?: string | string[]
  resource?: string | string[]
  cnf?: {
    jwk?: unknown
    jkt?: string
    [key: string]: unknown
  }
  act?: { sub?: string; act?: unknown; [key: string]: unknown }
  mission?: { approver?: string; s256?: string; [key: string]: unknown }
  tenant?: string
  ps?: string
  parent_agent?: string
  r3_uri?: string
  r3_s256?: string
  r3_granted?: string[]
  r3_conditional?: unknown
}

export interface CapturedAAuthMissionClaim {
  approver?: string
  s256?: string
  [key: string]: unknown
}

export interface CapturedAAuthResourceMetadataEvidence {
  issuer?: string
  resource?: string
  access_mode?: CapturedAAuthAccessMode
}

export interface CapturedAAuthHttpSignatureEvidence {
  verified?: boolean
  scheme?: string
  coveredComponents?: string[]
  signingKeyJkt?: string
}

export interface CapturedAAuthR3Evidence {
  uri?: string
  s256?: string
  expectedS256?: string
  documentHashVerified?: boolean
  granted?: string[]
  conditional?: unknown
}

export interface CapturedAAuthEvidence {
  protocol: 'aauth'
  tokenKind?: CapturedAAuthTokenKind
  accessMode?: CapturedAAuthAccessMode
  claimsVerified: boolean
  claims: CapturedAAuthTokenClaims
  token_hash?: string
  issuer?: string
  audience?: string | string[]
  resource?: string
  resourceMetadata?: CapturedAAuthResourceMetadataEvidence
  requiredScopes?: string[]
  expectedAgent?: string
  expectedSubject?: string
  expectedActSubject?: string
  requireAct?: boolean
  expectedCnfJkt?: string
  expectedAgentJkt?: string
  expectedParentAgent?: string
  requiredMission?: CapturedAAuthMissionClaim
  httpSignature?: CapturedAAuthHttpSignatureEvidence
  r3?: CapturedAAuthR3Evidence
}

export interface AAuthEvidenceCaptureOptions {
  tokenKind?: CapturedAAuthTokenKind
  accessMode?: CapturedAAuthAccessMode
  claimsVerified?: boolean
  includeTokenHash?: boolean
  issuer?: string
  audience?: string | string[]
  resource?: string
  resourceMetadata?: CapturedAAuthResourceMetadataEvidence
  requiredScopes?: string[]
  expectedAgent?: string
  expectedSubject?: string
  expectedActSubject?: string
  requireAct?: boolean
  expectedCnfJkt?: string
  expectedAgentJkt?: string
  expectedParentAgent?: string
  requiredMission?: CapturedAAuthMissionClaim
  httpSignatureVerified?: boolean
  signingKeyJkt?: string
  r3?: CapturedAAuthR3Evidence
}

const MAX_SIGNATURE_METADATA_LENGTH = 4096

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function tokenHash(token: string): string {
  return `sha256:${base64urlEncode(sha256(new TextEncoder().encode(token)))}`
}

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split('.')
  const payload = parts[1]
  if (!payload) return null
  try {
    const json = new TextDecoder().decode(base64urlDecode(payload))
    return asRecord(JSON.parse(json))
  } catch {
    return null
  }
}

function copyStringClaim(
  out: CapturedAAuthTokenClaims,
  source: Record<string, unknown>,
  key: keyof CapturedAAuthTokenClaims,
): void {
  const value = source[key]
  if (typeof value === 'string') {
    ;(out as Record<string, unknown>)[key] = value
  }
}

function copyNumberClaim(
  out: CapturedAAuthTokenClaims,
  source: Record<string, unknown>,
  key: keyof CapturedAAuthTokenClaims,
): void {
  const value = source[key]
  if (typeof value === 'number' && Number.isFinite(value)) {
    ;(out as Record<string, unknown>)[key] = value
  }
}

function copyStructuredClaim(
  out: CapturedAAuthTokenClaims,
  source: Record<string, unknown>,
  key: keyof CapturedAAuthTokenClaims,
): void {
  const value = source[key]
  if (value !== undefined) {
    ;(out as Record<string, unknown>)[key] = value
  }
}

function copyAAuthClaims(source: Record<string, unknown>): CapturedAAuthTokenClaims {
  const claims: CapturedAAuthTokenClaims = {}
  copyStringClaim(claims, source, 'iss')
  copyStringClaim(claims, source, 'sub')
  copyStructuredClaim(claims, source, 'aud')
  copyNumberClaim(claims, source, 'exp')
  copyNumberClaim(claims, source, 'iat')
  copyNumberClaim(claims, source, 'nbf')
  copyStringClaim(claims, source, 'jti')
  copyStringClaim(claims, source, 'dwk')
  copyStringClaim(claims, source, 'agent')
  copyStringClaim(claims, source, 'agent_jkt')
  copyStructuredClaim(claims, source, 'scope')
  copyStructuredClaim(claims, source, 'resource')
  copyStructuredClaim(claims, source, 'cnf')
  copyStructuredClaim(claims, source, 'act')
  copyStructuredClaim(claims, source, 'mission')
  copyStringClaim(claims, source, 'tenant')
  copyStringClaim(claims, source, 'ps')
  copyStringClaim(claims, source, 'parent_agent')
  copyStringClaim(claims, source, 'r3_uri')
  copyStringClaim(claims, source, 'r3_s256')
  copyStructuredClaim(claims, source, 'r3_granted')
  copyStructuredClaim(claims, source, 'r3_conditional')
  return claims
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

function boundedSignatureMetadata(value: string | undefined): string | undefined {
  if (!value) return undefined
  return value.length > MAX_SIGNATURE_METADATA_LENGTH
    ? value.slice(0, MAX_SIGNATURE_METADATA_LENGTH)
    : value
}

function isAsciiWhitespace(charCode: number): boolean {
  return (
    charCode === 9 ||
    charCode === 10 ||
    charCode === 11 ||
    charCode === 12 ||
    charCode === 13 ||
    charCode === 32
  )
}

function splitAsciiWhitespace(value: string): string[] {
  const entries: string[] = []
  let start = -1

  for (let index = 0; index < value.length; index += 1) {
    if (isAsciiWhitespace(value.charCodeAt(index))) {
      if (start !== -1) {
        entries.push(value.slice(start, index))
        start = -1
      }
    } else if (start === -1) {
      start = index
    }
  }

  if (start !== -1) entries.push(value.slice(start))
  return entries
}

function stripOuterQuotes(value: string): string {
  if (value.length >= 2 && value[0] === '"' && value[value.length - 1] === '"') {
    return value.slice(1, -1)
  }
  return value
}

function coveredComponents(signatureInput: string | undefined): string[] {
  const value = boundedSignatureMetadata(signatureInput)
  if (!value) return []
  const start = value.indexOf('(')
  if (start === -1) return []
  const end = value.indexOf(')', start + 1)
  if (end === -1) return []
  return splitAsciiWhitespace(value.slice(start + 1, end))
    .map(stripOuterQuotes)
    .filter(Boolean)
}

function firstSchemeValueDelimiter(value: string): number {
  for (let index = 0; index < value.length; index += 1) {
    const charCode = value.charCodeAt(index)
    if (value[index] === ',' || isAsciiWhitespace(charCode)) return index
  }
  return -1
}

function signatureScheme(signatureKey: string | undefined): string | undefined {
  const value = boundedSignatureMetadata(signatureKey)
  if (!value) return undefined

  for (const part of value.split(';')) {
    const item = part.trim()
    if (!item.startsWith('scheme=')) continue
    const rawValue = item.slice('scheme='.length).trim()
    if (!rawValue) return undefined
    if (rawValue[0] === '"') {
      const closeQuote = rawValue.indexOf('"', 1)
      return closeQuote === -1 ? rawValue.slice(1) : rawValue.slice(1, closeQuote)
    }
    const delimiter = firstSchemeValueDelimiter(rawValue)
    return delimiter === -1 ? rawValue : rawValue.slice(0, delimiter)
  }

  return undefined
}

function rawTokenFromEvent(
  event: Record<string, unknown>,
  tokenKind?: CapturedAAuthTokenKind,
): string | undefined {
  if (tokenKind === 'agent_token')
    return stringFromKeys(event, ['agentToken', 'agent_token', 'jwt'])
  if (tokenKind === 'resource_token')
    return stringFromKeys(event, ['resourceToken', 'resource_token', 'jwt'])
  if (tokenKind === 'auth_token') return stringFromKeys(event, ['authToken', 'auth_token', 'jwt'])
  return stringFromKeys(event, [
    'authToken',
    'auth_token',
    'agentToken',
    'agent_token',
    'resourceToken',
    'resource_token',
    'jwt',
  ])
}

function stringFromKeys(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string') return value
  }
  return undefined
}

function objectFromKeys(
  record: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> | undefined {
  for (const key of keys) {
    const value = asRecord(record[key])
    if (value) return value
  }
  return undefined
}

function requestHeadersFromEvent(event: Record<string, unknown>): unknown {
  const request = objectFromKeys(event, ['signedRequest', 'request', 'retryRequest'])
  return request?.headers ?? event['headers']
}

export function buildAAuthEvidenceFromEvent(
  event: unknown,
  options: AAuthEvidenceCaptureOptions = {},
): CapturedAAuthEvidence | undefined {
  const eventRecord = asRecord(event)
  if (!eventRecord) return undefined

  const tokenKind = options.tokenKind
  const rawToken = rawTokenFromEvent(eventRecord, tokenKind)
  const suppliedClaims = objectFromKeys(eventRecord, ['claims', 'decodedClaims', 'tokenClaims'])
  const decodedClaims = rawToken ? decodeJwtPayload(rawToken) : null
  const claimsSource = suppliedClaims ?? decodedClaims
  if (!claimsSource) return undefined

  const headers = requestHeadersFromEvent(eventRecord)
  const signatureInput = headerValue(headers, 'signature-input')
  const signatureKey = headerValue(headers, 'signature-key')
  const components = coveredComponents(signatureInput)
  const scheme = signatureScheme(signatureKey)
  const httpSignature =
    components.length > 0 ||
    scheme ||
    options.httpSignatureVerified !== undefined ||
    options.signingKeyJkt
      ? {
          ...(options.httpSignatureVerified !== undefined
            ? { verified: options.httpSignatureVerified }
            : {}),
          ...(scheme ? { scheme } : {}),
          ...(components.length > 0 ? { coveredComponents: components } : {}),
          ...(options.signingKeyJkt ? { signingKeyJkt: options.signingKeyJkt } : {}),
        }
      : undefined

  const evidence: CapturedAAuthEvidence = {
    protocol: 'aauth',
    claimsVerified: options.claimsVerified === true,
    claims: copyAAuthClaims(claimsSource),
    ...(tokenKind ? { tokenKind } : {}),
    ...(options.accessMode ? { accessMode: options.accessMode } : {}),
    ...(options.issuer ? { issuer: options.issuer } : {}),
    ...(options.audience ? { audience: options.audience } : {}),
    ...(options.resource ? { resource: options.resource } : {}),
    ...(options.resourceMetadata ? { resourceMetadata: options.resourceMetadata } : {}),
    ...(options.requiredScopes ? { requiredScopes: options.requiredScopes } : {}),
    ...(options.expectedAgent ? { expectedAgent: options.expectedAgent } : {}),
    ...(options.expectedSubject ? { expectedSubject: options.expectedSubject } : {}),
    ...(options.expectedActSubject ? { expectedActSubject: options.expectedActSubject } : {}),
    ...(options.requireAct !== undefined ? { requireAct: options.requireAct } : {}),
    ...(options.expectedCnfJkt ? { expectedCnfJkt: options.expectedCnfJkt } : {}),
    ...(options.expectedAgentJkt ? { expectedAgentJkt: options.expectedAgentJkt } : {}),
    ...(options.expectedParentAgent ? { expectedParentAgent: options.expectedParentAgent } : {}),
    ...(options.requiredMission ? { requiredMission: options.requiredMission } : {}),
    ...(httpSignature ? { httpSignature } : {}),
    ...(options.r3 ? { r3: options.r3 } : {}),
  }

  if (options.includeTokenHash !== false && rawToken) {
    evidence.token_hash = tokenHash(rawToken)
  }

  return evidence
}
