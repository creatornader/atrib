// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { classifyProofX401NodeReadme } from '../src/proof-x401-sdk-compat.js'

describe('Proof x401 SDK compatibility classifier', () => {
  it('rejects the old x401-node header semantics', () => {
    const report = classifyProofX401NodeReadme({
      packageName: '@proof.com/x401-node',
      version: '0.2.0',
      readme: `
        Return PROOF-REQUIRED from the verifier.
        Retry with PROOF-PRESENTATION from the agent.
        Return verifier errors in PROOF-RESPONSE.
        The payload carries presentation_requirements and a VP Artifact with vp_artifact.
      `,
    })

    expect(report.compatible_with_current_spec).toBe(false)
    expect(report.missing_current_headers).toEqual(['PROOF-REQUEST', 'PROOF-RESULT'])
    expect(report.found_legacy_headers).toEqual(['PROOF-REQUIRED', 'PROOF-PRESENTATION'])
    expect(report.found_legacy_payload_markers).toContain('presentation_requirements')
    expect(report.recommendation).toContain('Do not claim Proof SDK interop')
  })

  it('accepts current x401 header and result artifact semantics', () => {
    const report = classifyProofX401NodeReadme({
      packageName: '@proof.com/x401-node',
      version: '0.3.0',
      readme: `
        The verifier returns PROOF-REQUEST.
        The agent retries with PROOF-RESPONSE.
        The verifier can return PROOF-RESULT.
        The payload carries credential_requirements.digital.
        Result artifacts use credential_result or credential_result_uri.
        The token exchange subject type is result_artifact.
      `,
    })

    expect(report.compatible_with_current_spec).toBe(true)
    expect(report.missing_current_headers).toEqual([])
    expect(report.found_legacy_headers).toEqual([])
  })
})

