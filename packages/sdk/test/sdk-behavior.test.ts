// SPDX-License-Identifier: Apache-2.0

/**
 * SDK behavior tests for the two verbs of @atrib/sdk.
 *
 * Covers the four behavioral surfaces of the consolidated client:
 *   1. buildEmitArgs() input mapping (ref discriminator, contradictory
 *      event_type rejection, absence-not-null on optionals, context_id
 *      pass-through).
 *   2. attest() in-process fallback: daemon off, caller-owned key, a mock
 *      §2.6.1 log anchor, and the §5.9 mirror envelope with
 *      _local.producer === 'atrib-sdk'.
 *   3. attest() pass-through mode (§5.8 rule: no key ⇒ no record, no throw).
 *   4. The daemon path against a real in-test MCP server over Streamable
 *      HTTP, plus §5.8 degradation against an unreachable endpoint in
 *      'require' mode (resolves via 'none', never throws).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createServer, type Server as HttpServer } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import {
  buildEmitArgs,
  createAtribClient,
  recordHashRef,
  SHAPE_TO_TOOL,
  toToolArgs,
  verifyRecord,
  type AtribRecord,
  type AttestInput,
} from '../src/index.js'

const HASH_A = 'sha256:' + 'a'.repeat(64)
const CONTEXT_A = 'a'.repeat(32)
const CONTEXT_B = 'b'.repeat(32)
const CONTEXT_C = 'c'.repeat(32)

// ── 1. buildEmitArgs ─────────────────────────────────────────────────────

describe('buildEmitArgs', () => {
  it("derives event_type 'annotation' and the annotates field from ref kind 'annotates'", () => {
    const args = buildEmitArgs({
      content: { summary: 'important', importance: 'high' },
      ref: { kind: 'annotates', record_hash: HASH_A },
    })
    expect(args['event_type']).toBe('annotation')
    expect(args['annotates']).toBe(HASH_A)
    expect(Object.prototype.hasOwnProperty.call(args, 'revises')).toBe(false)
  })

  it("derives event_type 'revision' and the revises field from ref kind 'revises'", () => {
    const args = buildEmitArgs({
      content: { prior_position: 'x', new_position: 'y', reason: 'z' },
      ref: { kind: 'revises', record_hash: HASH_A },
    })
    expect(args['event_type']).toBe('revision')
    expect(args['revises']).toBe(HASH_A)
    expect(Object.prototype.hasOwnProperty.call(args, 'annotates')).toBe(false)
  })

  it('throws TypeError on an event_type contradicting the ref kind', () => {
    expect(() =>
      buildEmitArgs({
        content: {},
        event_type: 'observation',
        ref: { kind: 'annotates', record_hash: HASH_A },
      }),
    ).toThrow(TypeError)
    expect(() =>
      buildEmitArgs({
        content: {},
        event_type: 'annotation',
        ref: { kind: 'revises', record_hash: HASH_A },
      }),
    ).toThrow(TypeError)
  })

  it('accepts a matching short-name or URI event_type alongside the ref', () => {
    const short = buildEmitArgs({
      content: {},
      event_type: 'annotation',
      ref: { kind: 'annotates', record_hash: HASH_A },
    })
    expect(short['event_type']).toBe('annotation')
    const uri = buildEmitArgs({
      content: {},
      event_type: 'https://atrib.dev/v1/types/annotation',
      ref: { kind: 'annotates', record_hash: HASH_A },
    })
    expect(uri['event_type']).toBe('https://atrib.dev/v1/types/annotation')
    expect(uri['annotates']).toBe(HASH_A)
  })

  it('OMITS undefined optionals from the returned args (key absence, not null/undefined values)', () => {
    // Explicit `undefined` values must behave identically to absent keys:
    // presence/absence of optional fields changes the JCS canonical form
    // downstream, so the mapping layer must never materialize the key.
    // exactOptionalPropertyTypes forbids explicit undefined at the type
    // level; the cast deliberately smuggles it through to prove the
    // runtime mapping stays absence-preserving for plain-JS callers.
    const args = buildEmitArgs({
      content: { what: 'observation content' },
      event_type: undefined,
      ref: undefined,
      informed_by: undefined,
      allow_unresolved_informed_by: undefined,
      context_id: undefined,
      chain_root: undefined,
      provenance_token: undefined,
      tool_name: undefined,
      args_hash: undefined,
      result_hash: undefined,
    } as unknown as AttestInput)
    expect(Object.keys(args).sort()).toEqual(['content', 'event_type'])
    for (const key of [
      'annotates',
      'revises',
      'informed_by',
      'allow_unresolved_informed_by',
      'context_id',
      'chain_root',
      'provenance_token',
      'tool_name',
      'args_hash',
      'result_hash',
    ]) {
      expect(Object.prototype.hasOwnProperty.call(args, key)).toBe(false)
    }
    expect(args['event_type']).toBe('observation')
    expect(args['content']).toEqual({ what: 'observation content' })
  })

  it('passes an explicit context_id through, beating the per-client default', () => {
    const explicitOnly = buildEmitArgs({ content: {}, context_id: CONTEXT_B })
    expect(explicitOnly['context_id']).toBe(CONTEXT_B)

    const defaultOnly = buildEmitArgs({ content: {} }, CONTEXT_C)
    expect(defaultOnly['context_id']).toBe(CONTEXT_C)

    const explicitWins = buildEmitArgs({ content: {}, context_id: CONTEXT_B }, CONTEXT_C)
    expect(explicitWins['context_id']).toBe(CONTEXT_B)
  })
})

describe('recall shape routing', () => {
  it('routes state through the modern recall tool and preserves its shape discriminator', () => {
    expect(SHAPE_TO_TOOL.state).toBe('recall')
    expect(toToolArgs({ shape: 'state', include_content: false })).toEqual({
      shape: 'state',
      include_content: false,
    })
  })
})

describe('local-only log submission', () => {
  it('signs and mirrors without an outbound fetch', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'atrib-sdk-local-only-'))
    const mirrorPath = join(directory, 'records.jsonl')
    const originalFetch = globalThis.fetch
    const fetchSpy = vi.fn(() => {
      throw new Error('local-only client attempted network submission')
    })
    globalThis.fetch = fetchSpy as typeof fetch
    try {
      const client = createAtribClient({
        daemon: { mode: 'off' },
        logSubmission: 'disabled',
        key: { privateKey: new Uint8Array(32).fill(15), source: 'env' },
        mirrorPath,
        contextId: CONTEXT_C,
      })
      const result = await client.attest({ content: { what: 'local proof' } })
      await client.close()

      expect(result.record_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(result.log_index).toBeNull()
      expect(fetchSpy).not.toHaveBeenCalled()
      const envelope = JSON.parse(readFileSync(mirrorPath, 'utf8').trim()) as {
        record: AtribRecord
      }
      expect(recordHashRef(envelope.record)).toBe(result.record_hash)
      expect(await verifyRecord(envelope.record)).toBe(true)
    } finally {
      globalThis.fetch = originalFetch
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('requires a non-daemon client', () => {
    expect(() => createAtribClient({ logSubmission: 'disabled' })).toThrow(
      "logSubmission: 'disabled' requires daemon.mode: 'off'",
    )
  })
})

// ── 2. attest() in-process fallback ──────────────────────────────────────

describe('attest() in-process fallback (daemon off)', () => {
  let logServer: HttpServer
  let logEndpoint: string
  const logPosts: Array<Record<string, unknown>> = []
  let mirrorDir: string
  let mirrorFile: string
  const savedEnv = new Map<string, string | undefined>()

  beforeAll(async () => {
    // Tiny §2.6.1-shaped mock log: every POST is accepted with a fixed
    // proof bundle so the submission queue's flush resolves immediately.
    logServer = createServer((req, res) => {
      let body = ''
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf8')
      })
      req.on('end', () => {
        if (req.method === 'POST') {
          try {
            logPosts.push(JSON.parse(body) as Record<string, unknown>)
          } catch {
            // Non-JSON body would be a producer bug; surfaced by assertions.
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(
            JSON.stringify({ log_index: 0, checkpoint: 'c', inclusion_proof: [], leaf_hash: 'l' }),
          )
          return
        }
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'not found' }))
      })
    })
    await new Promise<void>((resolve) => logServer.listen(0, '127.0.0.1', resolve))
    const port = (logServer.address() as AddressInfo).port
    logEndpoint = `http://127.0.0.1:${port}/v1/entries`

    mirrorDir = mkdtempSync(join(tmpdir(), 'atrib-sdk-behavior-'))
    mirrorFile = join(mirrorDir, 'mirror.jsonl')
    for (const key of [
      'ATRIB_MIRROR_FILE',
      'ATRIB_AUTOCHAIN_SOURCE',
      'ATRIB_LOG_ENDPOINT',
      'ATRIB_LOCAL_SUBSTRATE_ENDPOINT',
      `ATRIB_CHAIN_TAIL_${CONTEXT_A}`,
    ]) {
      savedEnv.set(key, process.env[key])
      delete process.env[key]
    }
    process.env['ATRIB_MIRROR_FILE'] = mirrorFile
  })

  afterAll(async () => {
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await new Promise<void>((resolve) => logServer.close(() => resolve()))
    rmSync(mirrorDir, { recursive: true, force: true })
  })

  it('signs in-process, submits the bare record to the anchor, and mirrors an atrib-sdk envelope', async () => {
    const seed = new Uint8Array(32).fill(7)
    const client = createAtribClient({
      daemon: { mode: 'off' },
      key: { privateKey: seed, source: 'env' },
      anchors: [logEndpoint],
      contextId: CONTEXT_A,
    })
    const result = await client.attest({
      content: { what: 'sdk behavior test emit', topics: ['test'] },
    })
    const reports = await client.flushAnchors()
    await client.close()

    expect(result.via).toBe('in-process')
    expect(result.record_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(result.context_id).toBe(CONTEXT_A)
    // The mock anchor confirmed within the flush deadline, so the proof is
    // patched onto the result.
    expect(result.log_index).toBe(0)

    // D138 posture: one explicit anchor, no allowSingleAnchor ⇒ warned.
    expect(result.anchor_posture).toEqual({
      effective_anchor_count: 1,
      used_default_set: false,
      warned: true,
      basis: 'configured_descriptors',
      plurality_met: null,
    })
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({
      configured_anchor_count: 1,
      attempted_anchor_count: 1,
      successful_submission_count: 0,
      proof_ready_anchor_count: 0,
      queued_anchor_count: 1,
    })

    // The anchor received the bare signed record (§5.9: never the envelope).
    expect(logPosts.length).toBeGreaterThan(0)
    const submitted = logPosts[logPosts.length - 1] as unknown as AtribRecord
    expect(Object.prototype.hasOwnProperty.call(submitted, '_local')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(submitted, 'record')).toBe(false)
    expect(recordHashRef(submitted)).toBe(result.record_hash)

    // The mirror's last line is an envelope {record, _local} whose record
    // verifies per §1.4.3 and hashes to the reported record_hash.
    const lines = readFileSync(mirrorFile, 'utf8').trim().split('\n')
    expect(lines.length).toBeGreaterThan(0)
    const envelope = JSON.parse(lines[lines.length - 1] as string) as {
      record: AtribRecord
      _local?: { producer?: string; content?: Record<string, unknown> }
    }
    expect(envelope.record).toBeDefined()
    expect(envelope._local?.producer).toBe('atrib-sdk')
    expect(envelope._local?.content).toEqual({ what: 'sdk behavior test emit', topics: ['test'] })
    expect(envelope.record.context_id).toBe(CONTEXT_A)
    expect(recordHashRef(envelope.record)).toBe(result.record_hash)
    expect(await verifyRecord(envelope.record)).toBe(true)
  })

  it('signs a real action request and linked outcome through the attest service boundary', async () => {
    const seed = new Uint8Array(32).fill(8)
    const client = createAtribClient({
      daemon: { mode: 'off' },
      key: { privateKey: seed, source: 'env' },
      anchors: [logEndpoint],
      allowSingleAnchor: true,
      contextId: CONTEXT_B,
    })

    const result = await client.action({
      name: 'sdk_action_boundary_regression',
      args: { task_id: 'task-1', revision: 'r1' },
      execute: () => ({ status: 'completed', revision: 'r1' }),
    })
    await client.flushAnchors()
    await client.close()

    expect(result.ok).toBe(true)
    expect(result.request.record_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(result.outcome.record_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(result.request.record_hash).not.toBe(result.outcome.record_hash)

    const lines = readFileSync(mirrorFile, 'utf8').trim().split('\n')
    const envelopes = lines.slice(-2).map(
      (line) =>
        JSON.parse(line) as {
          record: AtribRecord
          _local?: { content?: Record<string, unknown> }
        },
    )
    const [requestEnvelope, outcomeEnvelope] = envelopes
    expect(requestEnvelope?.record.tool_name).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(requestEnvelope?.record.tool_name).toHaveLength(71)
    expect(recordHashRef(requestEnvelope!.record)).toBe(result.request.record_hash)
    expect(recordHashRef(outcomeEnvelope!.record)).toBe(result.outcome.record_hash)
    expect(outcomeEnvelope?.record.chain_root).toBe(result.request.record_hash)
    expect(outcomeEnvelope?.record.informed_by).toEqual([result.request.record_hash])
    expect(requestEnvelope?._local?.content).toMatchObject({ action_phase: 'request' })
    expect(outcomeEnvelope?._local?.content).toMatchObject({ action_phase: 'outcome' })
    expect(await verifyRecord(requestEnvelope!.record)).toBe(true)
    expect(await verifyRecord(outcomeEnvelope!.record)).toBe(true)
  })

  it('isolates concurrent in-process clients with explicit mirror and autochain paths', async () => {
    const mirrorA = join(mirrorDir, `client-a-${randomUUID()}.jsonl`)
    const mirrorB = join(mirrorDir, `client-b-${randomUUID()}.jsonl`)
    const mutatedMirrorA = join(mirrorDir, `client-a-mutated-${randomUUID()}.jsonl`)
    const sharedMirrorHashesBefore = new Set(
      readFileSync(mirrorFile, 'utf8')
        .trim()
        .split('\n')
        .map((line) => recordHashRef((JSON.parse(line) as { record: AtribRecord }).record)),
    )

    const configA = {
      daemon: { mode: 'off' },
      key: { privateKey: new Uint8Array(32).fill(0x41), source: 'env' },
      anchors: [logEndpoint],
      allowSingleAnchor: true,
      contextId: CONTEXT_A,
      producer: 'concurrent-client-a',
      mirrorPath: mirrorA,
    } as const
    const clientA = createAtribClient(configA)
    const mutableConfigA = configA as { mirrorPath: string }
    mutableConfigA.mirrorPath = mutatedMirrorA
    const clientB = createAtribClient({
      daemon: { mode: 'off' },
      key: { privateKey: new Uint8Array(32).fill(0x42), source: 'env' },
      anchors: [logEndpoint],
      allowSingleAnchor: true,
      contextId: CONTEXT_A,
      producer: 'concurrent-client-b',
      mirrorPath: mirrorB,
    })

    try {
      const [seedA, seedB] = await Promise.all([
        clientA.attest({ content: { what: 'client A seed' } }),
        clientB.attest({ content: { what: 'client B seed' } }),
      ])
      const [actionA, actionB] = await Promise.all([
        clientA.action({
          name: 'client_a_action',
          args: { client: 'a' },
          execute: () => ({ client: 'a', status: 'completed' }),
        }),
        clientB.action({
          name: 'client_b_action',
          args: { client: 'b' },
          execute: () => ({ client: 'b', status: 'completed' }),
        }),
      ])
      await Promise.all([clientA.flushAnchors(), clientB.flushAnchors()])

      expect(actionA.ok).toBe(true)
      expect(actionB.ok).toBe(true)
      expect(seedA.record_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(seedB.record_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(existsSync(mutatedMirrorA)).toBe(false)

      const readRecords = (path: string): AtribRecord[] =>
        readFileSync(path, 'utf8')
          .trim()
          .split('\n')
          .map((line) => (JSON.parse(line) as { record: AtribRecord }).record)
      const recordsA = readRecords(mirrorA)
      const recordsB = readRecords(mirrorB)
      expect(recordsA).toHaveLength(3)
      expect(recordsB).toHaveLength(3)
      expect(new Set(recordsA.map((record) => record.context_id))).toEqual(new Set([CONTEXT_A]))
      expect(new Set(recordsB.map((record) => record.context_id))).toEqual(new Set([CONTEXT_A]))

      const byHashA = new Map(recordsA.map((record) => [recordHashRef(record), record]))
      const byHashB = new Map(recordsB.map((record) => [recordHashRef(record), record]))
      expect(byHashA.has(seedB.record_hash!)).toBe(false)
      expect(byHashB.has(seedA.record_hash!)).toBe(false)
      const explicitHashes = [
        seedA.record_hash,
        seedB.record_hash,
        actionA.request.record_hash,
        actionA.outcome.record_hash,
        actionB.request.record_hash,
        actionB.outcome.record_hash,
      ]
      expect(explicitHashes.every((hash) => !sharedMirrorHashesBefore.has(hash!))).toBe(true)
      const sharedMirrorHashesAfter = new Set(
        readFileSync(mirrorFile, 'utf8')
          .trim()
          .split('\n')
          .map((line) => recordHashRef((JSON.parse(line) as { record: AtribRecord }).record)),
      )
      expect(explicitHashes.every((hash) => !sharedMirrorHashesAfter.has(hash!))).toBe(true)
      expect(byHashA.get(actionA.request.record_hash!)?.chain_root).toBe(seedA.record_hash)
      expect(byHashB.get(actionB.request.record_hash!)?.chain_root).toBe(seedB.record_hash)
      expect(byHashA.get(actionA.outcome.record_hash!)?.informed_by).toEqual([
        actionA.request.record_hash,
      ])
      expect(byHashB.get(actionB.outcome.record_hash!)?.informed_by).toEqual([
        actionB.request.record_hash,
      ])
      for (const result of [
        seedA,
        seedB,
        actionA.request,
        actionA.outcome,
        actionB.request,
        actionB.outcome,
      ]) {
        expect(result.warnings.some((warning) => warning.includes('anchor fan-out skipped'))).toBe(
          false,
        )
      }
    } finally {
      await Promise.all([clientA.close(), clientB.close()])
    }
  })

  it('uses mirrorPath as the autochain fallback when no source is configured', async () => {
    const explicitMirror = join(mirrorDir, `mirror-only-${randomUUID()}.jsonl`)
    const client = createAtribClient({
      daemon: { mode: 'off' },
      key: { privateKey: new Uint8Array(32).fill(0x43), source: 'env' },
      anchors: [logEndpoint],
      allowSingleAnchor: true,
      contextId: CONTEXT_C,
      mirrorPath: explicitMirror,
    })
    try {
      const seed = await client.attest({ content: { what: 'mirror-only seed' } })
      const action = await client.action({
        name: 'mirror_only_action',
        args: { client: 'mirror-only' },
        execute: () => ({ status: 'completed' }),
      })
      await client.flushAnchors()

      const records = readFileSync(explicitMirror, 'utf8')
        .trim()
        .split('\n')
        .map((line) => (JSON.parse(line) as { record: AtribRecord }).record)
      const byHash = new Map(records.map((record) => [recordHashRef(record), record]))
      expect(records).toHaveLength(3)
      expect(byHash.get(action.request.record_hash!)?.chain_root).toBe(seed.record_hash)
      expect(action.request.warnings.some((warning) => warning.includes('fan-out skipped'))).toBe(
        false,
      )
      expect(action.outcome.warnings.some((warning) => warning.includes('fan-out skipped'))).toBe(
        false,
      )
    } finally {
      await client.close()
    }
  })

  it('uses the shared default mirror path for zero-config in-process fan-out', async () => {
    const priorMirror = process.env['ATRIB_MIRROR_FILE']
    const priorAutochain = process.env['ATRIB_AUTOCHAIN_SOURCE']
    const priorAgent = process.env['ATRIB_AGENT']
    const priorHome = process.env['HOME']
    const agent = `sdk-zero-config-${randomUUID()}`
    const temporaryHome = join(mirrorDir, `home-${randomUUID()}`)
    delete process.env['ATRIB_MIRROR_FILE']
    delete process.env['ATRIB_AUTOCHAIN_SOURCE']
    process.env['ATRIB_AGENT'] = agent
    process.env['HOME'] = temporaryHome
    const defaultMirror = join(homedir(), '.atrib', 'records', `atrib-emit-${agent}.jsonl`)
    rmSync(defaultMirror, { force: true })

    const client = createAtribClient({
      daemon: { mode: 'off' },
      key: { privateKey: new Uint8Array(32).fill(0x44), source: 'env' },
      anchors: [logEndpoint],
      allowSingleAnchor: true,
      contextId: randomUUID().replaceAll('-', ''),
    })
    try {
      const result = await client.attest({ content: { what: 'zero-config mirror path' } })
      await client.flushAnchors()
      expect(existsSync(defaultMirror)).toBe(true)
      expect(result.warnings.some((warning) => warning.includes('fan-out skipped'))).toBe(false)
    } finally {
      await client.close()
      rmSync(defaultMirror, { force: true })
      if (priorMirror === undefined) delete process.env['ATRIB_MIRROR_FILE']
      else process.env['ATRIB_MIRROR_FILE'] = priorMirror
      if (priorAutochain === undefined) delete process.env['ATRIB_AUTOCHAIN_SOURCE']
      else process.env['ATRIB_AUTOCHAIN_SOURCE'] = priorAutochain
      if (priorAgent === undefined) delete process.env['ATRIB_AGENT']
      else process.env['ATRIB_AGENT'] = priorAgent
      if (priorHome === undefined) delete process.env['HOME']
      else process.env['HOME'] = priorHome
    }
  })

  it('fans the signed record out to every configured atrib-log anchor (D138)', async () => {
    // Second §2.6.1-shaped mock anchor.
    const posts2: Array<Record<string, unknown>> = []
    const server2 = createServer((req, res) => {
      let body = ''
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf8')
      })
      req.on('end', () => {
        if (req.method === 'POST') {
          try {
            posts2.push(JSON.parse(body) as Record<string, unknown>)
          } catch {
            // Surfaced by assertions.
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(
            JSON.stringify({ log_index: 5, checkpoint: 'c', inclusion_proof: [], leaf_hash: 'l' }),
          )
          return
        }
        res.writeHead(404)
        res.end()
      })
    })
    await new Promise<void>((resolve) => server2.listen(0, '127.0.0.1', resolve))
    const endpoint2 = `http://127.0.0.1:${(server2.address() as AddressInfo).port}/v1/entries`

    const seed = new Uint8Array(32).fill(9)
    const client = createAtribClient({
      daemon: { mode: 'off' },
      key: { privateKey: seed, source: 'env' },
      anchors: [logEndpoint, endpoint2],
      contextId: CONTEXT_A,
    })
    try {
      const result = await client.attest({ content: { what: 'anchor fan-out test' } })
      expect(result.via).toBe('in-process')
      // Two configured descriptors avoid the configuration warning. Actual
      // plurality remains a verifier decision over returned proof material.
      expect(result.anchor_posture).toEqual({
        effective_anchor_count: 2,
        used_default_set: false,
        warned: false,
        basis: 'configured_descriptors',
        plurality_met: null,
      })
      expect(result.warnings.some((w) => w.includes('anchor fan-out skipped'))).toBe(false)

      // flushAnchors drains the fan-out legs; the atrib-log transport's own
      // queue confirms asynchronously, so poll briefly for the second
      // anchor's POST.
      const reports = await client.flushAnchors()
      expect(reports).toHaveLength(1)
      expect(reports[0]).toMatchObject({
        configured_anchor_count: 2,
        attempted_anchor_count: 2,
        successful_submission_count: 0,
        proof_ready_anchor_count: 0,
        queued_anchor_count: 2,
      })
      const deadline = Date.now() + 3000
      while (posts2.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      expect(posts2.length).toBeGreaterThan(0)
      const submitted = posts2[posts2.length - 1] as unknown as AtribRecord
      // The second anchor received the same BARE signed record.
      expect(Object.prototype.hasOwnProperty.call(submitted, '_local')).toBe(false)
      expect(recordHashRef(submitted)).toBe(result.record_hash)
    } finally {
      await client.close()
      server2.closeAllConnections()
      await new Promise<void>((resolve) => server2.close(() => resolve()))
    }
  }, 15_000)

  it('skips fan-out with a warning when the signed record cannot be read back from the mirror', async () => {
    // Point ATRIB_MIRROR_FILE at a DIRECTORY: emitInProcess's mirror write
    // degrades silently (§5.8) and readMirrorTail finds no record, so the
    // fan-out is skipped with a warning while the attest still succeeds.
    const saved = process.env['ATRIB_MIRROR_FILE']
    process.env['ATRIB_MIRROR_FILE'] = mirrorDir
    try {
      const seed = new Uint8Array(32).fill(11)
      const client = createAtribClient({
        daemon: { mode: 'off' },
        key: { privateKey: seed, source: 'env' },
        anchors: [logEndpoint],
        allowSingleAnchor: true,
        contextId: CONTEXT_B,
      })
      const result = await client.attest({ content: { what: 'mirror-miss fan-out test' } })
      await client.close()
      expect(result.via).toBe('in-process')
      expect(result.record_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(result.warnings.some((w) => w.includes('anchor fan-out skipped'))).toBe(true)
      // Posture is still surfaced: allowSingleAnchor makes it unwarned.
      expect(result.anchor_posture).toEqual({
        effective_anchor_count: 1,
        used_default_set: false,
        warned: false,
        basis: 'configured_descriptors',
        plurality_met: null,
      })
    } finally {
      if (saved === undefined) delete process.env['ATRIB_MIRROR_FILE']
      else process.env['ATRIB_MIRROR_FILE'] = saved
    }
  })
})

// ── 3. attest() pass-through ─────────────────────────────────────────────

describe('attest() pass-through (§5.8, key: null)', () => {
  it("resolves via 'none' with a pass-through warning and a null record_hash, without throwing", async () => {
    const client = createAtribClient({ daemon: { mode: 'off' }, key: null })
    const result = await client.attest({ content: { what: 'never signed' } })
    await client.close()

    expect(result.via).toBe('none')
    expect(result.record_hash).toBeNull()
    expect(result.log_index).toBeNull()
    expect(result.warnings.some((w) => w.includes('pass-through'))).toBe(true)
  })
})

// ── 4. daemon path ───────────────────────────────────────────────────────

const DAEMON_EMIT_RESULT = {
  record_hash: 'sha256:' + '0'.repeat(64),
  log_index: 1,
  inclusion_proof: [],
  context_id: CONTEXT_A,
  warnings: [],
}

const DAEMON_HISTORY_RESULT = {
  records: [{ record_hash: 'sha256:' + '1'.repeat(64), event_type: 'observation' }],
  total: 1,
}

const DAEMON_STATE_RESULT = {
  schema: 'atrib.state-projection.v1',
  cells: [],
}

interface MockDaemon {
  endpoint: string
  close(): Promise<void>
}

/**
 * Real MCP server over Streamable HTTP: McpServer + a single
 * StreamableHTTPServerTransport bound to an ephemeral node:http server.
 * One transport is enough because the SDK client opens one session.
 */
