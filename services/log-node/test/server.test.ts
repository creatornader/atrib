/**
 * HTTP API tests for the log-node server.
 *
 * Tests POST /v1/entries and GET /v1/checkpoint with a real in-process
 * server on a random port.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as ed from '@noble/ed25519'
import { sha512, sha256 } from '@noble/hashes/sha2.js'
import { signRecord, hexEncode } from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'
import { startLogServer, type LogServer } from '../src/index.js'

// Set up sync sha512 for @noble/ed25519
ed.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a valid signed AtribRecord with a fresh ephemeral keypair.
 */
async function makeSignedRecord(overrides: Partial<AtribRecord> = {}): Promise<AtribRecord> {
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
    content_id: 'sha256:' + hexEncode(sha256(new TextEncoder().encode('test-content'))),
    signature: '', // placeholder — signRecord will replace
    ...overrides,
  }

  // Use signRecord which correctly strips signature before signing (§1.4.3)
  return signRecord(unsigned as AtribRecord, privateKey)
}

async function post(url: string, body: unknown): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${url}/v1/entries`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  return { status: res.status, json }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

let server: LogServer

beforeAll(async () => {
  const privateKey = ed.utils.randomPrivateKey()
  server = await startLogServer({ port: 0, logPrivateKey: privateKey })
})

afterAll(async () => {
  await server.close()
})

describe('POST /v1/entries', () => {
  it('returns 200 with proof bundle for a valid record', async () => {
    const record = await makeSignedRecord()
    const { status, json } = await post(server.url, record)

    expect(status).toBe(200)
    const proof = json as Record<string, unknown>
    expect(typeof proof.log_index).toBe('number')
    expect(typeof proof.checkpoint).toBe('string')
    expect(Array.isArray(proof.inclusion_proof)).toBe(true)
    expect(typeof proof.leaf_hash).toBe('string')
  })

  it('duplicate submission returns the same proof (idempotent)', async () => {
    const record = await makeSignedRecord()
    const { json: first } = await post(server.url, record)
    const { json: second } = await post(server.url, record)

    expect(first).toEqual(second)
  })

  it('rejects invalid spec_version with 400', async () => {
    const record = await makeSignedRecord()
    const { status, json } = await post(server.url, { ...record, spec_version: 'atrib/2.0' })

    expect(status).toBe(400)
    expect((json as Record<string, unknown>).error).toMatch(/spec_version/)
  })

  it('rejects timestamp more than 10 minutes in future with 400', async () => {
    const record = await makeSignedRecord({ timestamp: Date.now() + 11 * 60 * 1000 })
    const { status, json } = await post(server.url, record)

    expect(status).toBe(400)
    expect((json as Record<string, unknown>).error).toMatch(/future/)
  })

  it('rejects invalid event_type with 400', async () => {
    const record = await makeSignedRecord()
    const { status, json } = await post(server.url, { ...record, event_type: 'invalid_type' })

    expect(status).toBe(400)
    expect((json as Record<string, unknown>).error).toMatch(/event_type/)
  })
})

describe('GET /v1/checkpoint', () => {
  it('returns the signed checkpoint as text after at least one entry', async () => {
    // Ensure there is at least one entry in this server's tree
    const record = await makeSignedRecord()
    await post(server.url, record)

    const res = await fetch(`${server.url}/v1/checkpoint`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/plain/)
    const text = await res.text()
    // Should contain the log origin and a signature line
    expect(text).toContain('log.atrib.io/v1')
    expect(text).toContain('\u2014')
  })
})
