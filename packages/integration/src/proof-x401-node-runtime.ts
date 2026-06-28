// SPDX-License-Identifier: Apache-2.0

import {
  agent as proofAgent,
  HEADER,
  verifier as proofVerifier,
  X401_VERSION,
} from '@proof.com/x401-node'
import {
  base64urlEncode,
  canonicalRecord,
  getPublicKey,
  hexEncode,
  sha256,
  signRecord,
  type AtribRecord,
} from '@atrib/mcp'
import {
  encodeX401HeaderObject,
  verifyAuthorizationEvidence,
  verifyRecord,
  type AuthorizationEvidenceInput,
  type EvidenceVerificationBlock,
  type RecordVerificationResult,
} from '@atrib/verify'

export type ProofX401NodeRuntimeAdapterMode =
  | 'current_spec_native'
  | 'legacy_sdk_to_current_spec_evidence'

export interface ProofX401NodeRuntimeInteropResult {
  sdk_package: '@proof.com/x401-node'
  sdk_version: string
  adapter_mode: ProofX401NodeRuntimeAdapterMode
  sdk_direct_current_spec_compatible: boolean
  sdk_headers: Record<string, string>
  current_spec_headers: Record<string, string>
  strict_legacy_evidence_rejected: boolean
  record_hashes: {
    attempted_action: string
    successful_action: string
  }
  attempted_record: AtribRecord
  successful_record: AtribRecord
  verification: RecordVerificationResult
  public_evidence: EvidenceVerificationBlock[]
  public_packet: {
    sdk_package: '@proof.com/x401-node'
    sdk_version: string
    adapter_mode: ProofX401NodeRuntimeAdapterMode
    sdk_runtime_exercised: true
    sdk_direct_current_spec_compatible: boolean
    strict_legacy_evidence_rejected: boolean
    proof_gate_status: string | null
    proof_request_hash: string | null
    proof_response_hash: string | null
    legacy_sdk_header_names: string[]
    current_spec_header_names: string[]
    informed_by_resolved: string[]
  }
}

const PRIVATE_KEY = new Uint8Array(32).fill(0x41)
const CONTEXT_ID = '40100000000000000000000000000001'
const REQUEST_ID = 'proof-sdk-runtime-basic-v1'
const AGENT_ID = 'did:web:agent.example'
const NONCE = 'proof-sdk-runtime-nonce-1'
const PROTECTED_URL = 'https://verifier.example/sdk-protected'

const CURRENT_HEADERS = {
  PROOF_REQUEST: 'PROOF-REQUEST',
  PROOF_RESPONSE: 'PROOF-RESPONSE',
  PROOF_RESULT: 'PROOF-RESULT',
} as const

const encoder = new TextEncoder()

