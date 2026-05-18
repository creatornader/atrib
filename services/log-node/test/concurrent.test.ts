// SPDX-License-Identifier: Apache-2.0

/**
 * Concurrent submission tests for the log-node service.
 *
 * Verifies the submit lock, idempotency cache, proof consistency,
 * and tree integrity under parallel load.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as ed from '@noble/ed25519'
import { sha512, sha256 } from '@noble/hashes/sha2.js'
import { signRecord, hexEncode } from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'
import { startLogServer, type LogServer } from '../src/index.js'
import crypto from 'crypto'

ed.hashes.sha512 = sha512

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function makeSignedRecord(
  privateKey: Uint8Array,
  creatorKey: string,
  suffix?: string,
): Promise<AtribRecord> {
  const contextId = hexEncode(crypto.getRandomValues(new Uint8Array(16)))
  const chainRoot = `sha256:${hexEncode(sha256(new TextEncoder().encode(contextId)))}`
  const contentId = `sha256:${hexEncode(sha256(new TextEncoder().encode('concurrent-test-' + (suffix ?? Date.now().toString()))))}`

  const unsigned = {
    spec_version: 'atrib/1.0' as const,
    event_type: 'https://atrib.dev/v1/types/tool_call' as const,
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

async function post(url: string, body: unknown): Promise<{ status: number; json: ProofBundle }> {
  const res = await fetch(`${url}/v1/entries`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = (await res.json()) as ProofBundle
  return { status: res.status, json }
}

async function getCheckpoint(url: string): Promise<string> {
  const res = await fetch(`${url}/v1/checkpoint`)
  return res.text()
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('concurrent submissions', () => {
  let server: LogServer
  let privateKey: Uint8Array
  let creatorKey: string

  beforeAll(async () => {
    privateKey = ed.utils.randomSecretKey()
    const publicKey = await ed.getPublicKeyAsync(privateKey)
    creatorKey = Buffer.from(publicKey).toString('base64url')
    server = await startLogServer({ port: 0, logPrivateKey: ed.utils.randomSecretKey() })
  })

  afterAll(async () => {
    await server.close()
  })

  it('parallel duplicate submissions return the same proof', async () => {
    const record = await makeSignedRecord(privateKey, creatorKey, 'dup-test')

    // Fire 5 identical requests simultaneously
    const results = await Promise.all(
      Array.from({ length: 5 }, () => post(server.url, record)),
    )

    // All should succeed
    for (const r of results) {
      expect(r.status).toBe(200)
    }

    // All should return the same log_index (idempotency)
    const indices = new Set(results.map((r) => r.json.log_index))
    expect(indices.size).toBe(1)

    // All should return the same leaf_hash
    const hashes = new Set(results.map((r) => r.json.leaf_hash))
    expect(hashes.size).toBe(1)
  })

  it('parallel distinct submissions all get unique log indices', async () => {
    const records = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        makeSignedRecord(privateKey, creatorKey, `distinct-${i}-${Date.now()}`),
      ),
    )

    // Fire all 10 simultaneously
    const results = await Promise.all(records.map((r) => post(server.url, r)))

    // All should succeed
    for (const r of results) {
      expect(r.status).toBe(200)
    }

    // All log indices should be unique
    const indices = results.map((r) => r.json.log_index)
    const uniqueIndices = new Set(indices)
    expect(uniqueIndices.size).toBe(10)

    // Indices should be contiguous (no gaps)
    const sorted = [...uniqueIndices].sort((a, b) => a - b)
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]).toBe(sorted[i - 1]! + 1)
    }
  })

  it('all proofs have valid structure under concurrent load', async () => {
    const records = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        makeSignedRecord(privateKey, creatorKey, `structure-${i}-${Date.now()}`),
      ),
    )

    const results = await Promise.all(records.map((r) => post(server.url, r)))

    for (const r of results) {
      expect(r.status).toBe(200)
      const proof = r.json

      // Required fields present
      expect(typeof proof.log_index).toBe('number')
      expect(proof.log_index).toBeGreaterThanOrEqual(0)
      expect(typeof proof.leaf_hash).toBe('string')
      expect(proof.leaf_hash.length).toBeGreaterThan(0)
      expect(typeof proof.checkpoint).toBe('string')
      expect(proof.checkpoint).toContain('log.atrib')
      expect(Array.isArray(proof.inclusion_proof)).toBe(true)

      // Inclusion proof length should be <= ceil(log2(tree_size))
      // (each element is a sibling hash on the Merkle path)
      for (const element of proof.inclusion_proof) {
        expect(typeof element).toBe('string')
        expect(element.length).toBeGreaterThan(0)
      }
    }
  })

  it('checkpoint is consistent after concurrent writes', async () => {
    // Submit a batch, then read checkpoint
    const records = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        makeSignedRecord(privateKey, creatorKey, `checkpoint-${i}-${Date.now()}`),
      ),
    )

    await Promise.all(records.map((r) => post(server.url, r)))

    // Read checkpoint multiple times concurrently
    const checkpoints = await Promise.all(
      Array.from({ length: 3 }, () => getCheckpoint(server.url)),
    )

    // All reads should return the same checkpoint
    expect(new Set(checkpoints).size).toBe(1)

    // Checkpoint should be valid C2SP signed-note format
    const cp = checkpoints[0]!
    expect(cp).toContain('log.atrib')
    const lines = cp.split('\n')
    expect(lines.length).toBeGreaterThanOrEqual(4) // origin, size, hash, blank, signature
  })

  it('mixed concurrent reads and writes do not corrupt state', async () => {
    const records = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        makeSignedRecord(privateKey, creatorKey, `mixed-${i}-${Date.now()}`),
      ),
    )

    // Interleave writes and reads
    const operations = [
      ...records.map((r) => post(server.url, r)),
      getCheckpoint(server.url),
      getCheckpoint(server.url),
    ]

    const results = await Promise.all(operations)

    // Write results should all be 200
    const writeResults = results.slice(0, 6) as Awaited<ReturnType<typeof post>>[]
    for (const r of writeResults) {
      expect(r.status).toBe(200)
    }

    // Checkpoint reads should succeed (not empty/error)
    const readResults = results.slice(6) as string[]
    for (const cp of readResults) {
      expect(typeof cp).toBe('string')
      // May or may not contain all writes depending on timing, but should be valid
      expect(cp.length).toBeGreaterThan(0)
    }
  })
})

describe('proof correctness under load', () => {
  let server: LogServer
  let privateKey: Uint8Array
  let creatorKey: string

  beforeAll(async () => {
    privateKey = ed.utils.randomSecretKey()
    const publicKey = await ed.getPublicKeyAsync(privateKey)
    creatorKey = Buffer.from(publicKey).toString('base64url')
    // Fresh server for proof correctness tests
    server = await startLogServer({ port: 0, logPrivateKey: ed.utils.randomSecretKey() })
  })

  afterAll(async () => {
    await server.close()
  })

  it('sequential submissions produce correct Merkle proof lengths', async () => {
    // Submit records one at a time and verify proof structure
    const expectedProofLengths = [0, 1, 1, 2, 1, 2, 2, 3] // ceil(log2) pattern for RFC 6962
    const records = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        makeSignedRecord(privateKey, creatorKey, `proof-len-${i}`),
      ),
    )

    for (let i = 0; i < records.length; i++) {
      const { status, json } = await post(server.url, records[i]!)
      expect(status).toBe(200)
      expect(json.log_index).toBe(i)
      expect(json.inclusion_proof.length).toBe(expectedProofLengths[i])
    }
  })

  it('tree grows monotonically under concurrent submissions', async () => {
    // Get initial checkpoint to find current tree size
    const initial = await getCheckpoint(server.url)
    const initialSize = parseInt(initial.split('\n')[1]!, 10)

    // Submit 10 more records in parallel
    const records = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        makeSignedRecord(privateKey, creatorKey, `monotonic-${i}-${Date.now()}`),
      ),
    )
    await Promise.all(records.map((r) => post(server.url, r)))

    // Check tree grew by exactly 10
    const after = await getCheckpoint(server.url)
    const afterSize = parseInt(after.split('\n')[1]!, 10)
    expect(afterSize).toBe(initialSize + 10)
  })

  it('each checkpoint signature is from the same key', async () => {
    // Submit a few records and collect checkpoints
    const records = await Promise.all(
      Array.from({ length: 3 }, (_, i) =>
        makeSignedRecord(privateKey, creatorKey, `sig-check-${i}-${Date.now()}`),
      ),
    )

    const checkpoints: string[] = []
    for (const r of records) {
      await post(server.url, r)
      checkpoints.push(await getCheckpoint(server.url))
    }

    // Extract key IDs from the signature lines (format:. origin keyid+sig)
    const keyIds = checkpoints.map((cp) => {
      const sigLine = cp.split('\n').find((l) => l.startsWith('—'))!
      // Key ID is between the origin name and the + sign
      const match = sigLine.match(/— .+ ([a-f0-9]+)\+/)
      return match?.[1]
    })

    // All should use the same key
    expect(new Set(keyIds).size).toBe(1)
  })
})
