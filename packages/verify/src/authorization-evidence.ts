// SPDX-License-Identifier: Apache-2.0

import { base64urlEncode, sha256 } from '@atrib/mcp'
import {
  calculateJwkThumbprint,
  createLocalJWKSet,
  decodeJwt,
  decodeProtectedHeader,
  importJWK,
  jwtVerify,
} from 'jose'
import type { JWK, JSONWebKeySet, JWTPayload, JWTVerifyOptions } from 'jose'
import { verifyAAuthAuthorizationEvidence } from './aauth-evidence.js'
import type {
  AAuthAuthorizationEvidenceInput,
  AAuthAuthorizationEvidenceVerification,
} from './aauth-evidence.js'
import type { DpopReplayCache, DpopReplayCacheKey } from './dpop-replay-cache.js'
import { verifyX401AuthorizationEvidence } from './x401-evidence.js'
import type {
  X401AuthorizationEvidenceInput,
  X401AuthorizationEvidenceVerification,
} from './x401-evidence.js'

export type EvidenceCheckStatus = 'passed' | 'failed' | 'unresolved' | 'not_checked'
export type OAuthSignaturePolicy = 'require' | 'best-effort' | 'off'
export type OAuthEvidenceProtocol = 'oauth2' | 'mcp_oauth'

export interface EvidenceConstraintCheck {
  type: string
  status: EvidenceCheckStatus
  expected?: unknown
  actual?: unknown
  reason?: string
}

export interface EvidenceVerificationBlock<TDetails = unknown> {
  protocol: string
  valid: boolean
  issuer: string | null
  subject: string | null
  scope: string[]
  attenuation_ok: boolean | null
  delegation_ok: boolean | null
  constraints: EvidenceConstraintCheck[]
  errors: string[]
  warnings: string[]
  details?: TDetails
}

export interface OAuthAuthorizationDetailConstraint {
  type: string
  actions?: string[]
  locations?: string[]
}

export interface OAuthProtectedResourceMetadata {
  resource?: string
  authorization_servers?: string[]
  scopes_supported?: string[]
}

export interface OAuthAccessTokenClaims extends JWTPayload {
  client_id?: string
  scope?: string
  scp?: string | string[]
  resource?: string | string[]
  authorization_details?: unknown
  cnf?: {
    jkt?: string
    jwk?: JWK
    [key: string]: unknown
  }
  act?: { sub?: string; [key: string]: unknown }
  may_act?: { sub?: string; [key: string]: unknown }
}

export interface OAuthTokenIntrospectionResponse {
  active: boolean
  scope?: string
  client_id?: string
  username?: string
  token_type?: string
  exp?: number
  iat?: number
  nbf?: number
  sub?: string
  aud?: string | string[]
  iss?: string
  jti?: string
  resource?: string | string[]
  authorization_details?: unknown
  cnf?: {
    jkt?: string
    jwk?: JWK
    [key: string]: unknown
  }
  act?: { sub?: string; [key: string]: unknown }
  may_act?: { sub?: string; [key: string]: unknown }
  [key: string]: unknown
}

export interface OAuthDpopProofInput {
  proofJwt: string
  method: string
  url: string
  accessToken?: string
  expectedAth?: string
  expectedNonce?: string
  seenJtis?: string[]
  maxAgeSeconds?: number
  nowSeconds?: number
  clockSkewSeconds?: number
}

export interface OAuthAuthorizationEvidenceInput {
  protocol?: OAuthEvidenceProtocol
  accessTokenJwt?: string
  claims?: OAuthAccessTokenClaims
  claimsVerified?: boolean
  introspection?: OAuthTokenIntrospectionResponse
  introspectionVerified?: boolean
  dpopProof?: OAuthDpopProofInput
  jwks?: JWK[] | JSONWebKeySet
  issuer?: string
  audience?: string | string[]
  resource?: string
  protectedResourceMetadata?: OAuthProtectedResourceMetadata
  requiredScopes?: string[]
  requiredAuthorizationDetails?: OAuthAuthorizationDetailConstraint[]
  expectedSubject?: string
  expectedClientId?: string
  expectedActorSubject?: string
  requiredCnfJkt?: string
  requireCnf?: boolean
  signaturePolicy?: OAuthSignaturePolicy
  dpopReplayCache?: DpopReplayCache
  nowSeconds?: number
  clockSkewSeconds?: number
}

