// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { bindArchiveServer } from '@atrib/archive-node'
import { startLogServer } from '@atrib/log-node'
import { createLiveMcpOAuthArchiveReceipt } from '../src/live-mcp-oauth-archive.js'

describe('MCP OAuth live archive helper', () => {
  it('creates an archive-backed OAuth evidence receipt without publishing the raw token', async () => {
    const log = await startLogServer({ port: 0 })
    const archive = await bindArchiveServer(0, '127.0.0.1', {
      origin: 'archive.test/v1',
      trustedLogEndpoints: [`${log.url}/v1`],
    })
    try {
      const receipt = await createLiveMcpOAuthArchiveReceipt({
        logEndpoint: log.url,
        archiveEndpoint: archive.url,
        explorerOrigin: 'https://explore.test',
      })

      expect(receipt.record_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(receipt.context_id).toBe('1234567890abcdef1234567890abcdef')
      expect(receipt.log_index).toBe(0)
      expect(receipt.explorer_action_url).toBe(`https://explore.test/action/${receipt.record_hash}`)
      expect(receipt.raw_bearer_token_published).toBe(false)
      expect(receipt.evidence_summary).toMatchObject({
        protocol: 'mcp_oauth',
        valid: true,
        issuer: 'https://auth.example.com',
        subject: 'user-123',
        attenuation_ok: true,
        delegation_ok: null,
        constraints_failed: 0,
        constraints_unresolved: 0,
      })
      expect(receipt.evidence_summary.scope).toEqual(['files:read', 'files:write'])
      expect(receipt.evidence_summary.constraints_total).toBeGreaterThan(0)

      const evidence = await fetch(receipt.archive_evidence_url)
      expect(evidence.status).toBe(200)
      expect(await evidence.text()).not.toContain('fixture-access-token')
    } finally {
      await archive.close()
      await log.close()
    }
  })
})
