// SPDX-License-Identifier: Apache-2.0

import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer as createNodeServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import {
  base64urlEncode,
  canonicalRecord,
  createJsonCommitment,
  createToolNameCommitment,
  computeContentId,
  genesisChainRoot,
  getPublicKey,
  hexEncode,
  sha256,
  signRecord,
  type AtribRecord,
} from '@atrib/mcp'
import { OPERATING_EVENT_SCHEMA, type OperatingEvent } from '../src/model.js'
import { startOperatingGraphServer } from '../src/server.js'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

async function appendOperatingRecord(
  mirrorFile: string,
  character: string,
  event: OperatingEvent,
  timestamp: number,
): Promise<void> {
  const seed = new Uint8Array(32).fill(character.charCodeAt(0))
  const contextId = character.repeat(32)
  const record = await signRecord(
    {
      spec_version: 'atrib/1.0',
      content_id: computeContentId('mcp://operating-test', event.kind),
      creator_key: base64urlEncode(await getPublicKey(seed)),
      chain_root: genesisChainRoot(contextId),
      event_type: 'https://atrib.dev/v1/types/observation',
      context_id: contextId,
      timestamp,
      signature: '',
    } as AtribRecord,
    seed,
  )
  appendFileSync(
    mirrorFile,
    `${JSON.stringify({
      record,
      proof: null,
      written_at: timestamp,
      _local: { content: event, producer: 'operating-test' },
    })}\n`,
  )
}

