// SPDX-License-Identifier: Apache-2.0

/**
 * Co-producer chain coherence test.
 *
 * Exercises the multi-producer composition contract: when one producer
 * (mcp-wrap, simulated here by directly signing a record) and another
 * (atrib-emit) sign records under the same context_id, both records MUST
 * form one chain. The second producer's chain_root MUST resolve to the
 * first producer's record hash, NOT to genesisChainRoot(context_id).
 *
 * This is the regression-test surface for the drift class that landed
 * 2026-05-07: @atrib/mcp@0.5.0 added ATRIB_CHAIN_TAIL_<context_id> env-var
 * handoff to its middleware, but atrib-emit's own resolver in auto-chain.ts
 * never consulted it — so hook-spawned subprocesses kept signing as
 * isolated genesis records.
 *
 * Three propagation surfaces are exercised:
 *   1. ATRIB_CHAIN_TAIL_<context_id> env var (parent-set on subprocess spawn)
 *   2. ATRIB_AUTOCHAIN_SOURCE mirror file inheritance (file-as-IPC fallback)
 *   3. context_id-mismatch (mirror's last record on a different trace —
 *      MUST NOT inherit; would produce a malformed record)
 *
 * The conformance corpus at spec/conformance/1.2.3/multi-producer/ covers
 * the same cases as a producer-independent contract.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as ed from '@noble/ed25519'
import {
  base64urlEncode,
  canonicalRecord,
  createSubmissionQueue,
  genesisChainRoot,
  hexEncode,
  sha256,
  signRecord,
  type AtribRecord,
  type SubmissionQueue,
} from '@atrib/mcp'
import { __test_only__ } from '../src/index.js'
import type { ResolvedKey } from '../src/keys.js'

const { handleEmit } = __test_only__

/**
 * Read the most recent record written to the emit mirror. The mirror lives
 * at the path set in `ATRIB_MIRROR_FILE` and stores envelope-shaped lines
 * `{record, proof?, written_at?, _local?}` per the storage convention.
 */
async function readEmitMirrorTail(path: string): Promise<AtribRecord> {
  const contents = await readFile(path, 'utf-8')
  const lines = contents.trim().split('\n').filter((l) => l.length)
  if (lines.length === 0) throw new Error(`emit mirror empty at ${path}`)
  const last = lines[lines.length - 1]!
  const parsed = JSON.parse(last) as { record?: AtribRecord } | AtribRecord
  if ('record' in parsed && parsed.record) return parsed.record
  return parsed as AtribRecord
}

interface LogStub {
  server: Server
  url: string
  close: () => Promise<void>
}

async function startLogStub(): Promise<LogStub> {
  let nextLogIndex = 0
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'POST' && req.url === '/v1/entries') {
      let body = ''
      req.on('data', (chunk) => (body += chunk))
      req.on('end', () => {
        const logIndex = nextLogIndex++
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            log_index: logIndex,
            checkpoint: 'stub',
            inclusion_proof: [],
            leaf_hash: 'stub',
          }),
        )
      })
    } else {
      res.writeHead(404)
      res.end()
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  if (!addr || typeof addr === 'string') throw new Error('no address')
  const url = `http://127.0.0.1:${addr.port}/v1/entries`
  return {
    server,
    url,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  }
}

const WRAPPER_KEY = new Uint8Array(32).fill(13)
const EMIT_KEY = new Uint8Array(32).fill(13) // same identity, two producers
const WRAPPER_CTX = 'a'.repeat(32)

let tmpDir: string
let wrapperMirrorPath: string
let emitMirrorPath: string
let log: LogStub
let envSnapshot: Record<string, string | undefined>
let queue: SubmissionQueue
let key: ResolvedKey

async function makeWrapperRecord(contextId: string): Promise<AtribRecord> {
  const pubKey = await ed.getPublicKeyAsync(WRAPPER_KEY)
  const unsigned = {
    spec_version: 'atrib/1.0' as const,
    content_id: `sha256:${hexEncode(sha256(new TextEncoder().encode('wrapper-tool-call')))}`,
    creator_key: base64urlEncode(pubKey),
    chain_root: genesisChainRoot(contextId),
    event_type: 'https://atrib.dev/v1/types/tool_call' as const,
    context_id: contextId,
    timestamp: 1_700_000_000_000,
    signature: '',
  }
  return signRecord(unsigned as AtribRecord, WRAPPER_KEY)
}

async function writeMirrorLine(path: string, record: AtribRecord) {
  // Bare-record convention used by mcp-wrap (one record per line).
  await writeFile(path, JSON.stringify(record) + '\n')
}

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'atrib-coproducer-'))
  wrapperMirrorPath = join(tmpDir, 'wrapper-mirror.jsonl')
  emitMirrorPath = join(tmpDir, 'emit-mirror.jsonl')
  log = await startLogStub()
  envSnapshot = {
    ATRIB_AUTOCHAIN_SOURCE: process.env['ATRIB_AUTOCHAIN_SOURCE'],
    ATRIB_MIRROR_FILE: process.env['ATRIB_MIRROR_FILE'],
    [`ATRIB_CHAIN_TAIL_${WRAPPER_CTX}`]: process.env[`ATRIB_CHAIN_TAIL_${WRAPPER_CTX}`],
  }
  process.env['ATRIB_MIRROR_FILE'] = emitMirrorPath
  queue = createSubmissionQueue(log.url)
  key = {
    privateKey: EMIT_KEY,
    source: 'env',
  }
})

