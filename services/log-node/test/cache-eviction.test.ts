// SPDX-License-Identifier: Apache-2.0

/**
 * Idempotency cache behavior tests (Gap #5).
 *
 * Verifies that re-submitting a record returns the cached proof, and that
 * after enough submissions to cause eviction, a re-submitted record gets
 * a fresh (but valid) proof with a new log_index.
 *
 * NOTE: The MAX_PROOF_CACHE is 100,000 entries. We can't test actual eviction
 * at that scale in a unit test (too slow). Instead we test the observable
 * idempotency behavior and verify the cache hit path.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as ed from '@noble/ed25519'
import { sha512, sha256 } from '@noble/hashes/sha2.js'
import { signRecord, hexEncode } from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'
import { startLogServer, type LogServer } from '../src/index.js'
import crypto from 'crypto'

ed.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m))

async function makeSignedRecord(
  privateKey: Uint8Array,
  creatorKey: string,
  suffix: string,
): Promise<AtribRecord> {
  const contextId = hexEncode(crypto.getRandomValues(new Uint8Array(16)))
  const chainRoot = `sha256:${hexEncode(sha256(new TextEncoder().encode(contextId)))}`
  const contentId = `sha256:${hexEncode(sha256(new TextEncoder().encode('cache-' + suffix)))}`
  const unsigned = {
    spec_version: 'atrib/1.0' as const,
    event_type: 'tool_call' as const,
    timestamp: Date.now(),
    context_id: contextId,
    creator_key: creatorKey,
    chain_root: chainRoot,
    content_id: contentId,
    signature: '',
  }
  return signRecord(unsigned as AtribRecord, privateKey)
}

interface ProofBundle {
  log_index: number
  checkpoint: string
  inclusion_proof: string[]
  leaf_hash: string
}

async function post(url: string, body: unknown): Promise<ProofBundle> {
  const res = await fetch(`${url}/v1/entries`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return (await res.json()) as ProofBundle
}

describe('idempotency cache', () => {
  let server: LogServer
  let privateKey: Uint8Array
  let creatorKey: string

  beforeAll(async () => {
    privateKey = ed.utils.randomPrivateKey()
    const publicKey = await ed.getPublicKeyAsync(privateKey)
    creatorKey = Buffer.from(publicKey).toString('base64url')
    server = await startLogServer({ port: 0, logPrivateKey: ed.utils.randomPrivateKey() })
  })

  afterAll(async () => {
    await server.close()
  })

  it('returns identical proof on immediate re-submission', async () => {
    const record = await makeSignedRecord(privateKey, creatorKey, 'immediate')
    const first = await post(server.url, record)
    const second = await post(server.url, record)

    expect(first.log_index).toBe(second.log_index)
    expect(first.leaf_hash).toBe(second.leaf_hash)
  })

  it('returns cached proof even after other submissions interleave', async () => {
    const target = await makeSignedRecord(privateKey, creatorKey, 'interleave-target')
    const firstSubmit = await post(server.url, target)

    // Submit 20 other records
    for (let i = 0; i < 20; i++) {
      const other = await makeSignedRecord(privateKey, creatorKey, `interleave-${i}`)
      await post(server.url, other)
    }

    // Re-submit original. should still be cached
    const resubmit = await post(server.url, target)
    expect(resubmit.log_index).toBe(firstSubmit.log_index)
    expect(resubmit.leaf_hash).toBe(firstSubmit.leaf_hash)
  })

  it('cached proof checkpoint may differ from fresh checkpoint (tree grew)', async () => {
    const record = await makeSignedRecord(privateKey, creatorKey, 'stale-cp')
    const first = await post(server.url, record)

    // Submit more records to grow the tree
    for (let i = 0; i < 5; i++) {
      const other = await makeSignedRecord(privateKey, creatorKey, `grow-${i}`)
      await post(server.url, other)
    }

    // Re-submit. cached proof's checkpoint was captured at earlier tree size
    const resubmit = await post(server.url, record)
    expect(resubmit.log_index).toBe(first.log_index)
    // The checkpoint in the cached proof reflects the tree state at first submission,
    // which is valid for verifying this entry's inclusion (the entry existed at that point)
  })
})