export interface OAuthTokenCheck {
  jwt_present: boolean
  introspection_present: boolean
  verified: boolean | null
  alg: string | null
  kid: string | null
  claims_verified: boolean
}

export interface OAuthAuthorizationEvidenceVerification extends EvidenceVerificationBlock<{
  token: OAuthTokenCheck
  dpop: OAuthDpopCheck | null
  audience: string[]
  resource: string[]
  client_id: string | null
}> {
  protocol: OAuthEvidenceProtocol
}

export interface OAuthDpopCheck {
  jwt_present: boolean
  verified: boolean
  alg: string | null
  jkt: string | null
  jti: string | null
  htm: string | null
  htu: string | null
}

interface ClaimsResult {
  claims: OAuthAccessTokenClaims | null
  token: OAuthTokenCheck
}

interface DpopVerificationResult {
  dpop: OAuthDpopCheck
  constraints: EvidenceConstraintCheck[]
  errors: string[]
}

function asArray(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value))
    return value.filter((entry): entry is string => typeof entry === 'string')
  return []
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function accessTokenHash(accessToken: string): string {
  return base64urlEncode(sha256(new TextEncoder().encode(accessToken)))
}

function normalizeScopes(claims: OAuthAccessTokenClaims | null): string[] {
  if (!claims) return []
  const scopeValues = [
    ...asArray(claims.scope)
      .flatMap((entry) => entry.split(/\s+/))
      .filter(Boolean),
    ...asArray(claims.scp)
      .flatMap((entry) => entry.split(/\s+/))
      .filter(Boolean),
  ]
  return Array.from(new Set(scopeValues)).sort()
}

function normalizeAudience(claims: OAuthAccessTokenClaims | null): string[] {
  if (!claims) return []
  return asArray(claims.aud).sort()
}

function normalizeResource(claims: OAuthAccessTokenClaims | null): string[] {
  if (!claims) return []
  return asArray(claims.resource).sort()
}

function normalizeJwks(jwks: JWK[] | JSONWebKeySet): JSONWebKeySet {
  return Array.isArray(jwks) ? { keys: jwks } : jwks
}

function claimsFromIntrospection(
  introspection: OAuthTokenIntrospectionResponse,
): OAuthAccessTokenClaims {
  const claims: OAuthAccessTokenClaims = {}
  if (typeof introspection.iss === 'string') claims.iss = introspection.iss
  if (typeof introspection.sub === 'string') claims.sub = introspection.sub
  if (introspection.aud !== undefined) claims.aud = introspection.aud
  if (typeof introspection.exp === 'number') claims.exp = introspection.exp
  if (typeof introspection.iat === 'number') claims.iat = introspection.iat
  if (typeof introspection.nbf === 'number') claims.nbf = introspection.nbf
  if (typeof introspection.jti === 'string') claims.jti = introspection.jti
  if (typeof introspection.scope === 'string') claims.scope = introspection.scope
  if (typeof introspection.client_id === 'string') claims.client_id = introspection.client_id
  if (introspection.resource !== undefined) claims.resource = introspection.resource
  if (introspection.authorization_details !== undefined) {
    claims.authorization_details = introspection.authorization_details
  }
  if (introspection.cnf !== undefined) claims.cnf = introspection.cnf
  if (introspection.act !== undefined) claims.act = introspection.act
  if (introspection.may_act !== undefined) claims.may_act = introspection.may_act
  return claims
}

function check(
  type: string,
  status: EvidenceCheckStatus,
  expected?: unknown,
  actual?: unknown,
  reason?: string,
): EvidenceConstraintCheck {
  const result: EvidenceConstraintCheck = { type, status }
  if (expected !== undefined) result.expected = expected
  if (actual !== undefined) result.actual = actual
  if (reason !== undefined) result.reason = reason
  return result
}

