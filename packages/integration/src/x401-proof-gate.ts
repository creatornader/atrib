// SPDX-License-Identifier: Apache-2.0

import { createServer, type ServerResponse } from 'node:http'
import { detectTransaction, type TransactionDetection } from '@atrib/agent'
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
  decodeX401HeaderObject,
  encodeX401HeaderObject,
  verifyAuthorizationEvidence,
  verifyRecord,
  type AuthorizationEvidenceInput,
  type EvidenceVerificationBlock,
  type RecordVerificationResult,
} from '@atrib/verify'

const PRIVATE_KEY = new Uint8Array(32).fill(0x58)
const CONTEXT_ID = '40100000000000000000000000000000'
const REQUEST_ID = 'proof-template-basic-v1'
const AGENT_ID = 'did:web:agent.example'
const NONCE = 'x401-proof-gate-nonce-1'
const PROTECTED_PATH = '/protected'

export interface X401ProofGateHarnessResult {
  protected_url: string
  attempts: {
    initial_status: number
    wrong_request_id_status: number
    stale_nonce_status: number
    success_status: number
  }
  record_hashes: {
    attempted_action: string
    successful_action: string
  }
  successful_record: AtribRecord
  attempted_record: AtribRecord
  verification: RecordVerificationResult
  public_evidence: EvidenceVerificationBlock[]
  private_authorization_evidence: AuthorizationEvidenceInput[]
  public_packet: {
    proof_request_hash: string | null
    proof_response_hash: string | null
    proof_gate_status: string | null
    payment_separation: unknown
    informed_by_resolved: string[]
    payment_detected: false
  }
}

export interface X401AAuthPaymentChainHarnessResult {
  x401: X401ProofGateHarnessResult
  verification: RecordVerificationResult
  payment_detection: TransactionDetection
  public_packet: {
    evidence_protocols: string[]
    evidence_valid: Record<string, boolean>
    proof_gate_status: string | null
    aauth_agent: string | null
    aauth_subject: string | null
    payment_detected: boolean
    payment_protocol: string | null
    x401_is_payment: false
    payment_hint_scheme: string | null
    informed_by_resolved: string[]
  }
}

export interface X401MultiEndpointHarnessEndpoint {
  path: string
  protected_url: string
  request_id: string
  attempts: {
    initial_status: number
    success_status: number
  }
  record_hashes: {
    attempted_action: string
    successful_action: string
  }
  attempted_record: AtribRecord
  successful_record: AtribRecord
  verification: RecordVerificationResult
  public_packet: {
    proof_request_hash: string | null
    proof_response_hash: string | null
    proof_gate_status: string | null
    agent_origin_verified: boolean | null
    issuer_trust_verified: boolean | null
    proof_payment_binding_verified: boolean | null
    informed_by_resolved: string[]
    payment_detected: false
  }
}

export interface X401MultiEndpointHarnessResult {
  context_id: string
  endpoints: X401MultiEndpointHarnessEndpoint[]
  public_packet: {
    request_ids: string[]
    successful_action_hashes: string[]
    payment_detected: false
  }
}

interface ProofGateServer {
  url: string
  close(): Promise<void>
}

interface MultiEndpointDefinition {
  path: string
  requestId: string
  nonce: string
  satisfiedRequirement: string
  resource: string
  agentOrigin: string
  trustRootRef: string
  paymentBindingRef: string
}

interface ResultArtifact {
  request_id?: string
  agent_id?: string
  credential_result?: {
    protocol?: string
    data?: {
      vp_token?: string
      nonce?: string
    }
  }
}

const MULTI_ENDPOINTS: MultiEndpointDefinition[] = [
  {
    path: '/protected/address',
    requestId: 'proof-template-address-v1',
    nonce: 'x401-address-nonce-1',
    satisfiedRequirement: 'urn:proof:x401:satisfaction:address:v1',
    resource: 'protected-address',
    agentOrigin: 'https://agent.example/origin/address',
    trustRootRef: 'https://trust.example/x401/address.json',
    paymentBindingRef: 'ap2-receipt:address-001',
  },
  {
    path: '/protected/eligibility',
    requestId: 'proof-template-eligibility-v1',
    nonce: 'x401-eligibility-nonce-1',
    satisfiedRequirement: 'urn:proof:x401:satisfaction:eligibility:v1',
    resource: 'protected-eligibility',
    agentOrigin: 'https://agent.example/origin/eligibility',
    trustRootRef: 'https://trust.example/x401/eligibility.json',
    paymentBindingRef: 'ap2-receipt:eligibility-001',
  },
]

