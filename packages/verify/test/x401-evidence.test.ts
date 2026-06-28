import { describe, expect, it } from 'vitest'
import * as ed from '@noble/ed25519'
import { base64urlEncode, signRecord, type AtribRecord } from '@atrib/mcp'
import { verifyAuthorizationEvidence } from '../src/authorization-evidence.js'
import { verifyRecord } from '../src/verify-record.js'
import { encodeX401HeaderObject, verifyX401AuthorizationEvidence } from '../src/x401-evidence.js'

const requestId = 'proof-template-financial-customer-v1'
const agentId = 'did:web:agent.example'

function unsecuredJwt(payload: Record<string, unknown>): string {
  return `${encodeX401HeaderObject({ alg: 'none', typ: 'JWT' })}.${encodeX401HeaderObject(payload)}.`
}

function proofRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
                nonce: 'nonce-1',
              }),
            },
          },
        ],
      },
    },
    oauth: {
      token_endpoint: 'https://verifier.example/oauth/token',
    },
    request_id: requestId,
    satisfied_requirements: ['kyc:basic', 'residency:us'],
    ...overrides,
  }
}

function resultArtifact(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    request_id: requestId,
    agent_id: agentId,
    credential_result: {
      protocol: 'openid4vp-v1-signed',
      data: { vp_token: 'credential-result' },
    },
    ...overrides,
  }
}

function x401Headers(): Record<string, string> {
  return {
    'PROOF-REQUEST': encodeX401HeaderObject(
      proofRequest({
        payment: {
          required: true,
          scheme_hint: 'ap2',
        },
      }),
    ),
    'PROOF-RESPONSE': encodeX401HeaderObject(resultArtifact()),
  }
}

async function freshKey(): Promise<Uint8Array> {
  const seed = new Uint8Array(32)
  for (let i = 0; i < 32; i++) seed[i] = (i * 5 + 19) & 0xff
  await ed.getPublicKeyAsync(seed)
  return seed
}

async function buildRecord(seed: Uint8Array): Promise<AtribRecord> {
  const pubKey = base64urlEncode(await ed.getPublicKeyAsync(seed))
  return signRecord(
    {
      spec_version: 'atrib/1.0',
      content_id: 'sha256:' + 'c'.repeat(64),
      creator_key: pubKey,
      chain_root: 'sha256:' + 'd'.repeat(64),
      event_type: 'https://atrib.dev/v1/types/tool_call',
      context_id: 'b'.repeat(32),
      timestamp: 1_700_000_000_000,
      signature: '',
    } as AtribRecord,
    seed,
  )
}

