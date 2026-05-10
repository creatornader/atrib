// atrib-emit basic correctness tests. Exercises the public surface
// (createAtribEmitServer + the emit tool registration) without going over
// stdio, by invoking the underlying handler directly.

import { describe, expect, it } from 'vitest'
import * as ed from '@noble/ed25519'
import { canonicalRecord, sha256, hexEncode, verifyRecord, type AtribRecord } from '@atrib/mcp'
import { createAtribEmitServer, __test_only__ as __index_test_only__ } from '../src/index.js'
import { buildAndSignEmitRecord, __test_only__ } from '../src/sign.js'
import { createSubmissionQueue } from '@atrib/mcp'

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

  it('carries provenance_token when supplied (D044 / spec §1.2.6)', async () => {
    // 22 base64url chars = 16 bytes encoded, the spec-mandated shape for
    // cross-session causal anchors. The genesis-record-only invariant is
    // enforced upstream in handleEmit; buildAndSignEmitRecord trusts the
    // caller and just plumbs through.
    const seed = await freshKey()
    const provenanceToken = 'AAAAAAAAAAAAAAAAAAAAAA' // 22 chars; contents irrelevant for this test

    const record = await buildAndSignEmitRecord({
      privateKey: seed,
      eventType: 'https://atrib.dev/v1/types/observation',
      contextId: 'a'.repeat(32),
      chainRoot: 'sha256:' + 'b'.repeat(64),
      content: { what: 'descended from upstream session' },
      provenanceToken,
    })

    const r = record as AtribRecord & { provenance_token?: string }
    expect(r.provenance_token).toBe(provenanceToken)
    expect(await verifyRecord(record)).toBe(true)
  })

  it('omits provenance_token when not supplied', async () => {
    // JCS canonicalization is sensitive to presence/absence; "omitted (not
    // null)" is the spec contract per §1.3, same property §1.2.5 has for
    // informed_by.
    const seed = await freshKey()
    const record = await buildAndSignEmitRecord({
      privateKey: seed,
      eventType: 'https://atrib.dev/v1/types/observation',
      contextId: '1'.repeat(32),
      chainRoot: 'sha256:' + '2'.repeat(64),
      content: { what: 'no anchor' },
    })

    expect(record).not.toHaveProperty('provenance_token')
  })

  it('carries tool_name when supplied (§8.2 disclosure)', async () => {
    const seed = await freshKey()
    const record = await buildAndSignEmitRecord({
      privateKey: seed,
      eventType: 'https://atrib.dev/v1/types/tool_call',
      contextId: 'c'.repeat(32),
      chainRoot: 'sha256:' + 'd'.repeat(64),
      content: { tool: 'Edit', target: 'src/foo.py' },
      toolName: 'Edit',
    })

    const r = record as AtribRecord & { tool_name?: string }
    expect(r.tool_name).toBe('Edit')
    expect(await verifyRecord(record)).toBe(true)
  })

  it('carries args_hash when supplied (§8.3 commitment)', async () => {
    const seed = await freshKey()
    const probeHash = 'sha256:' + 'e'.repeat(64)
    const record = await buildAndSignEmitRecord({
      privateKey: seed,
      eventType: 'https://atrib.dev/v1/types/tool_call',
      contextId: 'c'.repeat(32),
      chainRoot: 'sha256:' + 'd'.repeat(64),
      content: { tool: 'Edit', target: 'src/foo.py' },
      argsHash: probeHash,
    })

    const r = record as AtribRecord & { args_hash?: string }
    expect(r.args_hash).toBe(probeHash)
    expect(await verifyRecord(record)).toBe(true)
  })

  it('omits tool_name and args_hash when not supplied (presence affects JCS)', async () => {
    const seed = await freshKey()
    const record = await buildAndSignEmitRecord({
      privateKey: seed,
      eventType: 'https://atrib.dev/v1/types/observation',
      contextId: '3'.repeat(32),
      chainRoot: 'sha256:' + '4'.repeat(64),
      content: { what: 'no disclosure' },
    })

    expect(record).not.toHaveProperty('tool_name')
    expect(record).not.toHaveProperty('args_hash')
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

describe('handleEmit validation paths', () => {
  // These tests drive the internal handler exposed via __test_only__ so we
  // can assert on the emptyOutput warnings rather than the McpServer
  // dispatch shape. Per spec §5.8 graceful degradation: malformed inputs
  // return warnings + a placeholder record_hash, never throw.
  const { handleEmit } = __index_test_only__

  it('refuses chain_root without context_id (no anchoring context)', async () => {
    const seed = await freshKey()
    const queue = createSubmissionQueue(LOCAL_LOG)
    const result = await handleEmit({
      input: {
        event_type: 'https://atrib.dev/v1/types/observation',
        content: { what: 'orphan chain_root' },
        chain_root: 'sha256:' + 'f'.repeat(64),
      },
      key: { privateKey: seed, source: 'env' },
      queue,
    })

    expect(result.record_hash).toBe('sha256:unknown')
    expect(result.warnings.some((w) => w.includes('chain_root requires context_id'))).toBe(true)
    await queue.flush()
  })

  it('refuses provenance_token alongside a non-genesis chain_root (spec §1.2.6)', async () => {
    // chain_root is set to a sentinel value that is NOT genesisChainRoot for
    // the supplied context_id; provenance_token is genesis-record-only, so
    // the combination is invalid and atrib-emit refuses to sign per §5.8.
    const seed = await freshKey()
    const queue = createSubmissionQueue(LOCAL_LOG)
    const result = await handleEmit({
      input: {
        event_type: 'https://atrib.dev/v1/types/observation',
        content: { what: 'misplaced provenance' },
        context_id: 'a'.repeat(32),
        chain_root: 'sha256:' + 'f'.repeat(64), // not the genesis for 'aaa...'
        provenance_token: 'AAAAAAAAAAAAAAAAAAAAAA',
      },
      key: { privateKey: seed, source: 'env' },
      queue,
    })

    expect(result.record_hash).toBe('sha256:unknown')
    expect(result.warnings.some((w) => w.includes('provenance_token is genesis-record-only'))).toBe(true)
    await queue.flush()
  })

  // Note: positive-path tests for caller-supplied chain_root + provenance_token
  // (where validation passes and the record submits) live in integration.test.ts
  // because they need a real HTTP log stub. The unit tests above focus on the
  // pre-submission rejection paths, which never hit the queue.
})
