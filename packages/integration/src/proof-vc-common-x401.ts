// SPDX-License-Identifier: Apache-2.0

import {
  agent as proofAgent,
  HEADER,
  verifier as proofVerifier,
  X401_VERSION,
} from '@proof.com/x401-node'
import { createVerifier as createProofVcVerifier } from '@proof.com/proof-vc-server'
import type { ProofCredential, TrustRoot, VPToken } from '@proof.com/proof-vc-server'
import {
  encodeX401HeaderObject,
  verifyAuthorizationEvidence,
  type AuthorizationEvidenceInput,
  type EvidenceVerificationBlock,
} from '@atrib/verify'

export type ProofVcCommonFixtureMode = 'fixture' | 'native'

export interface ProofVcCommonVerifierInput {
  encodedVPToken: string
  nonce?: string
  aud?: string
}

export type ProofVcCommonVerifier = (params: ProofVcCommonVerifierInput) => Promise<VPToken>

export interface ProofVcCommonX401InteropOptions {
  mode?: ProofVcCommonFixtureMode
  encodedVPToken?: string
  verifier?: ProofVcCommonVerifier
  nonce?: string
  trustRoot?: TrustRoot
  aud?: string
}

export interface ProofVcCommonX401InteropResult {
  credential_request_package: '@proof.com/proof-vc-common'
  credential_request_version: string
  credential_request_ref: string
  credential_verifier_package: '@proof.com/proof-vc-server'
  credential_verifier_version: string
  credential_verifier_ref: string
  credential_verifier_mode: ProofVcCommonFixtureMode
  x401_sdk_package: '@proof.com/x401-node'
  x401_sdk_version: string
  x401_spec_version: string
  verifier_invoked: boolean
  credential_result_verified: boolean
  credential_subject_over_18: boolean | null
  credential_nonce_verified: boolean
  verification: EvidenceVerificationBlock
  authorization_evidence: AuthorizationEvidenceInput
  public_packet: {
    credential_request_package: '@proof.com/proof-vc-common'
    credential_request_version: string
    credential_request_ref: string
    credential_verifier_package: '@proof.com/proof-vc-server'
    credential_verifier_version: string
    credential_verifier_ref: string
    credential_verifier_mode: ProofVcCommonFixtureMode
    x401_sdk_package: '@proof.com/x401-node'
    x401_sdk_version: string
    x401_spec_version: string
    verifier_invoked: boolean
    credential_result_verified: boolean
    credential_subject_over_18: boolean | null
    credential_nonce_verified: boolean
    proof_gate_status: string | null
    proof_request_hash: string | null
    proof_response_hash: string | null
    issuer_trust_verified: boolean | null
  }
}

const PROOF_VC_COMMON_VERSION = '0.3.0'
const PROOF_VC_COMMON_REF = `npm:@proof.com/proof-vc-common@${PROOF_VC_COMMON_VERSION}`
const PROOF_VC_SERVER_VERSION = '0.3.0'
const PROOF_VC_SERVER_REF = `npm:@proof.com/proof-vc-server@${PROOF_VC_SERVER_VERSION}`
const X401_NODE_VERSION = '0.3.0'
const X401_NODE_REF = `npm:@proof.com/x401-node@${X401_NODE_VERSION}`
const REQUEST_ID = 'proof-vc-common-x401-basic-v1'
const AGENT_ID = 'did:web:agent.example'
const DEFAULT_NONCE = 'proof-vc-common-x401-nonce-1'

function createNativeProofVcVerifier(trustRoot: TrustRoot): ProofVcCommonVerifier {
  const verifier = createProofVcVerifier({ trustRoot })
  return ({ encodedVPToken, aud }) =>
    verifier.verifyVPToken({
      encodedVPToken,
      ...(aud !== undefined ? { aud } : {}),
    })
}

function unsecuredJwt(payload: Record<string, unknown>): string {
  const header = encodeX401HeaderObject({ alg: 'none', typ: 'JWT' })
  const body = encodeX401HeaderObject(payload)
  return `${header}.${body}.`
}

