import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runAp2LiveInteropFromEnv } from '../src/ap2-live-interop.js'
import { extractGoogleAp2SampleArtifacts } from '../src/google-ap2-sample-extract.js'

import googleAp2SampleEventsJson from './fixtures/google-ap2-sample/events.json'

const tempDbDir = fileURLToPath(new URL('./fixtures/google-ap2-sample/temp-db', import.meta.url))

describe('Google AP2 sample extraction', () => {
  it('extracts official sample artifacts into the live interop contract', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'atrib-google-ap2-sample-'))
    try {
      const extracted = await extractGoogleAp2SampleArtifacts({
        events: googleAp2SampleEventsJson,
        tempDbDir,
        outDir,
      })

      expect(extracted.metadata).toEqual(
        expect.objectContaining({
          source:
            'google-agentic-commerce/AP2 samples/python/scenarios/a2a/human-not-present/cards',
          order_id: '14c40322-1d60-4848-a6db-9cfed1eed487',
          checkout_receipt_issuer: 'https://demo-merchant.example',
          checkout_mandate_chain_id: 'chk_18fe8144648a450aae614f84ded90985',
          payment_mandate_chain_id: 'pay_0365333ae6c249e0a96004c2e63d2a6e',
          now_seconds: 1780034803,
          ap2_receipt_signature: 'external_evidence_es256_jwt',
          atrib_counterparty_attestation: 'local_ed25519_over_atrib_transaction_bytes',
        }),
      )

      const evidence = JSON.parse(await readFile(extracted.files.evidence, 'utf8')) as {
        ap2?: {
          closedCheckoutMandate?: string
          closedPaymentMandate?: string
        }
      }
      expect(evidence.ap2?.closedCheckoutMandate).not.toContain('~~')
      expect(evidence.ap2?.closedPaymentMandate).not.toContain('~~')

      const summary = await runAp2LiveInteropFromEnv({
        ATRIB_AP2_INTEROP_RESULT_JSON: extracted.files.result,
        ATRIB_AP2_INTEROP_EVIDENCE_JSON: extracted.files.evidence,
        ATRIB_AP2_INTEROP_TRANSACTION_RECORD_JSON: extracted.files.transactionRecord,
        ATRIB_AP2_INTEROP_REQUIRE_COUNTERPARTY_ATTESTATION: '1',
        ATRIB_AP2_INTEROP_NOW_SECONDS: String(extracted.metadata.now_seconds),
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

  it('fails before writing artifacts when complete_checkout is absent', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'atrib-google-ap2-sample-missing-'))
    try {
      await expect(
        extractGoogleAp2SampleArtifacts({
          events: { events: [] },
          tempDbDir,
          outDir,
        }),
      ).rejects.toThrow('missing_complete_checkout_function_response')
    } finally {
      await rm(outDir, { recursive: true, force: true })
    }
  })
})