async function resolveClaims(input: OAuthAuthorizationEvidenceInput): Promise<ClaimsResult> {
  const signaturePolicy = input.signaturePolicy ?? 'require'
  const token: OAuthTokenCheck = {
    jwt_present: typeof input.accessTokenJwt === 'string',
    introspection_present: input.introspection !== undefined,
    verified: null,
    alg: null,
    kid: null,
    claims_verified: input.claimsVerified === true,
  }

  if (input.accessTokenJwt) {
    try {
      const header = decodeProtectedHeader(input.accessTokenJwt)
      token.alg = typeof header.alg === 'string' ? header.alg : null
      token.kid = typeof header.kid === 'string' ? header.kid : null
    } catch {
      token.alg = null
      token.kid = null
    }

    if (input.jwks && signaturePolicy !== 'off') {
      const verifyOptions: JWTVerifyOptions = {}
      if (input.issuer) verifyOptions.issuer = input.issuer
      if (input.audience) verifyOptions.audience = input.audience
      if (input.clockSkewSeconds !== undefined)
        verifyOptions.clockTolerance = input.clockSkewSeconds
      if (input.nowSeconds !== undefined) {
        verifyOptions.currentDate = new Date(input.nowSeconds * 1000)
      }

      const verified = await jwtVerify(
        input.accessTokenJwt,
        createLocalJWKSet(normalizeJwks(input.jwks)),
        verifyOptions,
      )
      token.verified = true
      token.claims_verified = true
      return { claims: verified.payload as OAuthAccessTokenClaims, token }
    }

    const decoded = decodeJwt(input.accessTokenJwt) as OAuthAccessTokenClaims
    token.verified = false
    token.claims_verified = signaturePolicy === 'off'
    return { claims: decoded, token }
  }

  if (input.introspection) {
    token.verified = input.introspectionVerified === true
    token.claims_verified = input.introspectionVerified === true
    return {
      claims: claimsFromIntrospection(input.introspection),
      token,
    }
  }

  return {
    claims: input.claims ?? null,
    token,
  }
}

function pushScopeChecks(
  checks: EvidenceConstraintCheck[],
  scopes: string[],
  requiredScopes: string[] | undefined,
): boolean | null {
  if (!requiredScopes || requiredScopes.length === 0) {
    checks.push(check('scope', 'not_checked'))
    return null
  }

  const missing = requiredScopes.filter((scope) => !scopes.includes(scope))
  checks.push(
    check(
      'scope',
      missing.length === 0 ? 'passed' : 'failed',
      requiredScopes,
      scopes,
      missing.length === 0 ? undefined : `missing scopes: ${missing.join(', ')}`,
    ),
  )
  return missing.length === 0
}

function pushAudienceChecks(
  checks: EvidenceConstraintCheck[],
  claims: OAuthAccessTokenClaims | null,
  input: OAuthAuthorizationEvidenceInput,
): void {
  const audience = normalizeAudience(claims)
  const expectedAudience = asArray(input.audience)
  if (expectedAudience.length > 0) {
    const missing = expectedAudience.filter((entry) => !audience.includes(entry))
    checks.push(
      check(
        'audience',
        missing.length === 0 ? 'passed' : 'failed',
        expectedAudience,
        audience,
        missing.length === 0 ? undefined : `missing audience: ${missing.join(', ')}`,
      ),
    )
  }

  const expectedResource = input.resource ?? input.protectedResourceMetadata?.resource
  if (expectedResource) {
    const resources = normalizeResource(claims)
    const matchesAudience = audience.includes(expectedResource)
    const matchesResource = resources.includes(expectedResource)
    checks.push(
      check(
        'resource',
        matchesAudience || matchesResource ? 'passed' : 'failed',
        expectedResource,
        { aud: audience, resource: resources },
        matchesAudience || matchesResource
          ? undefined
          : 'resource not present in aud or resource claims',
      ),
    )
  }
}

