/**
 * End-to-end proof verification test.
 *
 * Proves that a third party with only the proof bundle and the log's public
 * key can independently verify that a record was included in the log.
 *
 * Steps:
 *   1. Create and sign a record
 *   2. Submit to the log via POST /v1/entries
 *   3. Independently reconstruct the leaf hash from the record bytes
 *   4. Verify the returned leaf_hash matches the independently computed one
 *   5. Verify the checkpoint Ed25519 signature with the log's public key
 *   6. Verify inclusion: extract root from checkpoint, run verifyInclusion
 *
 * ALL CHECKS MUST PASS — if any fails the system is broken.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as ed from '@noble/ed25519'
import { sha512, sha256 } from '@noble/hashes/sha2.js'
import {
  canonicalRecord,
  leafHash,
  verifyInclusion,
  signRecord,
  serializeEntry,
  hexEncode,
} from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'
import { parseCheckpointBody } from '../src/checkpoint.js'
import { startLogServer, type LogServer } from '../src/index.js'

// Set up sync sha512 for @noble/ed25519
ed.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeSignedRecord(): Promise<{ record: AtribRecord; privateKey: Uint8Array }> {
  const privateKey = ed.utils.randomPrivateKey()
  const publicKeyBytes = await ed.getPublicKeyAsync(privateKey)
  const creatorKey = Buffer.from(publicKeyBytes).toString('base64url')

  const contextId = hexEncode(crypto.getRandomValues(new Uint8Array(16)))
  const chainRoot = `sha256:${hexEncode(sha256(new TextEncoder().encode(contextId)))}`

  const unsigned = {
    spec_version: 'atrib/1.0' as const,
    event_type: 'tool_call' as const,
    timestamp: Date.now(),
    context_id: contextId,
    creator_key: creatorKey,
    chain_root: chainRoot,
    content_id: 'sha256:' + hexEncode(sha256(new TextEncoder().encode('verification-test'))),
    signature: '', // placeholder — signRecord will replace
  }

  // Use signRecord which correctly strips signature before signing (§1.4.3)
  const record = await signRecord(unsigned as AtribRecord, privateKey)
  return { record, privateKey }
}

interface ProofBundle {
  log_index: number
  checkpoint: string
  inclusion_proof: string[]
  leaf_hash: string
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

let server: LogServer
let logPrivateKey: Uint8Array

beforeAll(async () => {
  logPrivateKey = ed.utils.randomPrivateKey()
  server = await startLogServer({ port: 0, logPrivateKey })
})

afterAll(async () => {
  await server.close()
})

describe('end-to-end proof verification', () => {
  it('independently verifies that a submitted record is included in the log', async () => {
    // Step 1: Create and sign a record
    const { record } = await makeSignedRecord()

    // Step 2: Submit to the log
    const res = await fetch(`${server.url}/v1/entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(record),
    })
    expect(res.status).toBe(200)

    const proof = (await res.json()) as ProofBundle
    expect(typeof proof.log_index).toBe('number')
    expect(typeof proof.checkpoint).toBe('string')
    expect(Array.isArray(proof.inclusion_proof)).toBe(true)
    expect(typeof proof.leaf_hash).toBe('string')

    // Step 3: Independently reconstruct the leaf hash
    //   a. Compute record_hash = SHA-256(canonicalRecord(record))
    const canonBytes = canonicalRecord(record)
    const recordHashBytes = sha256(canonBytes)
    const recordHashHex = hexEncode(recordHashBytes)

    //   b. Serialize to 90-byte entry
    const entryBytes = serializeEntry({
      record_hash_hex: recordHashHex,
      creator_key_b64url: record.creator_key,
      context_id: record.context_id,
      timestamp: record.timestamp,
      event_type: record.event_type,
    })
    expect(entryBytes.byteLength).toBe(90)

    //   c. Compute leafHash(entryBytes) = SHA-256(0x00 || entryBytes)
    const computedLeafHash = leafHash(entryBytes)

    // Step 4: Verify the returned leaf_hash matches the independently computed one
    const returnedLeafHash = Buffer.from(proof.leaf_hash, 'base64')
    expect(Buffer.from(computedLeafHash).toString('hex')).toBe(returnedLeafHash.toString('hex'))

    // Step 5: Verify the checkpoint Ed25519 signature
    //   The signed note format is:
    //     <body>\n\n— <origin> <keyIdHex>+<sigBase64>\n
    //   We need to extract the body and the signature separately.
    const checkpointText = proof.checkpoint

    // Split at the blank line that separates body from signatures
    const blankLineIdx = checkpointText.indexOf('\n\n')
    expect(blankLineIdx).toBeGreaterThan(0)

    const checkpointBody = checkpointText.slice(0, blankLineIdx + 1) // body ends with \n
    const signaturesSection = checkpointText.slice(blankLineIdx + 2) // after \n\n

    // Parse the signature line: "— origin keyIdHex+sigBase64\n"
    const sigLine = signaturesSection.trim()
    // em-dash (U+2014) followed by a space, then origin, then a space, then keyIdHex+sigBase64
    const sigLineMatch = sigLine.match(/^\u2014 \S+ ([0-9a-f]+)\+(.+)$/)
    expect(sigLineMatch).not.toBeNull()

    const sigBase64 = sigLineMatch![2] as string
    const sigBytes = Buffer.from(sigBase64, 'base64')
    const bodyBytes = new TextEncoder().encode(checkpointBody)

    // Verify with the log's public key
    const logPublicKey = server.logPublicKey
    const isValidSig = await ed.verifyAsync(sigBytes, bodyBytes, logPublicKey)
    expect(isValidSig).toBe(true)

    // Step 6: Verify inclusion using the Merkle proof
    //   Extract root hash from checkpoint body
    const parsed = parseCheckpointBody(checkpointBody)
    const expectedRoot = Buffer.from(parsed.rootHash, 'base64')

    //   Decode inclusion proof hashes from base64
    const proofHashes: Uint8Array[] = proof.inclusion_proof.map(
      (h) => new Uint8Array(Buffer.from(h, 'base64')),
    )

    const inclusionValid = verifyInclusion(
      proof.log_index,
      parsed.treeSize,
      computedLeafHash,
      proofHashes,
      new Uint8Array(expectedRoot),
    )
    expect(inclusionValid).toBe(true)
  })

  it('verifies multiple records in the same log', async () => {
    // Submit two more records and verify both have valid proofs
    for (let i = 0; i < 2; i++) {
      const { record } = await makeSignedRecord()

      const res = await fetch(`${server.url}/v1/entries`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(record),
      })
      expect(res.status).toBe(200)

      const proof = (await res.json()) as ProofBundle

      // Reconstruct leaf hash
      const canonBytes = canonicalRecord(record)
      const recordHashBytes = sha256(canonBytes)
      const recordHashHex = hexEncode(recordHashBytes)
      const entryBytes = serializeEntry({
        record_hash_hex: recordHashHex,
        creator_key_b64url: record.creator_key,
        context_id: record.context_id,
        timestamp: record.timestamp,
        event_type: record.event_type,
      })
      const computedLeafHash = leafHash(entryBytes)

      // Verify leaf_hash matches
      const returnedLeafHash = Buffer.from(proof.leaf_hash, 'base64')
      expect(Buffer.from(computedLeafHash).toString('hex')).toBe(returnedLeafHash.toString('hex'))

      // Verify checkpoint signature
      const blankLineIdx = proof.checkpoint.indexOf('\n\n')
      const checkpointBody = proof.checkpoint.slice(0, blankLineIdx + 1)
      const signaturesSection = proof.checkpoint.slice(blankLineIdx + 2)
      const sigLine = signaturesSection.trim()
      const sigLineMatch = sigLine.match(/^\u2014 \S+ ([0-9a-f]+)\+(.+)$/)
      expect(sigLineMatch).not.toBeNull()

      const sigBase64 = sigLineMatch![2] as string
      const sigBytes = Buffer.from(sigBase64, 'base64')
      const bodyBytes = new TextEncoder().encode(checkpointBody)
      const isValidSig = await ed.verifyAsync(sigBytes, bodyBytes, server.logPublicKey)
      expect(isValidSig).toBe(true)

      // Verify inclusion
      const parsed = parseCheckpointBody(checkpointBody)
      const expectedRoot = new Uint8Array(Buffer.from(parsed.rootHash, 'base64'))
      const proofHashes: Uint8Array[] = proof.inclusion_proof.map(
        (h) => new Uint8Array(Buffer.from(h, 'base64')),
      )
      const inclusionValid = verifyInclusion(
        proof.log_index,
        parsed.treeSize,
        computedLeafHash,
        proofHashes,
        expectedRoot,
      )
      expect(inclusionValid).toBe(true)
    }
  })
})
