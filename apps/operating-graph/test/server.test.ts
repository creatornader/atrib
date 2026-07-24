// SPDX-License-Identifier: Apache-2.0

import { appendFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import {
  base64urlEncode,
  computeContentId,
  genesisChainRoot,
  getPublicKey,
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
})