function pushMetadataChecks(
  checks: EvidenceConstraintCheck[],
  claims: OAuthAccessTokenClaims | null,
  metadata: OAuthProtectedResourceMetadata | undefined,
): void {
  if (!metadata) return

  if (metadata.authorization_servers && metadata.authorization_servers.length > 0) {
    const issuer = typeof claims?.iss === 'string' ? claims.iss : null
    checks.push(
      check(
        'protected_resource.authorization_servers',
        issuer && metadata.authorization_servers.includes(issuer) ? 'passed' : 'failed',
        metadata.authorization_servers,
        issuer,
      ),
    )
  }
}

function pushAuthorizationDetailsChecks(
  checks: EvidenceConstraintCheck[],
  claims: OAuthAccessTokenClaims | null,
  required: OAuthAuthorizationDetailConstraint[] | undefined,
): void {
  if (!required || required.length === 0) {
    checks.push(check('authorization_details', 'not_checked'))
    return
  }

  const presented = Array.isArray(claims?.authorization_details) ? claims.authorization_details : []
  for (const constraint of required) {
    const match = presented.some((entry) => authorizationDetailMatches(entry, constraint))
    checks.push(
      check(
        'authorization_details',
        match ? 'passed' : 'failed',
        constraint,
        presented,
        match ? undefined : `missing authorization_details type: ${constraint.type}`,
      ),
    )
  }
}

function authorizationDetailMatches(
  entry: unknown,
  constraint: OAuthAuthorizationDetailConstraint,
): boolean {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return false
  const record = entry as Record<string, unknown>
  if (record['type'] !== constraint.type) return false

  if (constraint.actions && constraint.actions.length > 0) {
    const actions = asArray(record['actions'])
    if (constraint.actions.some((action) => !actions.includes(action))) return false
  }

  if (constraint.locations && constraint.locations.length > 0) {
    const locations = asArray(record['locations'])
    if (constraint.locations.some((location) => !locations.includes(location))) return false
  }

  return true
}

function pushIdentityChecks(
  checks: EvidenceConstraintCheck[],
  claims: OAuthAccessTokenClaims | null,
  input: OAuthAuthorizationEvidenceInput,
): boolean | null {
  let delegationOk: boolean | null = null

  if (input.issuer) {
    checks.push(
      check(
        'issuer',
        claims?.iss === input.issuer ? 'passed' : 'failed',
        input.issuer,
        claims?.iss ?? null,
      ),
    )
  }

  if (input.expectedSubject) {
    checks.push(
      check(
        'subject',
        claims?.sub === input.expectedSubject ? 'passed' : 'failed',
        input.expectedSubject,
        claims?.sub ?? null,
      ),
    )
  }

  if (input.expectedClientId) {
    checks.push(
      check(
        'client_id',
        claims?.client_id === input.expectedClientId ? 'passed' : 'failed',
        input.expectedClientId,
        claims?.client_id ?? null,
      ),
    )
  }

  if (input.expectedActorSubject) {
    const actorSubject = claims?.act?.sub ?? claims?.may_act?.sub ?? null
    delegationOk = actorSubject === input.expectedActorSubject
    checks.push(
      check(
        'actor_subject',
        delegationOk ? 'passed' : 'failed',
        input.expectedActorSubject,
        actorSubject,
      ),
    )
  }

  if (input.requireCnf || input.requiredCnfJkt) {
    const actual = claims?.cnf?.jkt ?? null
    const expected = input.requiredCnfJkt ?? 'present'
    const passed = input.requiredCnfJkt
      ? actual === input.requiredCnfJkt
      : typeof actual === 'string'
    checks.push(check('cnf.jkt', passed ? 'passed' : 'failed', expected, actual))
  }

  return delegationOk
}