async function startMockDaemon(): Promise<MockDaemon> {
  const mcp = new McpServer({ name: 'mock-primitives-runtime', version: '0.0.0' })
  mcp.registerTool('emit', { description: 'mock emit tool' }, async () => ({
    content: [{ type: 'text' as const, text: JSON.stringify(DAEMON_EMIT_RESULT) }],
  }))
  mcp.registerTool(
    'recall_my_attribution_history',
    { description: 'mock recall tool' },
    async () => ({
      content: [{ type: 'text' as const, text: JSON.stringify(DAEMON_HISTORY_RESULT) }],
    }),
  )
  mcp.registerTool('recall', { description: 'mock modern recall tool' }, async () => ({
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(DAEMON_STATE_RESULT),
      },
    ],
  }))
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  })
  // Same exactOptionalPropertyTypes impedance the SDK's DaemonClient works
  // around: the concrete transport declares `onclose: (() => void) |
  // undefined` where the Transport interface wants an optional property.
  await mcp.connect(transport as unknown as Transport)

  const httpServer = createServer((req, res) => {
    void transport.handleRequest(req, res).catch(() => {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'internal error' }))
      }
    })
  })
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
  const port = (httpServer.address() as AddressInfo).port
  return {
    endpoint: `http://127.0.0.1:${port}/mcp`,
    close: async () => {
      try {
        await transport.close()
      } catch {
        // Best-effort teardown.
      }
      httpServer.closeAllConnections()
      await new Promise<void>((resolve) => httpServer.close(() => resolve()))
    },
  }
}

