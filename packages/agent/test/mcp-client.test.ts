import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { base64urlEncode } from '@atrib/mcp'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { atrib } from '../src/middleware.js'
import { wrapMcpClient, type MinimalMcpClient } from '../src/adapters/mcp-client.js'

const CREATOR_KEY = base64urlEncode(new Uint8Array(32).fill(73))

class NativeHeadersClient {
  readonly result = {
    content: [{ type: 'text', text: 'paid result' }],
    headers: new Headers({ 'Payment-Receipt': 'base64-receipt' }),
    responseHeaders: new Headers({ 'Payment-Receipt': 'base64-receipt' }),
  }

  async callTool(_params: { name: string; arguments?: Record<string, unknown> }) {
    return this.result
  }
}

describe('wrapMcpClient MPP MCP completion', () => {
  it('typechecks the concrete native Headers client without casts', () => {
    const program = ts.createProgram([fileURLToPath(import.meta.url)], {
      noEmit: true,
      strict: true,
      exactOptionalPropertyTypes: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      types: ['node'],
    })
    const diagnostics = ts
      .getPreEmitDiagnostics(program)
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
    expect(diagnostics).toEqual([])
  })

  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null
      if (body?.event_type === 'https://atrib.dev/v1/types/transaction') {
        return new Response(JSON.stringify({ logIndex: 1 }), { status: 200 })
      }
      return new Response(JSON.stringify({ logIndex: 1 }), { status: 200 })
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('passes the MCP receipt through and emits one receipt-identified transaction', async () => {
    const mppResult = {
      content: [{ type: 'text', text: 'paid result' }],
      _meta: {
        'org.paymentauth/receipt': {
          status: 'success',
          method: 'tempo',
          timestamp: '2026-09-02T12:00:15Z',
          reference: '0xtx789',
          challengeId: 'ch_mcp_789',
        },
      },
    }
    const rawClient: MinimalMcpClient = {
      async callTool(params) {
        expect(params._meta?.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/)
        return mppResult
      },
    }
    const submissions: Array<Record<string, unknown>> = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body =
        typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {}
      submissions.push(body)
      return new Response(JSON.stringify({ logIndex: 1 }), { status: 200 })
    })

    const interceptor = atrib({ creatorKey: CREATOR_KEY })
    const client = wrapMcpClient(rawClient, interceptor, {
      serverUrl: 'https://paid.example.com/mcp',
    })
    const result = await client.callTool({ name: 'paid_tool', arguments: {} })
    await interceptor.flush()

    expect(result).toBe(mppResult)
    const transactions = submissions.filter(
      (submission) => submission.event_type === 'https://atrib.dev/v1/types/transaction',
    )
    expect(transactions).toHaveLength(1)
    expect(transactions[0]?.content_id).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(JSON.stringify(transactions[0])).not.toContain('org.paymentauth/receipt')
  })

  it('passes client-exposed HTTP response headers to payment detection', async () => {
    const submissions: Array<Record<string, unknown>> = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body =
        typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {}
      submissions.push(body)
      return new Response(JSON.stringify({ logIndex: 1 }), { status: 200 })
    })

    const rawClient: MinimalMcpClient = {
      async callTool() {
        return {
          content: [{ type: 'text', text: 'paid result' }],
          headers: { 'Payment-Receipt': 'base64-receipt' },
        }
      },
    }

    const interceptor = atrib({ creatorKey: CREATOR_KEY })
    const client = wrapMcpClient(rawClient, interceptor, {
      serverUrl: 'https://paid.example.com/mcp',
    })
    await client.callTool({ name: 'paid_tool', arguments: {} })
    await interceptor.flush()

    expect(
      submissions.filter(
        (submission) => submission.event_type === 'https://atrib.dev/v1/types/transaction',
      ),
    ).toHaveLength(1)
  })

  it('accepts a typed client with native Headers and preserves its receipt response', async () => {
    const rawClient = new NativeHeadersClient()
    const submissions: Array<Record<string, unknown>> = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      if (typeof init?.body === 'string') submissions.push(JSON.parse(init.body))
      return new Response(JSON.stringify({ logIndex: 1 }), { status: 200 })
    })
    const interceptor = atrib({ creatorKey: CREATOR_KEY })
    const client = wrapMcpClient(rawClient, interceptor)
    const result = await client.callTool({ name: 'paid_tool' })
    await interceptor.flush()
    expect(result).toBe(rawClient.result)
    expect(result.headers.get('payment-receipt')).toBe('base64-receipt')
    expect(
      submissions.filter((entry) => entry.event_type === 'https://atrib.dev/v1/types/transaction'),
    ).toHaveLength(1)
  })
})
