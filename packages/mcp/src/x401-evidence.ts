// SPDX-License-Identifier: Apache-2.0

export interface CapturedX401Evidence {
  protocol: 'x401'
  headers: Record<string, string>
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
  allowLegacyHeaders?: boolean
  allowLegacyFields?: boolean
  verificationPolicy?: 'require' | 'best-effort' | 'off'
}

export interface X401EvidenceCaptureOptions {
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
  allowLegacyHeaders?: boolean
  allowLegacyFields?: boolean
  verificationPolicy?: 'require' | 'best-effort' | 'off'
}

interface McpRequestInfoLike {
  headers?: unknown
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function normalizeCaptureOptions(
  capture: boolean | X401EvidenceCaptureOptions | undefined,
): X401EvidenceCaptureOptions | null {
  if (capture === true) return {}
  if (capture && typeof capture === 'object') return capture
  return null
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

function pushHeader(out: Record<string, string>, headers: unknown, name: string): void {
  const value = headerValue(headers, name)
  if (value !== undefined) out[name] = value
}

export function buildX401EvidenceFromExtra(
  extra: unknown,
  capture: boolean | X401EvidenceCaptureOptions | undefined,
): CapturedX401Evidence | undefined {
  const options = normalizeCaptureOptions(capture)
  if (!options) return undefined

  const extraRecord = asRecord(extra)
  const requestInfo = asRecord(extraRecord?.['requestInfo']) as McpRequestInfoLike | null
  const headers = requestInfo?.headers
  if (!headers) return undefined

  const proofHeaders: Record<string, string> = {}
  pushHeader(proofHeaders, headers, 'PROOF-REQUEST')
  pushHeader(proofHeaders, headers, 'PROOF-RESPONSE')
  pushHeader(proofHeaders, headers, 'PROOF-RESULT')
  pushHeader(proofHeaders, headers, 'PROOF-REQUIRED')
  pushHeader(proofHeaders, headers, 'PROOF-PRESENTATION')

  if (Object.keys(proofHeaders).length === 0) return undefined

  return {
    protocol: 'x401',
    headers: proofHeaders,
    ...(options.resultVerified !== undefined ? { resultVerified: options.resultVerified } : {}),
    ...(options.tokenVerified !== undefined ? { tokenVerified: options.tokenVerified } : {}),
    ...(options.expectedVersion !== undefined ? { expectedVersion: options.expectedVersion } : {}),
    ...(options.expectedRequestId !== undefined
      ? { expectedRequestId: options.expectedRequestId }
      : {}),
    ...(options.expectedAgentId !== undefined ? { expectedAgentId: options.expectedAgentId } : {}),
    ...(options.expectedCredentialProtocol !== undefined
      ? { expectedCredentialProtocol: options.expectedCredentialProtocol }
      : {}),
    ...(options.requiredSatisfiedRequirements !== undefined
      ? { requiredSatisfiedRequirements: options.requiredSatisfiedRequirements }
      : {}),
    ...(options.expectedNonce !== undefined ? { expectedNonce: options.expectedNonce } : {}),
    ...(options.expectedAgentOrigin !== undefined
      ? { expectedAgentOrigin: options.expectedAgentOrigin }
      : {}),
    ...(options.agentOrigin !== undefined ? { agentOrigin: options.agentOrigin } : {}),
    ...(options.agentOriginVerified !== undefined
      ? { agentOriginVerified: options.agentOriginVerified }
      : {}),
    ...(options.issuerTrustVerified !== undefined
      ? { issuerTrustVerified: options.issuerTrustVerified }
      : {}),
    ...(options.issuerTrustRootType !== undefined
      ? { issuerTrustRootType: options.issuerTrustRootType }
      : {}),
    ...(options.issuerTrustRootRef !== undefined
      ? { issuerTrustRootRef: options.issuerTrustRootRef }
      : {}),
    ...(options.proofPaymentBindingVerified !== undefined
      ? { proofPaymentBindingVerified: options.proofPaymentBindingVerified }
      : {}),
    ...(options.proofPaymentBindingRef !== undefined
      ? { proofPaymentBindingRef: options.proofPaymentBindingRef }
      : {}),
    ...(options.requireProofRequest !== undefined
      ? { requireProofRequest: options.requireProofRequest }
      : {}),
    ...(options.requireProofResponse !== undefined
      ? { requireProofResponse: options.requireProofResponse }
      : {}),
    ...(options.allowLegacyHeaders !== undefined
      ? { allowLegacyHeaders: options.allowLegacyHeaders }
      : {}),
    ...(options.allowLegacyFields !== undefined
      ? { allowLegacyFields: options.allowLegacyFields }
      : {}),
    ...(options.verificationPolicy !== undefined
      ? { verificationPolicy: options.verificationPolicy }
      : {}),
  }
}
