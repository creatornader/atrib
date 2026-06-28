import { describe, expect, it } from 'vitest'
import * as ed from '@noble/ed25519'
import { detectTransaction } from '@atrib/agent'
import { bindArchiveServer } from '@atrib/archive-node'
import { base64urlEncode, signRecord, type AtribRecord } from '@atrib/mcp'
import { encodeX401HeaderObject, verifyAuthorizationEvidence, verifyRecord } from '@atrib/verify'
import {
  runX401AAuthPaymentChainHarness,
  runX401MultiEndpointHarness,
  runX401ProofGateHarness,
} from '../src/x401-proof-gate.js'

const requestId = 'proof-template-financial-customer-v1'
const agentId = 'did:web:agent.example'

function headerJwt(payload: Record<string, unknown>): string {
  const header = encodeX401HeaderObject({ alg: 'none', typ: 'JWT' })
  return `${header}.${encodeX401HeaderObject(payload)}.`
}

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
              request: headerJwt({
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
    satisfied_requirements: ['kyc:basic'],
    payment: {
      required: true,
      scheme_hint: 'ap2',
    },
  }
}

function resultArtifact(): Record<string, unknown> {
  return {
    request_id: requestId,
    agent_id: agentId,
    credential_result: {
      protocol: 'openid4vp-v1-signed',
      data: { vp_token: 'credential-result' },
    },
  }
}

function proofHeaders(): Record<string, string> {
  return {
    'PROOF-REQUEST': encodeX401HeaderObject(proofRequest()),
    'PROOF-RESPONSE': encodeX401HeaderObject(resultArtifact()),
  }
}

async function signedToolCallRecord(): Promise<AtribRecord> {
  const seed = new Uint8Array(32).fill(0x44)
  const pubKey = base64urlEncode(await ed.getPublicKeyAsync(seed))
  return signRecord(
    {
      spec_version: 'atrib/1.0',
      content_id: 'sha256:' + 'e'.repeat(64),
      creator_key: pubKey,
      chain_root: 'sha256:' + 'f'.repeat(64),
      event_type: 'https://atrib.dev/v1/types/tool_call',
      context_id: '9'.repeat(32),
      timestamp: 1_700_000_000_000,
      signature: '',
    } as AtribRecord,
    seed,
  )
}

