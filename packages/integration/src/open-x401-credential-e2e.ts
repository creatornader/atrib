// SPDX-License-Identifier: Apache-2.0

import { createServer, type ServerResponse } from 'node:http'
import {
  agent as proofAgent,
  HEADER,
  verifier as proofVerifier,
  X401_VERSION,
} from '@proof.com/x401-node'
import { calculateJwkThumbprint, exportJWK, generateKeyPair, jwtVerify, SignJWT } from 'jose'
import type { JWK, JWTPayload } from 'jose'
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

const PRIVATE_KEY = new Uint8Array(32).fill(0x51)
const CONTEXT_ID = '40110000000000000000000000000000'
const REQUEST_ID = 'open-x401-local-jwt-vc-v1'
const AGENT_ID = 'did:web:agent.example'
const HOLDER_DID = 'did:example:holder-open-x401'
const ISSUER_DID = 'did:web:issuer.example'
const VERIFIER_CLIENT_ID = 'https://verifier.example/open-x401-client.json'
const NONCE = 'open-x401-local-vp-nonce-1'
const SATISFIED_REQUIREMENT = 'urn:open:x401:satisfaction:jwt-vc:over-18:v1'
const PROTECTED_PATH = '/open-x401/protected'
const CREDENTIAL_PROTOCOL = 'openid4vp-v1-signed'
const CREDENTIAL_FORMAT = 'jwt_vc_json'
const ISSUER_KID = 'open-x401-issuer-key-1'
const HOLDER_KID = 'open-x401-holder-key-1'

const encoder = new TextEncoder()

interface LocalCredentialKeyMaterial {
  issuerPrivateKey: CryptoKey
  issuerPublicKey: CryptoKey
  issuerPublicJwk: JWK
  issuerThumbprint: string
  holderPrivateKey: CryptoKey
  holderPublicKey: CryptoKey
  holderPublicJwk: JWK
  holderThumbprint: string
}

interface LocalCredentialVerificationResult {
  valid: boolean
  credential_result_verified: boolean
  nonce_verified: boolean
  issuer_trust_verified: boolean
  subject_over_18: boolean | null
  credential_format: typeof CREDENTIAL_FORMAT
  issuer: string | null
  subject: string | null
  errors: string[]
}

interface OpenX401ResultArtifact {
  request_id?: string
  agent_id?: string
  credential_result?: {
    protocol?: string
    data?: {
      vp_token?: string
      nonce?: string
      verifier?: string
      credential_format?: string
    }
  }
}

interface OpenX401Server {
  url: string
  close(): Promise<void>
}