const encoder = new TextEncoder()

function proofRequest(): Record<string, unknown> {
  return {
    scheme: 'x401',
    version: '0.2.0',
    credential_requirements: {
      digital: {
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
    },
    oauth: {
      token_endpoint: 'https://verifier.example/oauth/token',
    },
    request_id: REQUEST_ID,
    satisfied_requirements: ['urn:proof:x401:satisfaction:basic:v1'],
    payment: {
      required: true,
      scheme_hint: 'ap2',
      notes: 'Payment may be required after proof is satisfied.',
    },
  }
}

function proofRequestForEndpoint(endpoint: MultiEndpointDefinition): Record<string, unknown> {
  return {
    scheme: 'x401',
    version: '0.2.0',
    credential_requirements: {
      digital: {
        requests: [
          {
            protocol: 'openid4vp-v1-signed',
            data: {
              request: unsecuredJwt({
                client_id: 'https://verifier.example/client.json',
                nonce: endpoint.nonce,
              }),
            },
          },
        ],
      },
    },
    oauth: {
      token_endpoint: 'https://verifier.example/oauth/token',
    },
    request_id: endpoint.requestId,
    satisfied_requirements: [endpoint.satisfiedRequirement],
    payment: {
      required: true,
      scheme_hint: 'ap2',
      notes: 'Payment may be required after proof is satisfied.',
    },
  }
}

function resultArtifact(overrides: Partial<ResultArtifact> = {}): ResultArtifact {
  return {
    request_id: REQUEST_ID,
    agent_id: AGENT_ID,
    credential_result: {
      protocol: 'openid4vp-v1-signed',
      data: {
        vp_token: 'private-fixture-vp-token',
        nonce: NONCE,
      },
    },
    ...overrides,
  }
}

function resultArtifactForEndpoint(
  endpoint: MultiEndpointDefinition,
  overrides: Partial<ResultArtifact> = {},
): ResultArtifact {
  return {
    request_id: endpoint.requestId,
    agent_id: AGENT_ID,
    credential_result: {
      protocol: 'openid4vp-v1-signed',
      data: {
        vp_token: 'private-fixture-vp-token',
        nonce: endpoint.nonce,
      },
    },
    ...overrides,
  }
}

function unsecuredJwt(payload: Record<string, unknown>): string {
  return `${encodeX401HeaderObject({ alg: 'none', typ: 'JWT' })}.${encodeX401HeaderObject(payload)}.`
}

function objectHash(value: unknown): string {
  return `sha256:${hexEncode(sha256(encoder.encode(JSON.stringify(value))))}`
}

function recordHash(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

async function signActionRecord(input: {
  label: string
  content: unknown
  informedBy?: string[]
}): Promise<AtribRecord> {
  const creatorKey = base64urlEncode(await getPublicKey(PRIVATE_KEY))
  const record = {
    spec_version: 'atrib/1.0' as const,
    event_type: 'https://atrib.dev/v1/types/tool_call',
    timestamp: 1_700_000_000_000,
    context_id: CONTEXT_ID,
    creator_key: creatorKey,
    chain_root: objectHash({ context_id: CONTEXT_ID }),
    content_id: objectHash(input.content),
    tool_name: input.label,
    ...(input.informedBy && input.informedBy.length > 0
      ? { informed_by: [...input.informedBy].sort() }
      : {}),
    signature: '',
  }
  return signRecord(record as AtribRecord, PRIVATE_KEY)
}

async function startProofGateServer(): Promise<ProofGateServer> {
  const requestHeader = encodeX401HeaderObject(proofRequest())
  const server = createServer((req, res) => {
    if (req.url !== PROTECTED_PATH) {
      json(res, 404, { error: 'not_found' })
      return
    }
    const proofResponse = req.headers['proof-response']
    if (typeof proofResponse !== 'string') {
      res.setHeader('PROOF-REQUEST', requestHeader)
      json(res, 401, { error: 'proof_required' })
      return
    }

    let artifact: ResultArtifact
    try {
      artifact = decodeX401HeaderObject(proofResponse) as ResultArtifact
    } catch {
      proofError(res, 'invalid_result')
      return
    }

    if (artifact.request_id !== REQUEST_ID) {
      proofError(res, 'invalid_request_id')
      return
    }
    if (artifact.agent_id !== AGENT_ID) {
      proofError(res, 'invalid_agent_id')
      return
    }
    if (artifact.credential_result?.data?.nonce !== NONCE) {
      proofError(res, 'invalid_nonce')
      return
    }

    json(res, 200, { ok: true, resource: 'protected-result' })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      }),
  }
}

async function startMultiEndpointProofGateServer(
  endpoints: MultiEndpointDefinition[],
): Promise<ProofGateServer> {
  const byPath = new Map(endpoints.map((endpoint) => [endpoint.path, endpoint]))
  const requestHeadersByPath = new Map(
    endpoints.map((endpoint) => [
      endpoint.path,
      encodeX401HeaderObject(proofRequestForEndpoint(endpoint)),
    ]),
  )
  const server = createServer((req, res) => {
    const endpoint = byPath.get(req.url ?? '')
    if (!endpoint) {
      json(res, 404, { error: 'not_found' })
      return
    }

    const proofResponse = req.headers['proof-response']
    if (typeof proofResponse !== 'string') {
      res.setHeader('PROOF-REQUEST', requestHeadersByPath.get(endpoint.path) ?? '')
      json(res, 401, { error: 'proof_required' })
      return
    }

    let artifact: ResultArtifact
    try {
      artifact = decodeX401HeaderObject(proofResponse) as ResultArtifact
    } catch {
      proofErrorForEndpoint(res, endpoint, 'invalid_result')
      return
    }

    if (artifact.request_id !== endpoint.requestId) {
      proofErrorForEndpoint(res, endpoint, 'invalid_request_id')
      return
    }
    if (artifact.agent_id !== AGENT_ID) {
      proofErrorForEndpoint(res, endpoint, 'invalid_agent_id')
      return
    }
    if (artifact.credential_result?.data?.nonce !== endpoint.nonce) {
      proofErrorForEndpoint(res, endpoint, 'invalid_nonce')
      return
    }

    json(res, 200, { ok: true, resource: endpoint.resource })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      }),
  }
}

