// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { bindArchiveServer } from '@atrib/archive-node'
import { startLogServer } from '@atrib/log-node'
import { createProofLogReceipt } from '../src/proof-log-receipt.js'

describe('proof-log receipt', () => {
  it('builds a single-hash receipt with checkpoint, inclusion, archive, and verifier evidence', async () => {
    const log = await startLogServer({ port: 0 })
    const archive = await bindArchiveServer(0, '127.0.0.1', {
      origin: 'archive.test/v1',
      trustedLogEndpoints: [`${log.url}/v1`],
    })

    try {
      const receipt = await createProofLogReceipt({
        logEndpoint: log.url,
        archiveEndpoint: archive.url,
        explorerOrigin: 'https://explore.test',
      })

      expect(receipt.strategy).toBe('atrib-proof-log-single-hash-receipt-v1')
      expect(receipt.record_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(receipt.context_id).toBe('1234567890abcdef1234567890abcdef')
      expect(receipt.urls.log_lookup).toContain('/v1/lookup/')
      expect(receipt.urls.log_proof).toContain('/v1/proof/')
      expect(receipt.urls.archive_record).toContain('/v1/record/')
      expect(receipt.urls.archive_evidence).toContain('/v1/evidence/')
      expect(receipt.urls.explorer_action).toBe(
        `https://explore.test/action/${receipt.record_hash}`,
      )

      expect(receipt.checkpoint).toMatchObject({
        origin: 'log.atrib.dev/v1',
        tree_size: 1,
        checkpoint_signature_ok: true,
        key_id_matches_pubkey: true,
        origin_matches_pubkey: true,
      })
      expect(receipt.inclusion).toMatchObject({
        log_index: 0,
        path_length: 0,
        verifies_against_checkpoint_root: true,
      })
      expect(receipt.archive).toMatchObject({
        record_status: 200,
        evidence_status: 200,
        body_hash_matches_log_hash: true,
        evidence_count: 1,
        evidence_valid: true,
        raw_bearer_token_published: false,
      })
      expect(receipt.verifier).toMatchObject({
        signature_ok: true,
        valid: true,
        warnings: [],
      })
      expect(receipt.verifier.evidence_protocols).toEqual(['mcp_oauth'])
      expect(receipt.caveats).toContain('single-log proof only; no witness cosignature is claimed')
    } finally {
      await archive.close()
      await log.close()
    }
  })
})