function fixtureCredential(over18: boolean) {
  return {
    credentialType: () => 'ProofCredentialV1' as const,
    format: () => 'dc+sd-jwt' as const,
    getClaims: () => ({
      age_is_over: { '18': over18 },
    }),
    getSDJWT: () => ({}) as never,
    getNonce: () => DEFAULT_NONCE,
    isOver18: over18,
  }
}

export async function verifyFixtureVPToken({
  nonce,
}: ProofVcCommonVerifierInput): Promise<VPToken> {
  if (nonce !== DEFAULT_NONCE) {
    throw new Error('fixture Proof VP token nonce mismatch')
  }
  return {
    proof_id_default: [fixtureCredential(true)],
  }
}

function firstProofCredential(presentation: VPToken): {
  isOver18?: boolean
  credentialType?: () => string
  getNonce?: ProofCredential['getNonce']
} | null {
  const credentials = presentation.proof_id_default
  const credential = credentials[0]
  if (!credential) return null
  return credential as {
    isOver18?: boolean
    credentialType?: () => string
    getNonce?: ProofCredential['getNonce']
  }
}

function detailsFromEvidence(evidence: EvidenceVerificationBlock): {
  proof_request_hash: string | null
  proof_response_hash: string | null
  proof_gate_status: string | null
  issuer_trust_verified: boolean | null
} {
  const details = evidence.details as
    | {
        proof_request_hash?: string | null
        proof_response_hash?: string | null
        proof_gate?: { status?: string | null }
        issuer_trust?: { verified?: boolean | null }
      }
    | undefined
  return {
    proof_request_hash: details?.proof_request_hash ?? null,
    proof_response_hash: details?.proof_response_hash ?? null,
    proof_gate_status: details?.proof_gate?.status ?? null,
    issuer_trust_verified: details?.issuer_trust?.verified ?? null,
  }
}

function buildProofRequest(nonce: string): ReturnType<typeof proofVerifier.buildPayload> {
  return proofVerifier.buildPayload({
    credentialRequirements: {
      digital: {
        requests: [
          {
            protocol: 'openid4vp-v1-signed',
            data: {
              request: unsecuredJwt({
                client_id: 'https://verifier.example/proof-vc-client.json',
                nonce,
                scope: 'urn:proof:params:scope:verifiable-credentials:basic',
              }),
            },
          },
        ],
      },
    },
    oauth: { token_endpoint: 'https://verifier.example/oauth/token' },
    requestId: REQUEST_ID,
    satisfiedRequirements: ['urn:proof:x401:satisfaction:proof-vc-common:v1'],
  })
}

