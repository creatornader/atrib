// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeAll } from 'vitest'
import { bindServer } from '../src/server.js'
import { createMerkleTree } from '../src/tree.js'
import { createCheckpointSigner } from '../src/checkpoint.js'
import { base64urlEncode, signRecord, getPublicKey, ENTRY_SIZE } from '@atrib/mcp'

const TEST_KEY = new Uint8Array(32).fill(99)
const TEST_KEY_B64 = base64urlEncode(TEST_KEY)

async function makeSignedRecord(contextId: string, idx: number) {
  const pk = await getPublicKey(TEST_KEY)
  const record = {
    spec_version: 'atrib/1.0' as const,
    content_id: `sha256:${'a'.repeat(64)}`,
    creator_key: base64urlEncode(pk),
    chain_root: `sha256:${'b'.repeat(64)}`,
    event_type: 'tool_call' as const,
    context_id: contextId,
    timestamp: Date.now() + idx,
    signature: '',
  }
  return signRecord(record, TEST_KEY)
}

describe('tile endpoints (§2.5.2)', () => {
  let url: string
  let close: () => Promise<void>

  beforeAll(async () => {
    const tree = createMerkleTree()
    const signer = await createCheckpointSigner(TEST_KEY, 'test-log')
    const handle = await bindServer(tree, signer, 0)
    url = handle.url
    close = handle.close

    // Submit 3 records
    for (let i = 0; i < 3; i++) {
      const record = await makeSignedRecord('c'.repeat(32), i)
      const res = await fetch(`${url}/v1/entries`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(record),
      })
      expect(res.ok).toBe(true)
    }

    return () => close()
  })

  it('returns level 0 tile with leaf hashes', async () => {
    const res = await fetch(`${url}/v1/tile/0/0`)
    expect(res.ok).toBe(true)
    expect(res.headers.get('content-type')).toBe('application/octet-stream')

    const data = new Uint8Array(await res.arrayBuffer())
    // 3 entries = 3 leaf hashes = 3 * 32 = 96 bytes
    expect(data.length).toBe(3 * 32)

    // Partial tile (3 < 256), should have short cache
    expect(res.headers.get('cache-control')).toBe('public, max-age=60')
  })

  it('returns 404 for out-of-range tile index', async () => {
    const res = await fetch(`${url}/v1/tile/0/999`)
    expect(res.status).toBe(404)
  })

  it('returns level 1 tile with internal node hashes', async () => {
    const res = await fetch(`${url}/v1/tile/1/0`)
    expect(res.ok).toBe(true)

    const data = new Uint8Array(await res.arrayBuffer())
    // 3 leaf hashes -> 2 internal nodes at level 1 (ceil(3/2))
    expect(data.length).toBe(2 * 32)
  })

  it('returns 404 for out-of-range tile at valid level', async () => {
    // Level 1 with 3 entries has ceil(3/2)=2 nodes, so tile index 1 is out of range
    const res = await fetch(`${url}/v1/tile/1/1`)
    expect(res.status).toBe(404)
  })
})

describe('entry bundle endpoint (§2.5.3)', () => {
  let url: string
  let close: () => Promise<void>

  beforeAll(async () => {
    const tree = createMerkleTree()
    const signer = await createCheckpointSigner(TEST_KEY, 'test-log')
    const handle = await bindServer(tree, signer, 0)
    url = handle.url
    close = handle.close

    // Submit 2 records
    for (let i = 0; i < 2; i++) {
      const record = await makeSignedRecord('d'.repeat(32), i)
      const res = await fetch(`${url}/v1/entries`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(record),
      })
      expect(res.ok).toBe(true)
    }

    return () => close()
  })

  it('returns length-prefixed entry bundle', async () => {
    const res = await fetch(`${url}/v1/tile/entries/0`)
    expect(res.ok).toBe(true)
    expect(res.headers.get('content-type')).toBe('application/octet-stream')

    const data = new Uint8Array(await res.arrayBuffer())
    // 2 entries, each ENTRY_SIZE bytes with 2-byte length prefix
    expect(data.length).toBe(2 * (2 + ENTRY_SIZE))

    // Parse first entry: uint16 big-endian length prefix
    const dv = new DataView(data.buffer)
    const len1 = dv.getUint16(0, false) // big-endian
    expect(len1).toBe(ENTRY_SIZE)
  })

  it('returns 404 for out-of-range bundle index', async () => {
    const res = await fetch(`${url}/v1/tile/entries/999`)
    expect(res.status).toBe(404)
  })
})
