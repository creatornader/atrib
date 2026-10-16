// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { createClient, parseAuthorizationResponse, ProofVCError } from '@proof.com/proof-vc-common'
import {
  resolveProofVcEnvironment,
  runProofVcCommonX401Interop,
  verifyFixtureVPToken,
} from '../src/proof-vc-common-x401.js'

describe('Proof VC Common x401 verifier interop', () => {
  it.each(['development', 'production'])(
    'checks capture CLI configuration before opening a browser: %s',
    async (trustRoot) => {
      const run = promisify(execFile)
      const invocation = run(
        process.execPath,
        [
          join(process.cwd(), 'node_modules/tsx/dist/cli.mjs'),
          'scripts/proof-vc-token-capture.ts',
          '--print-url',
        ],
        {
          timeout: 20_000,
          env: {
            ...process.env,
            ATRIB_PROOF_VC_CAPTURE_ENVIRONMENT: 'staging',
            ATRIB_PROOF_VC_COMMON_TRUST_ROOT: trustRoot,
            ATRIB_PROOF_VC_CAPTURE_CLIENT_ID: 'fixture-client',
            ATRIB_PROOF_VC_CAPTURE_LOGIN_HINT: 'fixture@example.test',
          },
        },
      )
      if (trustRoot === 'production') {
        await expect(invocation).rejects.toMatchObject({
          code: 2,
          stderr: expect.stringContaining('different trust roots'),
        })
      } else {
        const { stdout } = await invocation
        const result = JSON.parse(stdout)
        expect(result.proof_environment).toBe('staging')
        expect(result.trust_root).toBe('development')
        expect(new URL(result.authorization_url).hostname).toBe('api.staging.proof.com')
      }
    },
  )

  it('maps legacy trust roots to explicit environments and rejects contradictory configuration', () => {
    expect(resolveProofVcEnvironment({})).toBe('production')
    expect(resolveProofVcEnvironment({ trustRoot: 'development' })).toBe('sandbox')
    expect(resolveProofVcEnvironment({ trustRoot: 'production' })).toBe('production')
    expect(resolveProofVcEnvironment({ environment: 'staging', trustRoot: 'development' })).toBe(
      'staging',
    )
    expect(() =>
      resolveProofVcEnvironment({ environment: 'sandbox', trustRoot: 'production' }),
    ).toThrow(/different trust roots/)
    expect(() => resolveProofVcEnvironment({ environment: 'invalid' as never })).toThrow(
      /unsupported/,
    )
  })

  it.each([
    'not-json',
    'null',
    '[]',
    '{"proof_id_default":"not-an-array"}',
    '{"proof_id_default":["not-an-sd-jwt"]}',
    '{"__proto__":[]}',
  ])('uses the real native verifier to reject %s without a network request', async (body) => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('unexpected network request'))
    try {
      await expect(
        runProofVcCommonX401Interop({
          mode: 'native',
          encodedVPToken: Buffer.from(body).toString('base64url'),
          environment: 'sandbox',
        }),
      ).rejects.toBeInstanceOf(ProofVCError)
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('does not turn a native empty presentation into accepted credential evidence', async () => {
    const result = await runProofVcCommonX401Interop({
      mode: 'native',
      encodedVPToken: Buffer.from('{}').toString('base64url'),
      trustRoot: 'development',
    })
    expect(result.credential_verifier_mode).toBe('native')
    expect(result.credential_result_verified).toBe(false)
    expect(result.verification.valid).toBe(false)
  })

  it('binds the real native verifier to the selected Proof issuer environment', async () => {
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
    const sdjwt = `${encode({ typ: 'dc+sd-jwt', alg: 'ES256', x5c: ['invalid-fixture-certificate'] })}.${encode({ iss: 'https://untrusted.example' })}.c2ln~`
    await expect(
      runProofVcCommonX401Interop({
        mode: 'native',
        environment: 'staging',
        encodedVPToken: encode({ proof_id_default: [sdjwt] }),
      }),
    ).rejects.toThrow(/expected issuer.*staging\.proof\.com/)
  })

  it('keeps unsupported credential types outside the over-18 policy', async () => {
    const result = await runProofVcCommonX401Interop({
      verifier: async (params) => {
        const presentation = await verifyFixtureVPToken(params)
        const credential = presentation.proof_id_default[0]!
        return {
          ...presentation,
          proof_id_default: [{ ...credential, credentialType: () => 'Default' }],
        }
      },
    })
    expect(result.credential_result_verified).toBe(false)
    expect(result.verification.valid).toBe(false)
  })

  it('builds a real authorization URL and parses the callback without contacting Proof', () => {
    const proof = createClient({
      environment: 'sandbox',
      clientId: 'fixture-client',
      callbackUri: 'http://127.0.0.1/callback',
    })
    const url = new URL(
      proof.authorizationUrl({
        nonce: 'fixture-nonce',
        state: 'fixture-state',
        scope: 'urn:proof:params:scope:verifiable-credentials:basic',
      }),
    )
    expect(url.searchParams.get('nonce')).toBe('fixture-nonce')
    expect(url.searchParams.get('state')).toBe('fixture-state')
    expect(url.searchParams.get('client_id')).toBe('fixture-client')
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1/callback')
    expect(
      parseAuthorizationResponse('#vp_token=private-fixture-token&state=fixture-state'),
    ).toMatchObject({ type: 'success', vpToken: 'private-fixture-token', state: 'fixture-state' })
    expect(parseAuthorizationResponse('#error=access_denied&state=fixture-state')).toMatchObject({
      type: 'error',
      error: 'access_denied',
    })
  })

  it('turns a Proof VC verification result into caller-owned x401 evidence', async () => {
    const result = await runProofVcCommonX401Interop()

    expect(result.credential_request_package).toBe('@proof.com/proof-vc-common')
    expect(result.credential_request_version).toBe('0.6.0')
    expect(result.credential_request_ref).toBe('npm:@proof.com/proof-vc-common@0.6.0')
    expect(result.credential_verifier_package).toBe('@proof.com/proof-vc-server')
    expect(result.credential_verifier_version).toBe('0.6.0')
    expect(result.credential_verifier_ref).toBe('npm:@proof.com/proof-vc-server@0.6.0')
    expect(result.credential_verifier_mode).toBe('fixture')
    expect(result.x401_sdk_package).toBe('@proof.com/x401-node')
    expect(result.x401_sdk_version).toBe('0.3.3')
    expect(result.x401_spec_version).toBe('0.2.0')
    expect(result.verifier_invoked).toBe(true)
    expect(result.credential_result_verified).toBe(true)
    expect(result.credential_subject_over_18).toBe(true)
    expect(result.credential_nonce_verified).toBe(true)
    expect(result.verification).toMatchObject({ protocol: 'x401', valid: true })
    expect(result.public_packet).toMatchObject({
      credential_request_package: '@proof.com/proof-vc-common',
      credential_request_version: '0.6.0',
      credential_request_ref: 'npm:@proof.com/proof-vc-common@0.6.0',
      credential_verifier_package: '@proof.com/proof-vc-server',
      credential_verifier_version: '0.6.0',
      credential_verifier_ref: 'npm:@proof.com/proof-vc-server@0.6.0',
      credential_verifier_mode: 'fixture',
      x401_sdk_package: '@proof.com/x401-node',
      x401_sdk_version: '0.3.3',
      x401_spec_version: '0.2.0',
      credential_result_verified: true,
      credential_subject_over_18: true,
      credential_nonce_verified: true,
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
          proof_id_nationality_us: [],
          proof_id_default: [
            {
              credentialType: () => 'ProofCredentialV1',
              format: () => 'dc+sd-jwt',
              getClaims: () => ({ age_equal_or_over: { '18': false } }),
              getSDJWT: () => ({}) as never,
              getNonce: () => 'proof-vc-common-x401-nonce-1',
              isOver18: false,
              toJSON: () => ({ isOver18: false }),
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

  it('fails x401 result verification when the verified credential nonce does not bind', async () => {
    const result = await runProofVcCommonX401Interop({
      verifier: async (params) => {
        await verifyFixtureVPToken(params)
        return {
          proof_id_nationality_us: [],
          proof_id_default: [
            {
              credentialType: () => 'ProofCredentialV1',
              format: () => 'dc+sd-jwt',
              getClaims: () => ({ age_equal_or_over: { '18': true } }),
              getSDJWT: () => ({}) as never,
              getNonce: () => 'different-nonce',
              isOver18: true,
              toJSON: () => ({ isOver18: true }),
            },
          ],
        }
      },
    })

    expect(result.credential_nonce_verified).toBe(false)
    expect(result.credential_result_verified).toBe(false)
    expect(result.verification.valid).toBe(false)
    expect(result.verification.errors).toContain('x401_evidence issuer trust verification failed')
    expect(result.verification.errors).toContain('x401_evidence result verification failed')
  })
})