describe('x401 authorization evidence', () => {
  it('validates v0.2 proof request and result artifact evidence', () => {
    const result = verifyX401AuthorizationEvidence({
      headers: x401Headers(),
      resultVerified: true,
      expectedVersion: '0.2.0',
      expectedRequestId: requestId,
      expectedAgentId: agentId,
      expectedCredentialProtocol: 'openid4vp-v1-signed',
      expectedNonce: 'nonce-1',
      expectedAgentOrigin: 'https://agent.example/origin',
      agentOrigin: 'https://agent.example/origin',
      agentOriginVerified: true,
      issuerTrustVerified: true,
      issuerTrustRootType: 'proof-trust-list',
      issuerTrustRootRef: 'https://trust.example/x401.json',
      proofPaymentBindingVerified: true,
      proofPaymentBindingRef: 'ap2-receipt:checkout-123',
      requiredSatisfiedRequirements: ['kyc:basic'],
    })

    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.issuer).toBe('https://verifier.example/client.json')
    expect(result.subject).toBe(agentId)
    expect(result.details?.payment_separation).toMatchObject({
      present: true,
      required: true,
      scheme_hint: 'ap2',
    })
    expect(result.details?.proof_gate).toEqual({
      kind: 'result_artifact',
      status: 'passed',
    })
    expect(result.details?.agent_origin).toMatchObject({
      verified: true,
    })
    expect(result.details?.agent_origin.expected_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(result.details?.agent_origin.actual_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(result.details?.issuer_trust).toMatchObject({
      verified: true,
      root_type: 'proof-trust-list',
    })
    expect(result.details?.issuer_trust.root_ref_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(result.details?.proof_payment_binding).toMatchObject({
      verified: true,
    })
    expect(result.details?.proof_payment_binding.reference_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(result.details?.proof_request_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(result.details?.proof_response_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(JSON.stringify(result)).not.toContain('credential-result')
    expect(JSON.stringify(result)).not.toContain('https://agent.example/origin')
    expect(JSON.stringify(result)).not.toContain('https://trust.example/x401.json')
    expect(JSON.stringify(result)).not.toContain('ap2-receipt:checkout-123')
    expect(result.constraints).toContainEqual(
      expect.objectContaining({
        type: 'x401.payment_separation',
        status: 'passed',
      }),
    )
  })

  it('fails explicit negative external verifier facts', () => {
    const result = verifyX401AuthorizationEvidence({
      headers: x401Headers(),
      resultVerified: true,
      expectedRequestId: requestId,
      expectedAgentId: agentId,
      issuerTrustVerified: false,
      proofPaymentBindingVerified: false,
    })

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('x401_evidence issuer trust verification failed')
    expect(result.errors).toContain('x401_evidence proof payment binding verification failed')
    expect(result.constraints).toContainEqual(
      expect.objectContaining({
        type: 'x401.issuer_trust_verified',
        status: 'failed',
      }),
    )
    expect(result.constraints).toContainEqual(
      expect.objectContaining({
        type: 'x401.proof_payment_binding_verified',
        status: 'failed',
      }),
    )
  })

  it('does not treat a decoded result artifact as verified proof by itself', () => {
    const result = verifyX401AuthorizationEvidence({
      headers: x401Headers(),
      expectedRequestId: requestId,
    })

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('x401_evidence result verification unresolved')
    expect(result.details?.proof_gate.status).toBe('unresolved')
    expect(result.constraints).toContainEqual(
      expect.objectContaining({
        type: 'x401.result_verified',
        status: 'unresolved',
      }),
    )
  })

  it('surfaces verifier proof-result errors as failed evidence', () => {
    const result = verifyX401AuthorizationEvidence({
      headers: {
        'PROOF-REQUEST': encodeX401HeaderObject(proofRequest()),
        'PROOF-RESULT': encodeX401HeaderObject({
          scheme: 'x401',
          version: '0.2.0',
          error: 'invalid_result',
          request_id: requestId,
        }),
      },
    })

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('x401_evidence proof result error: invalid_result')
    expect(result.details?.proof_gate.status).toBe('failed')
  })

  it('accepts legacy draft header and payload names with warnings', () => {
    const result = verifyX401AuthorizationEvidence({
      headers: {
        'PROOF-REQUIRED': encodeX401HeaderObject({
          ...proofRequest({
            credential_requirements: undefined,
            presentation_requirements: proofRequest().credential_requirements,
          }),
          version: '0.1.0',
        }),
        'PROOF-PRESENTATION': encodeX401HeaderObject(resultArtifact()),
      },
      resultVerified: true,
    })

    expect(result.valid).toBe(true)
    expect(result.details?.legacy_headers_used).toEqual(['PROOF-REQUIRED', 'PROOF-PRESENTATION'])
    expect(result.details?.legacy_fields_used).toEqual(['presentation_requirements'])
    expect(result.warnings.join('\n')).toContain('legacy header names used')
    expect(result.warnings.join('\n')).toContain('legacy payload fields used')
  })

  it('dispatches through generic authorization evidence and verifyRecord', async () => {
    const evidence = await verifyAuthorizationEvidence({
      protocol: 'x401',
      x401: {
        headers: x401Headers(),
        resultVerified: true,
        expectedRequestId: requestId,
      },
    })
    expect(evidence).toMatchObject({ protocol: 'x401', valid: true })

    const record = await buildRecord(await freshKey())
    const result = await verifyRecord(record, {
      authorizationEvidence: [
        {
          protocol: 'x401',
          x401: {
            headers: x401Headers(),
            resultVerified: true,
            expectedRequestId: requestId,
          },
        },
      ],
    })

    expect(result.valid).toBe(true)
    expect(result.evidence).toHaveLength(1)
    expect(result.evidence?.[0]).toMatchObject({ protocol: 'x401', valid: true })
  })
})