export interface OpenX401CredentialE2EResult {
  protected_url: string
  attempts: {
    initial_status: number
    stale_nonce_status: number
    success_status: number
  }
  record_hashes: {
    attempted_action: string
    successful_action: string
  }
  attempted_record: AtribRecord
  successful_record: AtribRecord
  credential_verification: LocalCredentialVerificationResult
  verification: RecordVerificationResult
  public_evidence: EvidenceVerificationBlock[]
  private_authorization_evidence: AuthorizationEvidenceInput[]
  public_packet: {
    provider_profile: 'open-local-jwt-vc'
    x401_sdk_package: '@proof.com/x401-node'
    x401_spec_version: string
    credential_protocol: typeof CREDENTIAL_PROTOCOL
    credential_format: typeof CREDENTIAL_FORMAT
    credential_result_verified: boolean
    credential_nonce_verified: boolean
    issuer_trust_verified: boolean
    subject_over_18: boolean | null
    issuer_key_thumbprint: string
    holder_key_thumbprint: string
    proof_gate_status: string | null
    proof_request_hash: string | null
    proof_response_hash: string | null
    proof_result_hash: string | null
    informed_by_resolved: string[]
    raw_credential_material_stored: false
    payment_detected: false
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringMember(value: Record<string, unknown>, key: string): string | null {
  const member = value[key]
  return typeof member === 'string' ? member : null
}

function booleanMember(value: Record<string, unknown>, key: string): boolean | null {
  const member = value[key]
  return typeof member === 'boolean' ? member : null
}

function arrayMember(value: Record<string, unknown>, key: string): unknown[] {
  const member = value[key]
  return Array.isArray(member) ? member : []
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

async function createLocalCredentialKeyMaterial(): Promise<LocalCredentialKeyMaterial> {
  const issuer = await generateKeyPair('ES256')
  const holder = await generateKeyPair('ES256')
  const issuerPublicJwk = await exportJWK(issuer.publicKey)
  const holderPublicJwk = await exportJWK(holder.publicKey)
  issuerPublicJwk.kid = ISSUER_KID
  issuerPublicJwk.alg = 'ES256'
  holderPublicJwk.kid = HOLDER_KID
  holderPublicJwk.alg = 'ES256'

  return {
    issuerPrivateKey: issuer.privateKey,
    issuerPublicKey: issuer.publicKey,
    issuerPublicJwk,
    issuerThumbprint: await calculateJwkThumbprint(issuerPublicJwk),
    holderPrivateKey: holder.privateKey,
    holderPublicKey: holder.publicKey,
    holderPublicJwk,
    holderThumbprint: await calculateJwkThumbprint(holderPublicJwk),
  }
}

async function issueCredentialJwt(keys: LocalCredentialKeyMaterial): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({
    vc: {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      type: ['VerifiableCredential', 'OpenX401Credential'],
      issuer: ISSUER_DID,
      credentialSubject: {
        id: HOLDER_DID,
        age_over_18: true,
        kyc: {
          status: 'verified',
        },
      },
    },
  })
    .setProtectedHeader({ alg: 'ES256', kid: ISSUER_KID, typ: 'JWT' })
    .setIssuer(ISSUER_DID)
    .setSubject(HOLDER_DID)
    .setJti('urn:uuid:open-x401-local-vc-1')
    .setIssuedAt(now)
    .setNotBefore(now - 60)
    .setExpirationTime(now + 300)
    .sign(keys.issuerPrivateKey)
}

async function issueVpToken(input: {
  keys: LocalCredentialKeyMaterial
  nonce: string
  audience: string
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const vcJwt = await issueCredentialJwt(input.keys)
  return new SignJWT({
    nonce: input.nonce,
    vp: {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      type: ['VerifiablePresentation'],
      holder: HOLDER_DID,
      verifiableCredential: [vcJwt],
    },
  })
    .setProtectedHeader({ alg: 'ES256', kid: HOLDER_KID, typ: 'JWT' })
    .setIssuer(HOLDER_DID)
    .setAudience(input.audience)
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(input.keys.holderPrivateKey)
}

function credentialSubjectFromPayload(payload: JWTPayload): Record<string, unknown> | null {
  const vc = isRecord(payload.vc) ? payload.vc : null
  const subject = vc && isRecord(vc.credentialSubject) ? vc.credentialSubject : null
  return subject
}

async function verifyLocalVpToken(input: {
  keys: LocalCredentialKeyMaterial
  vpToken: string
  expectedNonce: string
  expectedAudience: string
}): Promise<LocalCredentialVerificationResult> {
  const errors: string[] = []
  let vpPayload: JWTPayload
  try {
    const verified = await jwtVerify(input.vpToken, input.keys.holderPublicKey, {
      algorithms: ['ES256'],
      audience: input.expectedAudience,
      issuer: HOLDER_DID,
    })
    vpPayload = verified.payload
  } catch (err) {
    return {
      valid: false,
      credential_result_verified: false,
      nonce_verified: false,
      issuer_trust_verified: false,
      subject_over_18: null,
      credential_format: CREDENTIAL_FORMAT,
      issuer: null,
      subject: null,
      errors: [`vp token verification failed: ${(err as Error).message}`],
    }
  }

  const nonceVerified = vpPayload.nonce === input.expectedNonce
  if (!nonceVerified) errors.push('vp token nonce mismatch')

  const vp = isRecord(vpPayload.vp) ? vpPayload.vp : null
  const credentials = vp ? arrayMember(vp, 'verifiableCredential') : []
  const vcJwt = credentials.find(
    (credential): credential is string => typeof credential === 'string',
  )
  if (!vcJwt) errors.push('verifiable presentation missing credential')

  let subjectOver18: boolean | null = null
  let issuer: string | null = null
  let subject: string | null = null
  if (vcJwt) {
    try {
      const verifiedCredential = await jwtVerify(vcJwt, input.keys.issuerPublicKey, {
        algorithms: ['ES256'],
        issuer: ISSUER_DID,
        subject: HOLDER_DID,
      })
      issuer = verifiedCredential.payload.iss ?? null
      subject = verifiedCredential.payload.sub ?? null
      const credentialSubject = credentialSubjectFromPayload(verifiedCredential.payload)
      const kyc =
        credentialSubject && isRecord(credentialSubject.kyc) ? credentialSubject.kyc : null
      subjectOver18 = credentialSubject ? booleanMember(credentialSubject, 'age_over_18') : null
      if (subjectOver18 !== true) errors.push('credential subject is not over 18')
      if (kyc ? stringMember(kyc, 'status') !== 'verified' : true) {
        errors.push('credential subject kyc is not verified')
      }
    } catch (err) {
      errors.push(`credential verification failed: ${(err as Error).message}`)
    }
  }

  const trustedThumbprint = await calculateJwkThumbprint(input.keys.issuerPublicJwk)
  const issuerTrustVerified = trustedThumbprint === input.keys.issuerThumbprint
  if (!issuerTrustVerified) errors.push('issuer public key is not trusted')

  return {
    valid: errors.length === 0,
    credential_result_verified: errors.length === 0,
    nonce_verified: nonceVerified,
    issuer_trust_verified: issuerTrustVerified,
    subject_over_18: subjectOver18,
    credential_format: CREDENTIAL_FORMAT,
    issuer,
    subject,
    errors,
  }
}

function buildProofRequest(): ReturnType<typeof proofVerifier.buildPayload> {
  return proofVerifier.buildPayload({
    credentialRequirements: {
      digital: {
        requests: [
          {
            protocol: CREDENTIAL_PROTOCOL,
            data: {
              request: unsecuredJwt({
                client_id: VERIFIER_CLIENT_ID,
                nonce: NONCE,
                dcql_query: {
                  credentials: [
                    {
                      id: 'open_x401_local_credential',
                      format: CREDENTIAL_FORMAT,
                      meta: {
                        type_values: ['OpenX401Credential'],
                      },
                      claims: [
                        {
                          path: ['credentialSubject', 'age_over_18'],
                          values: [true],
                        },
                        {
                          path: ['credentialSubject', 'kyc', 'status'],
                          values: ['verified'],
                        },
                      ],
                    },
                  ],
                },
              }),
            },
          },
        ],
      },
    },
    oauth: { token_endpoint: 'https://verifier.example/oauth/token' },
    requestId: REQUEST_ID,
    satisfiedRequirements: [SATISFIED_REQUIREMENT],
  })
}

function proofError(res: ServerResponse, error: string): void {
  res.setHeader(
    HEADER.PROOF_RESULT,
    encodeX401HeaderObject({
      scheme: 'x401',
      version: X401_VERSION,
      error,
      request_id: REQUEST_ID,
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

function requestHeaders(proofResponse: OpenX401ResultArtifact): HeadersInit {
  return {
    [HEADER.PROOF_RESPONSE]: encodeX401HeaderObject(proofResponse),
  }
}

async function startOpenCredentialProofGateServer(
  keys: LocalCredentialKeyMaterial,
): Promise<OpenX401Server> {
  const requestPayload = buildProofRequest()
  const requestHeader = proofVerifier.encodePayload(requestPayload)
  const server = createServer((req, res) => {
    void (async () => {
      if (req.url !== PROTECTED_PATH) {
        json(res, 404, { error: 'not_found' })
        return
      }
      const proofResponse = req.headers[HEADER.PROOF_RESPONSE.toLowerCase()]
      if (typeof proofResponse !== 'string') {
        res.setHeader(HEADER.PROOF_REQUEST, requestHeader)
        json(res, 401, { error: 'proof_required' })
        return
      }

      let artifact: OpenX401ResultArtifact
      try {
        artifact = proofVerifier.decodeResultArtifact(proofResponse) as OpenX401ResultArtifact
      } catch {
        proofError(res, 'invalid_result_artifact')
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
      const token = artifact.credential_result?.data?.vp_token
      if (!token) {
        proofError(res, 'missing_vp_token')
        return
      }

      const verification = await verifyLocalVpToken({
        keys,
        vpToken: token,
        expectedNonce: NONCE,
        expectedAudience: VERIFIER_CLIENT_ID,
      })
      if (!verification.valid) {
        proofError(res, 'credential_verification_failed')
        return
      }

      res.setHeader(
        HEADER.PROOF_RESULT,
        encodeX401HeaderObject({
          scheme: 'x401',
          version: X401_VERSION,
          request_id: REQUEST_ID,
          satisfied_requirements: [SATISFIED_REQUIREMENT],
          result: 'ok',
        }),
      )
      json(res, 200, {
        ok: true,
        resource: 'open-x401-local-vp-result',
        credential_result_verified: true,
      })
    })().catch((err) => {
      console.error(err)
      proofError(res, 'server_error')
    })
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

function resultArtifact(vpToken: string, nonce: string): OpenX401ResultArtifact {
  return proofAgent.buildResultArtifact({
    requestId: REQUEST_ID,
    agentId: AGENT_ID,
    credentialResult: {
      protocol: CREDENTIAL_PROTOCOL,
      data: {
        vp_token: vpToken,
        nonce,
        credential_format: CREDENTIAL_FORMAT,
        verifier: 'open-local-jwt-vc',
      },
    },
  }) as OpenX401ResultArtifact
}

function x401Details(evidence: EvidenceVerificationBlock | undefined):
  | {
      proof_request_hash?: string | null
      proof_response_hash?: string | null
      proof_result_hash?: string | null
      proof_gate?: { status?: string | null }
    }
  | undefined {
  return evidence?.details as
    | {
        proof_request_hash?: string | null
        proof_response_hash?: string | null
        proof_result_hash?: string | null
        proof_gate?: { status?: string | null }
      }
    | undefined
}

export async function runOpenX401CredentialE2E(): Promise<OpenX401CredentialE2EResult> {
  const keys = await createLocalCredentialKeyMaterial()
  const server = await startOpenCredentialProofGateServer(keys)
  try {
    const protectedUrl = `${server.url}${PROTECTED_PATH}`
    const initial = await fetch(protectedUrl)
    const proofRequestHeader = headerValue(initial, HEADER.PROOF_REQUEST)
    const requirement = proofAgent.detectProofRequirement({
      headers: { [HEADER.PROOF_REQUEST]: proofRequestHeader },
    })
    if (!requirement) throw new Error('Proof x401 SDK did not detect local proof request')

    const staleVpToken = await issueVpToken({
      keys,
      nonce: 'stale-open-x401-nonce',
      audience: VERIFIER_CLIENT_ID,
    })
    const staleNonce = await fetch(protectedUrl, {
      headers: requestHeaders(resultArtifact(staleVpToken, 'stale-open-x401-nonce')),
    })

    const vpToken = await issueVpToken({
      keys,
      nonce: NONCE,
      audience: VERIFIER_CLIENT_ID,
    })
    const credentialVerification = await verifyLocalVpToken({
      keys,
      vpToken,
      expectedNonce: NONCE,
      expectedAudience: VERIFIER_CLIENT_ID,
    })
    const successProofResponse = resultArtifact(vpToken, NONCE)
    const success = await fetch(protectedUrl, {
      headers: requestHeaders(successProofResponse),
    })
    const proofResponseHeader = encodeX401HeaderObject(successProofResponse)
    const proofResultHeader = headerValue(success, HEADER.PROOF_RESULT)

    const attemptedRecord = await signActionRecord({
      label: 'open_x401_credential_fetch_attempt',
      content: {
        method: 'GET',
        url: protectedUrl,
        outcome: initial.status,
        proof_request_hash: objectHash(decodeX401HeaderObject(proofRequestHeader)),
      },
    })
    const attemptedHash = recordHash(attemptedRecord)
    const successfulRecord = await signActionRecord({
      label: 'open_x401_credential_fetch_success',
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

    const authorizationEvidence: AuthorizationEvidenceInput = {
      protocol: 'x401',
      x401: {
        headers: {
          [HEADER.PROOF_REQUEST]: proofRequestHeader,
          [HEADER.PROOF_RESPONSE]: proofResponseHeader,
          [HEADER.PROOF_RESULT]: proofResultHeader,
        },
        resultVerified: credentialVerification.credential_result_verified,
        issuerTrustVerified: credentialVerification.issuer_trust_verified,
        issuerTrustRootType: 'local-jwt-vc-jwks',
        issuerTrustRootRef: `jwk-thumbprint:${keys.issuerThumbprint}`,
        expectedVersion: X401_VERSION,
        expectedRequestId: REQUEST_ID,
        expectedAgentId: AGENT_ID,
        expectedCredentialProtocol: CREDENTIAL_PROTOCOL,
        expectedNonce: NONCE,
        requiredSatisfiedRequirements: [SATISFIED_REQUIREMENT],
        allowLegacyHeaders: false,
        allowLegacyFields: false,
      },
    }

    const evidence = await verifyAuthorizationEvidence(authorizationEvidence)
    const verification = await verifyRecord(successfulRecord, {
      informedByCandidates: [attemptedRecord],
      authorizationEvidence: [authorizationEvidence],
    })
    const publicEvidence = verification.evidence ?? [evidence]
    const x401Evidence = publicEvidence.find((block) => block.protocol === 'x401')
    const details = x401Details(x401Evidence)

    return {
      protected_url: protectedUrl,
      attempts: {
        initial_status: initial.status,
        stale_nonce_status: staleNonce.status,
        success_status: success.status,
      },
      record_hashes: {
        attempted_action: attemptedHash,
        successful_action: successfulHash,
      },
      attempted_record: attemptedRecord,
      successful_record: successfulRecord,
      credential_verification: credentialVerification,
      verification,
      public_evidence: publicEvidence,
      private_authorization_evidence: [authorizationEvidence],
      public_packet: {
        provider_profile: 'open-local-jwt-vc',
        x401_sdk_package: '@proof.com/x401-node',
        x401_spec_version: X401_VERSION,
        credential_protocol: CREDENTIAL_PROTOCOL,
        credential_format: CREDENTIAL_FORMAT,
        credential_result_verified: credentialVerification.credential_result_verified,
        credential_nonce_verified: credentialVerification.nonce_verified,
        issuer_trust_verified: credentialVerification.issuer_trust_verified,
        subject_over_18: credentialVerification.subject_over_18,
        issuer_key_thumbprint: keys.issuerThumbprint,
        holder_key_thumbprint: keys.holderThumbprint,
        proof_gate_status: details?.proof_gate?.status ?? null,
        proof_request_hash: details?.proof_request_hash ?? null,
        proof_response_hash: details?.proof_response_hash ?? null,
        proof_result_hash: details?.proof_result_hash ?? null,
        informed_by_resolved: verification.informed_by_resolution?.resolved ?? [],
        raw_credential_material_stored: false,
        payment_detected: false,
      },
    }
  } finally {
    await server.close()
  }
}
