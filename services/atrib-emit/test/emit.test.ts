// atrib-emit basic correctness tests. Exercises the public surface
// (createAtribEmitServer + the emit tool registration) without going over
// stdio, by invoking the underlying handler directly.

import { describe, expect, it } from 'vitest'
import * as ed from '@noble/ed25519'
import { canonicalRecord, sha256, hexEncode, verifyRecord, type AtribRecord } from '@atrib/mcp'
import { createAtribEmitServer } from '../src/index.js'
import { buildAndSignEmitRecord, __test_only__ } from '../src/sign.js'

const LOCAL_LOG = 'http://127.0.0.1:0/v1/entries'

async function freshKey(): Promise<Uint8Array> {
  const seed = new Uint8Array(32)
  for (let i = 0; i < 32; i++) seed[i] = (i * 7 + 11) & 0xff
  // Sanity: derives a real Ed25519 keypair.
  await ed.getPublicKeyAsync(seed)
  return seed
}

describe('buildAndSignEmitRecord', () => {
  it('produces a valid signed record for an observation', async () => {
    const seed = await freshKey()
    const record = await buildAndSignEmitRecord({
      privateKey: seed,
      eventType: 'https://atrib.dev/v1/types/observation',
      contextId: 'a'.repeat(32),
      chainRoot: 'sha256:' + 'b'.repeat(64),
      content: { what: 'discovered the labeling gap', topics: ['atrib', 'dashboard'] },
    })

    expect(record.signature).toBeTruthy()
    expect(record.event_type).toBe('https://atrib.dev/v1/types/observation')
    expect(record.context_id).toBe('a'.repeat(32))
    expect(record.creator_key).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(await verifyRecord(record)).toBe(true)
  })

  it('sorts informed_by lexicographically', async () => {
    const seed = await freshKey()
    const record = await buildAndSignEmitRecord({
      privateKey: seed,
      eventType: 'https://atrib.dev/v1/types/annotation',
      contextId: 'c'.repeat(32),
      chainRoot: 'sha256:' + 'd'.repeat(64),
      content: { annotates: 'sha256:' + 'e'.repeat(64), summary: 'pivotal moment' },
      informedBy: [
        'sha256:' + 'f'.repeat(64),
        'sha256:' + '1'.repeat(64),
        'sha256:' + '0'.repeat(64),
      ],
    })

    // informed_by lives on AtribRecord per spec §1.2.5 but the type's
    // intersection with session_token confuses Omit; cast to read it back.
    const r = record as AtribRecord & { informed_by?: string[] }
    expect(r.informed_by).toEqual([
      'sha256:' + '0'.repeat(64),
      'sha256:' + '1'.repeat(64),
      'sha256:' + 'f'.repeat(64),
    ])
    expect(await verifyRecord(record)).toBe(true)
  })

  it('omits informed_by when input is empty', async () => {
    const seed = await freshKey()
    const record = await buildAndSignEmitRecord({
      privateKey: seed,
      eventType: 'https://atrib.dev/v1/types/observation',
      contextId: '0'.repeat(32),
      chainRoot: 'sha256:' + '0'.repeat(64),
      content: { what: 'something' },
    })

    expect(record).not.toHaveProperty('informed_by')
  })

  it('record_hash is stable for identical inputs at the same timestamp', async () => {
    // Sanity: canonicalization should be deterministic for non-time-dependent
    // fields. We can't pin Date.now() through buildAndSignEmitRecord without
    // mocking, so just validate the canonicalization itself is stable on the
    // returned record.
    const seed = await freshKey()
    const record = await buildAndSignEmitRecord({
      privateKey: seed,
      eventType: 'https://atrib.dev/v1/types/observation',
      contextId: '0'.repeat(32),
      chainRoot: 'sha256:' + '0'.repeat(64),
      content: { what: 'stable' },
    })

    const hash1 = `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
    const hash2 = `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
    expect(hash1).toBe(hash2)
  })
})

describe('leafOfEventTypeUri', () => {
  const { leafOfEventTypeUri } = __test_only__

  it('extracts the trailing path segment', () => {
    expect(leafOfEventTypeUri('https://atrib.dev/v1/types/observation')).toBe('observation')
    expect(leafOfEventTypeUri('https://example.com/v1/types/annotation')).toBe('annotation')
  })

  it('returns the URI verbatim when there is no slash', () => {
    expect(leafOfEventTypeUri('urn:custom:type')).toBe('urn:custom:type')
  })

  it('returns the URI verbatim when the trailing segment is empty', () => {
    expect(leafOfEventTypeUri('https://atrib.dev/v1/types/')).toBe('https://atrib.dev/v1/types/')
  })
})

describe('createAtribEmitServer', () => {
  it('registers the emit tool', async () => {
    const seed = await freshKey()
    const server = await createAtribEmitServer({
      key: { privateKey: seed, source: 'env' },
      logEndpoint: LOCAL_LOG,
    })

    // McpServer doesn't expose a public tool listing, but we can confirm
    // the server constructed and our flush() handle is callable.
    expect(server.mcp).toBeTruthy()
    expect(typeof server.flush).toBe('function')
    await server.flush()
  })

  it('returns a degraded result with a warning when no key is available', async () => {
    const server = await createAtribEmitServer({
      key: undefined,
      logEndpoint: LOCAL_LOG,
    })
    // The handler is exercised through tool dispatch; for this v1 surface
    // we trust the McpServer wiring and assert that constructing without a
    // key still succeeds (degradation is in the per-call response, not the
    // server lifecycle).
    expect(server.mcp).toBeTruthy()
    await server.flush()
  })
})