function proofError(res: ServerResponse, error: string): void {
  res.setHeader(
    'PROOF-RESULT',
    encodeX401HeaderObject({
      scheme: 'x401',
      version: '0.2.0',
      error,
      request_id: REQUEST_ID,
    }),
  )
  json(res, 401, { error })
}

function proofErrorForEndpoint(
  res: ServerResponse,
  endpoint: MultiEndpointDefinition,
  error: string,
): void {
  res.setHeader(
    'PROOF-RESULT',
    encodeX401HeaderObject({
      scheme: 'x401',
      version: '0.2.0',
      error,
      request_id: endpoint.requestId,
    }),
  )
  json(res, 401, { error })
}

function json(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.setHeader('content-length', Buffer.byteLength(body))
  res.end(body)
}

function headerValue(response: Response, name: string): string {
  const value = response.headers.get(name)
  if (!value) throw new Error(`missing ${name} header`)
  return value
}

function requestHeaders(proofResponse: ResultArtifact): HeadersInit {
  return {
    'PROOF-RESPONSE': encodeX401HeaderObject(proofResponse),
  }
}

function aauthAuthorizationEvidence(resource: string): AuthorizationEvidenceInput {
  return {
    protocol: 'aauth',
    aauth: {
      claims: {
        iss: 'https://ps.example',
        aud: [resource],
        resource: [resource],
        agent: 'aauth:agent.example',
        sub: 'user-pairwise-x401-1',
        scope: 'protected:read protected:audit',
        jti: 'aauth-x401-chain-jti-1',
        iat: 1_700_000_000,
        exp: 1_700_000_300,
        act: { sub: 'aauth:agent.example' },
        mission: {
          approver: 'https://ps.example/person/alice',
          s256: 'mission-x401-chain-s256',
        },
        r3_uri: 'https://api.example/.well-known/r3/x401.json',
        r3_s256: 'r3-x401-chain-s256',
        r3_granted: ['protected.read'],
      },
      claimsVerified: true,
      accessMode: 'auth-token',
      issuer: 'https://ps.example',
      audience: resource,
      resource,
      expectedAgent: 'aauth:agent.example',
      expectedSubject: 'user-pairwise-x401-1',
      expectedActSubject: 'aauth:agent.example',
      requiredScopes: ['protected:read'],
      requiredMission: {
        approver: 'https://ps.example/person/alice',
        s256: 'mission-x401-chain-s256',
      },
      r3: {
        expectedS256: 'r3-x401-chain-s256',
        documentHashVerified: true,
      },
      httpSignature: {
        verified: true,
        scheme: 'http-message-signatures',
        coveredComponents: ['@method', '@authority', '@path', 'signature-key'],
      },
      signaturePolicy: 'off',
      nowSeconds: 1_700_000_100,
    },
  }
}

