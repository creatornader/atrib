// SPDX-License-Identifier: Apache-2.0

/**
 * Full-chain integration test with real cryptography.
 *
 * Exercises the complete atrib attribution pipeline end-to-end:
 *
 *   1. Start a real @atrib/log-node server (in-process, ephemeral port)
 *   2. Wrap a mock MCP server with @atrib/mcp middleware, pointed at the real log
 *   3. Simulate a tool call through the middleware
 *   4. Verify the middleware submitted a record to the real log
 *   5. Retrieve the proof from the log
 *   6. Independently verify the inclusion proof using verifyInclusion
 *   7. Verify the checkpoint signature (Ed25519)
 *
 * Unlike end-to-end.test.ts (which uses a fetch mock), this test hits a real
 * Merkle log with real Ed25519 signatures and real inclusion proofs.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'
import crypto from 'crypto'
import {
  atrib,
  base64urlEncode,
  getPublicKey,
  signRecord,
  hexEncode,
  sha256,
  verifyInclusion,
} from '@atrib/mcp'
import type { AtribRecord, AtribServer, ProofBundle } from '@atrib/mcp'
import { startLogServer, parseCheckpointBody, type LogServer } from '@atrib/log-node'
import { createMockMcpServer } from '../src/test-harness.js'

// Ensure sync sha512 is available for @noble/ed25519
ed.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m))

// ─────────────────────────────────────────────────────────────────────────────
// Test keys
// ─────────────────────────────────────────────────────────────────────────────

const CREATOR_PRIVATE_KEY = new Uint8Array(32).fill(55)
const CREATOR_PRIVATE_KEY_B64 = base64urlEncode(CREATOR_PRIVATE_KEY)
const SERVER_URL = 'https://tools.example.com'

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
  const contentId = `sha256:${hexEncode(sha256(new TextEncoder().encode('full-chain-' + suffix)))}`

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

async function submitRecord(url: string, record: AtribRecord): Promise<ProofBundle> {
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

describe('full-chain integration (real log, real crypto)', () => {
  let logServer: LogServer
  let creatorPubB64: string

  beforeAll(async () => {
    const logPrivateKey = ed.utils.randomPrivateKey()
    logServer = await startLogServer({ port: 0, logPrivateKey })
    creatorPubB64 = base64urlEncode(await getPublicKey(CREATOR_PRIVATE_KEY))
  })

  afterAll(async () => {
    await logServer.close()
  })

  it('submits a record through middleware to a real log and verifies the inclusion proof', async () => {
    // ── 1. Set up a mock MCP server wrapped with atrib middleware ──────
    const handle = createMockMcpServer()
    const wrappedServer: AtribServer = atrib(handle.server, {
      creatorKey: CREATOR_PRIVATE_KEY_B64,
      serverUrl: SERVER_URL,
      logEndpoint: `${logServer.url}/v1/entries`,
    })

    // Register a simple tool handler that returns a text response
    handle.registerToolHandler(async () => ({
      content: [{ type: 'text', text: 'hello from the tool' }],
    }))

    // ── 2. Simulate a tool call through the wrapped handler ───────────
    const request = {
      method: 'tools/call',
      params: {
        name: 'greet',
        arguments: { name: 'world' },
        _meta: {
          traceparent: '00-abcdef1234567890abcdef1234567890-0011223344556677-01',
        },
      },
    }

    const wrappedHandler = handle.getToolHandler()
    expect(wrappedHandler).toBeDefined()

    const result = (await wrappedHandler!(request, {})) as Record<string, unknown>

    // The middleware should have attached attribution context to the response
    expect(result._meta).toBeDefined()
    const meta = result._meta as Record<string, unknown>
    expect(meta.atrib).toBeDefined()

    // ── 3. Flush pending submissions to the real log ──────────────────
    await wrappedServer.flush()
    // Give the submission queue a tick to complete the HTTP round-trip
    await new Promise((resolve) => setTimeout(resolve, 200))

    // ── 4. Verify the record was submitted by fetching the checkpoint ─
    const checkpointRes = await fetch(`${logServer.url}/v1/checkpoint`)
    expect(checkpointRes.status).toBe(200)
    const checkpointText = await checkpointRes.text()

    // Parse the signed checkpoint body
    const cpParts = checkpointText.split('\n\n')
    const cpBody = cpParts[0]! + '\n'
    const parsed = parseCheckpointBody(cpBody)

    // The tree should have at least 1 entry (our submission)
    expect(parsed.treeSize).toBeGreaterThanOrEqual(1)

    // ── 5. Submit a record directly to get a proof we can verify ──────
    // Direct submission returns the ProofBundle immediately.
    const record = await makeSignedRecord(CREATOR_PRIVATE_KEY, creatorPubB64, 'proof-verify')
    const proof = await submitRecord(logServer.url, record)

    // ── 6. Independently verify the inclusion proof ───────────────────
    const proofCpParts = proof.checkpoint.split('\n\n')
    const proofCpBody = proofCpParts[0]! + '\n'
    const proofParsed = parseCheckpointBody(proofCpBody)

    const rootHashBytes = new Uint8Array(Buffer.from(proofParsed.rootHash, 'base64'))
    const leafHashBytes = new Uint8Array(Buffer.from(proof.leaf_hash, 'base64'))
    const proofHashes = proof.inclusion_proof.map(
      (h) => new Uint8Array(Buffer.from(h, 'base64')),
    )

    const inclusionValid = verifyInclusion(
      proof.log_index,
      proofParsed.treeSize,
      leafHashBytes,
      proofHashes,
      rootHashBytes,
    )
    expect(inclusionValid).toBe(true)

    // ── 7. Verify the checkpoint signature (Ed25519) ──────────────────
    // C2SP signed-note canonical encoding (spec §2.4.3 post-D031):
    //   "— <origin> <base64(keyHash[4B] || sig[64B])>"
    const sigLine = proofCpParts[1]!.trim()
    const m = sigLine.match(/^[—\-] \S+ (\S+)\s*$/)
    expect(m).not.toBeNull()
    const decoded = new Uint8Array(Buffer.from(m![1]!, 'base64'))
    expect(decoded.length).toBe(68)
    const sigBytes = decoded.slice(4) // skip 4-byte keyHash

    const bodyBytes = new TextEncoder().encode(proofCpBody)
    const sigValid = await ed.verifyAsync(sigBytes, bodyBytes, logServer.logPublicKey)
    expect(sigValid).toBe(true)
  })

  it('tampered leaf hash fails inclusion verification', async () => {
    const record = await makeSignedRecord(CREATOR_PRIVATE_KEY, creatorPubB64, 'tamper')
    const proof = await submitRecord(logServer.url, record)

    // Parse checkpoint
    const cpParts = proof.checkpoint.split('\n\n')
    const cpBody = cpParts[0]! + '\n'
    const parsed = parseCheckpointBody(cpBody)

    const rootHashBytes = new Uint8Array(Buffer.from(parsed.rootHash, 'base64'))
    const leafHashBytes = new Uint8Array(Buffer.from(proof.leaf_hash, 'base64'))
    const proofHashes = proof.inclusion_proof.map(
      (h) => new Uint8Array(Buffer.from(h, 'base64')),
    )

    // Tamper with the leaf hash (flip first byte)
    const tamperedLeaf = new Uint8Array(leafHashBytes)
    tamperedLeaf[0] = tamperedLeaf[0]! ^ 0xff

    const valid = verifyInclusion(
      proof.log_index,
      parsed.treeSize,
      tamperedLeaf,
      proofHashes,
      rootHashBytes,
    )
    expect(valid).toBe(false)
  })

  it('middleware-submitted record appears in the log checkpoint', async () => {
    // Capture initial tree size
    const initialCpRes = await fetch(`${logServer.url}/v1/checkpoint`)
    const initialCpText = await initialCpRes.text()
    const initialParsed = parseCheckpointBody(initialCpText.split('\n\n')[0]! + '\n')
    const initialTreeSize = initialParsed.treeSize

    // Set up middleware pointed at the real log
    const handle = createMockMcpServer()
    const wrappedServer: AtribServer = atrib(handle.server, {
      creatorKey: CREATOR_PRIVATE_KEY_B64,
      serverUrl: SERVER_URL,
      logEndpoint: `${logServer.url}/v1/entries`,
    })

    handle.registerToolHandler(async () => ({
      content: [{ type: 'text', text: 'another tool response' }],
    }))

    const request = {
      method: 'tools/call',
      params: {
        name: 'search',
        arguments: { q: 'test' },
        _meta: {
          traceparent: '00-11223344556677889900aabbccddeeff-aabbccddeeff0011-01',
        },
      },
    }

    const wrappedHandler = handle.getToolHandler()
    expect(wrappedHandler).toBeDefined()
    await wrappedHandler!(request, {})

    // Flush and wait for the async submission
    await wrappedServer.flush()
    await new Promise((resolve) => setTimeout(resolve, 200))

    // Verify tree size increased
    const afterCpRes = await fetch(`${logServer.url}/v1/checkpoint`)
    const afterCpText = await afterCpRes.text()
    const afterParsed = parseCheckpointBody(afterCpText.split('\n\n')[0]! + '\n')

    expect(afterParsed.treeSize).toBeGreaterThan(initialTreeSize)
  })
})
