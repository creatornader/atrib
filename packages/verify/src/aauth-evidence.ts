// SPDX-License-Identifier: Apache-2.0

import {
  calculateJwkThumbprint,
  createLocalJWKSet,
  decodeJwt,
  decodeProtectedHeader,
  jwtVerify,
} from 'jose'
import type { JWK, JSONWebKeySet, JWTPayload, JWTVerifyOptions } from 'jose'
import type {
  EvidenceConstraintCheck,
  EvidenceVerificationBlock,
} from './authorization-evidence.js'

export type AAuthEvidenceProtocol = 'aauth'
export type AAuthSignaturePolicy = 'require' | 'best-effort' | 'off'
export type AAuthAccessMode = 'agent-token' | 'aauth-access-token' | 'auth-token'
export type AAuthTokenKind = 'agent_token' | 'resource_token' | 'auth_token'

export interface AAuthMissionClaim {
  approver?: string
  s256?: string
  [key: string]: unknown
}

export interface AAuthActClaim {
  sub?: string
  act?: AAuthActClaim
  [key: string]: unknown
}

export interface AAuthTokenClaims extends JWTPayload {
  dwk?: string
  agent?: string
  agent_jkt?: string
  scope?: string | string[]
  resource?: string | string[]
  cnf?: {
    jwk?: JWK
    jkt?: string
    [key: string]: unknown
  }
  act?: AAuthActClaim
  mission?: AAuthMissionClaim
  tenant?: string
  ps?: string
  parent_agent?: string
  r3_uri?: string
  r3_s256?: string
  r3_granted?: string[]
  r3_conditional?: unknown
}

export interface AAuthResourceMetadataEvidence {
  issuer?: string
  resource?: string
  access_mode?: AAuthAccessMode
}

export interface AAuthHttpSignatureEvidence {
  verified?: boolean
  scheme?: string
  coveredComponents?: string[]
  requiredComponents?: string[]
  signingKeyJkt?: string
  created?: number
  maxAgeSeconds?: number
}

export interface AAuthR3Evidence {
  uri?: string
  s256?: string
  expectedS256?: string
  documentHashVerified?: boolean
  granted?: string[]
  conditional?: unknown
}

export interface AAuthAuthorizationEvidenceInput {
  protocol?: AAuthEvidenceProtocol
  tokenKind?: AAuthTokenKind
  accessMode?: AAuthAccessMode
  tokenJwt?: string
  claims?: AAuthTokenClaims
  claimsVerified?: boolean
  jwks?: JWK[] | JSONWebKeySet
  issuer?: string
  audience?: string | string[]
  resource?: string
  resourceMetadata?: AAuthResourceMetadataEvidence
  requiredScopes?: string[]
  expectedAgent?: string
  expectedSubject?: string
  expectedActSubject?: string
  requireAct?: boolean
  expectedCnfJkt?: string
  expectedAgentJkt?: string
  expectedParentAgent?: string
  requiredMission?: AAuthMissionClaim
  httpSignature?: AAuthHttpSignatureEvidence
  r3?: AAuthR3Evidence
  signaturePolicy?: AAuthSignaturePolicy
  nowSeconds?: number
  clockSkewSeconds?: number
}

export interface AAuthTokenCheck {
  jwt_present: boolean
  verified: boolean | null
  claims_verified: boolean
  alg: string | null
  kid: string | null
  typ: string | null
  token_kind: AAuthTokenKind | null
  jti: string | null
  cnf_jkt: string | null
  agent: string | null
  parent_agent: string | null
  act_chain: string[]
}

export interface AAuthHttpSignatureCheck {
  present: boolean
  verified: boolean | null
  scheme: string | null
  covered_components: string[]
  signing_key_jkt: string | null
}

export interface AAuthR3Check {
  present: boolean
  uri: string | null
  s256: string | null
  granted: string[]
  document_hash_verified: boolean | null
}

export interface AAuthAuthorizationEvidenceVerification extends EvidenceVerificationBlock<{
  token: AAuthTokenCheck
  http_signature: AAuthHttpSignatureCheck
  access_mode: AAuthAccessMode | null
  audience: string[]
  resource: string[]
  mission: AAuthMissionClaim | null
  r3: AAuthR3Check
}> {
  protocol: AAuthEvidenceProtocol
}

interface AAuthClaimsResult {
  claims: AAuthTokenClaims | null
  token: AAuthTokenCheck
}

