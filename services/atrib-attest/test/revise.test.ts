// @atrib/revise basic correctness tests.
//
// Exercises the narrow Zod schema (ReviseInput) and the server-construction
// surface. The underlying signing pipeline (handleEmit + buildAndSignEmitRecord)
// is owned by @atrib/emit and tested there; the value @atrib/revise adds is
// the narrow input contract per D079, so that's what we test here.

import { describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { ReviseInput, createAtribReviseServer } from '../src/index.js'

const VALID_HASH = 'sha256:' + 'a'.repeat(64)
const VALID_CONTEXT = 'a'.repeat(32)

async function callReviseTool(
  server: Awaited<ReturnType<typeof createAtribReviseServer>>,
  args: Record<string, unknown>,
) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.mcp.connect(serverTransport)
  const client = new Client({ name: 'atrib-revise-test-client', version: '0.0.0' })
  await client.connect(clientTransport)
  try {
    return await client.callTool({ name: 'atrib-revise', arguments: args })
  } finally {
    await client.close()
    await server.mcp.close()
  }
}

describe('createAtribReviseServer', () => {
  it('returns an McpServer + flush handle', async () => {
    const server = await createAtribReviseServer({})
    expect(server.mcp).toBeTruthy()
    expect(typeof server.flush).toBe('function')
    await server.flush()
  })

  it('surfaces handleEmit guard refusals as MCP tool errors', async () => {
    const server = await createAtribReviseServer({ key: null, logEndpoint: 'http://127.0.0.1:0' })
    try {
      const result = await callReviseTool(server, {
        revises: VALID_HASH,
        prior_position: 'old position',
        new_position: 'new position',
        reason: 'missing key refusal',
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

describe('ReviseInput schema (D079 narrow contract)', () => {
  it('accepts minimal valid input (revises + prior + new + reason)', () => {
    const parsed = ReviseInput.parse({
      revises: VALID_HASH,
      prior_position: 'X is the right approach',
      new_position: 'X is wrong; Y supersedes it',
      reason: 'New evidence invalidated X.',
    })
    expect(parsed.revises).toBe(VALID_HASH)
    expect(parsed.reason).toContain('New evidence')
  })

  it('rejects missing revises', () => {
    expect(() =>
      ReviseInput.parse({
        prior_position: 'a',
        new_position: 'b',
        reason: 'c',
      }),
    ).toThrow()
  })

  it('rejects missing prior_position', () => {
    expect(() =>
      ReviseInput.parse({
        revises: VALID_HASH,
        new_position: 'b',
        reason: 'c',
      }),
    ).toThrow()
  })

  it('rejects missing new_position', () => {
    expect(() =>
      ReviseInput.parse({
        revises: VALID_HASH,
        prior_position: 'a',
        reason: 'c',
      }),
    ).toThrow()
  })

  it('rejects missing reason', () => {
    expect(() =>
      ReviseInput.parse({
        revises: VALID_HASH,
        prior_position: 'a',
        new_position: 'b',
      }),
    ).toThrow()
  })

  it('rejects malformed revises (not sha256:<64-hex>)', () => {
    const malformed = [
      'sha256:' + 'A'.repeat(64),
      'sha256:' + 'a'.repeat(63),
      'not-a-hash',
      '',
    ]
    for (const v of malformed) {
      expect(() =>
        ReviseInput.parse({
          revises: v,
          prior_position: 'a',
          new_position: 'b',
          reason: 'c',
        }),
      ).toThrow()
    }
  })

  it('rejects empty prior_position / new_position / reason', () => {
    for (const field of ['prior_position', 'new_position', 'reason']) {
      const input = {
        revises: VALID_HASH,
        prior_position: 'a',
        new_position: 'b',
        reason: 'c',
        [field]: '',
      } as Record<string, unknown>
      expect(() => ReviseInput.parse(input)).toThrow()
    }
  })

  it('rejects prior_position / new_position / reason > 4096 chars', () => {
    for (const field of ['prior_position', 'new_position', 'reason']) {
      const input = {
        revises: VALID_HASH,
        prior_position: 'a',
        new_position: 'b',
        reason: 'c',
        [field]: 'x'.repeat(4097),
      } as Record<string, unknown>
      expect(() => ReviseInput.parse(input)).toThrow()
    }
  })

  it('accepts 4096-char fields exactly', () => {
    expect(() =>
      ReviseInput.parse({
        revises: VALID_HASH,
        prior_position: 'x'.repeat(4096),
        new_position: 'y'.repeat(4096),
        reason: 'z'.repeat(4096),
      }),
    ).not.toThrow()
  })

  it('accepts optional topics array up to 16', () => {
    expect(() =>
      ReviseInput.parse({
        revises: VALID_HASH,
        prior_position: 'a',
        new_position: 'b',
        reason: 'c',
        topics: Array(16).fill('t'),
      }),
    ).not.toThrow()
    expect(() =>
      ReviseInput.parse({
        revises: VALID_HASH,
        prior_position: 'a',
        new_position: 'b',
        reason: 'c',
        topics: Array(17).fill('t'),
      }),
    ).toThrow()
  })

  it('accepts optional context_id when valid 32-hex', () => {
    expect(() =>
      ReviseInput.parse({
        revises: VALID_HASH,
        prior_position: 'a',
        new_position: 'b',
        reason: 'c',
        context_id: VALID_CONTEXT,
      }),
    ).not.toThrow()
  })

  it('rejects malformed context_id', () => {
    for (const bad of ['A'.repeat(32), 'a'.repeat(31), 'a'.repeat(33)]) {
      expect(() =>
        ReviseInput.parse({
          revises: VALID_HASH,
          prior_position: 'a',
          new_position: 'b',
          reason: 'c',
          context_id: bad,
        }),
      ).toThrow()
    }
  })

  it('accepts informed_by array of sha256 refs', () => {
    expect(() =>
      ReviseInput.parse({
        revises: VALID_HASH,
        prior_position: 'a',
        new_position: 'b',
        reason: 'c',
        informed_by: [VALID_HASH, 'sha256:' + 'b'.repeat(64)],
      }),
    ).not.toThrow()
  })

  it('rejects informed_by entries that are not sha256:<64-hex>', () => {
    expect(() =>
      ReviseInput.parse({
        revises: VALID_HASH,
        prior_position: 'a',
        new_position: 'b',
        reason: 'c',
        informed_by: ['not-a-hash'],
      }),
    ).toThrow()
  })
})