function paymentResponseHeader(): string {
  return Buffer.from(
    JSON.stringify({
      success: true,
      transaction: '0xabc123',
      network: 'base-sepolia',
      payer: '0xagent',
    }),
  ).toString('base64')
}

export async function runX401ProofGateHarness(): Promise<X401ProofGateHarnessResult> {
  const server = await startProofGateServer()
  try {
    const protectedUrl = `${server.url}${PROTECTED_PATH}`

    const initial = await fetch(protectedUrl)
    const proofRequestHeader = headerValue(initial, 'PROOF-REQUEST')

    const wrongRequestId = await fetch(protectedUrl, {
      headers: requestHeaders(resultArtifact({ request_id: 'wrong-template' })),
    })
    const staleNonce = await fetch(protectedUrl, {
      headers: requestHeaders(
        resultArtifact({
          credential_result: {
            protocol: 'openid4vp-v1-signed',
            data: {
              vp_token: 'private-fixture-vp-token',
              nonce: 'stale-nonce',
            },
          },
        }),
      ),
    })

    const successProofResponse = resultArtifact()
    const success = await fetch(protectedUrl, {
      headers: requestHeaders(successProofResponse),
    })
    const proofResponseHeader = encodeX401HeaderObject(successProofResponse)

    const attemptedRecord = await signActionRecord({
      label: 'x401_protected_fetch_attempt',
      content: {
        method: 'GET',
        url: protectedUrl,
        outcome: initial.status,
        proof_request_hash: objectHash(decodeX401HeaderObject(proofRequestHeader)),
      },
    })
    const attemptedHash = recordHash(attemptedRecord)
    const successfulRecord = await signActionRecord({
      label: 'x401_protected_fetch_success',
      content: {
        method: 'GET',
        url: protectedUrl,
        outcome: success.status,
        proof_request_hash: objectHash(decodeX401HeaderObject(proofRequestHeader)),
        proof_response_hash: objectHash(successProofResponse),
      },
      informedBy: [attemptedHash],
    })
    const successfulHash = recordHash(successfulRecord)

    const evidence = await verifyAuthorizationEvidence({
      protocol: 'x401',
      x401: {
        headers: {
          'PROOF-REQUEST': proofRequestHeader,
          'PROOF-RESPONSE': proofResponseHeader,
        },
        resultVerified: true,
        expectedVersion: '0.2.0',
        expectedRequestId: REQUEST_ID,
        expectedAgentId: AGENT_ID,
        expectedCredentialProtocol: 'openid4vp-v1-signed',
        expectedNonce: NONCE,
        requiredSatisfiedRequirements: ['urn:proof:x401:satisfaction:basic:v1'],
      },
    })

    const x401AuthorizationEvidence: AuthorizationEvidenceInput = {
      protocol: 'x401',
      x401: {
        headers: {
          'PROOF-REQUEST': proofRequestHeader,
          'PROOF-RESPONSE': proofResponseHeader,
        },
        resultVerified: true,
        expectedRequestId: REQUEST_ID,
        expectedAgentId: AGENT_ID,
        expectedNonce: NONCE,
      },
    }

    const verification = await verifyRecord(successfulRecord, {
      informedByCandidates: [attemptedRecord],
      authorizationEvidence: [x401AuthorizationEvidence],
    })
    const publicEvidence = verification.evidence ?? [evidence]
    const x401Evidence = publicEvidence.find((block) => block.protocol === 'x401')
    const details = x401Evidence?.details as
      | {
          proof_request_hash?: string | null
          proof_response_hash?: string | null
          proof_gate?: { status?: string | null }
          payment_separation?: unknown
        }
      | undefined

    return {
      protected_url: protectedUrl,
      attempts: {
        initial_status: initial.status,
        wrong_request_id_status: wrongRequestId.status,
        stale_nonce_status: staleNonce.status,
        success_status: success.status,
      },
      record_hashes: {
        attempted_action: attemptedHash,
        successful_action: successfulHash,
      },
      attempted_record: attemptedRecord,
      successful_record: successfulRecord,
      verification,
      public_evidence: publicEvidence,
      private_authorization_evidence: [x401AuthorizationEvidence],
      public_packet: {
        proof_request_hash: details?.proof_request_hash ?? null,
        proof_response_hash: details?.proof_response_hash ?? null,
        proof_gate_status: details?.proof_gate?.status ?? null,
        payment_separation: details?.payment_separation ?? null,
        informed_by_resolved: verification.informed_by_resolution?.resolved ?? [],
        payment_detected: false,
      },
    }
  } finally {
    await server.close()
  }
}

