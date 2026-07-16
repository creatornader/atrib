// @atrib/annotate basic correctness tests.
//
// Exercises the narrow Zod schema (AnnotateInput) and the server-construction
// surface. The underlying signing pipeline (handleEmit + buildAndSignEmitRecord)
// is owned by @atrib/emit and tested there; the value @atrib/annotate adds
// is the narrow input contract per D079, so that's what we test here.

import { describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { AnnotateInput, createAtribAnnotateServer } from '../src/index.js'

const VALID_HASH = 'sha256:' + 'a'.repeat(64)
const VALID_CONTEXT = 'a'.repeat(32)

async function callAnnotateTool(
  server: Awaited<ReturnType<typeof createAtribAnnotateServer>>,
  args: Record<string, unknown>,
) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.mcp.connect(serverTransport)
  const client = new Client({ name: 'atrib-annotate-test-client', version: '0.0.0' })
  await client.connect(clientTransport)
  try {
    return await client.callTool({ name: 'atrib-annotate', arguments: args })
  } finally {
    await client.close()
    await server.mcp.close()
  }
}

describe('createAtribAnnotateServer', () => {
  it('returns an McpServer + flush handle', async () => {
    const server = await createAtribAnnotateServer({
      // logEndpoint omitted; no records will actually submit because no
      // signing key is resolved in the test environment, and that's fine,
      // we're testing surface construction, not the signing pipeline.
    })
    expect(server.mcp).toBeTruthy()
    expect(typeof server.flush).toBe('function')
    await server.flush()
  })

  it('surfaces handleEmit guard refusals as MCP tool errors', async () => {
    const server = await createAtribAnnotateServer({ key: null, logEndpoint: 'http://127.0.0.1:0' })
    try {
      const result = await callAnnotateTool(server, {
        annotates: VALID_HASH,
        importance: 'high',
        summary: 'missing key refusal',
        context_id: VALID_CONTEXT,
      })

      expect(result.isError).toBe(true)
      expect(result.content[0]?.type).toBe('text')
      expect(result.content[0]?.text).toContain('no signing key resolved')
    } finally {
      await server.flush()
    }
  })
})

describe('AnnotateInput schema (D079 narrow contract)', () => {
  // These tests exercise the actual exported Zod schema. They prove the
  // schema rejects malformed input rather than just asserting my test
  // data matches my test assertions (the bug shape from initial draft).

  it('accepts minimal valid input (annotates + importance + summary)', () => {
    const parsed = AnnotateInput.parse({
      annotates: VALID_HASH,
      importance: 'high',
      summary: 'a one-line gist',
    })
    expect(parsed.annotates).toBe(VALID_HASH)
    expect(parsed.importance).toBe('high')
    expect(parsed.summary).toBe('a one-line gist')
  })

  it('rejects missing annotates field', () => {
    expect(() =>
      AnnotateInput.parse({ importance: 'high', summary: 'gist' }),
    ).toThrow()
  })

  it('rejects missing importance field', () => {
    expect(() =>
      AnnotateInput.parse({ annotates: VALID_HASH, summary: 'gist' }),
    ).toThrow()
  })

  it('rejects missing summary field', () => {
    expect(() =>
      AnnotateInput.parse({ annotates: VALID_HASH, importance: 'high' }),
    ).toThrow()
  })

  it('rejects malformed annotates (not sha256:<64-hex>)', () => {
    const malformed = [
      'sha256:' + 'A'.repeat(64), // uppercase
      'sha256:' + 'a'.repeat(63), // too short
      'sha256:' + 'a'.repeat(65), // too long
      'not-a-hash',
      'sha1:' + 'a'.repeat(40),
      '',
    ]
    for (const v of malformed) {
      expect(() =>
        AnnotateInput.parse({ annotates: v, importance: 'high', summary: 'g' }),
      ).toThrow()
    }
  })

  it('rejects unknown importance values', () => {
    for (const bad of ['urgent', 'HIGH', 'p0', '', 'normal']) {
      expect(() =>
        AnnotateInput.parse({
          annotates: VALID_HASH,
          importance: bad,
          summary: 'g',
        }),
      ).toThrow()
    }
  })

  it('accepts all 5 spec importance values', () => {
    for (const ok of ['critical', 'high', 'medium', 'low', 'noise']) {
      expect(() =>
        AnnotateInput.parse({
          annotates: VALID_HASH,
          importance: ok,
          summary: 'g',
        }),
      ).not.toThrow()
    }
  })

  it('rejects empty summary', () => {
    expect(() =>
      AnnotateInput.parse({
        annotates: VALID_HASH,
        importance: 'high',
        summary: '',
      }),
    ).toThrow()
  })

  it('rejects summary > 2048 chars', () => {
    expect(() =>
      AnnotateInput.parse({
        annotates: VALID_HASH,
        importance: 'high',
        summary: 'a'.repeat(2049),
      }),
    ).toThrow()
    // 2048 exactly should pass.
    expect(() =>
      AnnotateInput.parse({
        annotates: VALID_HASH,
        importance: 'high',
        summary: 'a'.repeat(2048),
      }),
    ).not.toThrow()
  })

  it('rejects topics array > 16 entries', () => {
    expect(() =>
      AnnotateInput.parse({
        annotates: VALID_HASH,
        importance: 'high',
        summary: 'g',
        topics: Array(17).fill('t'),
      }),
    ).toThrow()
    expect(() =>
      AnnotateInput.parse({
        annotates: VALID_HASH,
        importance: 'high',
        summary: 'g',
        topics: Array(16).fill('t'),
      }),
    ).not.toThrow()
  })

  it('accepts optional context_id when valid 32-hex', () => {
    expect(() =>
      AnnotateInput.parse({
        annotates: VALID_HASH,
        importance: 'high',
        summary: 'g',
        context_id: VALID_CONTEXT,
      }),
    ).not.toThrow()
  })

  it('rejects malformed context_id', () => {
    for (const bad of ['A'.repeat(32), 'a'.repeat(31), 'a'.repeat(33), 'xyz']) {
      expect(() =>
        AnnotateInput.parse({
          annotates: VALID_HASH,
          importance: 'high',
          summary: 'g',
          context_id: bad,
        }),
      ).toThrow()
    }
  })

  it('accepts informed_by array of sha256 refs', () => {
    expect(() =>
      AnnotateInput.parse({
        annotates: VALID_HASH,
        importance: 'high',
        summary: 'g',
        informed_by: [VALID_HASH, 'sha256:' + 'b'.repeat(64)],
      }),
    ).not.toThrow()
  })

  it('rejects informed_by entries that are not sha256:<64-hex>', () => {
    expect(() =>
      AnnotateInput.parse({
        annotates: VALID_HASH,
        importance: 'high',
        summary: 'g',
        informed_by: [VALID_HASH, 'not-a-hash'],
      }),
    ).toThrow()
  })
})