const TOKEN_TYP_BY_KIND: Record<AAuthTokenKind, string> = {
  agent_token: 'aa-agent+jwt',
  resource_token: 'aa-resource+jwt',
  auth_token: 'aa-auth+jwt',
}

function asArray(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value))
    return value.filter((entry): entry is string => typeof entry === 'string')
  return []
}

function normalizeScopes(claims: AAuthTokenClaims | null): string[] {
  if (!claims) return []
  return Array.from(
    new Set(
      asArray(claims.scope)
        .flatMap((entry) => entry.split(/\s+/))
        .filter(Boolean),
    ),
  ).sort()
}

function normalizeAudience(claims: AAuthTokenClaims | null): string[] {
  if (!claims) return []
  return asArray(claims.aud).sort()
}

function normalizeResource(claims: AAuthTokenClaims | null): string[] {
  if (!claims) return []
  return asArray(claims.resource).sort()
}

function normalizeJwks(jwks: JWK[] | JSONWebKeySet): JSONWebKeySet {
  return Array.isArray(jwks) ? { keys: jwks } : jwks
}

function check(
  type: string,
  status: EvidenceConstraintCheck['status'],
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

function inferTokenKind(
  typ: string | null,
  fallback: AAuthTokenKind | undefined,
): AAuthTokenKind | null {
  if (typ === TOKEN_TYP_BY_KIND.agent_token) return 'agent_token'
  if (typ === TOKEN_TYP_BY_KIND.resource_token) return 'resource_token'
  if (typ === TOKEN_TYP_BY_KIND.auth_token) return 'auth_token'
  return fallback ?? null
}

function tokenAgent(
  claims: AAuthTokenClaims | null,
  tokenKind: AAuthTokenKind | null,
): string | null {
  if (!claims) return null
  if (tokenKind === 'agent_token') return typeof claims.sub === 'string' ? claims.sub : null
  return typeof claims.agent === 'string' ? claims.agent : null
}

function flattenAct(act: AAuthActClaim | undefined): string[] {
  const out: string[] = []
  let current = act
  let depth = 0
  while (current && depth < 16) {
    if (typeof current.sub === 'string') out.push(current.sub)
    current = current.act
    depth += 1
  }
  return out
}

async function cnfJkt(claims: AAuthTokenClaims | null): Promise<string | null> {
  if (!claims?.cnf) return null
  if (typeof claims.cnf.jkt === 'string') return claims.cnf.jkt
  if (claims.cnf.jwk) return calculateJwkThumbprint(claims.cnf.jwk, 'sha256')
  return null
}

function tokenCheckBase(input: AAuthAuthorizationEvidenceInput): AAuthTokenCheck {
  return {
    jwt_present: typeof input.tokenJwt === 'string',
    verified: null,
    claims_verified: input.claimsVerified === true,
    alg: null,
    kid: null,
    typ: null,
    token_kind: input.tokenKind ?? null,
    jti: null,
    cnf_jkt: null,
    agent: null,
    parent_agent: null,
    act_chain: [],
  }
}

async function resolveClaims(input: AAuthAuthorizationEvidenceInput): Promise<AAuthClaimsResult> {
  const signaturePolicy = input.signaturePolicy ?? 'require'
  const token = tokenCheckBase(input)

  if (input.tokenJwt) {
    try {
      const header = decodeProtectedHeader(input.tokenJwt)
      token.alg = typeof header.alg === 'string' ? header.alg : null
      token.kid = typeof header.kid === 'string' ? header.kid : null
      token.typ = typeof header.typ === 'string' ? header.typ : null
      token.token_kind = inferTokenKind(token.typ, input.tokenKind)
    } catch {
      token.alg = null
      token.kid = null
      token.typ = null
    }

    if (input.jwks && signaturePolicy !== 'off') {
      const verifyOptions: JWTVerifyOptions = {}
      if (input.issuer) verifyOptions.issuer = input.issuer
      if (input.audience) verifyOptions.audience = input.audience
      if (input.clockSkewSeconds !== undefined)
        verifyOptions.clockTolerance = input.clockSkewSeconds
      if (input.nowSeconds !== undefined)
        verifyOptions.currentDate = new Date(input.nowSeconds * 1000)
      const verified = await jwtVerify(
        input.tokenJwt,
        createLocalJWKSet(normalizeJwks(input.jwks)),
        verifyOptions,
      )
      token.verified = true
      token.claims_verified = true
      return { claims: verified.payload as AAuthTokenClaims, token }
    }

    const decoded = decodeJwt(input.tokenJwt) as AAuthTokenClaims
    token.verified = false
    token.claims_verified = signaturePolicy === 'off'
    return { claims: decoded, token }
  }

  return { claims: input.claims ?? null, token }
}

function pushTokenTypeCheck(
  checks: EvidenceConstraintCheck[],
  token: AAuthTokenCheck,
  input: AAuthAuthorizationEvidenceInput,
): void {
  if (!input.tokenKind) {
    checks.push(check('aauth.token_type', 'not_checked'))
    return
  }

  const expectedTyp = TOKEN_TYP_BY_KIND[input.tokenKind]
  const actualTyp = token.typ
  if (actualTyp === null) {
    checks.push(check('aauth.token_type', 'unresolved', expectedTyp, null))
    return
  }
  checks.push(
    check(
      'aauth.token_type',
      actualTyp === expectedTyp ? 'passed' : 'failed',
      expectedTyp,
      actualTyp,
    ),
  )
}

function pushTemporalChecks(
  checks: EvidenceConstraintCheck[],
  claims: AAuthTokenClaims | null,
  input: AAuthAuthorizationEvidenceInput,
): void {
  if (!claims) return
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000)
  const skew = input.clockSkewSeconds ?? 0
  if (typeof claims.exp === 'number') {
    checks.push(
      check('exp', claims.exp + skew >= now ? 'passed' : 'failed', { now, skew }, claims.exp),
    )
  } else {
    checks.push(check('exp', 'unresolved', 'present', null))
  }
  if (typeof claims.iat === 'number') {
    checks.push(
      check('iat', claims.iat <= now + skew ? 'passed' : 'failed', { now, skew }, claims.iat),
    )
  }
}