async function verifyDpopProof(
  input: OAuthDpopProofInput,
  claims: OAuthAccessTokenClaims | null,
  requiredCnfJkt: string | undefined,
  replayCache: DpopReplayCache | undefined,
): Promise<DpopVerificationResult> {
  const constraints: EvidenceConstraintCheck[] = []
  const errors: string[] = []
  const dpop: OAuthDpopCheck = {
    jwt_present: typeof input.proofJwt === 'string' && input.proofJwt.length > 0,
    verified: false,
    alg: null,
    jkt: null,
    jti: null,
    htm: null,
    htu: null,
  }

  try {
    const header = decodeProtectedHeader(input.proofJwt)
    dpop.alg = typeof header.alg === 'string' ? header.alg : null
    const headerRecord = header as Record<string, unknown>
    const publicJwk = asRecord(headerRecord['jwk']) as JWK | null
    if (!publicJwk) {
      constraints.push(check('dpop.jwk', 'failed', 'present', null, 'missing public jwk'))
      return { dpop, constraints, errors }
    }

    if (header.typ !== 'dpop+jwt') {
      constraints.push(check('dpop.typ', 'failed', 'dpop+jwt', header.typ ?? null))
    } else {
      constraints.push(check('dpop.typ', 'passed', 'dpop+jwt', header.typ))
    }

    const key = await importJWK(publicJwk, dpop.alg ?? undefined)
    const verifyOptions: JWTVerifyOptions = {}
    const nowSeconds = input.nowSeconds
    if (nowSeconds !== undefined) verifyOptions.currentDate = new Date(nowSeconds * 1000)
    if (input.clockSkewSeconds !== undefined) {
      verifyOptions.clockTolerance = input.clockSkewSeconds
    }
    const verified = await jwtVerify(input.proofJwt, key, verifyOptions)
    dpop.verified = true

    const payload = verified.payload as JWTPayload & {
      htm?: unknown
      htu?: unknown
      jti?: unknown
      iat?: unknown
      ath?: unknown
      nonce?: unknown
    }
    dpop.htm = typeof payload.htm === 'string' ? payload.htm : null
    dpop.htu = typeof payload.htu === 'string' ? payload.htu : null
    dpop.jti = typeof payload.jti === 'string' ? payload.jti : null
    dpop.jkt = await calculateJwkThumbprint(publicJwk, 'sha256')

    const expectedMethod = input.method.toUpperCase()
    constraints.push(
      check(
        'dpop.htm',
        dpop.htm === expectedMethod ? 'passed' : 'failed',
        expectedMethod,
        dpop.htm,
      ),
    )
    constraints.push(
      check('dpop.htu', dpop.htu === input.url ? 'passed' : 'failed', input.url, dpop.htu),
    )

    const jtiSeen =
      dpop.jti !== null && input.seenJtis?.includes(dpop.jti) === true
        ? true
        : dpop.jti !== null && replayCache !== undefined
          ? !(await replayCache.checkAndRemember(
              replayKey(dpop.jti, dpop, claims),
              dpopReplayExpiresAtSeconds(payload, input),
            ))
          : false
    constraints.push(
      check(
        'dpop.jti',
        dpop.jti && !jtiSeen ? 'passed' : 'failed',
        'present and unseen',
        dpop.jti,
        jtiSeen ? 'jti already seen' : dpop.jti ? undefined : 'missing jti',
      ),
    )

    const now = input.nowSeconds ?? Math.floor(Date.now() / 1000)
    const skew = input.clockSkewSeconds ?? 0
    const maxAge = input.maxAgeSeconds ?? 300
    const iat = typeof payload.iat === 'number' ? payload.iat : null
    const iatPassed = iat !== null && iat <= now + skew && now - iat <= maxAge + skew
    constraints.push(
      check(
        'dpop.iat',
        iatPassed ? 'passed' : 'failed',
        { maxAgeSeconds: maxAge, nowSeconds: now, clockSkewSeconds: skew },
        iat,
      ),
    )

    const expectedAth =
      input.expectedAth ?? (input.accessToken ? accessTokenHash(input.accessToken) : undefined)
    if (expectedAth) {
      constraints.push(
        check(
          'dpop.ath',
          payload.ath === expectedAth ? 'passed' : 'failed',
          expectedAth,
          payload.ath ?? null,
        ),
      )
    } else {
      constraints.push(check('dpop.ath', 'not_checked'))
    }

    if (input.expectedNonce) {
      constraints.push(
        check(
          'dpop.nonce',
          payload.nonce === input.expectedNonce ? 'passed' : 'failed',
          input.expectedNonce,
          payload.nonce ?? null,
        ),
      )
    }

    const expectedJkt = requiredCnfJkt ?? claims?.cnf?.jkt
    if (expectedJkt) {
      constraints.push(
        check(
          'dpop.cnf.jkt',
          dpop.jkt === expectedJkt ? 'passed' : 'failed',
          expectedJkt,
          dpop.jkt,
        ),
      )
    } else {
      constraints.push(check('dpop.cnf.jkt', 'unresolved', 'access token cnf.jkt', dpop.jkt))
    }
  } catch (err) {
    errors.push(`oauth_evidence dpop proof error: ${(err as Error).message}`)
  }

  return { dpop, constraints, errors }
}

