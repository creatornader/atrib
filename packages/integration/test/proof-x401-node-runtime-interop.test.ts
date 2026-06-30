// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { runProofX401NodeRuntimeInterop } from '../src/proof-x401-node-runtime.js'

describe('Proof x401 Node native runtime interop', () => {
  it('runs the released current-spec Proof SDK while producing strict atrib evidence', async () => {
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
    expect(result.sdk_version).toBe('0.3.0')
    expect(result.x401_spec_version).toBe('0.2.0')
    expect(result.sdk_package_ref).toBe('npm:@proof.com/x401-node@0.3.0')
    expect(result.adapter_mode).toBe('current_spec_native')
    expect(result.sdk_direct_current_spec_compatible).toBe(true)
    expect(result.strict_legacy_evidence_rejected).toBe(true)
    expect(result.verification.valid).toBe(true)
    expect(result.verification.warnings).toEqual([])
    expect(x401Evidence).toMatchObject({ protocol: 'x401', valid: true })
    expect(details?.legacy_headers_used).toEqual([])
    expect(details?.legacy_fields_used).toEqual([])
    expect(details?.proof_gate?.status).toBe('passed')

    expect(result.public_packet).toMatchObject({
      sdk_package: '@proof.com/x401-node',
      sdk_version: '0.3.0',
      x401_spec_version: '0.2.0',
      sdk_package_ref: 'npm:@proof.com/x401-node@0.3.0',
      adapter_mode: 'current_spec_native',
      sdk_runtime_exercised: true,
      sdk_direct_current_spec_compatible: true,
      strict_legacy_evidence_rejected: true,
      proof_gate_status: 'passed',
      informed_by_resolved: [result.record_hashes.attempted_action],
    })
    expect(result.public_packet.sdk_header_names).toEqual([
      'PROOF-REQUEST',
      'PROOF-RESPONSE',
      'PROOF-RESULT',
    ])
    expect(result.public_packet.current_spec_header_names).toEqual([
      'PROOF-REQUEST',
      'PROOF-RESPONSE',
      'PROOF-RESULT',
    ])
    expect(JSON.stringify(result.public_packet)).not.toContain('private-fixture-vp-token')
    expect(JSON.stringify(result.public_packet)).not.toContain('private-token')
  })
})
