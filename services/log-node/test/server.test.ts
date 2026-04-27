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
    signature: '', // placeholder. signRecord will replace
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
    expect(text).toContain('log.atrib.dev/v1')
    expect(text).toContain('\u2014')
  })
})

describe('GET /v1/pubkey', () => {
  it('returns the log Ed25519 public key + key_id', async () => {
    const res = await fetch(`${server.url}/v1/pubkey`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/json/)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.origin).toBe('log.atrib.dev/v1')
    expect(body.algorithm).toBe('Ed25519')
    expect(typeof body.public_key).toBe('string')
    expect(typeof body.key_id).toBe('string')
    // 32-byte Ed25519 pubkey base64url-encodes to 43 chars (no padding)
    expect((body.public_key as string).length).toBe(43)
    // 4-byte key_id hex-encodes to 8 chars
    expect((body.key_id as string)).toMatch(/^[0-9a-f]{8}$/)
  })

  it('published key_id matches the prefix used in checkpoint signatures', async () => {
    // Ensure the tree has at least one entry so /checkpoint returns 200
    const record = await makeSignedRecord()
    await post(server.url, record)

    const [pubkeyRes, cpRes] = await Promise.all([
      fetch(`${server.url}/v1/pubkey`),
      fetch(`${server.url}/v1/checkpoint`),
    ])
    const pubkey = (await pubkeyRes.json()) as { key_id: string }
    const cpText = await cpRes.text()
    // Signed-note signature line: "\u2014 origin <keyIdHex>+<sigB64>"
    const sigMatch = cpText.match(/\u2014 \S+ ([0-9a-f]{8})\+/)
    expect(sigMatch).not.toBeNull()
    expect(sigMatch![1]).toBe(pubkey.key_id)
  })

  it('signed checkpoint verifies under the published pubkey', async () => {
    const record = await makeSignedRecord()
    await post(server.url, record)

    const [pubkeyRes, cpRes] = await Promise.all([
      fetch(`${server.url}/v1/pubkey`),
      fetch(`${server.url}/v1/checkpoint`),
    ])
    const pubkey = (await pubkeyRes.json()) as { public_key: string }
    const cpText = await cpRes.text()

    // Split body|signatures on the blank line.
    const idx = cpText.indexOf('\n\n')
    expect(idx).toBeGreaterThan(0)
    const body = cpText.slice(0, idx + 1) // body keeps trailing \n
    const sigBlock = cpText.slice(idx + 2)

    const sigLine = sigBlock.split('\n').find((l) => l.startsWith('\u2014'))
    expect(sigLine).toBeDefined()
    const m = sigLine!.match(/^\u2014 \S+ [0-9a-f]{8}\+(\S+)$/)
    expect(m).not.toBeNull()
    const sigB64 = m![1]
    const sigBytes = new Uint8Array(Buffer.from(sigB64, 'base64'))

    const pkBytes = new Uint8Array(
      Buffer.from(
        (pubkey.public_key as string).replace(/-/g, '+').replace(/_/g, '/'),
        'base64',
      ),
    )

    const ok = await ed.verifyAsync(sigBytes, new TextEncoder().encode(body), pkBytes)
    expect(ok).toBe(true)
  })
})

describe('GET /v1/log-pubkey', () => {
  it('returns the C2SP vkey string as text/plain', async () => {
    const res = await fetch(`${server.url}/v1/log-pubkey`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/plain/)
    const text = await res.text()
    // Format: <origin>+<hex 8 chars>+<base64 of 33 bytes = 44 chars with padding>
    const m = text.match(/^(\S+)\+([0-9a-f]{8})\+([A-Za-z0-9+/]+=*)$/)
    expect(m).not.toBeNull()
    expect(m![1]).toBe('log.atrib.dev/v1')
  })

  it('vkey origin and key_id agree with the JSON /v1/pubkey endpoint', async () => {
    const [vkeyRes, jsonRes] = await Promise.all([
      fetch(`${server.url}/v1/log-pubkey`),
      fetch(`${server.url}/v1/pubkey`),
    ])
    const vkey = await vkeyRes.text()
    const json = (await jsonRes.json()) as { origin: string; key_id: string }
    const m = vkey.match(/^(\S+)\+([0-9a-f]{8})\+/)
    expect(m).not.toBeNull()
    expect(m![1]).toBe(json.origin)
    expect(m![2]).toBe(json.key_id)
  })

  it('vkey payload decodes to 0x01 + the published public key', async () => {
    const [vkeyRes, jsonRes] = await Promise.all([
      fetch(`${server.url}/v1/log-pubkey`),
      fetch(`${server.url}/v1/pubkey`),
    ])
    const vkey = await vkeyRes.text()
    const json = (await jsonRes.json()) as { public_key: string }

    const payloadB64 = vkey.split('+').pop()!
    const payload = new Uint8Array(Buffer.from(payloadB64, 'base64'))
    expect(payload.length).toBe(33) // 0x01 type byte + 32-byte Ed25519 pubkey
    expect(payload[0]).toBe(0x01)

    const pkFromVkey = payload.slice(1)
    const pkFromJson = new Uint8Array(
      Buffer.from(json.public_key.replace(/-/g, '+').replace(/_/g, '/'), 'base64'),
    )
    expect(Buffer.from(pkFromVkey).equals(Buffer.from(pkFromJson))).toBe(true)
  })

  it('pubkey extracted from vkey verifies the checkpoint signature', async () => {
    const record = await makeSignedRecord()
    await post(server.url, record)

    const [vkeyRes, cpRes] = await Promise.all([
      fetch(`${server.url}/v1/log-pubkey`),
      fetch(`${server.url}/v1/checkpoint`),
    ])
    const vkey = await vkeyRes.text()
    const cpText = await cpRes.text()

    const payloadB64 = vkey.split('+').pop()!
    const payload = new Uint8Array(Buffer.from(payloadB64, 'base64'))
    const pkBytes = payload.slice(1)

    const idx = cpText.indexOf('\n\n')
    const body = cpText.slice(0, idx + 1)
    const sigBlock = cpText.slice(idx + 2)
    const sigLine = sigBlock.split('\n').find((l) => l.startsWith('\u2014'))!
    const sigB64 = sigLine.match(/^\u2014 \S+ [0-9a-f]{8}\+(\S+)$/)![1]
    const sigBytes = new Uint8Array(Buffer.from(sigB64, 'base64'))

    const ok = await ed.verifyAsync(sigBytes, new TextEncoder().encode(body), pkBytes)
    expect(ok).toBe(true)
  })
})