function asRecord(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be a JSON object`)
  }
  return value as Record<string, unknown>
}

function sdkHeaderMap(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(HEADER as Record<string, string>).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
}

function sdkHasCurrentHeaders(headers: Record<string, string>): boolean {
  return (
    headers['PROOF_REQUEST'] === CURRENT_HEADERS.PROOF_REQUEST &&
    headers['PROOF_RESPONSE'] === CURRENT_HEADERS.PROOF_RESPONSE &&
    headers['PROOF_RESULT'] === CURRENT_HEADERS.PROOF_RESULT
  )
}

function currentAdapterMode(headers: Record<string, string>): ProofX401NodeRuntimeAdapterMode {
  return sdkHasCurrentHeaders(headers)
    ? 'current_spec_native'
    : 'legacy_sdk_to_current_spec_evidence'
}

function unsecuredJwt(payload: Record<string, unknown>): string {
  const header = encodeX401HeaderObject({ alg: 'none', typ: 'JWT' })
  const body = encodeX401HeaderObject(payload)
  return `${header}.${body}.`
}

function objectHash(value: unknown): string {
  return `sha256:${hexEncode(sha256(encoder.encode(JSON.stringify(value))))}`
}

function recordHash(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

async function signActionRecord(input: {
  label: string
  content: Record<string, unknown>
  informedBy?: string[]
}): Promise<AtribRecord> {
  const pubKey = base64urlEncode(await getPublicKey(PRIVATE_KEY))
  return signRecord(
    {
      spec_version: 'atrib/1.0',
      content_id: objectHash({
        label: input.label,
        content: input.content,
      }),
      creator_key: pubKey,
      chain_root: 'sha256:' + '4'.repeat(64),
      event_type: 'https://atrib.dev/v1/types/tool_call',
      context_id: CONTEXT_ID,
      timestamp: 1_700_000_000_401,
      informed_by: input.informedBy,
      signature: '',
    } as AtribRecord,
    PRIVATE_KEY,
  )
}

export function proofX401NodePayloadToCurrentSpecPayload(value: unknown): Record<string, unknown> {
  const payload = asRecord(value, 'Proof SDK x401 payload')
  const current: Record<string, unknown> = {}
  for (const [key, member] of Object.entries(payload)) {
    if (key === 'presentation_requirements' || key === 'trust_establishment') continue
    current[key] = member
  }

  if (!current['credential_requirements'] && payload['presentation_requirements']) {
    current['credential_requirements'] = {
      digital: payload['presentation_requirements'],
    }
  }

  return current
}

export function proofX401NodeVpArtifactToCurrentSpecResultArtifact(
  value: unknown,
): Record<string, unknown> {
  const artifact = asRecord(value, 'Proof SDK VP artifact')
  const current: Record<string, unknown> = {}

  for (const key of ['request_id', 'agent_id', 'expires_at']) {
    if (artifact[key] !== undefined) current[key] = artifact[key]
  }

  if (artifact['credential_result'] !== undefined) {
    current['credential_result'] = artifact['credential_result']
  } else if (artifact['response'] !== undefined) {
    current['credential_result'] = artifact['response']
  }

  if (artifact['credential_result_uri'] !== undefined) {
    current['credential_result_uri'] = artifact['credential_result_uri']
  } else if (artifact['presentation_uri'] !== undefined) {
    current['credential_result_uri'] = artifact['presentation_uri']
  }

  return current
}

export function proofX401NodeTokenObjectToCurrentSpecTokenObject(
  value: unknown,
): Record<string, unknown> {
  return { ...asRecord(value, 'Proof SDK token object') }
}

function buildSdkPayload(): ReturnType<typeof proofVerifier.buildPayload> {
  return proofVerifier.buildPayload({
    presentationRequirements: {
      requests: [
        {
          protocol: 'openid4vp-v1-signed',
          data: {
            request: unsecuredJwt({
              client_id: 'https://verifier.example/client.json',
              nonce: NONCE,
            }),
          },
        },
      ],
    },
    oauth: { token_endpoint: 'https://verifier.example/oauth/token' },
    trustEstablishment: 'https://verifier.example/.well-known/x401/trust/basic-v1',
    requestId: REQUEST_ID,
    satisfiedRequirements: ['urn:proof:x401:satisfaction:sdk-runtime:v1'],
    payment: {
      required: false,
      scheme_hint: 'ap2',
      notes: 'Payment, if required later, stays outside x401.',
    },
  })
}

function buildSdkVpArtifact(): ReturnType<typeof proofAgent.buildVPArtifact> {
  return proofAgent.buildVPArtifact({
    response: {
      protocol: 'openid4vp-v1-signed',
      data: {
        vp_token: 'private-fixture-vp-token',
        nonce: NONCE,
      },
    },
    requestId: REQUEST_ID,
    agentId: AGENT_ID,
  })
}

function resultDetails(evidence: EvidenceVerificationBlock | undefined): {
  proof_request_hash: string | null
  proof_response_hash: string | null
  proof_gate_status: string | null
} {
  const details = evidence?.details as
    | {
        proof_request_hash?: string | null
        proof_response_hash?: string | null
        proof_gate?: { status?: string | null }
      }
    | undefined
  return {
    proof_request_hash: details?.proof_request_hash ?? null,
    proof_response_hash: details?.proof_response_hash ?? null,
    proof_gate_status: details?.proof_gate?.status ?? null,
  }
}

export async function runProofX401NodeRuntimeInterop(): Promise<ProofX401NodeRuntimeInteropResult> {
  const headers = sdkHeaderMap()
  const adapterMode = currentAdapterMode(headers)
  const sdkPayload = buildSdkPayload()
  const sdkProofRequest = proofVerifier.encodePayload(sdkPayload)
  const sdkRequirement = proofAgent.detectProofRequirement({
    headers: { [headers['PROOF_REQUIRED'] ?? 'PROOF-REQUIRED']: sdkProofRequest },
  })
  if (!sdkRequirement) throw new Error('Proof SDK did not detect its own proof requirement')

  const currentPayload = proofX401NodePayloadToCurrentSpecPayload(sdkRequirement.payload)
  const sdkArtifact = buildSdkVpArtifact()
  const sdkProofPresentation = proofAgent.encodeVPArtifact(sdkArtifact)
  const decodedSdkArtifact = proofVerifier.decodeVPArtifact(sdkProofPresentation)
  const currentResultArtifact =
    proofX401NodeVpArtifactToCurrentSpecResultArtifact(decodedSdkArtifact)

  const currentHeaders = {
    [CURRENT_HEADERS.PROOF_REQUEST]: encodeX401HeaderObject(currentPayload),
    [CURRENT_HEADERS.PROOF_RESPONSE]: encodeX401HeaderObject(currentResultArtifact),
  }
  const legacyHeaders = {
    [headers['PROOF_REQUIRED'] ?? 'PROOF-REQUIRED']: sdkProofRequest,
    [headers['PROOF_PRESENTATION'] ?? 'PROOF-PRESENTATION']: sdkProofPresentation,
  }

  const strictLegacy = await verifyAuthorizationEvidence({
    protocol: 'x401',
    x401: {
      headers: legacyHeaders,
      allowLegacyHeaders: false,
      allowLegacyFields: false,
      resultVerified: true,
      expectedRequestId: REQUEST_ID,
    },
  })

  const authorizationEvidence: AuthorizationEvidenceInput = {
    protocol: 'x401',
    x401: {
      headers: currentHeaders,
      resultVerified: true,
      expectedVersion: X401_VERSION,
      expectedRequestId: REQUEST_ID,
      expectedAgentId: AGENT_ID,
      expectedCredentialProtocol: 'openid4vp-v1-signed',
      expectedNonce: NONCE,
      requiredSatisfiedRequirements: ['urn:proof:x401:satisfaction:sdk-runtime:v1'],
      allowLegacyHeaders: false,
      allowLegacyFields: false,
    },
  }

  const attemptedRecord = await signActionRecord({
    label: 'proof_x401_node_runtime_attempt',
    content: {
      method: 'GET',
      url: PROTECTED_URL,
      sdk_package: '@proof.com/x401-node',
      sdk_version: X401_VERSION,
      adapter_mode: adapterMode,
      sdk_header_names: Object.values(headers),
      current_spec_header_names: Object.values(CURRENT_HEADERS),
    },
  })
  const attemptedHash = recordHash(attemptedRecord)
  const successfulRecord = await signActionRecord({
    label: 'proof_x401_node_runtime_success',
    content: {
      method: 'GET',
      url: PROTECTED_URL,
      sdk_package: '@proof.com/x401-node',
      sdk_version: X401_VERSION,
      adapter_mode: adapterMode,
      proof_request_hash: objectHash(currentPayload),
      proof_response_hash: objectHash(currentResultArtifact),
    },
    informedBy: [attemptedHash],
  })
  const successfulHash = recordHash(successfulRecord)

  const verification = await verifyRecord(successfulRecord, {
    informedByCandidates: [attemptedRecord],
    authorizationEvidence: [authorizationEvidence],
  })
  const publicEvidence = verification.evidence ?? []
  const x401Evidence = publicEvidence.find((block) => block.protocol === 'x401')
  const details = resultDetails(x401Evidence)
  const sdkDirectCurrentSpecCompatible = sdkHasCurrentHeaders(headers)

  return {
    sdk_package: '@proof.com/x401-node',
    sdk_version: X401_VERSION,
    adapter_mode: adapterMode,
    sdk_direct_current_spec_compatible: sdkDirectCurrentSpecCompatible,
    sdk_headers: headers,
    current_spec_headers: {
      proof_request: CURRENT_HEADERS.PROOF_REQUEST,
      proof_response: CURRENT_HEADERS.PROOF_RESPONSE,
      proof_result: CURRENT_HEADERS.PROOF_RESULT,
    },
    strict_legacy_evidence_rejected: !strictLegacy.valid,
    record_hashes: {
      attempted_action: attemptedHash,
      successful_action: successfulHash,
    },
    attempted_record: attemptedRecord,
    successful_record: successfulRecord,
    verification,
    public_evidence: publicEvidence,
    public_packet: {
      sdk_package: '@proof.com/x401-node',
      sdk_version: X401_VERSION,
      adapter_mode: adapterMode,
      sdk_runtime_exercised: true,
      sdk_direct_current_spec_compatible: sdkDirectCurrentSpecCompatible,
      strict_legacy_evidence_rejected: !strictLegacy.valid,
      proof_gate_status: details.proof_gate_status,
      proof_request_hash: details.proof_request_hash,
      proof_response_hash: details.proof_response_hash,
      legacy_sdk_header_names: Object.values(headers),
      current_spec_header_names: Object.values(CURRENT_HEADERS),
      informed_by_resolved: verification.informed_by_resolution?.resolved ?? [],
    },
  }
}
