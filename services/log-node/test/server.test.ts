/**
 * HTTP API tests for the log-node server.
 *
 * Tests POST /v1/entries and GET /v1/checkpoint with a real in-process
 * server on a random port.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as ed from '@noble/ed25519'
import { sha512, sha256 } from '@noble/hashes/sha2.js'
import { canonicalRecord, signRecord, hexEncode } from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'
import { startLogServer, type LogServer } from '../src/index.js'
import { parseSignatureLine } from '../src/checkpoint.js'

// Set up sha512 for @noble/ed25519 (safe to call multiple times)
ed.hashes.sha512 = sha512

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a valid signed AtribRecord with a fresh ephemeral keypair.
 */
async function makeSignedRecord(overrides: Partial<AtribRecord> = {}): Promise<AtribRecord> {
  const privateKey = ed.utils.randomSecretKey()
  const publicKeyBytes = await ed.getPublicKeyAsync(privateKey)
  const creatorKey = Buffer.from(publicKeyBytes).toString('base64url')

  const contextId = hexEncode(crypto.getRandomValues(new Uint8Array(16)))
  const chainRoot = `sha256:${hexEncode(sha256(new TextEncoder().encode(contextId)))}`

  const unsigned = {
    spec_version: 'atrib/1.0' as const,
    event_type: 'https://atrib.dev/v1/types/tool_call' as const,
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

async function readSseEvent(res: Response, eventName: string): Promise<Record<string, unknown>> {
  const reader = res.body?.getReader()
  if (!reader) throw new Error('response has no body')
  const decoder = new TextDecoder()
  let text = ''
  try {
    while (true) {
      const next = await Promise.race([
        reader.read(),
        new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) => {
          setTimeout(() => reject(new Error(`timed out waiting for ${eventName}`)), 2000)
        }),
      ])
      if (next.done) break
      text += decoder.decode(next.value, { stream: true })
      for (const chunk of text.split('\n\n')) {
        if (!chunk.includes(`event: ${eventName}`)) continue
        const data = chunk
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice('data:'.length).trimStart())
          .join('\n')
        return JSON.parse(data) as Record<string, unknown>
      }
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  throw new Error(`stream ended before ${eventName}`)
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

let server: LogServer

beforeAll(async () => {
  const privateKey = ed.utils.randomSecretKey()
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

describe('GET / (service-info index)', () => {
  it('returns service-info JSON for non-explore.atrib.dev hosts', async () => {
    const res = await fetch(`${server.url}/`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.service).toBe('atrib-log-node')
    expect(body.versions).toEqual(['v1'])
    expect(body.current_version).toBe('v1')
    expect(body.endpoints.submit).toBe('POST /v1/entries')
    expect(body.endpoints.proof).toBe('GET /v1/proof/<record_hash_hex>')
    expect(body.explorer).toBe('https://explore.atrib.dev/')
  })
})

describe('GET /v1/proof/:hash', () => {
  it('returns the cached proof for a submitted record', async () => {
    const record = await makeSignedRecord()
    const { json: submitted } = await post(server.url, record)
    const recordHashHex = hexEncode(sha256(canonicalRecord(record)))

    const res = await fetch(`${server.url}/v1/proof/${recordHashHex}`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(submitted)
  })

  it('generates a fresh proof after restart from the persisted tree', async () => {
    const privateKey = ed.utils.randomSecretKey()
    const dir = await mkdtemp(join(tmpdir(), 'atrib-log-proof-'))
    const persistencePath = join(dir, 'entries.bin')
    const firstServer = await startLogServer({
      port: 0,
      logPrivateKey: privateKey,
      persistencePath,
    })

    try {
      const record = await makeSignedRecord()
      const { json: submitted } = await post(firstServer.url, record)
      const recordHashHex = hexEncode(sha256(canonicalRecord(record)))
      await firstServer.close()

      const secondServer = await startLogServer({
        port: 0,
        logPrivateKey: privateKey,
        persistencePath,
      })
      try {
        const res = await fetch(`${secondServer.url}/v1/proof/${recordHashHex}`)
        expect(res.status).toBe(200)
        const proof = (await res.json()) as Record<string, unknown>
        expect(proof.log_index).toBe((submitted as Record<string, unknown>).log_index)
        expect(typeof proof.checkpoint).toBe('string')
        expect(Array.isArray(proof.inclusion_proof)).toBe(true)
        expect(typeof proof.leaf_hash).toBe('string')
      } finally {
        await secondServer.close()
      }
    } finally {
      try {
        await firstServer.close()
      } catch {
        // The test closes firstServer before restart.
      }
    }
  })

  it('returns 404 for a missing hash', async () => {
    const res = await fetch(`${server.url}/v1/proof/${'0'.repeat(64)}`)
    expect(res.status).toBe(404)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toBe('not found')
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
    expect(body.key_id as string).toMatch(/^[0-9a-f]{8}$/)
  })

  it('published key_id matches the keyHash embedded in checkpoint signatures', async () => {
    // Ensure the tree has at least one entry so /checkpoint returns 200
    const record = await makeSignedRecord()
    await post(server.url, record)

    const [pubkeyRes, cpRes] = await Promise.all([
      fetch(`${server.url}/v1/pubkey`),
      fetch(`${server.url}/v1/checkpoint`),
    ])
    const pubkey = (await pubkeyRes.json()) as { key_id: string }
    const cpText = await cpRes.text()
    // C2SP signed-note: keyHash is the first 4 bytes of base64(keyHash || sig)
    const sigBlock = cpText.split('\n\n')[1]!
    const sigLine = sigBlock.split('\n').find((l) => l.startsWith('\u2014'))!
    const parsed = parseSignatureLine(sigLine.trim())
    expect(parsed).not.toBeNull()
    expect(Buffer.from(parsed!.keyId).toString('hex')).toBe(pubkey.key_id)
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
    const parsed = parseSignatureLine(sigLine!.trim())
    expect(parsed).not.toBeNull()

    const pkBytes = new Uint8Array(
      Buffer.from((pubkey.public_key as string).replace(/-/g, '+').replace(/_/g, '/'), 'base64'),
    )

    const ok = await ed.verifyAsync(parsed!.signature, new TextEncoder().encode(body), pkBytes)
    expect(ok).toBe(true)
  })
})

describe('GET /v1/stats', () => {
  it('returns aggregate counters over the current tree', async () => {
    // Submit one of each normative event_type plus an extension URI.
    // The fixture log persists across the whole test file, so prior tests
    // contribute records too; we assert minimum counts, not exact ones.
    const tc = await makeSignedRecord({ event_type: 'https://atrib.dev/v1/types/tool_call' })
    const tx = await makeSignedRecord({ event_type: 'https://atrib.dev/v1/types/transaction' })
    const ob = await makeSignedRecord({ event_type: 'https://atrib.dev/v1/types/observation' })
    const ext = await makeSignedRecord({ event_type: 'https://example.com/v1/types/custom' })
    await post(server.url, tc)
    await post(server.url, tx)
    await post(server.url, ob)
    await post(server.url, ext)

    const res = await fetch(`${server.url}/v1/stats`)
    expect(res.status).toBe(200)
    const stats = (await res.json()) as {
      tree_size: number
      distinct_signers: number
      oldest_timestamp_ms: number | null
      newest_timestamp_ms: number | null
      entries_by_event_type: {
        tool_call: number
        transaction: number
        observation: number
        extension: number
        reserved: number
      }
    }

    expect(stats.tree_size).toBeGreaterThanOrEqual(4)
    expect(stats.distinct_signers).toBeGreaterThanOrEqual(4)
    expect(stats.oldest_timestamp_ms).toBeGreaterThan(0)
    expect(stats.newest_timestamp_ms).toBeGreaterThan(0)
    expect(stats.newest_timestamp_ms!).toBeGreaterThanOrEqual(stats.oldest_timestamp_ms!)
    expect(stats.entries_by_event_type.tool_call).toBeGreaterThanOrEqual(1)
    expect(stats.entries_by_event_type.transaction).toBeGreaterThanOrEqual(1)
    expect(stats.entries_by_event_type.observation).toBeGreaterThanOrEqual(1)
    expect(stats.entries_by_event_type.extension).toBeGreaterThanOrEqual(1)
    expect(stats.entries_by_event_type.reserved).toBe(0)
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

    // vkey is <origin>+<hex8>+<base64>. Base64 itself may contain '+', so
    // re-join everything after the first two '+' separators rather than
    // .pop()ing the last segment.
    const payloadB64 = vkey.split('+').slice(2).join('+')
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

    // vkey is <origin>+<hex8>+<base64>. Base64 itself may contain '+', so
    // re-join everything after the first two '+' separators rather than
    // .pop()ing the last segment.
    const payloadB64 = vkey.split('+').slice(2).join('+')
    const payload = new Uint8Array(Buffer.from(payloadB64, 'base64'))
    const pkBytes = payload.slice(1)

    const idx = cpText.indexOf('\n\n')
    const body = cpText.slice(0, idx + 1)
    const sigBlock = cpText.slice(idx + 2)
    const sigLine = sigBlock.split('\n').find((l) => l.startsWith('\u2014'))!
    const parsed = parseSignatureLine(sigLine.trim())!

    const ok = await ed.verifyAsync(parsed.signature, new TextEncoder().encode(body), pkBytes)
    expect(ok).toBe(true)
  })
})

// D054: browser-based explorer reads
describe('CORS (D054)', () => {
  it('OPTIONS preflight returns 204 with CORS headers', async () => {
    const res = await fetch(`${server.url}/v1/checkpoint`, { method: 'OPTIONS' })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-allow-methods')).toContain('GET')
    expect(res.headers.get('access-control-allow-headers')).toContain('x-atrib-priority')
  })

  it('GET /v1/checkpoint includes access-control-allow-origin', async () => {
    const res = await fetch(`${server.url}/v1/checkpoint`)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })
})

describe('graph fanout', () => {
  it('POSTs the full record to graphFanoutEndpoint after a successful submit', async () => {
    const { createServer } = await import('node:http')
    const received: { headers: Record<string, string | string[] | undefined>; body: string }[] = []
    const mockServer = createServer((req, res) => {
      let body = ''
      req.on('data', (c: Buffer) => {
        body += c.toString('utf-8')
      })
      req.on('end', () => {
        received.push({ headers: { ...req.headers }, body })
        res.statusCode = 200
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ ok: true }))
      })
    })
    await new Promise<void>((r) => mockServer.listen(0, '127.0.0.1', r))
    const addr = mockServer.address()
    if (!addr || typeof addr === 'string') throw new Error('mock addr')
    const fanoutUrl = `http://127.0.0.1:${addr.port}/ingest`

    const { startLogServer } = await import('../src/index.js')
    const fanoutSrv = await startLogServer({ port: 0, graphFanoutEndpoint: fanoutUrl })

    const record = await makeSignedRecord()
    const submitRes = await fetch(`${fanoutSrv.url}/v1/entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(record),
    })
    expect(submitRes.status).toBe(200)

    // Fanout is fire-and-forget; wait for it to land on the mock.
    const deadline = Date.now() + 2000
    while (received.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50))
    }
    expect(received.length).toBe(1)
    const forwarded = JSON.parse(received[0]!.body) as { creator_key: string; signature: string }
    expect(forwarded.creator_key).toBe(record.creator_key)
    expect(forwarded.signature).toBe(record.signature)

    await fanoutSrv.close()
    await new Promise<void>((r) => mockServer.close(() => r()))
  })

  it('retries graph fanout after a transient failure', async () => {
    const { createServer } = await import('node:http')
    const received: { status: number; body: string }[] = []
    const mockServer = createServer((req, res) => {
      let body = ''
      req.on('data', (c: Buffer) => {
        body += c.toString('utf-8')
      })
      req.on('end', () => {
        const status = received.length === 0 ? 503 : 200
        received.push({ status, body })
        res.statusCode = status
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ ok: status === 200 }))
      })
    })
    await new Promise<void>((r) => mockServer.listen(0, '127.0.0.1', r))
    const addr = mockServer.address()
    if (!addr || typeof addr === 'string') throw new Error('mock addr')
    const fanoutUrl = `http://127.0.0.1:${addr.port}/ingest`

    const { startLogServer } = await import('../src/index.js')
    const fanoutSrv = await startLogServer({ port: 0, graphFanoutEndpoint: fanoutUrl })

    const record = await makeSignedRecord()
    const submitRes = await fetch(`${fanoutSrv.url}/v1/entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(record),
    })
    expect(submitRes.status).toBe(200)

    const deadline = Date.now() + 2000
    while (received.length < 2 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50))
    }
    expect(received.map((r) => r.status)).toEqual([503, 200])

    const retried = JSON.parse(received[1]!.body) as { creator_key: string; signature: string }
    expect(retried.creator_key).toBe(record.creator_key)
    expect(retried.signature).toBe(record.signature)

    await fanoutSrv.close()
    await new Promise<void>((r) => mockServer.close(() => r()))
  })

  it('still responds 200 to submit when fanout endpoint is unreachable', async () => {
    const { startLogServer } = await import('../src/index.js')
    const srv = await startLogServer({
      port: 0,
      graphFanoutEndpoint: 'http://127.0.0.1:1/unreachable',
    })
    const record = await makeSignedRecord()
    const res = await fetch(`${srv.url}/v1/entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(record),
    })
    expect(res.status).toBe(200)
    await srv.close()
  })
})

// T8: the log is append-only; DELETE is rejected with 405.
describe('append-only design (T8)', () => {
  it('DELETE /v1/entries returns 405 with Allow header', async () => {
    const u = new URL(server.url)
    const got = await new Promise<{ status: number; allow: string; body: string }>(
      (resolve, reject) => {
        const req = httpRequest(
          {
            method: 'DELETE',
            hostname: u.hostname,
            port: u.port,
            path: '/v1/entries',
          },
          (res: IncomingMessage) => {
            const chunks: Buffer[] = []
            res.on('data', (c: Buffer) => chunks.push(c))
            res.on('end', () =>
              resolve({
                status: res.statusCode ?? 0,
                allow: String(res.headers['allow'] ?? ''),
                body: Buffer.concat(chunks).toString('utf-8'),
              }),
            )
          },
        )
        req.on('error', reject)
        req.end()
      },
    )
    expect(got.status).toBe(405)
    expect(got.allow).toBe('POST')
    expect(got.body).toMatch(/append-only/i)
  })

  it('DELETE /v1/entries/<index> returns 405', async () => {
    const u = new URL(server.url)
    const got = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        {
          method: 'DELETE',
          hostname: u.hostname,
          port: u.port,
          path: '/v1/entries/0',
        },
        (res: IncomingMessage) => {
          res.resume()
          resolve(res.statusCode ?? 0)
        },
      )
      req.on('error', reject)
      req.end()
    })
    expect(got).toBe(405)
  })
})

