// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { runProofVcCommonX401Interop, verifyFixtureVPToken } from '../src/proof-vc-common-x401.js'

describe('Proof VC Common x401 verifier interop', () => {
  it('turns a Proof VC verification result into caller-owned x401 evidence', async () => {
    const result = await runProofVcCommonX401Interop()

    expect(result.credential_verifier_package).toBe('@proof.com/proof-vc-common')
    expect(result.credential_verifier_version).toBe('0.2.0')
    expect(result.credential_verifier_ref).toBe('npm:@proof.com/proof-vc-common@0.2.0')
    expect(result.credential_verifier_mode).toBe('fixture')
    expect(result.x401_sdk_package).toBe('@proof.com/x401-node')
    expect(result.x401_sdk_version).toBe('0.3.0')
    expect(result.x401_spec_version).toBe('0.2.0')
    expect(result.verifier_invoked).toBe(true)
    expect(result.credential_result_verified).toBe(true)
    expect(result.credential_subject_over_18).toBe(true)
    expect(result.verification).toMatchObject({ protocol: 'x401', valid: true })
    expect(result.public_packet).toMatchObject({
      credential_verifier_package: '@proof.com/proof-vc-common',
      credential_verifier_version: '0.2.0',
      credential_verifier_ref: 'npm:@proof.com/proof-vc-common@0.2.0',
      credential_verifier_mode: 'fixture',
      x401_sdk_package: '@proof.com/x401-node',
      x401_sdk_version: '0.3.0',
      x401_spec_version: '0.2.0',
      credential_result_verified: true,
      credential_subject_over_18: true,
      proof_gate_status: 'passed',
      issuer_trust_verified: true,
    })
    expect(JSON.stringify(result.public_packet)).not.toContain('fixture-proof-vc-common-vp-token')
  })

  it('fails x401 result verification when Proof VC verification does not accept the credential', async () => {
    const result = await runProofVcCommonX401Interop({
      verifier: async (params) => {
        await verifyFixtureVPToken(params)
        return {
          proof_id_default: [
            {
              credentialType: () => 'ProofCredentialV1',
              format: () => 'dc+sd-jwt',
              getClaims: () => ({ age_is_over: { '18': false } }),
              getSDJWT: () => ({}) as never,
              isOver18: false,
            },
          ],
        }
      },
    })

    expect(result.credential_result_verified).toBe(false)
    expect(result.verification.valid).toBe(false)
    expect(result.verification.errors).toContain('x401_evidence issuer trust verification failed')
    expect(result.verification.errors).toContain('x401_evidence result verification failed')
  })
})
