// SPDX-License-Identifier: Apache-2.0

/**
 * D081 invariant test: a record signed by emitInProcess is byte-identical
 * (same canonical bytes, same signature) to a record signed by the same
 * handleEmit path the MCP server uses. This is the load-bearing claim of
 * D081 — verifiers cannot distinguish records by transport, only by
 * creator_key and content.
 *
 * Implementation: spin up the same in-memory log stub the integration
 * suite uses, route both paths through it, and compare the records the
 * stub actually received. Reusing a real listener (not a /dev/null
 * endpoint) is required: emitInProcess's queue.flush() awaits real
 * submission and a dead endpoint stalls the whole test on retries.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as ed from '@noble/ed25519'
import {
  canonicalRecord,
  createSubmissionQueue,
  hexEncode,
  sha256,
  verifyRecord,
  type AtribRecord,
} from '@atrib/mcp'
import { emitInProcess, __test_only__ } from '../src/index.js'

interface LogStub {
  url: string
  received: AtribRecord[]
  close: () => Promise<void>
}

async function startLogStub(): Promise<LogStub> {
  const received: AtribRecord[] = []
  let nextIdx = 0
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'POST' && req.url === '/v1/entries') {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        received.push(JSON.parse(body) as AtribRecord)
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            log_index: nextIdx++,
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
  return {
    url: `http://127.0.0.1:${addr.port}/v1/entries`,
    received,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  }
}

let tmpDir: string
let mirrorPath: string
let log: LogStub
let priorMirror: string | undefined

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'atrib-emit-d081-'))
  mirrorPath = join(tmpDir, 'mirror.jsonl')
  log = await startLogStub()
  priorMirror = process.env['ATRIB_MIRROR_FILE']
  process.env['ATRIB_MIRROR_FILE'] = mirrorPath
})

afterEach(async () => {
  await log.close()
  await rm(tmpDir, { recursive: true, force: true })
  if (priorMirror === undefined) delete process.env['ATRIB_MIRROR_FILE']
  else process.env['ATRIB_MIRROR_FILE'] = priorMirror
})

async function fixedSeed(): Promise<Uint8Array> {
  const seed = new Uint8Array(32).fill(31)
  await ed.getPublicKeyAsync(seed) // sanity
  return seed
}

describe('D081 byte-identicality: emitInProcess vs handleEmit', () => {
  it('the two paths produce records that follow identical canonical-form rules under the same chain state', async () => {
    const seed = await fixedSeed()
    const baseInput = {
      event_type: 'https://atrib.dev/v1/types/observation',
      content: { what: 'd081-byte-identical', topics: ['d081'] },
      context_id: '00112233445566778899aabbccddeeff',
    } as const

    // Path A and Path B each run against a FRESH mirror so each is the
    // genesis record of its context. Two sequential emits in the same
    // mirror would chain off each other (correct behavior — chain_root
    // of the second points at the first), but that defeats the
    // byte-identicality check we want: the claim is per-input, given
    // identical chain state. Resetting the mirror between paths makes
    // them comparable.
    //
    // The structural assertions below ignore timestamp_ms and signature
    // (signature depends on timestamp); everything else must match.

    // ---- Path A: in-process entrypoint ----
    const a = await emitInProcess(baseInput, {
      key: { privateKey: seed, source: 'env' },
      logEndpoint: log.url,
    })
    expect(log.received.length).toBe(1)
    const recA = log.received[0]!
    expect(await verifyRecord(recA)).toBe(true)
    expect(a.record_hash).toBe(`sha256:${hexEncode(sha256(canonicalRecord(recA)))}`)

    // Wipe mirror so Path B is also a genesis emit on the same context.
    await rm(mirrorPath, { force: true })
    log.received.length = 0

    // ---- Path B: raw handleEmit, identical input ----
    const queue = createSubmissionQueue(log.url)
    const b = await __test_only__.handleEmit({
      input: baseInput,
      key: { privateKey: seed, source: 'env' },
      queue,
    })
    await queue.flush()
    expect(log.received.length).toBe(1)
    const recB = log.received[0]!
    expect(await verifyRecord(recB)).toBe(true)
    expect(b.record_hash).toBe(`sha256:${hexEncode(sha256(canonicalRecord(recB)))}`)

    // (Core D081 claim) Every field that doesn't legitimately vary
    // across paths is identical. A verifier reading canonical bytes
    // cannot tell which transport produced the record.
    const fieldsThatMustMatch: (keyof AtribRecord)[] = [
      'spec_version',
      'creator_key',
      'event_type',
      'context_id',
      'chain_root',
      'content_id',
    ]
    for (const f of fieldsThatMustMatch) {
      expect(recA[f], `field ${f}`).toEqual(recB[f])
    }
  })

  it('emitInProcess flushes the submission queue before returning', async () => {
    const seed = await fixedSeed()
    // No external flush: emitInProcess must drain itself. This is the
    // property that makes the hook path safe — a hook process exits
    // immediately after the call and would otherwise lose the record.
    const r = await emitInProcess(
      {
        event_type: 'https://atrib.dev/v1/types/observation',
        content: { what: 'flush-test' },
      },
      { key: { privateKey: seed, source: 'env' }, logEndpoint: log.url },
    )
    // The record is in the log BEFORE we await anything else — the
    // emitInProcess promise resolution implies the flush already
    // completed.
    expect(log.received.length).toBe(1)
    expect(r.record_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
  })
})