describe('x401 evidence e2e', () => {
  it('attaches x401 proof evidence while keeping payment detection separate', async () => {
    const headers = proofHeaders()
    const x401Only = detectTransaction('api_call', {}, headers)
    const withPayment = detectTransaction(
      'api_call',
      {},
      {
        ...headers,
        'PAYMENT-RESPONSE': 'eyJzdWNjZXNzIjp0cnVlfQ==',
      },
    )

    expect(x401Only).toMatchObject({ detected: false, protocol: null })
    expect(withPayment).toMatchObject({ detected: true, protocol: 'x402' })

    const evidence = await verifyAuthorizationEvidence({
      protocol: 'x401',
      x401: {
        headers,
        resultVerified: true,
        expectedRequestId: requestId,
        expectedAgentId: agentId,
        requiredSatisfiedRequirements: ['kyc:basic'],
      },
    })
    expect(evidence).toMatchObject({ protocol: 'x401', valid: true })
    expect(evidence.details).toMatchObject({
      response_kind: 'result_artifact',
      proof_gate: {
        kind: 'result_artifact',
        status: 'passed',
      },
      payment_separation: {
        present: true,
        required: true,
        scheme_hint: 'ap2',
      },
    })

    const record = await signedToolCallRecord()
    const verified = await verifyRecord(record, {
      authorizationEvidence: [
        {
          protocol: 'x401',
          x401: {
            headers,
            resultVerified: true,
            expectedRequestId: requestId,
            expectedAgentId: agentId,
          },
        },
      ],
    })

    expect(verified.valid).toBe(true)
    expect(verified.evidence).toContainEqual(
      expect.objectContaining({
        protocol: 'x401',
        valid: true,
      }),
    )
  })

  it('runs a local x401 proof gate and propagates sanitized evidence through archive', async () => {
    const run = await runX401ProofGateHarness()
    expect(run.attempts).toEqual({
      initial_status: 401,
      wrong_request_id_status: 401,
      stale_nonce_status: 401,
      success_status: 200,
    })
    expect(run.verification.warnings).toEqual([])
    expect(run.verification.valid).toBe(true)
    expect(run.verification.informed_by_resolution?.resolved).toEqual([
      run.record_hashes.attempted_action,
    ])
    expect(run.public_packet).toMatchObject({
      proof_gate_status: 'passed',
      informed_by_resolved: [run.record_hashes.attempted_action],
      payment_detected: false,
    })
    expect(JSON.stringify(run.public_packet)).not.toContain('private-fixture-vp-token')

    const archive = await bindArchiveServer(0, '127.0.0.1', {
      origin: 'archive.test/v1',
      allowUncommittedRecords: true,
    })
    try {
      const x401Evidence = run.public_evidence.find((block) => block.protocol === 'x401')
      const submit = await fetch(`${archive.url}/v1/records`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          record_hash: run.record_hashes.successful_action,
          record: run.successful_record,
          evidence: x401Evidence ? [x401Evidence] : [],
        }),
      })
      expect(submit.status).toBe(201)

      const evidence = await fetch(
        `${archive.url}/v1/evidence/${run.record_hashes.successful_action.slice('sha256:'.length)}`,
      )
      expect(evidence.status).toBe(200)
      const evidenceText = await evidence.text()
      expect(evidenceText).toContain('"protocol":"x401"')
      expect(evidenceText).toContain('"status":"passed"')
      expect(evidenceText).not.toContain('private-fixture-vp-token')
      expect(evidenceText).not.toContain('vp_token')
    } finally {
      await archive.close()
    }
  })

  it('composes x401, AAuth, and payment evidence without collapsing protocols', async () => {
    const run = await runX401AAuthPaymentChainHarness()

    expect(run.verification.valid).toBe(true)
    expect(run.verification.warnings).toEqual([])
    expect(run.public_packet).toMatchObject({
      evidence_protocols: ['aauth', 'x401'],
      evidence_valid: {
        aauth: true,
        x401: true,
      },
      proof_gate_status: 'passed',
      aauth_agent: 'aauth:agent.example',
      aauth_subject: 'user-pairwise-x401-1',
      payment_detected: true,
      payment_protocol: 'x402',
      x401_is_payment: false,
      payment_hint_scheme: 'ap2',
      informed_by_resolved: [run.x401.record_hashes.attempted_action],
    })
    expect(run.payment_detection).toMatchObject({ detected: true, protocol: 'x402' })
    expect(JSON.stringify(run.public_packet)).not.toContain('private-fixture-vp-token')
    expect(JSON.stringify(run.public_packet)).not.toContain('PAYMENT-RESPONSE')
  })

  it('runs multi-endpoint x401 propagation as separate signed proof gates', async () => {
    const run = await runX401MultiEndpointHarness()

    expect(run.context_id).toBe('40100000000000000000000000000000')
    expect(run.public_packet).toMatchObject({
      request_ids: ['proof-template-address-v1', 'proof-template-eligibility-v1'],
      payment_detected: false,
    })
    expect(run.endpoints).toHaveLength(2)

    const first = run.endpoints[0]!
    const second = run.endpoints[1]!
    for (const endpoint of run.endpoints) {
      expect(endpoint.attempts).toEqual({
        initial_status: 401,
        success_status: 200,
      })
      expect(endpoint.verification.valid).toBe(true)
      expect(endpoint.verification.warnings).toEqual([])
      expect(endpoint.public_packet).toMatchObject({
        proof_gate_status: 'passed',
        agent_origin_verified: true,
        issuer_trust_verified: true,
        proof_payment_binding_verified: true,
        payment_detected: false,
      })
      expect(endpoint.public_packet.proof_request_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(endpoint.public_packet.proof_response_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(JSON.stringify(endpoint.public_packet)).not.toContain('private-fixture-vp-token')
    }

    expect(first.public_packet.informed_by_resolved).toEqual([first.record_hashes.attempted_action])
    expect(second.public_packet.informed_by_resolved).toEqual(
      expect.arrayContaining([
        second.record_hashes.attempted_action,
        first.record_hashes.successful_action,
      ]),
    )
  })
})
