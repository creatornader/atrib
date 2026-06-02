import { createMemory, loadMemory, staticBlock } from 'llamaindex'
import { describe, expect, it } from 'vitest'
import {
  base64urlEncode,
  canonicalRecord,
  genesisChainRoot,
  hexEncode,
  sha256,
  verifyRecord,
} from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'
import {
  attributeLlamaIndexMemory,
  resolveLlamaIndexMemoryPrivateKey,
  type AtribLlamaIndexMemorySidecar,
  type LlamaIndexMemoryLike,
} from '../src/llamaindex-memory-attribution.js'

const privateKey = new Uint8Array(32).fill(41)
const contextId = '5d1f4a5a6a2d4990a35c6e36f8992a6d'
const userMemory = 'Alice prefers quiet sci-fi movies.'
const staticMemory = 'The user likes verifiable logs.'

describe('LlamaIndex memory attribution wrapper', () => {
  it('preserves memory values while signing hash-only records', async () => {
    const records: AtribRecord[] = []
    const sidecars: AtribLlamaIndexMemorySidecar[] = []
    const memory = attributeLlamaIndexMemory(
      createMemory({
        memoryBlocks: [staticBlock({ content: staticMemory })],
      }),
      {
        privateKey,
        contextId,
        logSubmission: 'disabled',
        now: () => 1_780_356_000_000,
        onRecord: (record, sidecar) => {
          records.push(record)
          sidecars.push(sidecar)
        },
      },
    )

    await memory.add({ role: 'user', content: userMemory })
    await memory.add({ role: 'assistant', content: 'Saved.' })
    const llamaIndexMessages = await memory.get()
    const vercelMessages = await memory.get({ type: 'vercel' })
    const llmMessages = await memory.getLLM()
    const snapshot = memory.snapshot()
    await memory.flushAtrib()
    const restored = loadMemory(snapshot)

    expect(messageSummaries(llamaIndexMessages)).toEqual([
      { role: 'user', content: userMemory },
      { role: 'assistant', content: 'Saved.' },
    ])
    expect(vercelMessages[0]).toMatchObject({
      role: 'user',
      content: userMemory,
    })
    expect(messageSummaries(llmMessages)).toEqual([
      { role: 'user', content: staticMemory },
      { role: 'user', content: userMemory },
      { role: 'assistant', content: 'Saved.' },
    ])
    expect(messageSummaries(await restored.get())).toEqual(messageSummaries(llamaIndexMessages))
    expect(records.map((record) => record.tool_name)).toEqual([
      'llamaindex.memory.add',
      'llamaindex.memory.add',
      'llamaindex.memory.get',
      'llamaindex.memory.get',
      'llamaindex.memory.get_llm',
      'llamaindex.memory.snapshot',
    ])
    expect(records[0]!.args_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(records[0]!.result_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(records.at(-1)!.args_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(records.at(-1)!.result_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(JSON.stringify(records)).not.toContain('quiet sci-fi')
    expect(JSON.stringify(sidecars)).toContain('quiet sci-fi')
    for (const record of records) {
      expect(await verifyRecord(record)).toBe(true)
    }
  })

  it('chains memory records in one context', async () => {
    const memory = attributeLlamaIndexMemory(createMemory(), {
      privateKey,
      contextId,
      logSubmission: 'disabled',
    })

    await memory.add({ role: 'user', content: userMemory })
    await memory.get()

    const records = memory.getSignedRecords()
    const firstHash = `sha256:${hexEncode(sha256(canonicalRecord(records[0]!)))}`
    expect(records).toHaveLength(2)
    expect(records[0]!.chain_root).toBe(genesisChainRoot(contextId))
    expect(records[1]!.chain_root).toBe(firstHash)
  })

  it('passes through without signing when no private key is configured', async () => {
    const memory = attributeLlamaIndexMemory(createMemory(), {
      privateKey: '',
      logSubmission: 'disabled',
    })

    await memory.add({ role: 'user', content: userMemory })
    const messages = await memory.get()

    expect(messageSummaries(messages)).toEqual([{ role: 'user', content: userMemory }])
    expect(memory.creatorKey).toBe('')
    expect(memory.getSignedRecords()).toHaveLength(0)
  })

  it('signs clear and manageMemoryBlocks calls', async () => {
    const memory = attributeLlamaIndexMemory(
      createMemory({
        tokenLimit: 1000,
        memoryBlocks: [staticBlock({ content: staticMemory })],
      }),
      {
        privateKey,
        contextId,
        logSubmission: 'disabled',
      },
    )

    await memory.add({ role: 'user', content: userMemory })
    await memory.manageMemoryBlocks()
    await memory.clear()
    const messages = await memory.get()

    expect(messageSummaries(messages)).toEqual([])
    expect(memory.getSignedRecords().map((record) => record.tool_name)).toEqual([
      'llamaindex.memory.add',
      'llamaindex.memory.manage_memory_blocks',
      'llamaindex.memory.clear',
      'llamaindex.memory.get',
    ])
  })

  it('signs failed memory calls without changing the thrown error', async () => {
    const error = new Error('memory unavailable')
    const failingMemory = {
      add: async () => {},
      get: async () => {
        throw error
      },
      getLLM: async () => [],
      manageMemoryBlocks: async () => {},
      clear: async () => {},
      snapshot: () => '',
    } as unknown as LlamaIndexMemoryLike
    const memory = attributeLlamaIndexMemory(failingMemory, {
      privateKey,
      logSubmission: 'disabled',
    })

    await expect(memory.get()).rejects.toThrow(error)

    const records = memory.getSignedRecords()
    const sidecars = memory.getSidecars()
    expect(records).toHaveLength(1)
    expect(records[0]!.tool_name).toBe('llamaindex.memory.get')
    expect(sidecars[0]!.status).toBe('error')
    expect(sidecars[0]!.status === 'error' ? sidecars[0]!.error.message : '').toBe(
      'memory unavailable',
    )
    expect(await verifyRecord(records[0]!)).toBe(true)
  })

  it('accepts base64url and hex private key strings', () => {
    expect(resolveLlamaIndexMemoryPrivateKey(base64urlEncode(privateKey))).toEqual(privateKey)
    expect(resolveLlamaIndexMemoryPrivateKey(Buffer.from(privateKey).toString('hex'))).toEqual(
      privateKey,
    )
  })
})

function messageSummaries(messages: unknown): Array<{ role: string; content: unknown }> {
  if (!Array.isArray(messages)) throw new Error('expected messages array')
  return messages.map((message) => {
    if (!message || typeof message !== 'object') throw new Error('expected message object')
    const item = message as { role?: unknown; content?: unknown }
    if (typeof item.role !== 'string') throw new Error('expected message role')
    return { role: item.role, content: item.content }
  })
}
