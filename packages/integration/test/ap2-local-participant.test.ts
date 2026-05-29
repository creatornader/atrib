import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generateAp2LocalParticipantArtifacts } from '../src/ap2-local-participant.js'
import { runAp2LiveInteropFromEnv } from '../src/ap2-live-interop.js'

import ap2ViReferenceEvidenceJson from './fixtures/ap2-vi-reference/ap2-vi-reference-evidence.json'
import ap2ViReferenceMetadataJson from './fixtures/ap2-vi-reference/ap2-vi-reference-metadata.json'
import ap2ViReferenceResultJson from './fixtures/ap2-vi-reference/ap2-vi-reference-result.json'

const metadata = ap2ViReferenceMetadataJson as { now_seconds: number }

describe('AP2 local participant artifacts', () => {
  it('emits a counterparty-signed atrib transaction record for AP2 / VI evidence', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'atrib-ap2-local-participant-'))
    try {
      const generated = await generateAp2LocalParticipantArtifacts({
        result: ap2ViReferenceResultJson,
        evidence: ap2ViReferenceEvidenceJson,
        outDir,
        nowSeconds: metadata.now_seconds,
      })

      expect(generated.transactionRecord.signers).toHaveLength(2)
      expect(generated.files.result).toBe(join(outDir, 'ap2-result.json'))
      expect(generated.files.evidence).toBe(join(outDir, 'ap2-vi-evidence.json'))
      expect(generated.files.transactionRecord).toBe(join(outDir, 'atrib-transaction-record.json'))

      const summary = await runAp2LiveInteropFromEnv({
        ATRIB_AP2_INTEROP_RESULT_JSON: generated.files.result,
        ATRIB_AP2_INTEROP_EVIDENCE_JSON: generated.files.evidence,
        ATRIB_AP2_INTEROP_TRANSACTION_RECORD_JSON: generated.files.transactionRecord,
        ATRIB_AP2_INTEROP_REQUIRE_COUNTERPARTY_ATTESTATION: '1',
        ATRIB_AP2_INTEROP_NOW_SECONDS: String(metadata.now_seconds),
      })

      expect(summary.ok).toBe(true)
      expect(summary.errors).toEqual([])
      expect(summary.evidence?.valid).toBe(true)
      expect(summary.recordVerification?.cross_attestation).toEqual({
        signers_count: 2,
        signers_valid: 2,
        missing: false,
      })
    } finally {
      await rm(outDir, { recursive: true, force: true })
    }
  })
})
