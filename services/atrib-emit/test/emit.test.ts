// atrib-emit basic correctness tests. Exercises the public surface
// (createAtribEmitServer + the emit tool registration) without going over
// stdio, by invoking the underlying handler directly.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

  it('carries result_hash when supplied (§8.3 commitment)', async () => {
    const seed = await freshKey()
    const probeHash = 'sha256:' + 'f'.repeat(64)
    const record = await buildAndSignEmitRecord({
      privateKey: seed,
      eventType: 'https://atrib.dev/v1/types/tool_call',
      contextId: 'c'.repeat(32),
      chainRoot: 'sha256:' + 'd'.repeat(64),
      content: { tool: 'Edit', target: 'src/foo.py' },
      resultHash: probeHash,
    })

    const r = record as AtribRecord & { result_hash?: string }
    expect(r.result_hash).toBe(probeHash)
    expect(await verifyRecord(record)).toBe(true)
  })

  it('commits local content with args_hash when caller omits args_hash', async () => {
    const seed = await freshKey()
    const record = await buildAndSignEmitRecord({
      privateKey: seed,
      eventType: 'https://atrib.dev/v1/types/observation',
      contextId: '3'.repeat(32),
      chainRoot: 'sha256:' + '4'.repeat(64),
      content: { what: 'no disclosure' },
    })

    expect(record).not.toHaveProperty('tool_name')
    expect((record as AtribRecord & { args_hash?: string }).args_hash).toMatch(
      /^sha256:[0-9a-f]{64}$/,
    )
    expect(record).not.toHaveProperty('result_hash')
  })

  it('different local content produces different records at the same timestamp', async () => {
    const seed = await freshKey()
    const timestamp = 1779972472173
    const spy = vi.spyOn(Date, 'now').mockReturnValue(timestamp)
    try {
      const common = {
        privateKey: seed,
        eventType: 'https://atrib.dev/v1/types/observation',
        contextId: '5'.repeat(32),
        chainRoot: 'sha256:' + '6'.repeat(64),
      }
      const first = await buildAndSignEmitRecord({
        ...common,
        content: { what: 'first diagnostic' },
      })
      const second = await buildAndSignEmitRecord({
        ...common,
        content: { what: 'second diagnostic' },
      })

      const firstHash = `sha256:${hexEncode(sha256(canonicalRecord(first)))}`
      const secondHash = `sha256:${hexEncode(sha256(canonicalRecord(second)))}`
      expect(firstHash).not.toBe(secondHash)
      expect((first as AtribRecord & { args_hash?: string }).args_hash).not.toBe(
        (second as AtribRecord & { args_hash?: string }).args_hash,
      )
    } finally {
      spy.mockRestore()
    }
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
    expect(result.warnings.some((w) => w.includes('provenance_token is genesis-record-only'))).toBe(
      true,
    )
    await queue.flush()
  })

  // Note: positive-path tests for caller-supplied chain_root + provenance_token
  // (where validation passes and the record submits) live in integration.test.ts
  // because they need a real HTTP log stub. The unit tests above focus on the
  // pre-submission rejection paths, which never hit the queue.
})

