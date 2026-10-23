// SPDX-License-Identifier: Apache-2.0

/**
 * D190 signer socket in the emit path: records signed through a host
 * signer are byte-identical to in-process signing, and a down signer
 * fails the call instead of falling back to a seed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  base64urlEncode,
  createSignerSocket,
  getPublicKey,
  signRecord,
  verifyRecord,
  type AtribRecord,
} from '@atrib/mcp'
import { buildAndSignEmitRecord } from '../src/sign.js'

const seed = new Uint8Array(32).fill(5)
let dir: string
let socketPath: string
let server: Server | undefined

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'atrib-attest-signer-'))
  socketPath = join(dir, 'signer.sock')
})

afterEach(async () => {
  vi.useRealTimers()
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
  server = undefined
  rmSync(dir, { recursive: true, force: true })
})

async function startBroker(): Promise<void> {
  server = createServer((socket) => {
    let text = ''
    socket.on('data', (chunk) => {
      text += chunk.toString('utf-8')
      const newline = text.indexOf('\n')
      if (newline === -1) return
      const request = JSON.parse(text.slice(0, newline)) as { record: AtribRecord }
      void signRecord(request.record, seed).then((signed) => {
        socket.end(`${JSON.stringify({ v: 1, ok: true, signature: signed.signature })}\n`)
      })
    })
  })
  await new Promise<void>((resolve) => server!.listen(socketPath, resolve))
}

const input = {
  eventType: 'https://atrib.dev/v1/types/observation',
  contextId: 'a'.repeat(32),
  chainRoot: 'sha256:' + 'b'.repeat(64),
  content: { what: 'signed through the host signer' },
}

describe('emit with a signer socket', () => {
  it('signs records byte-identical to in-process signing', async () => {
    await startBroker()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1_779_840_300_000)
    const signer = createSignerSocket({
      socketPath,
      creatorKey: base64urlEncode(await getPublicKey(seed)),
      identity: 'claude-code',
      allowSameOwner: true,
    })

    const viaSocket = await buildAndSignEmitRecord({ ...input, signer })
    const inProcess = await buildAndSignEmitRecord({ ...input, privateKey: seed })

    expect(viaSocket).toEqual(inProcess)
    expect(await verifyRecord(viaSocket)).toBe(true)
  })

  it('fails when the signer is down instead of using another key', async () => {
    const signer = createSignerSocket({
      socketPath,
      creatorKey: base64urlEncode(await getPublicKey(seed)),
      identity: 'claude-code',
      allowSameOwner: true,
    })
    await expect(buildAndSignEmitRecord({ ...input, signer })).rejects.toThrow('signer socket')
  })

  it('requires exactly one key source', async () => {
    await expect(buildAndSignEmitRecord({ ...input })).rejects.toThrow('exactly one')
  })
})
