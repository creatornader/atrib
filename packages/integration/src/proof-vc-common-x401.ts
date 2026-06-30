// SPDX-License-Identifier: Apache-2.0

import {
  agent as proofAgent,
  HEADER,
  verifier as proofVerifier,
  X401_VERSION,
} from '@proof.com/x401-node'
import {
  init as initProofVcCommon,
  verifyVPToken as proofVerifyVPToken,
} from '@proof.com/proof-vc-common'
import type { TrustRoot, VerifyVPTokenParams, VPToken } from '@proof.com/proof-vc-common'
import {
  encodeX401HeaderObject,
  verifyAuthorizationEvidence,
  type AuthorizationEvidenceInput,
  type EvidenceVerificationBlock,
} from '@atrib/verify'

export type ProofVcCommonFixtureMode = 'fixture' | 'native'

export type ProofVcCommonVerifier = (params: VerifyVPTokenParams) => Promise<VPToken>

export interface ProofVcCommonX401InteropOptions {
  mode?: ProofVcCommonFixtureMode
  encodedVPToken?: string
  verifier?: ProofVcCommonVerifier
  nonce?: string
  trustRoot?: TrustRoot
}

export interface ProofVcCommonX401InteropResult {
  credential_verifier_package: '@proof.com/proof-vc-common'
  credential_verifier_version: string
  credential_verifier_ref: string
  credential_verifier_mode: ProofVcCommonFixtureMode
  x401_sdk_package: '@proof.com/x401-node'
  x401_sdk_version: string
  x401_spec_version: string
  verifier_invoked: boolean
  credential_result_verified: boolean
  credential_subject_over_18: boolean | null
  verification: EvidenceVerificationBlock
  authorization_evidence: AuthorizationEvidenceInput
  public_packet: {
    credential_verifier_package: '@proof.com/proof-vc-common'
    credential_verifier_version: string
    credential_verifier_ref: string
    credential_verifier_mode: ProofVcCommonFixtureMode
    x401_sdk_package: '@proof.com/x401-node'
    x401_sdk_version: string
    x401_spec_version: string
    verifier_invoked: boolean
    credential_result_verified: boolean
    credential_subject_over_18: boolean | null
    proof_gate_status: string | null
    proof_request_hash: string | null
    proof_response_hash: string | null
    issuer_trust_verified: boolean | null
  }
}

const PROOF_VC_COMMON_VERSION = '0.2.0'
const PROOF_VC_COMMON_REF = `npm:@proof.com/proof-vc-common@${PROOF_VC_COMMON_VERSION}`
const X401_NODE_VERSION = '0.3.0'
const X401_NODE_REF = `npm:@proof.com/x401-node@${X401_NODE_VERSION}`
const REQUEST_ID = 'proof-vc-common-x401-basic-v1'
const AGENT_ID = 'did:web:agent.example'
const DEFAULT_NONCE = 'proof-vc-common-x401-nonce-1'
let proofVcCommonNativeInitialized = false

function ensureProofVcCommonNativeInitialized(trustRoot: TrustRoot): void {
  if (proofVcCommonNativeInitialized) return
  try {
    initProofVcCommon({ trustRoot })
  } catch (err) {
    if (!String(err).includes('already initialized')) throw err
  }
  proofVcCommonNativeInitialized = true
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
    isOver18: over18,
  }
}

export async function verifyFixtureVPToken({ nonce }: VerifyVPTokenParams): Promise<VPToken> {
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
} | null {
  const credentials = presentation.proof_id_default
  const credential = credentials[0]
  if (!credential) return null
  return credential as {
    isOver18?: boolean
    credentialType?: () => string
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
  if (mode === 'native' && !options.verifier) {
    ensureProofVcCommonNativeInitialized(options.trustRoot ?? 'production')
  }
  const verifyVPToken =
    options.verifier ?? (mode === 'native' ? proofVerifyVPToken : verifyFixtureVPToken)

  const proofRequest = buildProofRequest(nonce)
  const proofRequestHeader = proofVerifier.encodePayload(proofRequest)
  const requirement = proofAgent.detectProofRequirement({
    headers: { [HEADER.PROOF_REQUEST]: proofRequestHeader },
  })
  if (!requirement) throw new Error('Proof x401 SDK did not detect the Proof VC requirement')

  const presentation = await verifyVPToken({ encodedVPToken, nonce })
  const credential = firstProofCredential(presentation)
  const credentialResultVerified =
    credential?.credentialType?.() === 'ProofCredentialV1' && credential.isOver18 === true

  const resultArtifact = proofAgent.buildResultArtifact({
    credentialResult: {
      protocol: 'openid4vp-v1-signed',
      data: {
        vp_token: encodedVPToken,
        verifier_package: PROOF_VC_COMMON_REF,
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
      issuerTrustRootRef: PROOF_VC_COMMON_REF,
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
    credential_verifier_package: '@proof.com/proof-vc-common',
    credential_verifier_version: PROOF_VC_COMMON_VERSION,
    credential_verifier_ref: PROOF_VC_COMMON_REF,
    credential_verifier_mode: mode,
    x401_sdk_package: '@proof.com/x401-node',
    x401_sdk_version: X401_NODE_VERSION,
    x401_spec_version: X401_VERSION,
    verifier_invoked: true,
    credential_result_verified: credentialResultVerified,
    credential_subject_over_18: credential?.isOver18 ?? null,
    verification,
    authorization_evidence: authorizationEvidence,
    public_packet: {
      credential_verifier_package: '@proof.com/proof-vc-common',
      credential_verifier_version: PROOF_VC_COMMON_VERSION,
      credential_verifier_ref: PROOF_VC_COMMON_REF,
      credential_verifier_mode: mode,
      x401_sdk_package: '@proof.com/x401-node',
      x401_sdk_version: X401_NODE_VERSION,
      x401_spec_version: X401_VERSION,
      verifier_invoked: true,
      credential_result_verified: credentialResultVerified,
      credential_subject_over_18: credential?.isOver18 ?? null,
      proof_gate_status: details.proof_gate_status,
      proof_request_hash: details.proof_request_hash,
      proof_response_hash: details.proof_response_hash,
      issuer_trust_verified: details.issuer_trust_verified,
    },
  }
}

export const proofVcCommonX401Packages = {
  proof_vc_common: PROOF_VC_COMMON_REF,
  x401_node: X401_NODE_REF,
} as const