export async function runX401AAuthPaymentChainHarness(): Promise<X401AAuthPaymentChainHarnessResult> {
  const x401 = await runX401ProofGateHarness()
  const aauthEvidence = aauthAuthorizationEvidence(x401.protected_url)
  const paymentDetection = detectTransaction(
    'x401_protected_fetch_success',
    { ok: true },
    { 'PAYMENT-RESPONSE': paymentResponseHeader() },
  )
  const verification = await verifyRecord(x401.successful_record, {
    informedByCandidates: [x401.attempted_record],
    authorizationEvidence: [...x401.private_authorization_evidence, aauthEvidence],
  })
  const evidence = verification.evidence ?? []
  const x401Evidence = evidence.find((block) => block.protocol === 'x401')
  const aauthBlock = evidence.find((block) => block.protocol === 'aauth')
  const x401Details = x401Evidence?.details as
    | {
        proof_gate?: { status?: string | null }
        payment_separation?: { scheme_hint?: string | null }
      }
    | undefined
  const aauthDetails = aauthBlock?.details as
    | {
        token?: { agent?: string | null }
      }
    | undefined

  return {
    x401,
    verification,
    payment_detection: paymentDetection,
    public_packet: {
      evidence_protocols: evidence.map((block) => block.protocol).sort(),
      evidence_valid: Object.fromEntries(
        evidence.map((block) => [block.protocol, block.valid] as const),
      ),
      proof_gate_status: x401Details?.proof_gate?.status ?? null,
      aauth_agent: aauthDetails?.token?.agent ?? null,
      aauth_subject: aauthBlock?.subject ?? null,
      payment_detected: paymentDetection.detected,
      payment_protocol: paymentDetection.protocol,
      x401_is_payment: false,
      payment_hint_scheme: x401Details?.payment_separation?.scheme_hint ?? null,
      informed_by_resolved: verification.informed_by_resolution?.resolved ?? [],
    },
  }
}