async function appendActionRecord(
  mirrorFile: string,
  character: string,
): Promise<{
  recordHash: string
  record: AtribRecord
  args: Record<string, unknown>
  result: Record<string, unknown>
}> {
  const seed = new Uint8Array(32).fill(character.charCodeAt(0))
  const contextId = character.repeat(32)
  const args = { issue: 42, private_note: 'local only' }
  const result = { status: 'updated' }
  const argsCommitment = createJsonCommitment(args, 'salted-sha256', () =>
    new Uint8Array(16).fill(3),
  )
  const resultCommitment = createJsonCommitment(result, 'salted-sha256', () =>
    new Uint8Array(16).fill(4),
  )
  const record = await signRecord(
    {
      spec_version: 'atrib/1.0',
      content_id: computeContentId('mcp://operating-test', 'update_issue'),
      creator_key: base64urlEncode(await getPublicKey(seed)),
      chain_root: genesisChainRoot(contextId),
      event_type: 'https://atrib.dev/v1/types/tool_call',
      context_id: contextId,
      timestamp: 300,
      tool_name: createToolNameCommitment('update_issue'),
      args_hash: argsCommitment.hash,
      args_salt: argsCommitment.salt,
      result_hash: resultCommitment.hash,
      result_salt: resultCommitment.salt,
      signature: '',
    } as AtribRecord,
    seed,
  )
  const recordHash = `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
  appendFileSync(
    mirrorFile,
    `${JSON.stringify({
      record,
      proof: null,
      written_at: 300,
      _local: { toolName: 'update_issue', args, result, producer: 'operating-test' },
    })}\n`,
  )
  return { recordHash, record, args, result }
}

describe('operating graph HTTP contract', () => {
  it('requires a bearer secret whenever signed writes are enabled', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'atrib-operating-auth-'))
    tempDirectories.push(directory)
    const mirrorFile = join(directory, 'records.jsonl')
    appendFileSync(mirrorFile, '')

    await expect(
      startOperatingGraphServer({
        mirrorPath: mirrorFile,
        host: '127.0.0.1',
        port: 0,
        writesEnabled: true,
        pollMs: 50,
      }),
    ).rejects.toThrow('ATRIB_OPERATING_WRITE_TOKEN is required')

    const server = await startOperatingGraphServer({
      mirrorPath: mirrorFile,
      host: '127.0.0.1',
      port: 0,
      writesEnabled: true,
      writeToken: 'test-write-token',
      pollMs: 50,
    })
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    try {
      const missing = await fetch(`${base}/v1/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      expect(missing.status).toBe(401)
      expect(missing.headers.get('www-authenticate')).toContain('Bearer')

      const wrong = await fetch(`${base}/v1/resolve`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer wrong-token',
          'Content-Type': 'application/json',
        },
        body: '{}',
      })
      expect(wrong.status).toBe(401)

      const authorized = await fetch(`${base}/v1/events`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-write-token',
          'Content-Type': 'application/json',
        },
        body: '{}',
      })
      expect(authorized.status).toBe(400)
      expect(await authorized.json()).toEqual({ error: 'invalid request' })
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('serves bounded views, body search, reconnect refusal, and live change events', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'atrib-operating-'))
    tempDirectories.push(directory)
    const mirrorFile = join(directory, 'records.jsonl')
    const workspace = { id: 'workspace-1', name: 'Apollo' }
    const task = { id: 'task-1', name: 'Ship' }
    const agent = { id: 'agent-1', name: 'Alice', role: 'builder' }
    await appendOperatingRecord(
      mirrorFile,
      'a',
      {
        schema: OPERATING_EVENT_SCHEMA,
        kind: 'decision',
        workspace,
        task,
        agent,
        subject: 'database',
        value: { selected: 'sqlite', reason: 'single-node' },
      },
      200,
    )
    const server = await startOperatingGraphServer({
      mirrorPath: mirrorFile,
      host: '127.0.0.1',
      port: 0,
      writesEnabled: false,
      pollMs: 50,
    })
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

    try {
      const workspaces = await fetch(`${base}/v1/workspaces`).then((response) => response.json())
      expect(workspaces).toMatchObject({
        revision: 1,
        workspaces: [{ id: workspace.id, name: workspace.name }],
      })

      const view = await fetch(`${base}/v1/view?workspace_id=${workspace.id}`).then((response) =>
        response.json(),
      )
      expect(view.view).toMatchObject({
        scope: { workspace_id: workspace.id },
        identities: [agent],
        counts: { records_considered: 1, cells_total: 1 },
      })

      const search = await fetch(
        `${base}/v1/search?workspace_id=${workspace.id}&q=single-node`,
      ).then((response) => response.json())
      expect(search.results).toHaveLength(1)
      expect(search.results[0].event.subject).toBe('database')

      const ahead = await fetch(`${base}/v1/stream?after=9`)
      expect(ahead.status).toBe(409)

      const controller = new AbortController()
      const stream = await fetch(`${base}/v1/stream?after=1`, {
        signal: controller.signal,
      })
      expect(stream.status).toBe(200)
      const reader = stream.body!.getReader()
      const decoder = new TextDecoder()
      let received = decoder.decode((await reader.read()).value)
      expect(received).toContain('event: ready')

      await appendOperatingRecord(
        mirrorFile,
        'b',
        {
          schema: OPERATING_EVENT_SCHEMA,
          kind: 'outcome',
          workspace,
          task,
          agent,
          subject: 'deploy',
          value: 'healthy',
        },
        100,
      )
      const deadline = Date.now() + 3_000
      while (!received.includes('event: changed') && Date.now() < deadline) {
        const next = await reader.read()
        received += decoder.decode(next.value)
      }
      controller.abort()
      expect(received).toContain('event: changed')
      expect(received).toContain('id: 2')

      const gapController = new AbortController()
      const gapStream = await fetch(`${base}/v1/stream?after=0`, {
        signal: gapController.signal,
      })
      const gapReader = gapStream.body!.getReader()
      const gapPayload = decoder.decode((await gapReader.read()).value)
      gapController.abort()
      expect(gapPayload).toContain('event: gap')
      expect(gapPayload).toContain('"after_revision":0')
      expect(gapPayload).toContain('"current_revision":2')

      const updated = await fetch(`${base}/v1/view?workspace_id=${workspace.id}`).then((response) =>
        response.json(),
      )
      expect(updated.revision).toBeGreaterThan(1)
      expect(
        updated.view.activity.map((entry: { event: { subject: string } }) => entry.event.subject),
      ).toEqual(['database', 'deploy'])

      const disabledWrite = await fetch(`${base}/v1/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      expect(disabledWrite.status).toBe(403)
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }, 10_000)

  it('keeps body openings authorization-protected and verifies disclosed values', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'atrib-operating-body-'))
    tempDirectories.push(directory)
    const mirrorFile = join(directory, 'records.jsonl')
    const { recordHash, args, result } = await appendActionRecord(mirrorFile, 'c')
    const server = await startOperatingGraphServer({
      mirrorPath: mirrorFile,
      host: '127.0.0.1',
      port: 0,
      writesEnabled: false,
      bodyReadToken: 'read-secret',
      pollMs: 50,
    })
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const hashHex = recordHash.slice('sha256:'.length)

    try {
      const unauthenticated = await fetch(`${base}/v1/body/${hashHex}`)
      expect(unauthenticated.status).toBe(401)

      const authorized = await fetch(`${base}/v1/body/${hashHex}`, {
        headers: { Authorization: 'Bearer read-secret' },
      })
      expect(authorized.status).toBe(200)
      const body = await authorized.json()
      expect(body).toMatchObject({
        schema: 'atrib.body-opening.v1',
        source: 'local-mirror',
        integrity: { record_hash_verified: true, signature_verified: true },
        openings: {
          tool_name: { present: true, verified: true, value: 'update_issue' },
          args: { present: true, verified: true, value: args },
          result: { present: true, verified: true, value: result },
        },
      })
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  const credentialedArchive = new URL('https://archive.example/v1')
  credentialedArchive.username = 'operator'

  it.each([
    ['ftp://archive.example/v1', 'HTTP or HTTPS'],
    ['http://169.254.169.254/v1', 'loopback hosts'],
    [credentialedArchive.toString(), 'must not contain credentials'],
    ['https://archive.example/v1?tenant=one', 'must not contain credentials'],
  ])('rejects unsafe archive configuration %s', async (archiveUrl, message) => {
    await expect(
      startOperatingGraphServer({
        mirrorPath: '/unused',
        host: '127.0.0.1',
        port: 0,
        writesEnabled: false,
        archiveUrl,
        pollMs: 50,
      }),
    ).rejects.toThrow(message)
  })

  it('falls back to an archive and re-verifies the returned signed body', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'atrib-operating-archive-'))
    tempDirectories.push(directory)
    const sourceMirror = join(directory, 'source.jsonl')
    const emptyMirror = join(directory, 'empty.jsonl')
    const { recordHash, record } = await appendActionRecord(sourceMirror, 'd')
    writeFileSync(emptyMirror, '')

    const archive = createNodeServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(
        JSON.stringify({
          record_hash: recordHash,
          record,
          log_proofs: [],
          archived_at_ms: 100,
          retention_window_ms: 1_000,
        }),
      )
    })
    await new Promise<void>((resolve) => archive.listen(0, '127.0.0.1', resolve))
    const archiveBase = `http://127.0.0.1:${(archive.address() as AddressInfo).port}/v1`
    const server = await startOperatingGraphServer({
      mirrorPath: emptyMirror,
      host: '127.0.0.1',
      port: 0,
      writesEnabled: false,
      bodyReadToken: 'read-secret',
      archiveUrl: archiveBase,
      pollMs: 50,
    })
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

    try {
      const response = await fetch(`${base}/v1/body/${recordHash.slice('sha256:'.length)}`, {
        headers: { Authorization: 'Bearer read-secret' },
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        source: 'archive',
        record_hash: recordHash,
        integrity: { record_hash_verified: true, signature_verified: true },
        archive: { archived_at_ms: 100, retention_window_ms: 1_000 },
        openings: {
          content: { present: false, verified: null },
          args: { present: false, verified: null },
          result: { present: false, verified: null },
        },
      })
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await new Promise<void>((resolve) => archive.close(() => resolve()))
    }
  })
})
