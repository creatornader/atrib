// SPDX-License-Identifier: Apache-2.0

/**
 * End-to-end proof verification tests (Gap #2).
 *
 * Independently recomputes the Merkle root from inclusion proofs returned
 * by the log server and verifies it matches the checkpoint. This is what
 * a real verifier does. if these tests pass, the cryptography works.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as ed from '@noble/ed25519'
import { sha512, sha256 } from '@noble/hashes/sha2.js'
import {
  signRecord,
  hexEncode,
  verifyInclusion,
} from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'
import { startLogServer, type LogServer } from '../src/index.js'
import { parseCheckpointBody, parseSignatureLine } from '../src/checkpoint.js'
import crypto from 'crypto'

ed.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m))

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function makeSignedRecord(
  privateKey: Uint8Array,
  creatorKey: string,
  suffix: string,
): Promise<AtribRecord> {
  const contextId = hexEncode(crypto.getRandomValues(new Uint8Array(16)))
  const chainRoot = `sha256:${hexEncode(sha256(new TextEncoder().encode(contextId)))}`
  const contentId = `sha256:${hexEncode(sha256(new TextEncoder().encode('proof-verify-' + suffix)))}`

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

async function submit(url: string, record: AtribRecord): Promise<ProofBundle> {
  const res = await fetch(`${url}/v1/entries`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(record),
  })
  expect(res.status).toBe(200)
  return (await res.json()) as ProofBundle
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('independent proof verification', () => {
  let server: LogServer
  let serverPublicKey: Uint8Array
  let privateKey: Uint8Array
  let creatorKey: string

  beforeAll(async () => {
    privateKey = ed.utils.randomPrivateKey()
    const publicKey = await ed.getPublicKeyAsync(privateKey)
    creatorKey = Buffer.from(publicKey).toString('base64url')

    const logKey = ed.utils.randomPrivateKey()
    server = await startLogServer({ port: 0, logPrivateKey: logKey })
    serverPublicKey = server.logPublicKey
  })

  afterAll(async () => {
    await server.close()
  })

  it('inclusion proof verifies against checkpoint root for single entry', async () => {
    const record = await makeSignedRecord(privateKey, creatorKey, 'single')
    const proof = await submit(server.url, record)

    // Parse checkpoint to extract root hash
    const cpLines = proof.checkpoint.split('\n')
    const body = cpLines.slice(0, 3).join('\n') + '\n'
    const parsed = parseCheckpointBody(body)

    const rootHashBytes = Buffer.from(parsed.rootHash, 'base64')
    const leafHashBytes = Buffer.from(proof.leaf_hash, 'base64')
    const proofHashes = proof.inclusion_proof.map((h) => Buffer.from(h, 'base64'))

    // Verify inclusion proof independently
    const valid = verifyInclusion(
      proof.log_index,
      parsed.treeSize,
      new Uint8Array(leafHashBytes),
      proofHashes.map((h) => new Uint8Array(h)),
      new Uint8Array(rootHashBytes),
    )
    expect(valid).toBe(true)
  })

  it('inclusion proofs verify for all entries in a multi-entry tree', async () => {
    // Submit 8 records and collect all proofs
    const proofs: ProofBundle[] = []
    for (let i = 0; i < 8; i++) {
      const record = await makeSignedRecord(privateKey, creatorKey, `multi-${i}`)
      proofs.push(await submit(server.url, record))
    }

    // Verify the last proof (which has the complete tree state)
    const lastProof = proofs[proofs.length - 1]!
    const cpLines = lastProof.checkpoint.split('\n')
    const body = cpLines.slice(0, 3).join('\n') + '\n'
    const parsed = parseCheckpointBody(body)

    const rootHashBytes = new Uint8Array(Buffer.from(parsed.rootHash, 'base64'))
    const leafHashBytes = new Uint8Array(Buffer.from(lastProof.leaf_hash, 'base64'))
    const proofHashes = lastProof.inclusion_proof.map(
      (h) => new Uint8Array(Buffer.from(h, 'base64')),
    )

    const valid = verifyInclusion(
      lastProof.log_index,
      parsed.treeSize,
      leafHashBytes,
      proofHashes,
      rootHashBytes,
    )
    expect(valid).toBe(true)
  })

  it('checkpoint signature is valid Ed25519', async () => {
    const record = await makeSignedRecord(privateKey, creatorKey, 'sig-check')
    const proof = await submit(server.url, record)

    // C2SP signed-note (spec §2.4.3): body\n\n— origin <base64(keyHash||sig)>\n
    const parts = proof.checkpoint.split('\n\n')
    const body = parts[0]! + '\n'
    const sigLine = parts[1]!.trim()

    const parsed = parseSignatureLine(sigLine)
    expect(parsed).not.toBeNull()

    // Verify Ed25519 signature over the body
    const bodyBytes = new TextEncoder().encode(body)
    const valid = await ed.verifyAsync(parsed!.signature, bodyBytes, serverPublicKey)
    expect(valid).toBe(true)
  })

  it('tampered proof fails verification', async () => {
    const record = await makeSignedRecord(privateKey, creatorKey, 'tamper')
    const proof = await submit(server.url, record)

    const cpLines = proof.checkpoint.split('\n')
    const body = cpLines.slice(0, 3).join('\n') + '\n'
    const parsed = parseCheckpointBody(body)

    const rootHashBytes = new Uint8Array(Buffer.from(parsed.rootHash, 'base64'))
    const leafHashBytes = new Uint8Array(Buffer.from(proof.leaf_hash, 'base64'))

    // Tamper with leaf hash (flip first byte)
    const tamperedLeaf = new Uint8Array(leafHashBytes)
    tamperedLeaf[0] = tamperedLeaf[0]! ^ 0xff

    const proofHashes = proof.inclusion_proof.map(
      (h) => new Uint8Array(Buffer.from(h, 'base64')),
    )

    const valid = verifyInclusion(
      proof.log_index,
      parsed.treeSize,
      tamperedLeaf,
      proofHashes,
      rootHashBytes,
    )
    expect(valid).toBe(false)
  })
})
