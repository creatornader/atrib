// SPDX-License-Identifier: Apache-2.0

/**
 * P045 key-API headroom (SDK brief post-spawn addendum 5).
 *
 * Delegation certificates are NOT implemented, but the canonicalization
 * path must already tolerate a future OPTIONAL `delegation_cert_hash`
 * genesis field: JCS-slotted between `creator_key` and `event_type`,
 * omitted-not-null. These are regression guards so the record layer never
 * paints that slot into a corner.
 */

import { describe, it, expect } from 'vitest'
import {
  canonicalSigningInput,
  genesisChainRoot,
  hexDecode,
  recordHashHex,
  signRecord,
  verifyRecord,
  type AtribRecord,
} from '../src/index.js'

const seed = hexDecode('11'.repeat(32))

function baseRecord(): AtribRecord {
  return {
    spec_version: 'atrib/1.0',
    content_id: `sha256:${'ab'.repeat(32)}`,
    creator_key: '0EqyMnQrtKs6E2i9RhXk5tAiSrcaAWuvhSCjMsl3hzc',
    chain_root: genesisChainRoot('a'.repeat(32)),
    event_type: 'https://atrib.dev/v1/types/observation',
    context_id: 'a'.repeat(32),
    timestamp: 1700000000000,
    signature: '',
  }
}

describe('P045 headroom: delegation_cert_hash tolerance', () => {
  it('canonicalizes the future field between creator_key and event_type', () => {
    const record = {
      ...baseRecord(),
      delegation_cert_hash: `sha256:${'cd'.repeat(32)}`,
    } as unknown as AtribRecord
    const canonical = new TextDecoder().decode(canonicalSigningInput(record))
    const creatorIdx = canonical.indexOf('"creator_key"')
    const certIdx = canonical.indexOf('"delegation_cert_hash"')
    const eventIdx = canonical.indexOf('"event_type"')
    expect(certIdx).toBeGreaterThan(creatorIdx)
    expect(certIdx).toBeLessThan(eventIdx)
  })

  it('signs and verifies a record carrying the future field', async () => {
    const record = {
      ...baseRecord(),
      delegation_cert_hash: `sha256:${'cd'.repeat(32)}`,
    } as unknown as AtribRecord
    const signed = await signRecord(record, seed)
    expect(await verifyRecord(signed)).toBe(true)
  })

  it('presence changes the signature and hash (omitted-not-null)', async () => {
    const plain = await signRecord(baseRecord(), seed)
    const withCert = await signRecord(
      { ...baseRecord(), delegation_cert_hash: `sha256:${'cd'.repeat(32)}` } as unknown as AtribRecord,
      seed,
    )
    expect(plain.signature).not.toBe(withCert.signature)
    expect(recordHashHex(plain)).not.toBe(recordHashHex(withCert))
  })
})