function pushIdentityChecks(
  checks: EvidenceConstraintCheck[],
  claims: AAuthTokenClaims | null,
  token: AAuthTokenCheck,
  input: AAuthAuthorizationEvidenceInput,
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

  const expectedAudience = asArray(input.audience)
  if (expectedAudience.length > 0) {
    const audience = normalizeAudience(claims)
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

  if (input.expectedAgent) {
    checks.push(
      check(
        'agent',
        token.agent === input.expectedAgent ? 'passed' : 'failed',
        input.expectedAgent,
        token.agent,
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

  if (input.expectedParentAgent) {
    checks.push(
      check(
        'parent_agent',
        claims?.parent_agent === input.expectedParentAgent ? 'passed' : 'failed',
        input.expectedParentAgent,
        claims?.parent_agent ?? null,
      ),
    )
  }

  const requireAct = input.requireAct ?? input.tokenKind === 'auth_token'
  if (requireAct || input.expectedActSubject) {
    const actual = token.act_chain[0] ?? null
    const expected = input.expectedActSubject ?? token.agent
    const passed = typeof expected === 'string' && actual === expected
    delegationOk = passed
    checks.push(
      check(
        'act.sub',
        passed ? 'passed' : 'failed',
        expected ?? 'present',
        actual,
        passed ? undefined : 'missing or mismatched act.sub',
      ),
    )
  }

  return delegationOk
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

function pushResourceAndAccessModeChecks(
  checks: EvidenceConstraintCheck[],
  claims: AAuthTokenClaims | null,
  input: AAuthAuthorizationEvidenceInput,
): void {
  const expectedResource = input.resource ?? input.resourceMetadata?.resource
  if (expectedResource) {
    const audience = normalizeAudience(claims)
    const resource = normalizeResource(claims)
    const matches = audience.includes(expectedResource) || resource.includes(expectedResource)
    checks.push(
      check(
        'resource',
        matches ? 'passed' : 'failed',
        expectedResource,
        { aud: audience, resource },
        matches ? undefined : 'resource not present in aud or resource claims',
      ),
    )
  }

  if (input.resourceMetadata?.issuer) {
    checks.push(
      check(
        'resource_metadata.issuer',
        input.resourceMetadata.issuer === input.resourceMetadata.resource ? 'passed' : 'unresolved',
        input.resourceMetadata.resource ?? 'resource URL',
        input.resourceMetadata.issuer,
        input.resourceMetadata.issuer === input.resourceMetadata.resource
          ? undefined
          : 'caller supplied metadata issuer without fetched URL proof',
      ),
    )
  }

  if (input.accessMode && input.resourceMetadata?.access_mode) {
    checks.push(
      check(
        'resource_metadata.access_mode',
        input.resourceMetadata.access_mode === input.accessMode ? 'passed' : 'failed',
        input.accessMode,
        input.resourceMetadata.access_mode,
      ),
    )
  }
}

function pushMissionChecks(
  checks: EvidenceConstraintCheck[],
  mission: AAuthMissionClaim | undefined,
  required: AAuthMissionClaim | undefined,
): void {
  if (!required) {
    checks.push(check('mission', 'not_checked'))
    return
  }
  if (!mission) {
    checks.push(check('mission', 'failed', required, null, 'missing mission claim'))
    return
  }
  if (required.approver) {
    checks.push(
      check(
        'mission.approver',
        mission.approver === required.approver ? 'passed' : 'failed',
        required.approver,
        mission.approver ?? null,
      ),
    )
  }
  if (required.s256) {
    checks.push(
      check(
        'mission.s256',
        mission.s256 === required.s256 ? 'passed' : 'failed',
        required.s256,
        mission.s256 ?? null,
      ),
    )
  }
}

function pushHttpSignatureChecks(
  checks: EvidenceConstraintCheck[],
  claims: AAuthTokenClaims | null,
  cnfThumbprint: string | null,
  input: AAuthAuthorizationEvidenceInput,
): AAuthHttpSignatureCheck {
  const evidence = input.httpSignature
  const signature: AAuthHttpSignatureCheck = {
    present: evidence !== undefined,
    verified: evidence?.verified ?? null,
    scheme: evidence?.scheme ?? null,
    covered_components: evidence?.coveredComponents ?? [],
    signing_key_jkt: evidence?.signingKeyJkt ?? null,
  }

  if (!evidence) {
    checks.push(check('http_signature', 'not_checked'))
    return signature
  }

  checks.push(
    check(
      'http_signature.verified',
      evidence.verified === true ? 'passed' : 'failed',
      true,
      evidence.verified ?? null,
    ),
  )

  const covered = new Set((evidence.coveredComponents ?? []).map((entry) => entry.toLowerCase()))
  const required = evidence.requiredComponents ?? [
    '@method',
    '@authority',
    '@path',
    'signature-key',
  ]
  const missing = required.filter((entry) => !covered.has(entry.toLowerCase()))
  checks.push(
    check(
      'http_signature.covered_components',
      missing.length === 0 ? 'passed' : 'failed',
      required,
      evidence.coveredComponents ?? [],
      missing.length === 0 ? undefined : `missing covered components: ${missing.join(', ')}`,
    ),
  )

  if (input.accessMode === 'aauth-access-token') {
    checks.push(
      check(
        'http_signature.authorization_covered',
        covered.has('authorization') ? 'passed' : 'failed',
        'authorization',
        evidence.coveredComponents ?? [],
      ),
    )
  }

  const expectedJkt = input.expectedCnfJkt ?? cnfThumbprint
  if (evidence.signingKeyJkt && expectedJkt) {
    checks.push(
      check(
        'http_signature.cnf_binding',
        evidence.signingKeyJkt === expectedJkt ? 'passed' : 'failed',
        expectedJkt,
        evidence.signingKeyJkt,
      ),
    )
  } else if (claims?.cnf || evidence.signingKeyJkt) {
    checks.push(
      check('http_signature.cnf_binding', 'unresolved', 'cnf.jwk and signing key thumbprint', {
        cnf_jkt: expectedJkt,
        signing_key_jkt: evidence.signingKeyJkt ?? null,
      }),
    )
  }

  return signature
}

function pushCnfChecks(
  checks: EvidenceConstraintCheck[],
  claims: AAuthTokenClaims | null,
  cnfThumbprint: string | null,
  input: AAuthAuthorizationEvidenceInput,
): void {
  if (input.expectedCnfJkt) {
    checks.push(
      check(
        'cnf.jwk',
        cnfThumbprint === input.expectedCnfJkt ? 'passed' : 'failed',
        input.expectedCnfJkt,
        cnfThumbprint,
      ),
    )
  } else if (claims?.cnf) {
    checks.push(check('cnf.jwk', cnfThumbprint ? 'passed' : 'failed', 'present', cnfThumbprint))
  }

  if (input.expectedAgentJkt) {
    checks.push(
      check(
        'agent_jkt',
        claims?.agent_jkt === input.expectedAgentJkt ? 'passed' : 'failed',
        input.expectedAgentJkt,
        claims?.agent_jkt ?? null,
      ),
    )
  }
}

function pushR3Checks(
  checks: EvidenceConstraintCheck[],
  claims: AAuthTokenClaims | null,
  input: AAuthAuthorizationEvidenceInput,
): AAuthR3Check {
  const r3: AAuthR3Check = {
    present:
      input.r3 !== undefined ||
      typeof claims?.r3_uri === 'string' ||
      typeof claims?.r3_s256 === 'string',
    uri: input.r3?.uri ?? claims?.r3_uri ?? null,
    s256: input.r3?.s256 ?? claims?.r3_s256 ?? null,
    granted: input.r3?.granted ?? claims?.r3_granted ?? [],
    document_hash_verified: input.r3?.documentHashVerified ?? null,
  }

  if (!input.r3) {
    checks.push(check('r3', 'not_checked'))
    return r3
  }

  const expectedS256 = input.r3.expectedS256 ?? input.r3.s256
  if (expectedS256) {
    checks.push(
      check('r3.s256', r3.s256 === expectedS256 ? 'passed' : 'failed', expectedS256, r3.s256),
    )
  }
  if (input.r3.documentHashVerified !== undefined) {
    checks.push(
      check(
        'r3.document_hash',
        input.r3.documentHashVerified ? 'passed' : 'failed',
        true,
        input.r3.documentHashVerified,
      ),
    )
  }

  return r3
}

export async function verifyAAuthAuthorizationEvidence(
  input: AAuthAuthorizationEvidenceInput,
): Promise<AAuthAuthorizationEvidenceVerification> {
  const errors: string[] = []
  const warnings: string[] = []
  const constraints: EvidenceConstraintCheck[] = []
  let claims: AAuthTokenClaims | null = null
  let token = tokenCheckBase(input)

  try {
    const resolved = await resolveClaims(input)
    claims = resolved.claims
    token = resolved.token
  } catch (err) {
    errors.push(`aauth_evidence token verification error: ${(err as Error).message}`)
  }

  token.token_kind = inferTokenKind(token.typ, input.tokenKind)
  token.jti = typeof claims?.jti === 'string' ? claims.jti : null
  token.agent = tokenAgent(claims, token.token_kind)
  token.parent_agent = typeof claims?.parent_agent === 'string' ? claims.parent_agent : null
  token.act_chain = flattenAct(claims?.act)
  token.cnf_jkt = await cnfJkt(claims)

  const signaturePolicy = input.signaturePolicy ?? 'require'
  if (!claims) {
    errors.push('aauth_evidence missing token claims')
  } else if (!token.claims_verified) {
    if (signaturePolicy === 'require') {
      errors.push('aauth_evidence claims were not verified')
    } else if (signaturePolicy === 'best-effort') {
      warnings.push('aauth_evidence claims were not verified')
    }
  }

  pushTokenTypeCheck(constraints, token, input)
  pushTemporalChecks(constraints, claims, input)
  const scopes = normalizeScopes(claims)
  const attenuationOk = pushScopeChecks(constraints, scopes, input.requiredScopes)
  pushResourceAndAccessModeChecks(constraints, claims, input)
  const delegationOk = pushIdentityChecks(constraints, claims, token, input)
  pushCnfChecks(constraints, claims, token.cnf_jkt, input)
  pushMissionChecks(constraints, claims?.mission, input.requiredMission)
  const httpSignature = pushHttpSignatureChecks(constraints, claims, token.cnf_jkt, input)
  const r3 = pushR3Checks(constraints, claims, input)

  for (const constraint of constraints) {
    if (constraint.status === 'failed') {
      errors.push(`aauth_evidence constraint failed: ${constraint.type}`)
    }
  }

  const issuer = typeof claims?.iss === 'string' ? claims.iss : null
  const subject = typeof claims?.sub === 'string' ? claims.sub : null
  const audience = normalizeAudience(claims)
  const resource = normalizeResource(claims)

  return {
    protocol: 'aauth',
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
      http_signature: httpSignature,
      access_mode: input.accessMode ?? input.resourceMetadata?.access_mode ?? null,
      audience,
      resource,
      mission: claims?.mission ?? null,
      r3,
    },
  }
}
