import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import type { WrapConfig } from '../src/config.js'

vi.mock('@atrib/mcp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@atrib/mcp')>()
  return {
    ...actual,
    createAtribProxy: vi.fn(async (options) => ({ options })),
  }
})

const RECORD_A = 'sha256:' + 'a'.repeat(64)

function makeConfig(recordFile: string): WrapConfig {
  return {
    name: 'agent-bridge',
    agent: 'codex',
    upstream: {
      command: 'agent-bridge',
      args: ['mcp'],
      env: { AGENT_BRIDGE_AGENT: 'codex' },
    },
    serverUrl: 'mcp://agent-bridge.local',
    logEndpoint: 'http://localhost:3100/v1/entries',
    recordFile,
    autoChain: true,
    autoChainFallback: 'fresh',
    contextIdSource: 'harness',
    autoDetectInformedByFromArgs: false,
    tools: {
      post_context: {
        injectReceiptId: true,
        informedByPaths: ['informed_by', 'metadata.message_envelope.informed_by'],
      },
    },
    disclosure: {
      post_context: {
        tool_name: true,
        args: {
          source: true,
          category: true,
          priority: true,
          content: { hash: true },
        },
      },
    },
  }
}

describe('wrap wiring', () => {
  it('passes bridge-safe context and informed_by options to createAtribProxy', async () => {
    const { wrap } = await import('../src/wrap.js')
    const { createAtribProxy } = await import('@atrib/mcp')
    const createAtribProxyMock = vi.mocked(createAtribProxy)
    createAtribProxyMock.mockClear()

    const dir = mkdtempSync(join(tmpdir(), 'atrib-wrap-wiring-'))
    const recordFile = join(dir, 'records.jsonl')

    try {
      await wrap(makeConfig(recordFile), {
        resolveKey: async () => ({
          seedB64url: 'seed',
          source: 'env',
          publicKeyB64url: 'pub',
        }),
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }

    expect(createAtribProxyMock).toHaveBeenCalledTimes(1)
    const options = createAtribProxyMock.mock.calls[0]?.[0]
    expect(options?.upstream).toEqual({
      type: 'stdio',
      command: 'agent-bridge',
      args: ['mcp'],
      env: { AGENT_BRIDGE_AGENT: 'codex' },
    })
    expect(options?.atrib.autoChain).toBe(true)
    expect(options?.atrib.autoChainFallback).toBe('fresh')
    expect(options?.atrib.autoDetectInformedByFromArgs).toBe(false)
    expect(typeof options?.atrib.contextIdResolver).toBe('function')
    expect(typeof options?.atrib.preCallTransform).toBe('function')
    expect(typeof options?.atrib.informedBy).toBe('function')
    expect(options?.atrib.disclosure).toEqual({
      post_context: {
        tool_name: true,
        args: {
          source: true,
          category: true,
          priority: true,
          content: { hash: true },
        },
      },
    })

    expect(
      options?.atrib.informedBy?.({
        name: 'post_context',
        arguments: {
          informed_by: RECORD_A,
          content: `not scanned ${'sha256:' + 'b'.repeat(64)}`,
        },
      }),
    ).toEqual([RECORD_A])
  })

  it('passes archive submission config to @atrib/mcp', async () => {
    const { wrap } = await import('../src/wrap.js')
    const { createAtribProxy } = await import('@atrib/mcp')
    const createAtribProxyMock = vi.mocked(createAtribProxy)
    createAtribProxyMock.mockClear()

    const dir = mkdtempSync(join(tmpdir(), 'atrib-wrap-archive-'))
    const recordFile = join(dir, 'records.jsonl')

    try {
      await wrap(
        {
          ...makeConfig(recordFile),
          archiveSubmission: { endpoint: 'https://archive.test/v1' },
        } as unknown as WrapConfig,
        {
          resolveKey: async () => ({
            seedB64url: 'seed',
            source: 'env',
            publicKeyB64url: 'pub',
          }),
        },
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }

    const options = createAtribProxyMock.mock.calls[0]?.[0]
    expect(options?.atrib.archiveSubmission).toEqual({ endpoint: 'https://archive.test/v1' })
  })
})