describe('GET /v1/recent', () => {
  it('returns latest entries newest-first with decoded fields', async () => {
    // Submit 3 records so /v1/recent has something to return
    for (let i = 0; i < 3; i++) await post(server.url, await makeSignedRecord())
    const res = await fetch(`${server.url}/v1/recent?limit=10`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      tree_size: number
      returned: number
      entries: Array<{
        index: number
        record_hash: string
        creator_key: string
        context_id: string
        timestamp_ms: number
        event_type: string
        event_type_byte: number
      }>
    }
    expect(body.tree_size).toBeGreaterThanOrEqual(3)
    expect(body.entries.length).toBeGreaterThanOrEqual(3)
    // newest-first: indices descend
    for (let i = 1; i < body.entries.length; i++) {
      expect(body.entries[i - 1]!.index).toBeGreaterThan(body.entries[i]!.index)
    }
    const e = body.entries[0]!
    expect(e.record_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(e.creator_key).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(e.context_id).toMatch(/^[0-9a-f]{32}$/)
    expect(typeof e.timestamp_ms).toBe('number')
    expect([
      'tool_call',
      'transaction',
      'observation',
      'directory_anchor',
      'extension',
      'reserved',
    ]).toContain(e.event_type)
  })

  it('clamps limit between 1 and 100', async () => {
    const tooBig = await fetch(`${server.url}/v1/recent?limit=999`)
    expect(tooBig.status).toBe(200)
    const tooSmall = await fetch(`${server.url}/v1/recent?limit=0`)
    expect(tooSmall.status).toBe(200)
    const bigBody = (await tooBig.json()) as { entries: unknown[] }
    expect(bigBody.entries.length).toBeLessThanOrEqual(100)
  })

  it('paginates older entries via offset', async () => {
    for (let i = 0; i < 6; i++) await post(server.url, await makeSignedRecord())
    const page1 = (await fetch(`${server.url}/v1/recent?limit=3&offset=0`).then((r) =>
      r.json(),
    )) as {
      tree_size: number
      offset: number
      entries: Array<{ index: number }>
    }
    const page2 = (await fetch(`${server.url}/v1/recent?limit=3&offset=3`).then((r) =>
      r.json(),
    )) as {
      tree_size: number
      offset: number
      entries: Array<{ index: number }>
    }
    expect(page1.offset).toBe(0)
    expect(page2.offset).toBe(3)
    expect(page1.entries.length).toBe(3)
    expect(page2.entries.length).toBeGreaterThanOrEqual(1)
    // page2's newest index must be older than page1's oldest index
    expect(page2.entries[0]!.index).toBeLessThan(page1.entries.at(-1)!.index)
  })
})

describe('GET /v1/feed.json', () => {
  it('returns JSON Feed items filtered by commitment-visible entry fields', async () => {
    const record = await makeSignedRecord()
    await post(server.url, record)
    await post(server.url, await makeSignedRecord())
    const recordHash = `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
    const eventType = encodeURIComponent('https://atrib.dev/v1/types/tool_call')

    const res = await fetch(
      `${server.url}/v1/feed.json?creator_key=${record.creator_key}&event_type=${eventType}&since=${record.timestamp - 1}`,
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/feed+json')
    const body = (await res.json()) as {
      version: string
      items: Array<{ id: string; _atrib: { creator_key: string; record_hash: string } }>
    }
    expect(body.version).toBe('https://jsonfeed.org/version/1.1')
    expect(body.items.map((item) => item.id)).toContain(recordHash)
    expect(body.items.every((item) => item._atrib.creator_key === record.creator_key)).toBe(true)
  })

  it('rejects filters that require record bodies', async () => {
    const res = await fetch(`${server.url}/v1/feed.json?importance=high`)
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('importance')
  })
})

describe('GET /v1/stream', () => {
  it('replays matching historical entries when since is present', async () => {
    const record = await makeSignedRecord()
    await post(server.url, record)

    const res = await fetch(
      `${server.url}/v1/stream?creator_key=${record.creator_key}&since=${record.timestamp - 1}`,
    )
    expect(res.status).toBe(200)

    const event = (await readSseEvent(res, 'log_entry')) as {
      entry: { creator_key: string; record_hash: string }
    }
    expect(event.entry.creator_key).toBe(record.creator_key)
    expect(event.entry.record_hash).toBe(`sha256:${hexEncode(sha256(canonicalRecord(record)))}`)
  })

  it('streams new matching entries as Server-Sent Events', async () => {
    const record = await makeSignedRecord()
    const res = await fetch(`${server.url}/v1/stream?creator_key=${record.creator_key}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')

    const eventPromise = readSseEvent(res, 'log_entry')
    await post(server.url, record)
    const event = (await eventPromise) as {
      tree_size: number
      entry: { creator_key: string; record_hash: string; event_type: string }
    }

    expect(event.tree_size).toBeGreaterThan(0)
    expect(event.entry.creator_key).toBe(record.creator_key)
    expect(event.entry.record_hash).toBe(`sha256:${hexEncode(sha256(canonicalRecord(record)))}`)
    expect(event.entry.event_type).toBe('tool_call')
  })

  it('rejects filters that require record bodies', async () => {
    const res = await fetch(`${server.url}/v1/stream?topic=ap2`)
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('topic')
  })
})

describe('GET /v1/lookup/<hex>', () => {
  it('returns the entry for a known record_hash', async () => {
    const record = await makeSignedRecord()
    await post(server.url, record)
    const recent = await fetch(`${server.url}/v1/recent?limit=10`)
    const body = (await recent.json()) as { entries: Array<{ record_hash: string }> }
    const target = body.entries[0]!
    const hashHex = target.record_hash.slice(7) // strip 'sha256:'
    const lookup = await fetch(`${server.url}/v1/lookup/${hashHex}`)
    expect(lookup.status).toBe(200)
    const found = (await lookup.json()) as { record_hash: string }
    expect(found.record_hash).toBe(target.record_hash)
  })

  it('returns 404 for unknown record_hash', async () => {
    const r = await fetch(`${server.url}/v1/lookup/${'a'.repeat(64)}`)
    expect(r.status).toBe(404)
  })
})

describe('GET /v1/by-context/<hex>', () => {
  it('returns entries for a known context_id newest-first', async () => {
    // submitted records share the same context_id from makeSignedRecord
    await post(server.url, await makeSignedRecord())
    await post(server.url, await makeSignedRecord())
    const recent = await fetch(`${server.url}/v1/recent?limit=3`)
    const recentBody = (await recent.json()) as { entries: Array<{ context_id: string }> }
    const ctx = recentBody.entries[0]!.context_id
    const r = await fetch(`${server.url}/v1/by-context/${ctx}`)
    expect(r.status).toBe(200)
    const body = (await r.json()) as {
      context_id: string
      count: number
      entries: Array<{ index: number; context_id: string }>
    }
    expect(body.context_id).toBe(ctx)
    expect(body.count).toBeGreaterThanOrEqual(1)
    for (const e of body.entries) expect(e.context_id).toBe(ctx)
    for (let i = 1; i < body.entries.length; i++) {
      expect(body.entries[i - 1]!.index).toBeGreaterThan(body.entries[i]!.index)
    }
  })

  it('returns 404 for unknown context_id', async () => {
    const r = await fetch(`${server.url}/v1/by-context/${'0'.repeat(32)}`)
    expect(r.status).toBe(404)
  })
})

// D054: explorer served inline at /dashboard
describe('GET /dashboard', () => {
  it('serves text/html with the explorer HTML', async () => {
    const res = await fetch(`${server.url}/dashboard`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    const body = await res.text()
    expect(body).toMatch(/<!doctype html>/i)
    expect(body).toMatch(/atrib/i)
  })

  it('serves dashboard HEAD requests with the same headers and no body', async () => {
    const res = await fetch(`${server.url}/dashboard`, { method: 'HEAD' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(Number(res.headers.get('content-length'))).toBeGreaterThan(0)
    expect(await res.text()).toBe('')
  })

  it('aliases /dashboard.html and /dashboard/', async () => {
    const a = await fetch(`${server.url}/dashboard.html`)
    const b = await fetch(`${server.url}/dashboard/`)
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
  })

  it('serves /graph-utils.mjs (sibling ES module imported by index.html)', async () => {
    // The dashboard's <script type="module"> imports pure helpers from
    // ./graph-utils.mjs. log-node serves the file with the spec-correct
    // text/javascript content-type so the browser parses it as ESM.
    const res = await fetch(`${server.url}/graph-utils.mjs`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/javascript')
    const body = await res.text()
    expect(body).toMatch(/export\s+(const|function)/)
    expect(body).toMatch(/SIGMA_FRAMED_DEFAULT_CAMERA/)
    expect(body).toMatch(/selectLayout/)
  })

  it('serves dashboard brand assets from /static', async () => {
    const favicon = await fetch(`${server.url}/favicon.ico`)
    expect(favicon.status).toBe(200)
    expect(favicon.headers.get('content-type')).toContain('image/x-icon')
    expect(favicon.headers.get('cache-control')).toBe('public, max-age=60')

    const versionedFavicon = await fetch(`${server.url}/favicon.ico?v=0ee8876`)
    expect(versionedFavicon.status).toBe(200)
    expect(versionedFavicon.headers.get('content-type')).toContain('image/x-icon')
    expect(versionedFavicon.headers.get('cache-control')).toBe('public, max-age=60')

    const staticFavicon = await fetch(`${server.url}/static/favicon.ico`)
    expect(staticFavicon.status).toBe(200)
    expect(staticFavicon.headers.get('content-type')).toContain('image/x-icon')
    expect(staticFavicon.headers.get('cache-control')).toBe('public, max-age=86400, immutable')

    const icon = await fetch(`${server.url}/static/apple-touch-icon.png`)
    expect(icon.status).toBe(200)
    expect(icon.headers.get('content-type')).toContain('image/png')

    const socialCard = await fetch(`${server.url}/static/opengraph-image.png`)
    expect(socialCard.status).toBe(200)
    expect(socialCard.headers.get('content-type')).toContain('image/png')
  })

  it('serves static asset HEAD requests with the same headers and no body', async () => {
    const res = await fetch(`${server.url}/static/opengraph-image.png`, { method: 'HEAD' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('image/png')
    expect(res.headers.get('cache-control')).toBe('public, max-age=86400, immutable')
    expect(Number(res.headers.get('content-length'))).toBeGreaterThan(0)
    expect(await res.text()).toBe('')
  })

  it('serves the YC demo page and trace bundle from the dashboard root', async () => {
    const html = await fetch(`${server.url}/yc-demo`)
    expect(html.status).toBe(200)
    expect(html.headers.get('content-type')).toContain('text/html')
    const body = await html.text()
    expect(body).toMatch(/demo: signed context changes action/)
    expect(body).toMatch(/yc-demo-trace-bundle\.json/)
    expect(body).toMatch(/<a class="brand" href="\/" aria-label="atrib explorer home">/)

    const legacyHtml = await fetch(`${server.url}/yc-demo.html`)
    expect(legacyHtml.status).toBe(200)
    expect(legacyHtml.headers.get('content-type')).toContain('text/html')

    const bundle = await fetch(`${server.url}/yc-demo-trace-bundle.json`)
    expect(bundle.status).toBe(200)
    expect(bundle.headers.get('content-type')).toContain('application/json')
    const json = (await bundle.json()) as { schema: string; records: unknown[] }
    expect(json.schema).toBe('atrib-yc-living-graph-trace-bundle-v1')
    expect(json.records.length).toBeGreaterThan(0)
  })

  it('serves the YC demo HEAD routes with the same headers and no body', async () => {
    const html = await fetch(`${server.url}/yc-demo`, { method: 'HEAD' })
    expect(html.status).toBe(200)
    expect(html.headers.get('content-type')).toContain('text/html')
    expect(Number(html.headers.get('content-length'))).toBeGreaterThan(0)
    expect(await html.text()).toBe('')

    const bundle = await fetch(`${server.url}/yc-demo-trace-bundle.json`, { method: 'HEAD' })
    expect(bundle.status).toBe(200)
    expect(bundle.headers.get('content-type')).toContain('application/json')
    expect(Number(bundle.headers.get('content-length'))).toBeGreaterThan(0)
    expect(await bundle.text()).toBe('')
  })

  it('returns 404 for an unknown sibling .mjs', async () => {
    const res = await fetch(`${server.url}/does-not-exist.mjs`)
    expect(res.status).toBe(404)
  })

  it('rejects path traversal via /<name>.mjs (regex restricts to root-level filenames)', async () => {
    // Regex is ^/[A-Za-z0-9_-]+\.mjs$, so slashes/dots in the name
    // don't match, these requests fall through to the default 404.
    // Test with a percent-encoded slash to be thorough.
    const a = await fetch(`${server.url}/%2E%2E%2Fpackage.mjs`)
    expect(a.status).toBe(404)
  })

  it('serves dashboard at root when Host=explore.atrib.dev (D054)', async () => {
    // Node fetch silently drops the Host header; use node:http to set it.
    const u = new URL(server.url)
    const got = await new Promise<{ status: number; ct: string; body: string }>(
      (resolve, reject) => {
        const req = httpRequest(
          {
            method: 'GET',
            hostname: u.hostname,
            port: u.port,
            path: '/',
            headers: { host: 'explore.atrib.dev' },
          },
          (res: IncomingMessage) => {
            const chunks: Buffer[] = []
            res.on('data', (c: Buffer) => chunks.push(c))
            res.on('end', () =>
              resolve({
                status: res.statusCode ?? 0,
                ct: res.headers['content-type'] ?? '',
                body: Buffer.concat(chunks).toString('utf-8'),
              }),
            )
          },
        )
        req.on('error', reject)
        req.end()
      },
    )
    expect(got.status).toBe(200)
    expect(got.ct).toContain('text/html')
    expect(got.body).toMatch(/<!doctype html>/i)
  })

  it('serves dashboard path routes when Host=explore.atrib.dev', async () => {
    const u = new URL(server.url)
    for (const path of [
      '/overview',
      '/demo',
      '/anchoring',
      '/about',
      '/session/0123456789abcdef0123456789abcdef',
    ]) {
      const got = await new Promise<{ status: number; ct: string; body: string }>(
        (resolve, reject) => {
          const req = httpRequest(
            {
              method: 'GET',
              hostname: u.hostname,
              port: u.port,
              path,
              headers: { host: 'explore.atrib.dev' },
            },
            (res: IncomingMessage) => {
              const chunks: Buffer[] = []
              res.on('data', (c: Buffer) => chunks.push(c))
              res.on('end', () =>
                resolve({
                  status: res.statusCode ?? 0,
                  ct: res.headers['content-type'] ?? '',
                  body: Buffer.concat(chunks).toString('utf-8'),
                }),
              )
            },
          )
          req.on('error', reject)
          req.end()
        },
      )
      expect(got.status).toBe(200)
      expect(got.ct).toContain('text/html')
      expect(got.body).toMatch(/<!doctype html>/i)
    }
  })

  it('serves explorer path HEAD routes when Host=explore.atrib.dev', async () => {
    const u = new URL(server.url)
    for (const path of ['/demo', '/yc-demo', '/session/0123456789abcdef0123456789abcdef']) {
      const got = await new Promise<{ status: number; ct: string; len: string; body: string }>(
        (resolve, reject) => {
          const req = httpRequest(
            {
              method: 'HEAD',
              hostname: u.hostname,
              port: u.port,
              path,
              headers: { host: 'explore.atrib.dev' },
            },
            (res: IncomingMessage) => {
              const chunks: Buffer[] = []
              res.on('data', (c: Buffer) => chunks.push(c))
              res.on('end', () =>
                resolve({
                  status: res.statusCode ?? 0,
                  ct: res.headers['content-type'] ?? '',
                  len: res.headers['content-length'] ?? '',
                  body: Buffer.concat(chunks).toString('utf-8'),
                }),
              )
            },
          )
          req.on('error', reject)
          req.end()
        },
      )
      expect(got.status).toBe(200)
      expect(got.ct).toContain('text/html')
      expect(Number(got.len)).toBeGreaterThan(0)
      expect(got.body).toBe('')
    }
  })

  it('returns service-info JSON (not the dashboard) at root when Host=log.atrib.dev', async () => {
    // Pre-2026-05-06: bare / on Host=log.atrib.dev returned 404, intentionally,
    // so the dashboard would never accidentally render on the API hostname.
    // Post-fix: bare / on Host=log.atrib.dev returns the service-info index
    // (matches GitHub api.github.com / Stripe api.stripe.com discovery
    // pattern). The "no dashboard on API hostname" invariant is preserved
    // by content-type assertion below, dashboard would be text/html, the
    // service-info is application/json.
    const u = new URL(server.url)
    const got = await new Promise<{ status: number; ct: string; body: string }>(
      (resolve, reject) => {
        const req = httpRequest(
          {
            method: 'GET',
            hostname: u.hostname,
            port: u.port,
            path: '/',
            headers: { host: 'log.atrib.dev' },
          },
          (res: IncomingMessage) => {
            const chunks: Buffer[] = []
            res.on('data', (c: Buffer) => chunks.push(c))
            res.on('end', () =>
              resolve({
                status: res.statusCode ?? 0,
                ct: String(res.headers['content-type'] ?? ''),
                body: Buffer.concat(chunks).toString('utf-8'),
              }),
            )
          },
        )
        req.on('error', reject)
        req.end()
      },
    )
    expect(got.status).toBe(200)
    expect(got.ct).toContain('application/json')
    expect(got.body).not.toMatch(/<!doctype html>/i)
    const body = JSON.parse(got.body)
    expect(body.service).toBe('atrib-log-node')
    expect(body.current_version).toBe('v1')
  })
})
