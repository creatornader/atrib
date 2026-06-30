// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  classifyMissingProofRepoSurface,
  classifyProofRepoSurface,
  classifyProofRepoSurfaces,
} from '../src/proof-x401-sdk-compat.js'

describe('Proof repository interop classifier', () => {
  it('keeps legacy x401-node out of runtime dependency scope', () => {
    const report = classifyProofRepoSurface({
      repo: 'proof/x401-node',
      packageJson: {
        name: '@proof.com/x401-node',
        version: '0.2.0',
      },
      sourceText: `
        export const HEADER = {
          PROOF_REQUIRED: "PROOF-REQUIRED",
          PROOF_PRESENTATION: "PROOF-PRESENTATION",
          PROOF_RESPONSE: "PROOF-RESPONSE",
        };
        export interface X401Payload {
          presentation_requirements: DigitalCredentialRequest;
        }
      `,
    })

    expect(report.interop_status).toBe('legacy_x401_wire')
    expect(report.runtime_dependency_allowed).toBe(false)
    expect(report.current_spec_wire_ready).toBe(false)
    expect(report.evidence.found_legacy_headers).toEqual(['PROOF-REQUIRED', 'PROOF-PRESENTATION'])
    expect(report.required_next_step).toContain('Do not use this SDK as a public package')
  })

  it('allows x401-node only when current wire names are present without legacy names', () => {
    const report = classifyProofRepoSurface({
      repo: 'x401-node',
      packageJson: {
        name: '@proof.com/x401-node',
        version: '0.3.0',
      },
      sourceText: `
        export const HEADER = {
          PROOF_REQUEST: "PROOF-REQUEST",
          PROOF_RESPONSE: "PROOF-RESPONSE",
          PROOF_RESULT: "PROOF-RESULT",
        };
        export interface X401Payload {
          credential_requirements: DigitalCredentialRequest;
        }
        export interface ResultArtifact {
          credential_result?: PresentationResult;
          credential_result_uri?: string;
          subject_token_type: "result_artifact";
        }
      `,
    })

    expect(report.interop_status).toBe('current_spec_sdk_ready')
    expect(report.runtime_dependency_allowed).toBe(true)
    expect(report.current_spec_wire_ready).toBe(true)
    expect(report.required_next_step).toContain('Run the released Proof SDK fixture')
  })

  it('classifies Proof credential and browser packages as helpers, not wire SDKs', () => {
    const reports = classifyProofRepoSurfaces([
      {
        repo: 'proof/proof-vc-common',
        packageJson: {
          name: '@proof.com/proof-vc-common',
          version: '0.2.0',
          dependencies: {
            '@sd-jwt/sd-jwt-vc': '^1.0.0',
            '@owf/identity-common': '^0.8.0',
          },
        },
        sourceText: `
          export { verifyVPToken, getDCAPIAuthorizationRequest, ProofCredentialV1 };
        `,
      },
      {
        repo: 'proof/proof-vc-web',
        packageJson: {
          name: '@proof.com/proof-vc-web',
          version: '0.2.0',
          dependencies: {
            '@proof.com/proof-vc-common': '^0.2.0',
          },
        },
        sourceText: `
          customElements.define("proof-verify-id", ProofVerifyId);
          export { ProofVerifyId };
        `,
      },
    ])

    expect(reports[0]).toMatchObject({
      role: 'credential verifier helper',
      interop_status: 'credential_verifier_helper',
      runtime_dependency_allowed: false,
    })
    expect(reports[0]?.required_next_step).toContain('Run the opt-in Proof VC Common fixture')
    expect(reports[0]?.evidence.found_helper_markers).toEqual(
      expect.arrayContaining(['verifyVPToken', '@sd-jwt/sd-jwt-vc']),
    )
    expect(reports[1]).toMatchObject({
      role: 'browser credential UI reference',
      interop_status: 'browser_credential_ui_reference',
      runtime_dependency_allowed: false,
    })
    expect(reports[1]?.evidence.found_helper_markers).toEqual(
      expect.arrayContaining(['proof-verify-id', 'ProofVerifyId']),
    )
  })

  it('keeps the verifier demo reference-only while it uses legacy x401 headers', () => {
    const report = classifyProofRepoSurface({
      repo: 'proof/verifier-vcp-demo',
      packageJson: {
        name: 'verifier-vcp-demo',
        version: '0.1.0',
        dependencies: {
          '@proof.com/x401-node': '^0.1.0',
        },
      },
      sourceText: `
        request.headers.get(HEADER.PROOF_PRESENTATION);
        return new Response(body, { headers: { [HEADER.PROOF_REQUIRED]: proofRequired } });
      `,
    })

    expect(report.interop_status).toBe('demo_legacy_x401')
    expect(report.runtime_dependency_allowed).toBe(false)
    expect(report.evidence.found_helper_markers).toContain('@proof.com/x401-node')
  })

  it('marks missing repos as unchecked instead of inferring support', () => {
    const report = classifyMissingProofRepoSurface('proof/x401')

    expect(report.interop_status).toBe('not_checked')
    expect(report.runtime_dependency_allowed).toBe(false)
    expect(report.recommendation).toContain('unchecked')
  })
})
