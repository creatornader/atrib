// SPDX-License-Identifier: Apache-2.0

import { base64urlDecode, base64urlEncode, hexEncode, sha256 } from '@atrib/mcp'
import canonicalize from 'canonicalize'
import { decodeJwt } from 'jose'
import type {
  EvidenceCheckStatus,
  EvidenceConstraintCheck,
  EvidenceVerificationBlock,
} from './authorization-evidence.js'

export type X401EvidenceProtocol = 'x401'
export type X401VerificationPolicy = 'require' | 'best-effort' | 'off'
export type X401HeaderValue = string | string[] | undefined
export type X401HeaderSource = Record<string, X401HeaderValue>
export type X401ResponseKind = 'result_artifact' | 'token' | 'unknown'
export type X401ProofGateStatus = 'passed' | 'failed' | 'unresolved' | 'not_checked'

export interface X401HeaderSet {
  proofRequest?: string
  proofResponse?: string
  proofResult?: string
  legacyProofRequired?: string
  legacyProofPresentation?: string
  legacyProofResponse?: string
}

export interface X401AuthorizationEvidenceInput {
  protocol?: X401EvidenceProtocol
  headers?: X401HeaderSource
  headerSet?: X401HeaderSet
  proofRequest?: unknown
  proofResponse?: unknown
  proofResult?: unknown
  allowLegacyHeaders?: boolean
  allowLegacyFields?: boolean
  verificationPolicy?: X401VerificationPolicy
  resultVerified?: boolean
  tokenVerified?: boolean
  expectedVersion?: string
  expectedRequestId?: string
  expectedAgentId?: string
  expectedCredentialProtocol?: string
  requiredSatisfiedRequirements?: string[]
  expectedNonce?: string
  expectedAgentOrigin?: string
  agentOrigin?: string
  agentOriginVerified?: boolean
  issuerTrustVerified?: boolean
  issuerTrustRootType?: string
  issuerTrustRootRef?: string
  proofPaymentBindingVerified?: boolean
  proofPaymentBindingRef?: string
  requireProofRequest?: boolean
  requireProofResponse?: boolean
}

export interface X401AuthorizationEvidenceDetails {
  version: string | null
  request_id: string | null
  header_names: string[]
  legacy_headers_used: string[]
  legacy_fields_used: string[]
  proof_request_hash: string | null
  proof_response_hash: string | null
  proof_result_hash: string | null
  credential_protocol: string | null
  nonce: string | null
  agent_id: string | null
  response_kind: X401ResponseKind | null
  result_verified: boolean | null
  token_verified: boolean | null
  proof_gate: {
    kind: X401ResponseKind | null
    status: X401ProofGateStatus
  }
  satisfied_requirements: string[]
  payment_separation: {
    present: boolean
    required: boolean | null
    scheme_hint: string | null
  }
  agent_origin: {
    expected_hash: string | null
    actual_hash: string | null
    verified: boolean | null
  }
  issuer_trust: {
    verified: boolean | null
    root_type: string | null
    root_ref_hash: string | null
  }
  proof_payment_binding: {
    verified: boolean | null
    reference_hash: string | null
  }
  verifier_client_id: string | null
  credential_result_uri_present: boolean
  credential_result_uri_hash: string | null
}

export interface X401AuthorizationEvidenceVerification extends EvidenceVerificationBlock<X401AuthorizationEvidenceDetails> {
  protocol: X401EvidenceProtocol
}

interface HeaderResolution {
  set: X401HeaderSet
  headerNames: string[]
  legacyHeadersUsed: string[]
  constraints: EvidenceConstraintCheck[]
  errors: string[]
}

interface DecodedX401 {
  proofRequest: Record<string, unknown> | null
  proofResponse: Record<string, unknown> | null
  proofResult: Record<string, unknown> | null
}

interface CredentialRequestSummary {
  valid: boolean
  legacyFieldsUsed: string[]
  credentialProtocol: string | null
  nonce: string | null
  verifierClientId: string | null
}

