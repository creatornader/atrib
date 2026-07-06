// SPDX-License-Identifier: Apache-2.0

/**
 * Runnable @atrib/sdk walkthrough: attest → chained revise → recall,
 * daemon-first routing, and §5.8 degradation. See README.md for the
 * one-line run command. Uses a temp mirror and an unroutable log anchor
 * so nothing persists outside this process or leaves the machine.
 */

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAtribClient } from '@atrib/sdk'

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
    // Unroutable anchor: submission stays local. Omit `anchors` (or use
    // https://log.atrib.dev/v1/entries) to submit real commitments.
    anchors: ['http://127.0.0.1:9/v1/entries'],
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
  await client.close()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