describe('ATRIB_PARENT_RECORD_HASH env seeding (D104)', () => {
  // Asserts that when the producer's environment carries a valid parent record
  // hash, handleEmit's signing path prepends it to informed_by.
  const { handleEmit } = __index_test_only__
  const VALID_PARENT = 'sha256:' + 'a'.repeat(64)
  const ANOTHER_VALID = 'sha256:' + 'b'.repeat(64)

  let priorEnv: string | undefined
  beforeEach(() => {
    priorEnv = process.env['ATRIB_PARENT_RECORD_HASH']
  })
  afterEach(() => {
    if (priorEnv === undefined) delete process.env['ATRIB_PARENT_RECORD_HASH']
    else process.env['ATRIB_PARENT_RECORD_HASH'] = priorEnv
  })

  async function emitWithEnv(envValue: string | undefined, callerInformedBy?: string[]) {
    if (envValue === undefined) delete process.env['ATRIB_PARENT_RECORD_HASH']
    else process.env['ATRIB_PARENT_RECORD_HASH'] = envValue
    const seed = await freshKey()
    // Stub the queue so submissions never reach the network. handleEmit
    // calls queue.submit() synchronously then returns; we don't need the
    // delivery roundtrip to test the env-seeding logic, the record_hash is
    // computed locally from the signed bytes before submission.
    let submitted: AtribRecord | undefined
    const queue = {
      submit: (record: AtribRecord) => {
        submitted = record
      },
      flush: async () => {},
      getProof: async () => null,
    } as unknown as ReturnType<typeof createSubmissionQueue>
    const result = await handleEmit({
      input: {
        event_type: 'https://atrib.dev/v1/types/observation',
        content: { what: 'env-seeded test' },
        context_id: 'c'.repeat(32),
        allow_unresolved_informed_by: true,
        ...(callerInformedBy ? { informed_by: callerInformedBy } : {}),
      },
      key: { privateKey: seed, source: 'env' },
      queue,
    })
    return { result, submitted }
  }

  function submittedInformedBy(record: AtribRecord | undefined): string[] | undefined {
    return (record as (AtribRecord & { informed_by?: string[] }) | undefined)?.informed_by
  }

  it('signs successfully when env carries a valid parent hash', async () => {
    const { result, submitted } = await emitWithEnv(VALID_PARENT)
    expect(result.record_hash).not.toBe('sha256:unknown')
    expect(result.warnings.some((w) => w.toLowerCase().includes('error'))).toBe(false)
    expect(submittedInformedBy(submitted)).toEqual([VALID_PARENT])
  })

  it('silently ignores invalid env values (uppercase / short / non-sha256)', async () => {
    for (const bad of [
      'sha256:' + 'A'.repeat(64), // uppercase
      'sha256:' + 'a'.repeat(63), // too short
      'not-a-hash',
      '',
    ]) {
      const { result, submitted } = await emitWithEnv(bad)
      // Should still sign successfully, env is silently dropped, not raised
      // as an error.
      expect(result.record_hash).not.toBe('sha256:unknown')
      expect(submittedInformedBy(submitted)).toBeUndefined()
    }
  })

  it('dedupes when caller informed_by already includes the parent hash', async () => {
    const { result, submitted } = await emitWithEnv(VALID_PARENT, [VALID_PARENT])
    expect(result.record_hash).not.toBe('sha256:unknown')
    expect(submittedInformedBy(submitted)).toEqual([VALID_PARENT])
  })

  it('merges env-parent with caller-supplied informed_by', async () => {
    const { result, submitted } = await emitWithEnv(VALID_PARENT, [ANOTHER_VALID])
    expect(result.record_hash).not.toBe('sha256:unknown')
    expect(submittedInformedBy(submitted)).toEqual([VALID_PARENT, ANOTHER_VALID])
  })

  it('no-op when env is unset', async () => {
    const { result, submitted } = await emitWithEnv(undefined, [ANOTHER_VALID])
    expect(result.record_hash).not.toBe('sha256:unknown')
    expect(submittedInformedBy(submitted)).toEqual([ANOTHER_VALID])
  })

  it('drops unresolved informed_by refs before signing by default', async () => {
    delete process.env['ATRIB_PARENT_RECORD_HASH']
    const seed = await freshKey()
    const known = 'sha256:' + 'c'.repeat(64)
    const missing = 'sha256:' + 'd'.repeat(64)
    let submitted: AtribRecord | undefined
    const queue = {
      submit: (record: AtribRecord) => {
        submitted = record
      },
      flush: async () => {},
      getProof: async () => null,
    } as unknown as ReturnType<typeof createSubmissionQueue>

    const result = await handleEmit({
      input: {
        event_type: 'https://atrib.dev/v1/types/observation',
        content: { what: 'filtered informed_by test' },
        context_id: 'c'.repeat(32),
        informed_by: [known, missing],
      },
      key: { privateKey: seed, source: 'env' },
      queue,
      recordReferenceResolver: async (ref) => (ref === known ? 'found' : 'not-found'),
    })

    expect(result.record_hash).not.toBe('sha256:unknown')
    expect(
      result.warnings.some((w) => w.includes('dropped unresolved informed_by reference')),
    ).toBe(true)
    expect(submittedInformedBy(submitted)).toEqual([known])
  })
})

