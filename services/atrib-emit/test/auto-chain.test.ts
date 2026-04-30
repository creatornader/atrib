// autoChain inheritance tests. Cover all three resolution branches:
//   1. Caller-supplied context_id → genesis chain_root for that context_id
//   2. Wrapper mirror present → inherit most-recent record's context_id
//   3. No mirror → fresh genesis context_id
//
// All file I/O routed through ATRIB_MIRROR_FILE pointed at a tmp path so
// these tests never touch the real ~/.atrib/records/ directory (the test
// guard in setup.ts catches network leaks; this is the equivalent for fs).

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as ed from '@noble/ed25519'
import {
  base64urlEncode,
  canonicalRecord,
  genesisChainRoot,
  hexEncode,
  sha256,
  signRecord,
  type AtribRecord,
} from '@atrib/mcp'
import { resolveChainContext, __test_only__ } from '../src/auto-chain.js'

let tmpDir: string
let mirrorPath: string

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'atrib-emit-autochain-'))
  mirrorPath = join(tmpDir, 'mirror.jsonl')
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

const fixedRandom = () => 'a'.repeat(32)

describe('resolveChainContext', () => {
  it('honors caller-supplied context_id with a genesis chain_root', async () => {
    const ctx = await resolveChainContext({
      callerContextId: 'b'.repeat(32),
      mirrorPath,
      genesisChainRoot,
      randomContextId: fixedRandom,
    })

    expect(ctx.contextId).toBe('b'.repeat(32))
    expect(ctx.chainRoot).toBe(genesisChainRoot('b'.repeat(32)))
    expect(ctx.inheritedFrom).toBe('fresh')
  })

  it('falls back to fresh genesis when the mirror file does not exist', async () => {
    const ctx = await resolveChainContext({
      mirrorPath,
      genesisChainRoot,
      randomContextId: fixedRandom,
    })

    expect(ctx.contextId).toBe('a'.repeat(32))
    expect(ctx.chainRoot).toBe(genesisChainRoot('a'.repeat(32)))
    expect(ctx.inheritedFrom).toBe('fresh')
  })

  it('falls back to fresh genesis when the mirror is empty', async () => {
    await writeFile(mirrorPath, '')
    const ctx = await resolveChainContext({
      mirrorPath,
      genesisChainRoot,
      randomContextId: fixedRandom,
    })
    expect(ctx.inheritedFrom).toBe('fresh')
  })

  it('inherits context_id and chains on top of the most-recent mirror record', async () => {
    const seed = new Uint8Array(32).fill(7)
    const pubKey = base64urlEncode(await ed.getPublicKeyAsync(seed))
    const ctxIdInMirror = 'c'.repeat(32)

    // Build two real signed records and write them as JSONL. The chained
    // resolution should pick the SECOND one (last line wins).
    const r1: AtribRecord = await signRecord(
      {
        spec_version: 'atrib/1.0',
        content_id: 'sha256:' + '1'.repeat(64),
        creator_key: pubKey,
        chain_root: genesisChainRoot(ctxIdInMirror),
        event_type: 'https://atrib.dev/v1/types/tool_call',
        context_id: ctxIdInMirror,
        timestamp: 1000,
        signature: '',
      } as AtribRecord,
      seed,
    )
    const r1Hash = hexEncode(sha256(canonicalRecord(r1)))
    const r2: AtribRecord = await signRecord(
      {
        spec_version: 'atrib/1.0',
        content_id: 'sha256:' + '2'.repeat(64),
        creator_key: pubKey,
        chain_root: 'sha256:' + r1Hash,
        event_type: 'https://atrib.dev/v1/types/tool_call',
        context_id: ctxIdInMirror,
        timestamp: 2000,
        signature: '',
      } as AtribRecord,
      seed,
    )
    const r2Hash = hexEncode(sha256(canonicalRecord(r2)))

    await writeFile(mirrorPath, JSON.stringify(r1) + '\n' + JSON.stringify(r2) + '\n')

    const ctx = await resolveChainContext({
      mirrorPath,
      genesisChainRoot,
      randomContextId: fixedRandom,
    })

    expect(ctx.contextId).toBe(ctxIdInMirror)
    expect(ctx.chainRoot).toBe('sha256:' + r2Hash)
    expect(ctx.inheritedFrom).toBe('wrapper-mirror')
  })

  it('falls back to fresh genesis on malformed last line', async () => {
    await writeFile(mirrorPath, '{not valid json}\n')
    const ctx = await resolveChainContext({
      mirrorPath,
      genesisChainRoot,
      randomContextId: fixedRandom,
    })
    expect(ctx.inheritedFrom).toBe('fresh')
  })

  it('falls back to fresh genesis when the last line is missing required fields', async () => {
    await writeFile(mirrorPath, JSON.stringify({ context_id: 'x' }) + '\n')
    const ctx = await resolveChainContext({
      mirrorPath,
      genesisChainRoot,
      randomContextId: fixedRandom,
    })
    expect(ctx.inheritedFrom).toBe('fresh')
  })

  it('accepts the envelope shape that atrib-emit storage writes', async () => {
    const seed = new Uint8Array(32).fill(19)
    const pubKey = base64urlEncode(await ed.getPublicKeyAsync(seed))
    const ctxId = 'f'.repeat(32)
    const record: AtribRecord = await signRecord(
      {
        spec_version: 'atrib/1.0',
        content_id: 'sha256:' + '5'.repeat(64),
        creator_key: pubKey,
        chain_root: genesisChainRoot(ctxId),
        event_type: 'https://atrib.dev/v1/types/observation',
        context_id: ctxId,
        timestamp: 500,
        signature: '',
      } as AtribRecord,
      seed,
    )
    const envelope = { record, proof: null, written_at: Date.now() }
    await writeFile(mirrorPath, JSON.stringify(envelope) + '\n')

    const ctx = await resolveChainContext({
      mirrorPath,
      genesisChainRoot,
      randomContextId: fixedRandom,
    })
    expect(ctx.contextId).toBe(ctxId)
    expect(ctx.inheritedFrom).toBe('wrapper-mirror')
  })

  it('reads the LAST line, not the first, when multiple records exist', async () => {
    const seed = new Uint8Array(32).fill(13)
    const pubKey = base64urlEncode(await ed.getPublicKeyAsync(seed))

    const oldCtx = 'd'.repeat(32)
    const recentCtx = 'e'.repeat(32)
    const oldRecord: AtribRecord = await signRecord(
      {
        spec_version: 'atrib/1.0',
        content_id: 'sha256:' + '3'.repeat(64),
        creator_key: pubKey,
        chain_root: genesisChainRoot(oldCtx),
        event_type: 'https://atrib.dev/v1/types/tool_call',
        context_id: oldCtx,
        timestamp: 100,
        signature: '',
      } as AtribRecord,
      seed,
    )
    const recentRecord: AtribRecord = await signRecord(
      {
        spec_version: 'atrib/1.0',
        content_id: 'sha256:' + '4'.repeat(64),
        creator_key: pubKey,
        chain_root: genesisChainRoot(recentCtx),
        event_type: 'https://atrib.dev/v1/types/tool_call',
        context_id: recentCtx,
        timestamp: 200,
        signature: '',
      } as AtribRecord,
      seed,
    )

    await writeFile(
      mirrorPath,
      JSON.stringify(oldRecord) + '\n' + JSON.stringify(recentRecord) + '\n',
    )

    const ctx = await resolveChainContext({
      mirrorPath,
      genesisChainRoot,
      randomContextId: fixedRandom,
    })
    expect(ctx.contextId).toBe(recentCtx)
  })
})

describe('readMostRecentRecord', () => {
  it('returns null for missing files', async () => {
    expect(await __test_only__.readMostRecentRecord(join(tmpDir, 'nonexistent.jsonl'))).toBeNull()
  })

  it('exposes the wrapper default mirror path', () => {
    expect(__test_only__.DEFAULT_MIRROR).toContain('/.atrib/records/')
    expect(__test_only__.DEFAULT_MIRROR).toContain('wrapper-mirror.jsonl')
  })
})