describe('daemon path over Streamable HTTP', () => {
  it("routes attest() and recall() through a reachable daemon (via 'daemon')", async () => {
    const daemon = await startMockDaemon()
    const client = createAtribClient({ daemon: { endpoint: daemon.endpoint } })
    try {
      const attested = await client.attest({ content: { what: 'daemon-path test' } })
      expect(attested.via).toBe('daemon')
      expect(attested.record_hash).toBe(DAEMON_EMIT_RESULT.record_hash)
      expect(attested.context_id).toBe(CONTEXT_A)
      expect(attested.log_index).toBe(1)

      const recalled = await client.recall<typeof DAEMON_HISTORY_RESULT>({ shape: 'history' })
      expect(recalled.via).toBe('daemon')
      expect(recalled.data).toEqual(DAEMON_HISTORY_RESULT)
      expect(recalled.warnings).toEqual([])

      const state = await client.recall<typeof DAEMON_STATE_RESULT>({
        shape: 'state',
        include_content: false,
      })
      expect(state.via).toBe('daemon')
      expect(state.data).toMatchObject({
        schema: 'atrib.state-projection.v1',
      })
    } finally {
      await client.close()
      await daemon.close()
    }
  }, 15_000)

  it("degrades to via 'none' with warnings (never throws) when the daemon is unreachable in 'require' mode", async () => {
    const client = createAtribClient({
      daemon: {
        endpoint: 'http://127.0.0.1:1/mcp',
        mode: 'require',
        connectTimeoutMs: 200,
      },
    })
    try {
      const attested = await client.attest({ content: { what: 'unreachable daemon' } })
      expect(attested.via).toBe('none')
      expect(attested.record_hash).toBeNull()
      expect(attested.warnings.some((w) => w.includes('daemon attest failed'))).toBe(true)

      const recalled = await client.recall({ shape: 'history' })
      expect(recalled.via).toBe('none')
      expect(recalled.data).toBeNull()
      expect(recalled.warnings.some((w) => w.includes('daemon recall'))).toBe(true)
    } finally {
      await client.close()
    }
  }, 10_000)

  it('suppresses in-process fallback when an idempotent daemon outcome is uncertain', async () => {
    const client = createAtribClient({
      daemon: {
        endpoint: 'http://127.0.0.1:1/mcp',
        mode: 'prefer',
        connectTimeoutMs: 200,
      },
      key: {
        privateKey: new Uint8Array(32).fill(19),
        source: 'env',
      },
    })
    try {
      const attested = await client.attest({
        content: { what: 'must not sign through fallback' },
        context_id: CONTEXT_A,
        idempotency_key: 'sdk-retry-key-000001',
      })
      expect(attested.via).toBe('none')
      expect(attested.record_hash).toBeNull()
      expect(attested.warnings.some((warning) => warning.includes('fallback suppressed'))).toBe(
        true,
      )
    } finally {
      await client.close()
    }
  }, 10_000)
})