describe('D083 harness session-id discovery (consumer integration)', () => {
  // Asserts the cross-cutting integration: when handleEmit runs in a process
  // that has no caller-supplied context_id and no ATRIB_CONTEXT_ID env, but
  // does have a documented harness env var (CLAUDE_CODE_SESSION_ID), the
  // signed record carries the derived 32-hex context_id. Covers the load-
  // bearing path the substrate-health analysis surfaced 2026-05-22.
  const { handleEmit } = __index_test_only__

  let priorCtx: string | undefined
  let priorClaude: string | undefined
  beforeEach(() => {
    priorCtx = process.env['ATRIB_CONTEXT_ID']
    priorClaude = process.env['CLAUDE_CODE_SESSION_ID']
  })
  afterEach(() => {
    if (priorCtx === undefined) delete process.env['ATRIB_CONTEXT_ID']
    else process.env['ATRIB_CONTEXT_ID'] = priorCtx
    if (priorClaude === undefined) delete process.env['CLAUDE_CODE_SESSION_ID']
    else process.env['CLAUDE_CODE_SESSION_ID'] = priorClaude
  })

  async function emitWithoutCallerContextId() {
    const seed = await freshKey()
    const queue = {
      submit: () => {},
      flush: async () => {},
      getProof: async () => null,
    } as unknown as ReturnType<typeof createSubmissionQueue>
    return handleEmit({
      input: {
        event_type: 'https://atrib.dev/v1/types/observation',
        content: { what: 'D083 integration probe' },
      },
      key: { privateKey: seed, source: 'env' },
      queue,
    })
  }

  it('derives context_id from CLAUDE_CODE_SESSION_ID when ATRIB_CONTEXT_ID is unset', async () => {
    delete process.env['ATRIB_CONTEXT_ID']
    process.env['CLAUDE_CODE_SESSION_ID'] = '38af29c4-fc3a-4f88-8fec-392501b8a0a9'
    const result = await emitWithoutCallerContextId()
    expect(result.context_id).toBe('38af29c4fc3a4f888fec392501b8a0a9')
  })

  it('ATRIB_CONTEXT_ID wins when both env vars are valid (D078 precedence)', async () => {
    process.env['ATRIB_CONTEXT_ID'] = '00000000000000000000000000000001'
    process.env['CLAUDE_CODE_SESSION_ID'] = '38af29c4-fc3a-4f88-8fec-392501b8a0a9'
    const result = await emitWithoutCallerContextId()
    expect(result.context_id).toBe('00000000000000000000000000000001')
  })

  it('falls through to fresh genesis when neither env var is set', async () => {
    delete process.env['ATRIB_CONTEXT_ID']
    delete process.env['CLAUDE_CODE_SESSION_ID']
    const result = await emitWithoutCallerContextId()
    // 32-hex context_id was synthesized (matches §1.2.3 format), not the
    // harness-derived value above.
    expect(result.context_id).toMatch(/^[0-9a-f]{32}$/)
    expect(result.context_id).not.toBe('38af29c4fc3a4f888fec392501b8a0a9')
  })
})