export async function runX401MultiEndpointHarness(): Promise<X401MultiEndpointHarnessResult> {
  const server = await startMultiEndpointProofGateServer(MULTI_ENDPOINTS)
  try {
    const endpoints: X401MultiEndpointHarnessEndpoint[] = []
    let previousSuccessfulRecord: AtribRecord | undefined
    let previousSuccessfulHash: string | undefined

    for (const endpoint of MULTI_ENDPOINTS) {
      const protectedUrl = `${server.url}${endpoint.path}`
      const initial = await fetch(protectedUrl)
      const proofRequestHeader = headerValue(initial, 'PROOF-REQUEST')
      const successProofResponse = resultArtifactForEndpoint(endpoint)
      const success = await fetch(protectedUrl, {
        headers: requestHeaders(successProofResponse),
      })
      const proofResponseHeader = encodeX401HeaderObject(successProofResponse)

      const attemptedRecord = await signActionRecord({
        label: 'x401_multi_endpoint_fetch_attempt',
        content: {
          method: 'GET',
          url: protectedUrl,
          request_id: endpoint.requestId,
          outcome: initial.status,
          proof_request_hash: objectHash(decodeX401HeaderObject(proofRequestHeader)),
        },
      })
      const attemptedHash = recordHash(attemptedRecord)
      const successfulInformedBy = previousSuccessfulHash
        ? [attemptedHash, previousSuccessfulHash]
        : [attemptedHash]
      const successfulRecord = await signActionRecord({
        label: 'x401_multi_endpoint_fetch_success',
        content: {
          method: 'GET',
          url: protectedUrl,
          request_id: endpoint.requestId,
          outcome: success.status,
          proof_request_hash: objectHash(decodeX401HeaderObject(proofRequestHeader)),
          proof_response_hash: objectHash(successProofResponse),
        },
        informedBy: successfulInformedBy,
      })
      const successfulHash = recordHash(successfulRecord)
      const informedByCandidates = previousSuccessfulRecord
        ? [attemptedRecord, previousSuccessfulRecord]
        : [attemptedRecord]

      const verification = await verifyRecord(successfulRecord, {
        informedByCandidates,
        authorizationEvidence: [
          {
            protocol: 'x401',
            x401: {
              headers: {
                'PROOF-REQUEST': proofRequestHeader,
                'PROOF-RESPONSE': proofResponseHeader,
              },
              resultVerified: true,
              expectedVersion: '0.2.0',
              expectedRequestId: endpoint.requestId,
              expectedAgentId: AGENT_ID,
              expectedAgentOrigin: endpoint.agentOrigin,
              agentOrigin: endpoint.agentOrigin,
              agentOriginVerified: true,
              issuerTrustVerified: true,
              issuerTrustRootType: 'proof-trust-list',
              issuerTrustRootRef: endpoint.trustRootRef,
              proofPaymentBindingVerified: true,
              proofPaymentBindingRef: endpoint.paymentBindingRef,
              expectedCredentialProtocol: 'openid4vp-v1-signed',
              expectedNonce: endpoint.nonce,
              requiredSatisfiedRequirements: [endpoint.satisfiedRequirement],
            },
          },
        ],
      })
      const x401Evidence = verification.evidence?.find((block) => block.protocol === 'x401')
      const details = x401Evidence?.details as
        | {
            proof_request_hash?: string | null
            proof_response_hash?: string | null
            proof_gate?: { status?: string | null }
            agent_origin?: { verified?: boolean | null }
            issuer_trust?: { verified?: boolean | null }
            proof_payment_binding?: { verified?: boolean | null }
          }
        | undefined

      endpoints.push({
        path: endpoint.path,
        protected_url: protectedUrl,
        request_id: endpoint.requestId,
        attempts: {
          initial_status: initial.status,
          success_status: success.status,
        },
        record_hashes: {
          attempted_action: attemptedHash,
          successful_action: successfulHash,
        },
        attempted_record: attemptedRecord,
        successful_record: successfulRecord,
        verification,
        public_packet: {
          proof_request_hash: details?.proof_request_hash ?? null,
          proof_response_hash: details?.proof_response_hash ?? null,
          proof_gate_status: details?.proof_gate?.status ?? null,
          agent_origin_verified: details?.agent_origin?.verified ?? null,
          issuer_trust_verified: details?.issuer_trust?.verified ?? null,
          proof_payment_binding_verified: details?.proof_payment_binding?.verified ?? null,
          informed_by_resolved: verification.informed_by_resolution?.resolved ?? [],
          payment_detected: false,
        },
      })

      previousSuccessfulRecord = successfulRecord
      previousSuccessfulHash = successfulHash
    }

    return {
      context_id: CONTEXT_ID,
      endpoints,
      public_packet: {
        request_ids: endpoints.map((endpoint) => endpoint.request_id),
        successful_action_hashes: endpoints.map(
          (endpoint) => endpoint.record_hashes.successful_action,
        ),
        payment_detected: false,
      },
    }
  } finally {
    await server.close()
  }
}