afterEach(async () => {
  await log.close()
  await rm(tmpDir, { recursive: true, force: true })
  for (const [k, v] of Object.entries(envSnapshot)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

describe('co-producer chain coherence', () => {
  it('emit chains to wrapper tail via ATRIB_CHAIN_TAIL_<context_id> env var', async () => {
    const wrapperRecord = await makeWrapperRecord(WRAPPER_CTX)
    const wrapperHashHex = hexEncode(sha256(canonicalRecord(wrapperRecord)))
    process.env[`ATRIB_CHAIN_TAIL_${WRAPPER_CTX}`] = `sha256:${wrapperHashHex}`

    const result = await handleEmit({
      input: {
        event_type: 'https://atrib.dev/v1/types/observation',
        context_id: WRAPPER_CTX,
        content: { what: 'co-producer-env-var-path' },
      },
      key,
      queue,
    })

    expect(result.context_id).toBe(WRAPPER_CTX)
    expect(result.record_hash).toBeTruthy()
    const emitted = await readEmitMirrorTail(emitMirrorPath)
    // The signed record's chain_root must point at the wrapper's record hash.
    // Currently FAILS because auto-chain.ts short-circuits on callerContextId
    // and never reads ATRIB_CHAIN_TAIL_<context_id>. Will pass once
    // resolveChainContext is replaced with @atrib/mcp's inheritChainContext.
    expect(emitted.chain_root).toBe(`sha256:${wrapperHashHex}`)
    expect(emitted.chain_root).not.toBe(genesisChainRoot(WRAPPER_CTX))
  })

  it('emit chains to wrapper tail via ATRIB_AUTOCHAIN_SOURCE mirror file', async () => {
    const wrapperRecord = await makeWrapperRecord(WRAPPER_CTX)
    const wrapperHashHex = hexEncode(sha256(canonicalRecord(wrapperRecord)))
    await writeMirrorLine(wrapperMirrorPath, wrapperRecord)
    process.env['ATRIB_AUTOCHAIN_SOURCE'] = wrapperMirrorPath
    // Note: NO ATRIB_CHAIN_TAIL_<...> env var. Mirror is the only signal.

    const result = await handleEmit({
      input: {
        event_type: 'https://atrib.dev/v1/types/observation',
        context_id: WRAPPER_CTX,
        content: { what: 'co-producer-mirror-path' },
      },
      key,
      queue,
    })

    expect(result.context_id).toBe(WRAPPER_CTX)
    const emitted = await readEmitMirrorTail(emitMirrorPath)
    expect(emitted.chain_root).toBe(`sha256:${wrapperHashHex}`)
    expect(emitted.chain_root).not.toBe(genesisChainRoot(WRAPPER_CTX))
  })

  it('emit does NOT chain to mirror when mirror is on a different context_id', async () => {
    // Adversarial case: caller passes context X, mirror's last record is on
    // context Y (e.g. previous session that the wrapper hasn't rotated out
    // of). Inheriting Y's tail would produce a malformed record (chain_root
    // points into Y's chain, but context_id says X). MUST fall through to
    // genesis for X (since no env var either).
    const otherCtx = 'b'.repeat(32)
    const otherRecord = await makeWrapperRecord(otherCtx)
    await writeMirrorLine(wrapperMirrorPath, otherRecord)
    process.env['ATRIB_AUTOCHAIN_SOURCE'] = wrapperMirrorPath
    // No env var; mirror has wrong context_id; must fall through to genesis.

    const result = await handleEmit({
      input: {
        event_type: 'https://atrib.dev/v1/types/observation',
        context_id: WRAPPER_CTX,
        content: { what: 'co-producer-mismatch-path' },
      },
      key,
      queue,
    })

    expect(result.context_id).toBe(WRAPPER_CTX)
    const emitted = await readEmitMirrorTail(emitMirrorPath)
    expect(emitted.chain_root).toBe(genesisChainRoot(WRAPPER_CTX))
  })

  it('env var takes precedence over mirror file when both present', async () => {
    // Both signals available; env var (parent-set, explicit) wins.
    const mirrorRec = await makeWrapperRecord(WRAPPER_CTX)
    const mirrorHashHex = hexEncode(sha256(canonicalRecord(mirrorRec)))
    await writeMirrorLine(wrapperMirrorPath, mirrorRec)
    process.env['ATRIB_AUTOCHAIN_SOURCE'] = wrapperMirrorPath

    // Different env-var hash — parent process knows a more recent tail than
    // the on-disk mirror reflects.
    const envHashHex = '7'.repeat(64)
    process.env[`ATRIB_CHAIN_TAIL_${WRAPPER_CTX}`] = `sha256:${envHashHex}`

    const result = await handleEmit({
      input: {
        event_type: 'https://atrib.dev/v1/types/observation',
        context_id: WRAPPER_CTX,
        content: { what: 'co-producer-env-wins' },
      },
      key,
      queue,
    })

    expect(result.context_id).toBe(WRAPPER_CTX)
    const emitted = await readEmitMirrorTail(emitMirrorPath)
    expect(emitted.chain_root).toBe(`sha256:${envHashHex}`)
    expect(emitted.chain_root).not.toBe(`sha256:${mirrorHashHex}`)
  })
})