interface ProofResponseSummary {
  kind: X401ResponseKind
  requestId: string | null
  agentId: string | null
  credentialProtocol: string | null
  credentialResultUri: string | null
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export function encodeX401HeaderObject(value: unknown): string {
  return base64urlEncode(textEncoder.encode(JSON.stringify(value)))
}

export function decodeX401HeaderObject(value: string): unknown {
  return JSON.parse(textDecoder.decode(base64urlDecode(value)))
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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function canonicalObjectHash(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const canonical = canonicalize(value)
  if (canonical === undefined) return null
  return `sha256:${hexEncode(sha256(textEncoder.encode(canonical)))}`
}

function labeledStringHash(label: string, value: string | undefined): string | null {
  if (value === undefined) return null
  return canonicalObjectHash({ [label]: value })
}

function stringMember(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key]
  return typeof value === 'string' ? value : null
}

function objectMember(
  record: Record<string, unknown> | null,
  key: string,
): Record<string, unknown> | null {
  return asRecord(record?.[key])
}

function stringArrayMember(record: Record<string, unknown> | null, key: string): string[] {
  const value = record?.[key]
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

function firstString(value: X401HeaderValue): string | null {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && value.length === 1 && typeof value[0] === 'string') return value[0]
  return null
}

function readHeader(
  headers: X401HeaderSource | undefined,
  names: string[],
): {
  value: string | null
  actualName: string | null
  constraint: EvidenceConstraintCheck | null
} {
  if (!headers) return { value: null, actualName: null, constraint: null }
  const normalized = names.map((name) => name.toLowerCase())
  for (const [name, value] of Object.entries(headers)) {
    if (!normalized.includes(name.toLowerCase())) continue

    const exactValue = firstString(value)
    const invalidList = Array.isArray(value) && (value.length !== 1 || typeof value[0] !== 'string')
    const commaList = typeof exactValue === 'string' && exactValue.includes(',')
    if (invalidList || commaList || exactValue === null) {
      return {
        value: null,
        actualName: name,
        constraint: check(
          `x401.header.${name.toLowerCase()}.single`,
          'failed',
          'one base64url JSON object',
          value,
          'x401 proof headers must not contain multiple values or comma lists',
        ),
      }
    }

    return {
      value: exactValue,
      actualName: name,
      constraint: check(`x401.header.${name.toLowerCase()}.single`, 'passed'),
    }
  }

  return { value: null, actualName: null, constraint: null }
}

function pushHeaderValue(
  set: X401HeaderSet,
  key: keyof X401HeaderSet,
  value: string | undefined,
): void {
  if (value !== undefined) set[key] = value
}

function resolveHeaders(input: X401AuthorizationEvidenceInput): HeaderResolution {
  const set: X401HeaderSet = { ...(input.headerSet ?? {}) }
  const headerNames: string[] = []
  const legacyHeadersUsed: string[] = []
  const constraints: EvidenceConstraintCheck[] = []
  const errors: string[] = []

  const request = readHeader(input.headers, ['proof-request'])
  const response = readHeader(input.headers, ['proof-response'])
  const result = readHeader(input.headers, ['proof-result'])
  const legacyRequired = readHeader(input.headers, ['proof-required'])
  const legacyPresentation = readHeader(input.headers, ['proof-presentation'])

  for (const item of [request, response, result, legacyRequired, legacyPresentation]) {
    if (item.constraint) constraints.push(item.constraint)
    if (item.actualName) headerNames.push(item.actualName)
  }

  pushHeaderValue(set, 'proofRequest', request.value ?? undefined)
  pushHeaderValue(set, 'proofResponse', response.value ?? undefined)
  pushHeaderValue(set, 'proofResult', result.value ?? undefined)
  pushHeaderValue(set, 'legacyProofRequired', legacyRequired.value ?? undefined)
  pushHeaderValue(set, 'legacyProofPresentation', legacyPresentation.value ?? undefined)

  if (input.headerSet) {
    for (const key of Object.keys(input.headerSet)) headerNames.push(`headerSet.${key}`)
  }
  if (input.proofRequest !== undefined) headerNames.push('direct.proofRequest')
  if (input.proofResponse !== undefined) headerNames.push('direct.proofResponse')
  if (input.proofResult !== undefined) headerNames.push('direct.proofResult')

  if (set.legacyProofRequired) legacyHeadersUsed.push('PROOF-REQUIRED')
  if (set.legacyProofPresentation) legacyHeadersUsed.push('PROOF-PRESENTATION')
  if (set.legacyProofResponse) legacyHeadersUsed.push('PROOF-RESPONSE')

  const allowLegacy = input.allowLegacyHeaders ?? true
  if (!allowLegacy && legacyHeadersUsed.length > 0) {
    errors.push('x401_evidence legacy proof headers are not allowed')
  }

  return {
    set,
    headerNames: Array.from(new Set(headerNames)),
    legacyHeadersUsed,
    constraints,
    errors,
  }
}

function decodeObjectValue(
  value: unknown,
  name: string,
  errors: string[],
): Record<string, unknown> | null {
  if (value === undefined) return null
  if (typeof value === 'string') {
    try {
      const decoded = decodeX401HeaderObject(value)
      const record = asRecord(decoded)
      if (!record) {
        errors.push(`x401_evidence ${name} decoded value is not an object`)
        return null
      }
      return record
    } catch (err) {
      errors.push(`x401_evidence ${name} decode error: ${(err as Error).message}`)
      return null
    }
  }

  const record = asRecord(value)
  if (!record) errors.push(`x401_evidence ${name} value is not an object`)
  return record
}

function decodeInput(input: X401AuthorizationEvidenceInput, headers: X401HeaderSet): DecodedX401 {
  const errors: string[] = []
  const proofRequest =
    decodeObjectValue(input.proofRequest, 'proof request', errors) ??
    decodeObjectValue(headers.proofRequest, 'PROOF-REQUEST', errors) ??
    decodeObjectValue(headers.legacyProofRequired, 'PROOF-REQUIRED', errors)
  const proofResponse =
    decodeObjectValue(input.proofResponse, 'proof response', errors) ??
    decodeObjectValue(headers.proofResponse, 'PROOF-RESPONSE', errors) ??
    decodeObjectValue(headers.legacyProofPresentation, 'PROOF-PRESENTATION', errors)
  const proofResult =
    decodeObjectValue(input.proofResult, 'proof result', errors) ??
    decodeObjectValue(headers.proofResult, 'PROOF-RESULT', errors) ??
    decodeObjectValue(headers.legacyProofResponse, 'legacy PROOF-RESPONSE', errors)

  if (errors.length > 0) throw new Error(errors.join('; '))
  return { proofRequest, proofResponse, proofResult }
}

function decodeRequestJwt(jwt: string): Record<string, unknown> | null {
  try {
    return decodeJwt(jwt) as Record<string, unknown>
  } catch {
    return null
  }
}

function summarizeCredentialRequest(
  payload: Record<string, unknown> | null,
  allowLegacyFields: boolean,
): CredentialRequestSummary {
  if (!payload) {
    return {
      valid: false,
      legacyFieldsUsed: [],
      credentialProtocol: null,
      nonce: null,
      verifierClientId: null,
    }
  }

  const legacyFieldsUsed: string[] = []
  let credentialRequirements = objectMember(payload, 'credential_requirements')
  if (!credentialRequirements) {
    credentialRequirements = objectMember(payload, 'presentation_requirements')
    if (credentialRequirements) legacyFieldsUsed.push('presentation_requirements')
  }

  if (!credentialRequirements || (!allowLegacyFields && legacyFieldsUsed.length > 0)) {
    return {
      valid: false,
      legacyFieldsUsed,
      credentialProtocol: null,
      nonce: null,
      verifierClientId: null,
    }
  }

  const digital = objectMember(credentialRequirements, 'digital')
  const requests = Array.isArray(digital?.['requests']) ? digital['requests'] : []
  const firstRequest = requests.map(asRecord).find((entry) => entry !== null) ?? null
  const credentialProtocol = stringMember(firstRequest, 'protocol')
  const data = objectMember(firstRequest, 'data')
  const requestJwt = stringMember(data, 'request')
  const decodedJwt = requestJwt ? decodeRequestJwt(requestJwt) : null

  return {
    valid: digital !== null && requests.length > 0,
    legacyFieldsUsed,
    credentialProtocol,
    nonce: stringMember(decodedJwt, 'nonce') ?? stringMember(data, 'nonce'),
    verifierClientId:
      stringMember(decodedJwt, 'client_id') ??
      stringMember(decodedJwt, 'iss') ??
      stringMember(data, 'client_id'),
  }
}

function summarizeProofResponse(response: Record<string, unknown> | null): ProofResponseSummary {
  if (!response) {
    return {
      kind: 'unknown',
      requestId: null,
      agentId: null,
      credentialProtocol: null,
      credentialResultUri: null,
    }
  }

  const credentialResult = objectMember(response, 'credential_result')
  const credentialResultUri = stringMember(response, 'credential_result_uri')
  const accessToken = stringMember(response, 'access_token')
  const tokenType = stringMember(response, 'token_type')
  const requestId = stringMember(response, 'request_id')
  const agentId = stringMember(response, 'agent_id')

  if (credentialResult || credentialResultUri) {
    return {
      kind: 'result_artifact',
      requestId,
      agentId,
      credentialProtocol: stringMember(credentialResult, 'protocol'),
      credentialResultUri,
    }
  }

  if (accessToken || tokenType) {
    return {
      kind: 'token',
      requestId,
      agentId,
      credentialProtocol: null,
      credentialResultUri: null,
    }
  }

  return {
    kind: 'unknown',
    requestId,
    agentId,
    credentialProtocol: null,
    credentialResultUri: null,
  }
}

function proofGateStatus(
  responseKind: X401ResponseKind,
  resultVerified: boolean | undefined,
  tokenVerified: boolean | undefined,
  proofResult: Record<string, unknown> | null,
): X401ProofGateStatus {
  if (typeof proofResult?.['error'] === 'string') return 'failed'
  if (responseKind === 'result_artifact') {
    if (resultVerified === true) return 'passed'
    if (resultVerified === false) return 'failed'
    return 'unresolved'
  }
  if (responseKind === 'token') {
    if (tokenVerified === true) return 'passed'
    if (tokenVerified === false) return 'failed'
    return 'unresolved'
  }
  return 'not_checked'
}

function pushVersionChecks(
  constraints: EvidenceConstraintCheck[],
  payload: Record<string, unknown> | null,
  expectedVersion: string | undefined,
): string | null {
  const version = stringMember(payload, 'version')
  if (expectedVersion) {
    constraints.push(
      check(
        'x401.payload.version',
        version === expectedVersion ? 'passed' : 'failed',
        expectedVersion,
        version,
      ),
    )
  } else {
    constraints.push(
      check(
        'x401.payload.version',
        typeof version === 'string' ? 'passed' : 'failed',
        'string',
        version,
      ),
    )
  }
  return version
}

function pushRequestIdChecks(
  constraints: EvidenceConstraintCheck[],
  expectedRequestId: string | undefined,
  payloadRequestId: string | null,
  responseRequestId: string | null,
): string | null {
  if (expectedRequestId) {
    const values = [payloadRequestId, responseRequestId].filter(
      (entry): entry is string => typeof entry === 'string',
    )
    const passed = values.length > 0 && values.every((entry) => entry === expectedRequestId)
    constraints.push(
      check(
        'x401.request_id',
        passed ? 'passed' : 'failed',
        expectedRequestId,
        values,
        passed ? undefined : 'request id did not match expected value',
      ),
    )
  }

  if (payloadRequestId && responseRequestId) {
    constraints.push(
      check(
        'x401.request_id.binding',
        payloadRequestId === responseRequestId ? 'passed' : 'failed',
        payloadRequestId,
        responseRequestId,
      ),
    )
  }

  return responseRequestId ?? payloadRequestId
}

function pushSatisfiedRequirementChecks(
  constraints: EvidenceConstraintCheck[],
  satisfiedRequirements: string[],
  requiredSatisfiedRequirements: string[] | undefined,
): boolean | null {
  if (!requiredSatisfiedRequirements || requiredSatisfiedRequirements.length === 0) {
    constraints.push(check('x401.satisfied_requirements', 'not_checked'))
    return null
  }

  const missing = requiredSatisfiedRequirements.filter(
    (requirement) => !satisfiedRequirements.includes(requirement),
  )
  constraints.push(
    check(
      'x401.satisfied_requirements',
      missing.length === 0 ? 'passed' : 'failed',
      requiredSatisfiedRequirements,
      satisfiedRequirements,
      missing.length === 0 ? undefined : `missing requirements: ${missing.join(', ')}`,
    ),
  )
  return missing.length === 0
}

function pushVerificationPolicyCheck(
  constraints: EvidenceConstraintCheck[],
  errors: string[],
  warnings: string[],
  type: 'result' | 'token',
  verified: boolean | undefined,
  policy: X401VerificationPolicy,
): boolean | null {
  const constraintType = `x401.${type}_verified`
  if (policy === 'off') {
    constraints.push(check(constraintType, 'not_checked'))
    return null
  }

  if (verified === true) {
    constraints.push(check(constraintType, 'passed', true, true))
    return true
  }

  if (verified === false) {
    constraints.push(check(constraintType, 'failed', true, false))
    errors.push(`x401_evidence ${type} verification failed`)
    return false
  }

  constraints.push(
    check(
      constraintType,
      'unresolved',
      true,
      null,
      'caller must supply verified credential or token outcome',
    ),
  )
  if (policy === 'require') {
    errors.push(`x401_evidence ${type} verification unresolved`)
  } else {
    warnings.push(`x401_evidence ${type} verification unresolved`)
  }
  return null
}

function pushOptionalVerifiedFactCheck(
  constraints: EvidenceConstraintCheck[],
  errors: string[],
  warnings: string[],
  type: string,
  verified: boolean | undefined,
  active: boolean,
  failureMessage: string,
  unresolvedMessage: string,
): boolean | null {
  if (verified === true) {
    constraints.push(check(type, 'passed', true, true))
    return true
  }

  if (verified === false) {
    constraints.push(check(type, 'failed', true, false))
    errors.push(failureMessage)
    return false
  }

  if (active) {
    constraints.push(check(type, 'unresolved', true, null, unresolvedMessage))
    warnings.push(unresolvedMessage)
    return null
  }

  constraints.push(check(type, 'not_checked'))
  return null
}

function pushProofResultChecks(
  constraints: EvidenceConstraintCheck[],
  errors: string[],
  proofResult: Record<string, unknown> | null,
): void {
  if (!proofResult) {
    constraints.push(check('x401.proof_result', 'not_checked'))
    return
  }

  const error = stringMember(proofResult, 'error')
  if (error) {
    constraints.push(
      check('x401.proof_result.error', 'failed', 'absent', error, 'verifier returned error'),
    )
    errors.push(`x401_evidence proof result error: ${error}`)
    return
  }

  constraints.push(check('x401.proof_result', 'passed'))
}

export function verifyX401AuthorizationEvidence(
  input: X401AuthorizationEvidenceInput,
): X401AuthorizationEvidenceVerification {
  const errors: string[] = []
  const warnings: string[] = []
  const constraints: EvidenceConstraintCheck[] = []
  const headerResolution = resolveHeaders(input)
  constraints.push(...headerResolution.constraints)
  errors.push(...headerResolution.errors)
  const allowLegacyFields = input.allowLegacyFields ?? true

  let decoded: DecodedX401 = {
    proofRequest: null,
    proofResponse: null,
    proofResult: null,
  }
  try {
    decoded = decodeInput(input, headerResolution.set)
  } catch (err) {
    errors.push((err as Error).message)
  }

  if (headerResolution.legacyHeadersUsed.length > 0) {
    warnings.push(
      `x401_evidence legacy header names used: ${headerResolution.legacyHeadersUsed.join(', ')}`,
    )
  }

  const requireProofRequest = input.requireProofRequest ?? true
  constraints.push(
    check(
      'x401.proof_request',
      decoded.proofRequest ? 'passed' : requireProofRequest ? 'failed' : 'not_checked',
      requireProofRequest ? 'present' : undefined,
      decoded.proofRequest ? 'present' : null,
    ),
  )
  if (requireProofRequest && !decoded.proofRequest) {
    errors.push('x401_evidence missing proof request')
  }

  const credentialSummary = summarizeCredentialRequest(decoded.proofRequest, allowLegacyFields)
  if (credentialSummary.legacyFieldsUsed.length > 0) {
    warnings.push(
      `x401_evidence legacy payload fields used: ${credentialSummary.legacyFieldsUsed.join(', ')}`,
    )
  }
  if (!allowLegacyFields && credentialSummary.legacyFieldsUsed.length > 0) {
    errors.push('x401_evidence legacy payload fields are not allowed')
  }

  constraints.push(
    check(
      'x401.payload.scheme',
      stringMember(decoded.proofRequest, 'scheme') === 'x401' ? 'passed' : 'failed',
      'x401',
      stringMember(decoded.proofRequest, 'scheme'),
    ),
  )
  const version = pushVersionChecks(constraints, decoded.proofRequest, input.expectedVersion)
  constraints.push(
    check(
      'x401.payload.credential_requirements.digital',
      credentialSummary.valid ? 'passed' : 'failed',
      'digital.requests[]',
      credentialSummary.credentialProtocol,
    ),
  )
  const oauth = objectMember(decoded.proofRequest, 'oauth')
  constraints.push(
    check(
      'x401.payload.oauth.token_endpoint',
      typeof oauth?.['token_endpoint'] === 'string' ? 'passed' : 'failed',
      'string',
      oauth?.['token_endpoint'] ?? null,
    ),
  )

  if (input.expectedNonce) {
    constraints.push(
      check(
        'x401.openid4vp.nonce',
        credentialSummary.nonce === input.expectedNonce ? 'passed' : 'failed',
        input.expectedNonce,
        credentialSummary.nonce,
      ),
    )
  } else {
    constraints.push(
      check(
        'x401.openid4vp.nonce',
        credentialSummary.nonce ? 'passed' : 'unresolved',
        'present',
        credentialSummary.nonce,
        credentialSummary.nonce
          ? undefined
          : 'nonce is inside the credential protocol request and was not decoded',
      ),
    )
  }

  const responseSummary = summarizeProofResponse(decoded.proofResponse)
  const requireProofResponse = input.requireProofResponse ?? false
  constraints.push(
    check(
      'x401.proof_response',
      decoded.proofResponse ? 'passed' : requireProofResponse ? 'failed' : 'not_checked',
      requireProofResponse ? 'present' : undefined,
      decoded.proofResponse ? responseSummary.kind : null,
    ),
  )
  if (requireProofResponse && !decoded.proofResponse) {
    errors.push('x401_evidence missing proof response')
  }

  if (decoded.proofResponse) {
    const hasCredentialResult = objectMember(decoded.proofResponse, 'credential_result') !== null
    const hasCredentialResultUri =
      typeof decoded.proofResponse['credential_result_uri'] === 'string'
    if (responseSummary.kind === 'result_artifact') {
      constraints.push(
        check(
          'x401.result_artifact.exactly_one_result_source',
          hasCredentialResult !== hasCredentialResultUri ? 'passed' : 'failed',
          'credential_result xor credential_result_uri',
          {
            credential_result: hasCredentialResult,
            credential_result_uri: hasCredentialResultUri,
          },
        ),
      )
    } else if (responseSummary.kind === 'token') {
      constraints.push(
        check(
          'x401.token.scheme',
          stringMember(decoded.proofResponse, 'scheme') === 'x401' ? 'passed' : 'failed',
          'x401',
          stringMember(decoded.proofResponse, 'scheme'),
        ),
      )
      constraints.push(
        check(
          'x401.token.type',
          stringMember(decoded.proofResponse, 'token_type') === 'Bearer' ? 'passed' : 'failed',
          'Bearer',
          stringMember(decoded.proofResponse, 'token_type'),
        ),
      )
    } else {
      constraints.push(
        check(
          'x401.proof_response.kind',
          'failed',
          'result_artifact or token',
          Object.keys(decoded.proofResponse).sort(),
        ),
      )
    }
  }

  const payloadRequestId = stringMember(decoded.proofRequest, 'request_id')
  const requestId = pushRequestIdChecks(
    constraints,
    input.expectedRequestId,
    payloadRequestId,
    responseSummary.requestId,
  )

  const credentialProtocol =
    responseSummary.credentialProtocol ?? credentialSummary.credentialProtocol
  if (input.expectedCredentialProtocol) {
    constraints.push(
      check(
        'x401.credential_result.protocol',
        credentialProtocol === input.expectedCredentialProtocol ? 'passed' : 'failed',
        input.expectedCredentialProtocol,
        credentialProtocol,
      ),
    )
  }

  const satisfiedRequirements = stringArrayMember(decoded.proofRequest, 'satisfied_requirements')
  const attenuationOk = pushSatisfiedRequirementChecks(
    constraints,
    satisfiedRequirements,
    input.requiredSatisfiedRequirements,
  )

  let delegationOk: boolean | null = null
  if (input.expectedAgentId) {
    delegationOk = responseSummary.agentId === input.expectedAgentId
    constraints.push(
      check(
        'x401.agent_id',
        delegationOk ? 'passed' : 'failed',
        input.expectedAgentId,
        responseSummary.agentId,
      ),
    )
  }

  const expectedAgentOriginHash = labeledStringHash(
    'expected_agent_origin',
    input.expectedAgentOrigin,
  )
  const agentOriginHash = labeledStringHash('agent_origin', input.agentOrigin)
  const hasAgentOriginFacts =
    input.expectedAgentOrigin !== undefined ||
    input.agentOrigin !== undefined ||
    input.agentOriginVerified !== undefined
  if (input.expectedAgentOrigin !== undefined) {
    constraints.push(
      check(
        'x401.agent_origin.value',
        input.agentOrigin === input.expectedAgentOrigin ? 'passed' : 'failed',
        expectedAgentOriginHash,
        agentOriginHash,
        input.agentOrigin === input.expectedAgentOrigin
          ? undefined
          : 'agent origin did not match expected value',
      ),
    )
  } else if (input.agentOrigin !== undefined) {
    constraints.push(
      check(
        'x401.agent_origin.value',
        'unresolved',
        'expected origin hash',
        agentOriginHash,
        'caller supplied an agent origin without an expected origin',
      ),
    )
    warnings.push('x401_evidence agent origin supplied without expected origin')
  } else {
    constraints.push(check('x401.agent_origin.value', 'not_checked'))
  }
  const agentOriginVerified = pushOptionalVerifiedFactCheck(
    constraints,
    errors,
    warnings,
    'x401.agent_origin_verified',
    input.agentOriginVerified,
    hasAgentOriginFacts,
    'x401_evidence agent origin verification failed',
    'x401_evidence agent origin verification unresolved',
  )

  const hasIssuerTrustFacts =
    input.issuerTrustVerified !== undefined ||
    input.issuerTrustRootType !== undefined ||
    input.issuerTrustRootRef !== undefined
  const issuerTrustVerified = pushOptionalVerifiedFactCheck(
    constraints,
    errors,
    warnings,
    'x401.issuer_trust_verified',
    input.issuerTrustVerified,
    hasIssuerTrustFacts,
    'x401_evidence issuer trust verification failed',
    'x401_evidence issuer trust verification unresolved',
  )

  const hasProofPaymentBindingFacts =
    input.proofPaymentBindingVerified !== undefined || input.proofPaymentBindingRef !== undefined
  const proofPaymentBindingVerified = pushOptionalVerifiedFactCheck(
    constraints,
    errors,
    warnings,
    'x401.proof_payment_binding_verified',
    input.proofPaymentBindingVerified,
    hasProofPaymentBindingFacts,
    'x401_evidence proof payment binding verification failed',
    'x401_evidence proof payment binding verification unresolved',
  )

  const policy = input.verificationPolicy ?? 'require'
  if (responseSummary.kind === 'result_artifact') {
    pushVerificationPolicyCheck(
      constraints,
      errors,
      warnings,
      'result',
      input.resultVerified,
      policy,
    )
  } else if (responseSummary.kind === 'token') {
    pushVerificationPolicyCheck(constraints, errors, warnings, 'token', input.tokenVerified, policy)
  }

  const paymentHint = decoded.proofRequest?.['payment'] ?? null
  const paymentRecord = asRecord(paymentHint)
  const paymentRequired =
    typeof paymentRecord?.['required'] === 'boolean' ? paymentRecord['required'] : null
  const paymentSchemeHint =
    typeof paymentRecord?.['scheme_hint'] === 'string' ? paymentRecord['scheme_hint'] : null
  if (paymentHint !== null) {
    constraints.push(
      check(
        'x401.payment_separation',
        'passed',
        'informational only',
        paymentHint,
        'x401 payment hints do not satisfy payment protocols',
      ),
    )
  }

  pushProofResultChecks(constraints, errors, decoded.proofResult)

  for (const constraint of constraints) {
    if (constraint.status === 'failed') {
      errors.push(`x401_evidence constraint failed: ${constraint.type}`)
    }
  }

  return {
    protocol: 'x401',
    valid: errors.length === 0,
    issuer: credentialSummary.verifierClientId,
    subject: responseSummary.agentId,
    scope: satisfiedRequirements,
    attenuation_ok: attenuationOk,
    delegation_ok: delegationOk,
    constraints,
    errors: Array.from(new Set(errors)),
    warnings,
    details: {
      version,
      request_id: requestId,
      header_names: headerResolution.headerNames,
      legacy_headers_used: headerResolution.legacyHeadersUsed,
      legacy_fields_used: credentialSummary.legacyFieldsUsed,
      proof_request_hash: canonicalObjectHash(decoded.proofRequest),
      proof_response_hash: canonicalObjectHash(decoded.proofResponse),
      proof_result_hash: canonicalObjectHash(decoded.proofResult),
      credential_protocol: credentialProtocol,
      nonce: credentialSummary.nonce,
      agent_id: responseSummary.agentId,
      response_kind: decoded.proofResponse ? responseSummary.kind : null,
      result_verified:
        responseSummary.kind === 'result_artifact' ? input.resultVerified === true : null,
      token_verified: responseSummary.kind === 'token' ? input.tokenVerified === true : null,
      proof_gate: {
        kind: decoded.proofResponse ? responseSummary.kind : null,
        status: proofGateStatus(
          responseSummary.kind,
          input.resultVerified,
          input.tokenVerified,
          decoded.proofResult,
        ),
      },
      satisfied_requirements: satisfiedRequirements,
      payment_separation: {
        present: paymentHint !== null,
        required: paymentRequired,
        scheme_hint: paymentSchemeHint,
      },
      agent_origin: {
        expected_hash: expectedAgentOriginHash,
        actual_hash: agentOriginHash,
        verified: agentOriginVerified,
      },
      issuer_trust: {
        verified: issuerTrustVerified,
        root_type: input.issuerTrustRootType ?? null,
        root_ref_hash: labeledStringHash('issuer_trust_root_ref', input.issuerTrustRootRef),
      },
      proof_payment_binding: {
        verified: proofPaymentBindingVerified,
        reference_hash: labeledStringHash(
          'proof_payment_binding_ref',
          input.proofPaymentBindingRef,
        ),
      },
      verifier_client_id: credentialSummary.verifierClientId,
      credential_result_uri_present: responseSummary.credentialResultUri !== null,
      credential_result_uri_hash: responseSummary.credentialResultUri
        ? canonicalObjectHash({ credential_result_uri: responseSummary.credentialResultUri })
        : null,
    },
  }
}
