import { describe, expect, it } from 'vitest'
import { canonicalRecord, hexEncode, sha256 } from '@atrib/mcp'
import { runMcpOAuthEvidenceHarness } from '../src/mcp-oauth-evidence-harness.js'

describe('MCP OAuth evidence harness', () => {
  it('captures verified authInfo evidence and verifies it through evidence[]', async () => {
    const result = await runMcpOAuthEvidenceHarness()

    expect(result.record.context_id).toBe('1234567890abcdef1234567890abcdef')
    expect(result.record.args_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(result.record.result_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(result.sidecar.resolvedFacts).toEqual({ tool_name: 'read_file' })
    expect(result.sidecar.authorizationEvidence).toHaveLength(1)
    expect(JSON.stringify(result.sidecar.authorizationEvidence)).not.toContain(
      'fixture-access-token',
    )

    expect(result.verification.valid).toBe(true)
    expect(result.verification.evidence).toHaveLength(1)
    expect(result.verification.evidence![0]!.protocol).toBe('mcp_oauth')
    expect(result.verification.evidence![0]!.valid).toBe(true)
    expect(result.verification.evidence![0]!.attenuation_ok).toBe(true)
    const details = result.verification.evidence![0]!.details as { dpop?: { verified?: boolean } }
    expect(details.dpop?.verified).toBe(true)
    expect(result.verification.evidence![0]!.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'scope', status: 'passed' }),
        expect.objectContaining({ type: 'dpop.htm', status: 'passed' }),
        expect.objectContaining({ type: 'dpop.htu', status: 'passed' }),
        expect.objectContaining({ type: 'dpop.ath', status: 'passed' }),
        expect.objectContaining({ type: 'dpop.cnf.jkt', status: 'passed' }),
      ]),
    )

    const hash = `sha256:${hexEncode(sha256(canonicalRecord(result.record)))}`
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/)
  })
})