export async function runProofVcCommonX401Interop(
  options: ProofVcCommonX401InteropOptions = {},
): Promise<ProofVcCommonX401InteropResult> {
  const mode = options.mode ?? 'fixture'
  const nonce = options.nonce ?? DEFAULT_NONCE
  const encodedVPToken = options.encodedVPToken ?? 'fixture-proof-vc-common-vp-token'
  const verifyVPToken =
    options.verifier ??
    (mode === 'native'
      ? createNativeProofVcVerifier(options.trustRoot ?? 'production')
      : verifyFixtureVPToken)

  const proofRequest = buildProofRequest(nonce)
  const proofRequestHeader = proofVerifier.encodePayload(proofRequest)
  const requirement = proofAgent.detectProofRequirement({
    headers: { [HEADER.PROOF_REQUEST]: proofRequestHeader },
  })
  if (!requirement) throw new Error('Proof x401 SDK did not detect the Proof VC requirement')

  const presentation = await verifyVPToken({
    encodedVPToken,
    nonce,
    ...(options.aud !== undefined ? { aud: options.aud } : {}),
  })
  const credential = firstProofCredential(presentation)
  const credentialNonceVerified = credential?.getNonce?.() === nonce
  const credentialResultVerified =
    credential?.credentialType?.() === 'ProofCredentialV1' &&
    credential.isOver18 === true &&
    credentialNonceVerified

  const resultArtifact = proofAgent.buildResultArtifact({
    credentialResult: {
      protocol: 'openid4vp-v1-signed',
      data: {
        vp_token: encodedVPToken,
        request_package: PROOF_VC_COMMON_REF,
        verifier_package: PROOF_VC_SERVER_REF,
      },
    },
    requestId: REQUEST_ID,
    agentId: AGENT_ID,
  })
  const proofResponseHeader = proofAgent.encodeResultArtifact(resultArtifact)

  const authorizationEvidence: AuthorizationEvidenceInput = {
    protocol: 'x401',
    x401: {
      headers: {
        [HEADER.PROOF_REQUEST]: encodeX401HeaderObject(requirement.payload),
        [HEADER.PROOF_RESPONSE]: encodeX401HeaderObject(
          proofVerifier.decodeResultArtifact(proofResponseHeader),
        ),
      },
      expectedVersion: X401_VERSION,
      expectedRequestId: REQUEST_ID,
      expectedAgentId: AGENT_ID,
      expectedCredentialProtocol: 'openid4vp-v1-signed',
      expectedNonce: nonce,
      requiredSatisfiedRequirements: ['urn:proof:x401:satisfaction:proof-vc-common:v1'],
      resultVerified: credentialResultVerified,
      issuerTrustVerified: credentialResultVerified,
      issuerTrustRootType: 'proof-vc-common',
      issuerTrustRootRef: PROOF_VC_SERVER_REF,
      allowLegacyHeaders: false,
      allowLegacyFields: false,
    },
  }

  const verification = await verifyAuthorizationEvidence(authorizationEvidence)
  if (verification.protocol !== 'x401') {
    throw new Error('Proof VC Common x401 fixture produced non-x401 evidence')
  }
  const details = detailsFromEvidence(verification)

  return {
    credential_request_package: '@proof.com/proof-vc-common',
    credential_request_version: PROOF_VC_COMMON_VERSION,
    credential_request_ref: PROOF_VC_COMMON_REF,
    credential_verifier_package: '@proof.com/proof-vc-server',
    credential_verifier_version: PROOF_VC_SERVER_VERSION,
    credential_verifier_ref: PROOF_VC_SERVER_REF,
    credential_verifier_mode: mode,
    x401_sdk_package: '@proof.com/x401-node',
    x401_sdk_version: X401_NODE_VERSION,
    x401_spec_version: X401_VERSION,
    verifier_invoked: true,
    credential_result_verified: credentialResultVerified,
    credential_subject_over_18: credential?.isOver18 ?? null,
    credential_nonce_verified: credentialNonceVerified,
    verification,
    authorization_evidence: authorizationEvidence,
    public_packet: {
      credential_request_package: '@proof.com/proof-vc-common',
      credential_request_version: PROOF_VC_COMMON_VERSION,
      credential_request_ref: PROOF_VC_COMMON_REF,
      credential_verifier_package: '@proof.com/proof-vc-server',
      credential_verifier_version: PROOF_VC_SERVER_VERSION,
      credential_verifier_ref: PROOF_VC_SERVER_REF,
      credential_verifier_mode: mode,
      x401_sdk_package: '@proof.com/x401-node',
      x401_sdk_version: X401_NODE_VERSION,
      x401_spec_version: X401_VERSION,
      verifier_invoked: true,
      credential_result_verified: credentialResultVerified,
      credential_subject_over_18: credential?.isOver18 ?? null,
      credential_nonce_verified: credentialNonceVerified,
      proof_gate_status: details.proof_gate_status,
      proof_request_hash: details.proof_request_hash,
      proof_response_hash: details.proof_response_hash,
      issuer_trust_verified: details.issuer_trust_verified,
    },
  }
}

export const proofVcCommonX401Packages = {
  proof_vc_common: PROOF_VC_COMMON_REF,
  proof_vc_server: PROOF_VC_SERVER_REF,
  x401_node: X401_NODE_REF,
} as const