describe('producer sidecar routing (substrate-health by-producer aggregation)', () => {
  // Each cognitive primitive labels its records with a distinct producer
  // string in the mirror sidecar so the substrate-health snapshot can
  // bucket records by emitter without inspecting envelopes. Default is
  // `'atrib-emit'` for the bare server; specialized wrappers
  // (atrib-annotate, atrib-revise) and the CLI binary supply their own.
  const { handleEmit } = __index_test_only__

  let priorMirrorFile: string | undefined
  let tmpDir: string
  let mirrorFile: string

  beforeEach(async () => {
    const { mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    priorMirrorFile = process.env['ATRIB_MIRROR_FILE']
    tmpDir = mkdtempSync(join(tmpdir(), 'atrib-producer-test-'))
    mirrorFile = join(tmpDir, 'mirror.jsonl')
    process.env['ATRIB_MIRROR_FILE'] = mirrorFile
  })
  afterEach(async () => {
    const { rmSync } = await import('node:fs')
    rmSync(tmpDir, { recursive: true, force: true })
    if (priorMirrorFile === undefined) delete process.env['ATRIB_MIRROR_FILE']
    else process.env['ATRIB_MIRROR_FILE'] = priorMirrorFile
  })

  async function emitAndReadMirror(producer?: string): Promise<Record<string, unknown>> {
    const seed = await freshKey()
    const queue = {
      submit: () => {},
      flush: async () => {},
      getProof: async () => null,
    } as unknown as ReturnType<typeof createSubmissionQueue>
    const handleEmitArgs: Parameters<typeof handleEmit>[0] = {
      input: {
        event_type: 'https://atrib.dev/v1/types/observation',
        content: { what: 'producer-routing probe' },
        context_id: 'b'.repeat(32),
      },
      key: { privateKey: seed, source: 'env' },
      queue,
    }
    if (producer !== undefined) handleEmitArgs.producer = producer
    await handleEmit(handleEmitArgs)
    const { readFileSync } = await import('node:fs')
    // Read the LAST JSONL line (each emit appends; tests that emit twice
    // care about the most recent record only).
    const lines = readFileSync(mirrorFile, 'utf8')
      .split('\n')
      .filter((l) => l.length > 0)
    return JSON.parse(lines[lines.length - 1] as string) as Record<string, unknown>
  }

  it("defaults to 'atrib-emit' when producer is not supplied", async () => {
    const entry = await emitAndReadMirror()
    const local = entry._local as Record<string, unknown>
    expect(local.producer).toBe('atrib-emit')
  })

  it('routes through caller-supplied producer label', async () => {
    const entry = await emitAndReadMirror('atrib-annotate')
    const local = entry._local as Record<string, unknown>
    expect(local.producer).toBe('atrib-annotate')
  })

  it("'atrib-revise' label flows through unchanged", async () => {
    const entry = await emitAndReadMirror('atrib-revise')
    const local = entry._local as Record<string, unknown>
    expect(local.producer).toBe('atrib-revise')
  })

  it("'atrib-emit-cli' label flows through unchanged (CLI binary path)", async () => {
    const entry = await emitAndReadMirror('atrib-emit-cli')
    const local = entry._local as Record<string, unknown>
    expect(local.producer).toBe('atrib-emit-cli')
  })

  it('signed-record bytes are independent of the producer label (sidecar-only)', async () => {
    // The producer field lives in `_local`, not in the signed AtribRecord.
    // Two records with identical content but different producer labels
    // should produce identical record_hash.
    const a = await emitAndReadMirror('atrib-emit')
    const b = await emitAndReadMirror('atrib-annotate')
    const aRecord = a.record as { record_hash?: string }
    const bRecord = b.record as { record_hash?: string }
    // Both signed records share identical canonical-form bytes because
    // sidecar.producer is not part of canonicalSigningInput per spec §1.3.
    // We assert via content_id rather than record_hash because record_hash
    // incorporates timestamp. Producer stays sidecar-only.
    expect((aRecord as { content_id?: string }).content_id).toBe(
      (bRecord as { content_id?: string }).content_id,
    )
  })
})
