// SPDX-License-Identifier: Apache-2.0

/**
 * Runnable @atrib/sdk walkthrough: attest → chained revise → recall,
 * pinned to the in-process path, and §5.8 degradation. See README.md for
 * the one-line run command. The SDK is daemon-first by default; this
 * example pins `daemon: { mode: 'off' }` so the walkthrough is hermetic —
 * temp mirror + unroutable anchor, nothing persists outside this process
 * or leaves the machine.
 */

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ATTRIBUTION_EXTENSION_KEY,
  buildEvidenceEnvelope,
  checkAttributionReceiptConsistency,
  createAtribClient,
  encodeToken,
  parseAttributionReceiptBlock,
  readMirrorTail,
  recordHashRef,
  validateEvidenceEnvelope,
  verifyAttributionReceipt,
} from '@atrib/sdk'

async function main(): Promise<void> {
  const mirror = join(mkdtempSync(join(tmpdir(), 'atrib-sdk-example-')), 'mirror.jsonl')
  // ATRIB_MIRROR_FILE is where attest's write path appends; ATRIB_RECORD_FILE
  // is where the in-process recall fallback (@atrib/recall) reads. Point both
  // at the same temp file so the example round-trips.
  process.env.ATRIB_MIRROR_FILE = mirror
  process.env.ATRIB_RECORD_FILE = mirror
  const contextId = 'e'.repeat(32)

  const client = createAtribClient({
    contextId,
    // The SDK is daemon-first by default ('prefer'). This example forces
    // the in-process path so the walkthrough is hermetic (temp mirror +
    // unroutable anchor; nothing leaves the machine) — with 'prefer', a
    // live local primitives runtime would serve the calls instead, signing
    // with the DAEMON's key and anchoring per the daemon's own config,
    // including its real public log.
    daemon: { mode: 'off' },
    // Two-member anchor set (D138 plurality, §2.11.12): the existing
    // unroutable atrib-log endpoint plus a registered non-atrib-log type
    // (opentimestamps — needs no URL). Both count toward plurality, so
    // this meets the >=2 bar without `allowSingleAnchor`. Omit `anchors`
    // (or use https://log.atrib.dev/v1/entries) to submit real commitments.
    anchors: ['http://127.0.0.1:9/v1/entries', { anchor_type: 'opentimestamps' }],
  })

  console.log(`mirror: ${mirror}\n`)

  // 1. Write an observation (the default attest kind).
  const observed = await client.attest({
    content: {
      what: 'chose sqlite over postgres for the pilot store',
      why_noted: 'single-node deployment constraint',
    },
  })
  console.log('observation:', observed.via, observed.record_hash)
  for (const warning of observed.warnings) console.log('  !', warning)

  if (observed.record_hash === null) {
    console.log('\nNo signing key resolved — pass-through mode (§5.8 rule 5).')
    console.log('Set ATRIB_PRIVATE_KEY (see README.md) and re-run.')
    await client.close()
    return
  }

  // 2. Revise it: one write verb, the ref discriminator picks the kind.
  const revised = await client.attest({
    content: {
      new_position: 'postgres after all',
      reason: 'pilot converted to multi-tenant',
    },
    ref: { kind: 'revises', record_hash: observed.record_hash },
  })
  console.log('revision:   ', revised.via, revised.record_hash)

  // 3. Read the chain back, newest first, signatures verified.
  const history = await client.recall<{
    records?: Array<{ record_hash?: string; event_type?: string; signature_verified?: boolean }>
  }>({ shape: 'history', context_id: contextId, limit: 5 })
  console.log(`\nrecall via ${history.via}:`)
  for (const entry of history.data?.records ?? []) {
    console.log(` - ${entry.event_type} ${entry.record_hash} verified=${entry.signature_verified}`)
  }

  // 4. Degradation: no key + no daemon never throws.
  const degraded = createAtribClient({ daemon: { mode: 'off' }, key: null })
  const passThrough = await degraded.attest({ content: { what: 'nothing signs this' } })
  console.log(`\ndegraded attest: via=${passThrough.via} record_hash=${passThrough.record_hash}`)

  await degraded.close()

  // 5. Multi-anchor config + anchor posture (D138, spec §2.11.12). The
  // fan-out is consulted only on the IN-PROCESS attest path — a daemon-
  // served result never carries `anchor_posture` because the daemon owns
  // its own anchor set. The two-member set configured above (an
  // unroutable atrib-log endpoint + a registered non-atrib-log type) meets
  // the >=2 plurality bar, so `warned` is false; the opentimestamps leg's
  // transport is a stub upstream and may itself report a warning when the
  // fan-out settles, which is expected and safe to print.
  console.log(`\nanchor_posture: ${JSON.stringify(observed.anchor_posture)}`)
  for (const warning of observed.warnings) console.log('  !', warning)

  // 6. Evidence envelope build + validate (D137, spec §5.5.7). One
  // universal envelope schema for every externally verifiable evidence
  // attachment, identified by an absolute HTTPS profile type URI (a
  // foreign domain is a valid third-party profile). buildEvidenceEnvelope
  // lazily delegates to the optional peer @atrib/verify — present in this
  // workspace — for hashing (`payload.hash` from `payload.material` via
  // the default JCS hash rule) and §5.5.7 shape validation.
  const built = await buildEvidenceEnvelope({
    profile: 'https://example.com/profiles/decision-context',
    profile_version: '1.0.0',
    tier: 'shape',
    payload: {
      material: { decision: 'sqlite for pilot', record_hash: observed.record_hash },
    },
  })
  console.log(`\nevidence envelope payload.hash: ${built.envelope?.payload.hash}`)
  console.log('  validation:', JSON.stringify(built.validation))
  for (const warning of built.warnings) console.log('  !', warning)

  // Round-trip the built envelope through validateEvidenceEnvelope on its
  // own — the same §5.5.7 shape check, run over an already-built envelope
  // rather than as part of construction.
  const revalidated = await validateEvidenceEnvelope(built.envelope)
  const revalidatedValid = (revalidated.validation as { valid?: boolean } | null)?.valid
  console.log(`  round-trip validation.valid: ${revalidatedValid}`)

  // 7. Attribution receipt checks (D141, `dev.atrib/attribution` v0.1).
  // TWO DISTINCT checks over the same synthetic daemon-style `_meta`
  // block — deliberately not unified, per the extension's
  // corrections-ledger semantics. The block is built §6.2-well-formed
  // from the newest signed record in the temp mirror (the in-process
  // path guarantees it is there): a top-level token plus all six receipt
  // string fields. Three outcomes, each answering a different question:
  //   a) verifyAttributionReceipt (extension spec §6.2): structural /
  //      internal-consistency check over the RAW block alone. The
  //      record-less log-submission case is §6.2-valid → valid: true.
  //   b) checkAttributionReceiptConsistency with NO record: conservative —
  //      nothing to check the claims against → receipt_valid: false with
  //      mismatched_fields ['record'].
  //   c) checkAttributionReceiptConsistency WITH the mirror-tail record:
  //      the claims match the signed record they name → receipt_valid: true.
  const tailRecord = await readMirrorTail({ path: mirror, contextId })
  if (tailRecord === null) {
    console.log('\natrib: no record at the mirror tail; skipping receipt checks')
  } else {
    const receiptMeta = {
      [ATTRIBUTION_EXTENSION_KEY]: {
        token: encodeToken(tailRecord),
        receipt: {
          record_hash: recordHashRef(tailRecord),
          creator_key: tailRecord.creator_key,
          context_id: tailRecord.context_id,
          event_type: tailRecord.event_type,
          chain_root: tailRecord.chain_root,
          log_submission: 'queued',
        },
      },
    }
    const receiptBlock = parseAttributionReceiptBlock(receiptMeta)
    console.log('\nattribution receipt block:', JSON.stringify(receiptBlock))
    if (receiptBlock) {
      const structural = verifyAttributionReceipt(receiptBlock)
      console.log('  verifyAttributionReceipt (§6.2 block integrity):', JSON.stringify(structural))

      const noRecord = checkAttributionReceiptConsistency(receiptBlock)
      console.log(
        '  checkAttributionReceiptConsistency (record-side, no record):',
        JSON.stringify(noRecord),
      )

      const withRecord = checkAttributionReceiptConsistency(receiptBlock, tailRecord)
      console.log(
        '  checkAttributionReceiptConsistency (record-side, with record):',
        JSON.stringify(withRecord),
      )
    }
  }

  await client.flushAnchors()
  await client.close()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