function replayKey(
  jti: string,
  dpop: OAuthDpopCheck,
  claims: OAuthAccessTokenClaims | null,
): DpopReplayCacheKey {
  return {
    jti,
    ...(dpop.jkt !== null ? { jkt: dpop.jkt } : {}),
    ...(dpop.htm !== null ? { htm: dpop.htm } : {}),
    ...(dpop.htu !== null ? { htu: dpop.htu } : {}),
    ...(typeof claims?.iss === 'string' ? { issuer: claims.iss } : {}),
    ...(typeof claims?.client_id === 'string' ? { client_id: claims.client_id } : {}),
  }
}

function dpopReplayExpiresAtSeconds(
  payload: JWTPayload & { iat?: unknown },
  input: OAuthDpopProofInput,
): number {
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000)
  const skew = input.clockSkewSeconds ?? 0
  const maxAge = input.maxAgeSeconds ?? 300
  const iat = typeof payload.iat === 'number' ? payload.iat : now
  return iat + maxAge + skew
}

export async function verifyOAuthAuthorizationEvidence(
  input: OAuthAuthorizationEvidenceInput,
): Promise<OAuthAuthorizationEvidenceVerification> {
  const errors: string[] = []
  const warnings: string[] = []
  const constraints: EvidenceConstraintCheck[] = []
  let claims: OAuthAccessTokenClaims | null = null
  let token: OAuthTokenCheck = {
    jwt_present: false,
    introspection_present: false,
    verified: null,
    alg: null,
    kid: null,
    claims_verified: false,
  }
  let dpop: OAuthDpopCheck | null = null

  try {
    const resolved = await resolveClaims(input)
    claims = resolved.claims
    token = resolved.token
  } catch (err) {
    errors.push(`oauth_evidence token verification error: ${(err as Error).message}`)
  }

  const signaturePolicy = input.signaturePolicy ?? 'require'
  if (!claims) {
    errors.push('oauth_evidence missing access token claims')
  } else if (input.introspection && input.introspection.active !== true) {
    errors.push('oauth_evidence introspection inactive')
  } else if (!token.claims_verified) {
    if (signaturePolicy === 'require') {
      errors.push('oauth_evidence claims were not verified')
    } else if (signaturePolicy === 'best-effort') {
      warnings.push('oauth_evidence claims were not verified')
    }
  }

  const scopes = normalizeScopes(claims)
  const attenuationOk = pushScopeChecks(constraints, scopes, input.requiredScopes)
  pushAudienceChecks(constraints, claims, input)
  pushMetadataChecks(constraints, claims, input.protectedResourceMetadata)
  pushAuthorizationDetailsChecks(constraints, claims, input.requiredAuthorizationDetails)
  const delegationOk = pushIdentityChecks(constraints, claims, input)

  if (input.dpopProof) {
    const dpopProofInput: OAuthDpopProofInput = {
      ...input.dpopProof,
      ...(input.dpopProof.nowSeconds === undefined && input.nowSeconds !== undefined
        ? { nowSeconds: input.nowSeconds }
        : {}),
      ...(input.dpopProof.clockSkewSeconds === undefined && input.clockSkewSeconds !== undefined
        ? { clockSkewSeconds: input.clockSkewSeconds }
        : {}),
    }
    const dpopResult = await verifyDpopProof(
      dpopProofInput,
      claims,
      input.requiredCnfJkt,
      input.dpopReplayCache,
    )
    dpop = dpopResult.dpop
    constraints.push(...dpopResult.constraints)
    errors.push(...dpopResult.errors)
  }

  for (const constraint of constraints) {
    if (constraint.status === 'failed') {
      errors.push(`oauth_evidence constraint failed: ${constraint.type}`)
    }
  }

  const audience = normalizeAudience(claims)
  const resource = normalizeResource(claims)
  const issuer = typeof claims?.iss === 'string' ? claims.iss : null
  const subject = typeof claims?.sub === 'string' ? claims.sub : null
  const clientId = typeof claims?.client_id === 'string' ? claims.client_id : null

  return {
    protocol: input.protocol ?? 'oauth2',
    valid: errors.length === 0,
    issuer,
    subject,
    scope: scopes,
    attenuation_ok: attenuationOk,
    delegation_ok: delegationOk,
    constraints,
    errors,
    warnings,
    details: {
      token,
      dpop,
      audience,
      resource,
      client_id: clientId,
    },
  }
}

