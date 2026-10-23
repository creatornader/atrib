import { describe, it, expect, vi } from 'vitest'
import { atrib } from '../src/middleware.js'
import { base64urlEncode } from '../src/base64url.js'
import { getPublicKey, signRecord, verifyRecord } from '../src/signing.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { RecordSigner } from '../src/signer-socket.js'
import type { AtribRecord } from '../src/types.js'

const HOST_KEY = new Uint8Array(32).fill(11)
const SEED_KEY_B64 = base64urlEncode(new Uint8Array(32).fill(42))

type Handler = (request: unknown, extra: unknown) => Promise<unknown>

function mockServer() {
  const handlers = new Map<string, Handler>()
  const underlying = {
    setRequestHandler(schema: { shape?: { method?: { value?: string } } }, handler: Handler) {
      handlers.set(schema?.shape?.method?.value ?? 'unknown', handler)
    },
  }
  const server = { server: underlying } as unknown as McpServer
  const register = (handler: Handler) =>
    underlying.setRequestHandler({ shape: { method: { value: 'tools/call' } } }, handler)
  return { server, register, handler: () => handlers.get('tools/call')! }
}

const request = {
  method: 'tools/call',
  params: {
    name: 'search',
    arguments: { query: 'test' },
    _meta: { traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' },
  },
}

/** A host signer that holds HOST_KEY outside the middleware. */
async function hostSigner(fail = false): Promise<RecordSigner & { calls: number }> {
  const creatorKey = base64urlEncode(await getPublicKey(HOST_KEY))
  const signer = {
    source: 'signer-socket' as const,
    socketPath: '/test/signer.sock',
    identity: 'test-agent',
    creatorKey,
    calls: 0,
    async signRecord(record: AtribRecord): Promise<AtribRecord> {
      signer.calls += 1
      if (fail) throw new Error('atrib: signer socket unreachable')
      return signRecord(record, HOST_KEY)
    },
  }
  return signer
}

describe('atrib() middleware with an external signer (D190)', () => {
  it('signs through the signer with the pinned key, byte-identical to in-process signing', async () => {
    const signer = await hostSigner()
    const records: AtribRecord[] = []
    const { server, register, handler } = mockServer()
    const wrapped = atrib(server, {
      signer,
      creatorKey: SEED_KEY_B64,
      serverUrl: 'https://test.example.com',
      logSubmission: 'disabled',
      onRecord: (record) => void records.push(record),
    })
    const result = { content: [{ type: 'text', text: 'ok' }] }
    register(vi.fn().mockResolvedValue(result))

    await handler()(request, {})
    await wrapped.flush()

    expect(signer.calls).toBe(1)
    expect(records).toHaveLength(1)
    const record = records[0]!
    expect(record.creator_key).toBe(signer.creatorKey)
    expect(await verifyRecord(record)).toBe(true)
    const resigned = await signRecord({ ...record, signature: '' }, HOST_KEY)
    expect(resigned.signature).toBe(record.signature)
    expect((result as { _meta?: { atrib?: unknown } })._meta?.atrib).toBeDefined()
  })

  it('leaves the call unattributed when the signer fails, without a seed fallback', async () => {
    const signer = await hostSigner(true)
    const onRecord = vi.fn()
    const { server, register, handler } = mockServer()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const wrapped = atrib(server, {
        signer,
        creatorKey: SEED_KEY_B64,
        serverUrl: 'https://test.example.com',
        logSubmission: 'disabled',
        onRecord,
      })
      const result = { content: [{ type: 'text', text: 'ok' }] }
      register(vi.fn().mockResolvedValue(result))

      const response = await handler()(request, {})
      await wrapped.flush()

      expect(response).toBe(result)
      expect(signer.calls).toBe(1)
      expect(onRecord).not.toHaveBeenCalled()
      expect((result as { _meta?: { atrib?: unknown } })._meta?.atrib).toBeUndefined()
    } finally {
      warn.mockRestore()
      error.mockRestore()
    }
  })
})
