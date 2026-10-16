// SPDX-License-Identifier: Apache-2.0

import { createServer, type Server } from 'node:http'
import type { HandoffEvidencePacket } from '@atrib/verify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runA2aHandoffProof } from '../src/a2a-handoff.js'

const fixture = vi.hoisted(() => ({
  mode: 'ok',
  url: '',
  bridge: undefined as typeof fetch | undefined,
  requests: [] as { version: string | undefined; body: string }[],
}))

vi.mock('@a2a-js/sdk', async (importOriginal) => {
  const sdk = await importOriginal<typeof import('@a2a-js/sdk')>()
  return {
    ...sdk,
    generateAgentCardSignature: (...args: Parameters<typeof sdk.generateAgentCardSignature>) => {
      const sign = sdk.generateAgentCardSignature(...args)
      return async (...input: Parameters<typeof sign>) => {
        const card = await sign(...input)
        if (fixture.mode === 'unsigned-card') card.signatures = []
        if (fixture.mode === 'tampered-card') card.description += ' changed after signing'
        return card
      }
    },
  }
})

vi.mock('@a2a-js/sdk/client', async (importOriginal) => {
  const sdk = await importOriginal<typeof import('@a2a-js/sdk/client')>()
  return {
    ...sdk,
    JsonRpcTransportFactory: class extends sdk.JsonRpcTransportFactory {
      constructor(options?: ConstructorParameters<typeof sdk.JsonRpcTransportFactory>[0]) {
        fixture.bridge = options?.fetchImpl
        super({ ...options, fetchImpl: (_input, init) => fetch(fixture.url, init) })
      }
    },
  }
})

type WireResponse = {
  result?: {
    message?: {
      parts: { data?: { kind?: string; packet: HandoffEvidencePacket } }[]
    }
  }
}

let server: Server

beforeEach(async () => {
  fixture.mode = 'ok'
  fixture.bridge = undefined
  fixture.requests = []
  server = createServer(async (req, res) => {
    try {
      let body = ''
      for await (const chunk of req) body += chunk.toString()
      fixture.requests.push({ version: req.headers['a2a-version'] as string | undefined, body })
      if (fixture.mode === 'http-error') {
        res.writeHead(503).end('fixture unavailable')
        return
      }
      if (fixture.mode === 'invalid-json') {
        res.writeHead(200, { 'content-type': 'application/json' }).end('{broken')
        return
      }
      const request = JSON.parse(body) as { id: string }
      if (fixture.mode === 'rpc-error') {
        res.writeHead(200, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: request.id,
            error: { code: -32602, message: 'fixture invalid request' },
          }),
        )
        return
      }
      if (!fixture.bridge) throw new Error('SDK transport did not supply its request handler')
      const response = await fixture.bridge(fixture.url, { method: 'POST', body })
      const wire = (await response.json()) as WireResponse
      const message = wire.result?.message
      if (!message) throw new Error('SDK handler did not return its native message envelope')
      const data = message.parts.find((part) => part.data?.kind === 'atrib_handoff_packet')?.data
      if (!data) throw new Error('SDK handler did not serialize the packet data part')
      const entry = data.packet.records?.[0]
      if (!entry?.record) throw new Error('SDK handler packet has no signed record')
      if (fixture.mode === 'missing-part') message.parts = []
      if (fixture.mode === 'tampered-body') entry._local = { content: { changed: true } }
      if (fixture.mode === 'tampered-record') entry.record.timestamp += 1
      if (fixture.mode === 'missing-proof') delete entry.proof
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(wire))
    } catch (error) {
      res.writeHead(500).end(String(error))
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('fixture did not bind')
  fixture.url = `http://127.0.0.1:${address.port}/jsonrpc`
})

afterEach(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
})

describe('A2A SDK compatibility over localhost HTTP', () => {
  it('round-trips native v1 data parts and verifies evidence before follow-up signing', async () => {
    const result = await runA2aHandoffProof({
      nowMs: 1_779_840_000_000,
      includeSignedRecords: true,
    })
    expect(fixture.requests).toHaveLength(1)
    expect(fixture.requests[0]!.version).toBe('1.0')
    const request = JSON.parse(fixture.requests[0]!.body)
    expect(request.method).toBe('SendMessage')
    // Protobuf JSON omits the default false value.
    expect(request.params.configuration.returnImmediately ?? false).toBe(false)
    expect(result.agent_card.signature_valid).toBe(true)
    expect(result.evidence.rejected_count).toBe(0)
    expect(result.followup.signature_ok).toBe(true)
    expect(result.followup.informed_by_resolved).toEqual([result.evidence.remote_record_hash])
    expect(JSON.stringify(result.records)).not.toContain(result.privacy.private_task_phrase)
  })

  it.each(['unsigned-card', 'tampered-card'])(
    'rejects %s before transport or follow-up signing',
    async (mode) => {
      fixture.mode = mode
      const stages: string[] = []
      await expect(
        runA2aHandoffProof({
          nowMs: 1_779_840_000_000,
          onTiming: (timing) => {
            stages.push(timing.key)
          },
        }),
      ).rejects.toThrow('Agent Card signature verification failed')
      expect(fixture.requests).toHaveLength(0)
      expect(stages).not.toContain('a2a_client_create')
      expect(stages).not.toContain('receiver_followup_sign')
    },
  )

  it.each([
    ['missing-part', 'packet data part'],
    ['tampered-body', 'expected one accepted record'],
    ['tampered-record', 'expected one accepted record'],
    ['missing-proof', 'expected one accepted record'],
    ['rpc-error', 'fixture invalid request'],
    ['http-error', '503'],
    ['invalid-json', 'JSON'],
  ])('rejects %s before follow-up signing', async (mode, message) => {
    fixture.mode = mode!
    const stages: string[] = []
    await expect(
      runA2aHandoffProof({
        nowMs: 1_779_840_000_000,
        onTiming: (timing) => {
          stages.push(timing.key)
        },
      }),
    ).rejects.toThrow(message)
    expect(fixture.requests).toHaveLength(1)
    expect(stages).not.toContain('receiver_followup_sign')
    expect(stages).toContain('log_server_close')
  })
})
