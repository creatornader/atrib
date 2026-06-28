// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  proofX401NodePayloadToCurrentSpecPayload,
  proofX401NodeTokenObjectToCurrentSpecTokenObject,
  proofX401NodeVpArtifactToCurrentSpecResultArtifact,
  runProofX401NodeRuntimeInterop,
} from '../src/proof-x401-node-runtime.js'

describe('Proof x401 Node runtime interop adapter', () => {
  it('translates Proof SDK payloads to the hosted current x401 payload shape', () => {
    const current = proofX401NodePayloadToCurrentSpecPayload({
      scheme: 'x401',
      version: '0.2.0',
      presentation_requirements: {
        requests: [
          {
            protocol: 'openid4vp-v1-signed',
            data: { request: 'signed-request-jwt' },
          },
        ],
      },
      oauth: { token_endpoint: 'https://verifier.example/oauth/token' },
      trust_establishment: 'https://verifier.example/.well-known/x401/trust/basic-v1',
      request_id: 'proof-template-basic-v1',
    })

    expect(current).toMatchObject({
      scheme: 'x401',
      version: '0.2.0',
      credential_requirements: {
        digital: {
          requests: [
            {
              protocol: 'openid4vp-v1-signed',
              data: { request: 'signed-request-jwt' },
            },
          ],
        },
      },
      oauth: { token_endpoint: 'https://verifier.example/oauth/token' },
      request_id: 'proof-template-basic-v1',
    })
    expect(current).not.toHaveProperty('presentation_requirements')
    expect(current).not.toHaveProperty('trust_establishment')
  })

  it('translates Proof SDK VP artifacts to current result artifacts', () => {
    const inline = proofX401NodeVpArtifactToCurrentSpecResultArtifact({
      response: {
        protocol: 'openid4vp-v1-signed',
        data: { vp_token: 'private-fixture-vp-token' },
      },
      request_id: 'proof-template-basic-v1',
      agent_id: 'did:web:agent.example',
    })
    const byReference = proofX401NodeVpArtifactToCurrentSpecResultArtifact({
      presentation_uri: 'https://verifier.example/.well-known/x401/results/abc123',
      expires_at: '2026-05-06T18:50:00Z',
      request_id: 'proof-template-basic-v1',
    })

    expect(inline).toMatchObject({
      credential_result: {
        protocol: 'openid4vp-v1-signed',
        data: { vp_token: 'private-fixture-vp-token' },
      },
      request_id: 'proof-template-basic-v1',
      agent_id: 'did:web:agent.example',
    })
    expect(inline).not.toHaveProperty('response')
    expect(byReference).toMatchObject({
      credential_result_uri: 'https://verifier.example/.well-known/x401/results/abc123',
      expires_at: '2026-05-06T18:50:00Z',
      request_id: 'proof-template-basic-v1',
    })
    expect(byReference).not.toHaveProperty('presentation_uri')
  })

  it('keeps x401 token objects stable across the adapter', () => {
    expect(
      proofX401NodeTokenObjectToCurrentSpecTokenObject({
        scheme: 'x401',
        version: '0.2.0',
        token_type: 'Bearer',
        access_token: 'private-token',
      }),
    ).toEqual({
      scheme: 'x401',
      version: '0.2.0',
      token_type: 'Bearer',
      access_token: 'private-token',
    })
  })

  it('runs the published SDK while producing strict current-spec atrib evidence', async () => {
    const result = await runProofX401NodeRuntimeInterop()
    const x401Evidence = result.public_evidence.find((block) => block.protocol === 'x401')
    const details = x401Evidence?.details as
      | {
          legacy_headers_used?: string[]
          legacy_fields_used?: string[]
          proof_gate?: { status?: string | null }
        }
      | undefined

    expect(result.sdk_package).toBe('@proof.com/x401-node')
    expect(result.sdk_version).toBe('0.2.0')
    expect(result.adapter_mode).toBe('legacy_sdk_to_current_spec_evidence')
    expect(result.sdk_direct_current_spec_compatible).toBe(false)
    expect(result.strict_legacy_evidence_rejected).toBe(true)
    expect(result.verification.valid).toBe(true)
    expect(result.verification.warnings).toEqual([])
    expect(x401Evidence).toMatchObject({ protocol: 'x401', valid: true })
    expect(details?.legacy_headers_used).toEqual([])
    expect(details?.legacy_fields_used).toEqual([])
    expect(details?.proof_gate?.status).toBe('passed')

    expect(result.public_packet).toMatchObject({
      sdk_package: '@proof.com/x401-node',
      sdk_version: '0.2.0',
      adapter_mode: 'legacy_sdk_to_current_spec_evidence',
      sdk_runtime_exercised: true,
      sdk_direct_current_spec_compatible: false,
      strict_legacy_evidence_rejected: true,
      proof_gate_status: 'passed',
      informed_by_resolved: [result.record_hashes.attempted_action],
    })
    expect(result.public_packet.legacy_sdk_header_names).toEqual(
      expect.arrayContaining(['PROOF-REQUIRED', 'PROOF-PRESENTATION', 'PROOF-RESPONSE']),
    )
    expect(result.public_packet.current_spec_header_names).toEqual([
      'PROOF-REQUEST',
      'PROOF-RESPONSE',
      'PROOF-RESULT',
    ])
    expect(JSON.stringify(result.public_packet)).not.toContain('private-fixture-vp-token')
    expect(JSON.stringify(result.public_packet)).not.toContain('private-token')
  })
})