export type AuthorizationEvidenceInput =
  | {
      protocol?: 'aauth'
      aauth: AAuthAuthorizationEvidenceInput
    }
  | {
      protocol?: 'x401'
      x401: X401AuthorizationEvidenceInput
    }
  | {
      protocol?: OAuthEvidenceProtocol
      oauth: OAuthAuthorizationEvidenceInput
    }
  | AAuthAuthorizationEvidenceInput
  | X401AuthorizationEvidenceInput
  | OAuthAuthorizationEvidenceInput

function isAAuthAuthorizationEvidenceInput(
  evidence: AuthorizationEvidenceInput,
): evidence is AAuthAuthorizationEvidenceInput {
  if (evidence.protocol === 'aauth') return true
  return (
    'tokenKind' in evidence ||
    'accessMode' in evidence ||
    'expectedAgent' in evidence ||
    'expectedActSubject' in evidence ||
    'expectedParentAgent' in evidence ||
    'requiredMission' in evidence ||
    'httpSignature' in evidence ||
    'r3' in evidence
  )
}

function isX401AuthorizationEvidenceInput(
  evidence: AuthorizationEvidenceInput,
): evidence is X401AuthorizationEvidenceInput {
  if (evidence.protocol === 'x401') return true
  return (
    'headers' in evidence ||
    'headerSet' in evidence ||
    'proofRequest' in evidence ||
    'proofResponse' in evidence ||
    'proofResult' in evidence ||
    'resultVerified' in evidence ||
    'tokenVerified' in evidence
  )
}

export async function verifyAuthorizationEvidence(
  evidence: AuthorizationEvidenceInput,
): Promise<
  EvidenceVerificationBlock | AAuthAuthorizationEvidenceVerification | X401AuthorizationEvidenceVerification
> {
  if ('aauth' in evidence) {
    return verifyAAuthAuthorizationEvidence({
      ...evidence.aauth,
      protocol: 'aauth',
    })
  }
  if ('x401' in evidence) {
    return verifyX401AuthorizationEvidence({
      ...evidence.x401,
      protocol: 'x401',
    })
  }
  if (isX401AuthorizationEvidenceInput(evidence)) {
    return verifyX401AuthorizationEvidence(evidence)
  }
  if (isAAuthAuthorizationEvidenceInput(evidence)) {
    return verifyAAuthAuthorizationEvidence(evidence)
  }
  if ('oauth' in evidence) {
    const protocol = evidence.protocol ?? evidence.oauth.protocol
    return verifyOAuthAuthorizationEvidence(
      protocol ? { ...evidence.oauth, protocol } : { ...evidence.oauth },
    )
  }
  return verifyOAuthAuthorizationEvidence(evidence)
}
