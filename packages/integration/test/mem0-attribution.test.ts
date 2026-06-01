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
  attributeMem0Memory,
  resolveMem0PrivateKey,
  type AtribMem0Sidecar,
  type Mem0LikeMemory,
} from '../src/mem0-attribution.js'

type FixtureMessage = { role: 'user' | 'assistant'; content: string }
type AddOptions = { userId: string; metadata?: Record<string, unknown>; simulateLoss?: boolean }
type SearchOptions = { filters?: { userId?: string }; topK?: number }
type AddResult = { results: Array<{ id: string; memory: string; userId: string }> }
type SearchResult = {
  results: Array<{ id: string; memory: string; userId: string; score: number }>
}

const privateKey = new Uint8Array(32).fill(19)
const contextId = '4bf92f3577b34da6a3ce929d0e0e4736'

class FixtureMem0Memory {
  private readonly memories: Array<{ id: string; memory: string; userId: string }> = []

  async add(messages: FixtureMessage[], options: AddOptions): Promise<AddResult> {
    const extracted = messages
      .filter((message) => message.role === 'user')
      .map((message) => ({
        id: `mem-${this.memories.length + 1}`,
        memory: extractMemory(message.content),
        userId: options.userId,
      }))
    const kept = options.simulateLoss ? extracted.slice(0, 1) : extracted
    this.memories.push(...kept)
    return { results: kept }
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult> {
    const userId = options.filters?.userId
    const topK = options.topK ?? 10
    const q = query.toLowerCase()
    return {
      results: this.memories
        .filter((item) => userId === undefined || item.userId === userId)
        .filter((item) => item.memory.toLowerCase().includes('sci-fi') || q.includes('movie'))
        .slice(0, topK)
        .map((item) => ({ ...item, score: 0.89 })),
    }
  }
}

describe('mem0 attribution wrapper', () => {
  it('preserves add and search results while signing hash-only records', async () => {
    const records: AtribRecord[] = []
    const sidecars: AtribMem0Sidecar[] = []
    const baseline = new FixtureMem0Memory()
    const attributed = attributeMem0Memory(new FixtureMem0Memory(), {
      privateKey,
      contextId,
      logSubmission: 'disabled',
      now: () => 1_780_354_200_000,
      onRecord: (record, sidecar) => {
        records.push(record)
        sidecars.push(sidecar)
      },
    })
    const messages: FixtureMessage[] = [
      { role: 'user', content: 'I love sci-fi movies but not thrillers.' },
      { role: 'assistant', content: 'I will remember sci-fi.' },
    ]
    const options = { userId: 'alice', metadata: { category: 'movie_recommendations' } }

    const expectedAdd = await baseline.add(messages, options)
    const actualAdd = await attributed.add(messages, options)
    const expectedSearch = await baseline.search('What movie preferences do you remember?', {
      filters: { userId: 'alice' },
      topK: 3,
    })
    const actualSearch = await attributed.search('What movie preferences do you remember?', {
      filters: { userId: 'alice' },
      topK: 3,
    })

    expect(actualAdd).toEqual(expectedAdd)
    expect(actualSearch).toEqual(expectedSearch)
    expect(records.map((record) => record.tool_name)).toEqual([
      'mem0.memory.add',
      'mem0.memory.search',
    ])
    expect(records[0]!.args_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(records[0]!.result_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(records[1]!.args_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(records[1]!.result_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(JSON.stringify(records)).not.toContain('sci-fi')
    expect(JSON.stringify(sidecars[0]!.args)).toContain('sci-fi')
    expect(await verifyRecord(records[0]!)).toBe(true)
    expect(await verifyRecord(records[1]!)).toBe(true)
  })

  it('chains add and search records in one context', async () => {
    const memory = attributeMem0Memory(new FixtureMem0Memory(), {
      privateKey,
      contextId,
      logSubmission: 'disabled',
    })

    await memory.add([{ role: 'user', content: 'I prefer sci-fi.' }], { userId: 'alice' })
    await memory.search('movie preference', { filters: { userId: 'alice' } })

    const records = memory.getSignedRecords()
    const firstHash = `sha256:${hexEncode(sha256(canonicalRecord(records[0]!)))}`
    expect(records).toHaveLength(2)
    expect(records[0]!.chain_root).toBe(genesisChainRoot(contextId))
    expect(records[1]!.chain_root).toBe(firstHash)
  })

  it('passes through without signing when no private key is configured', async () => {
    const memory = attributeMem0Memory(new FixtureMem0Memory(), {
      privateKey: '',
      logSubmission: 'disabled',
    })

    const result = await memory.add([{ role: 'user', content: 'I prefer sci-fi.' }], {
      userId: 'alice',
    })

    expect(result.results).toHaveLength(1)
    expect(memory.creatorKey).toBe('')
    expect(memory.getSignedRecords()).toHaveLength(0)
  })

  it('signs failed mem0 calls without changing the thrown error', async () => {
    const error = new Error('vector store unavailable')
    const failingMemory: Mem0LikeMemory<[], AddResult, [string], SearchResult> = {
      add: async () => ({ results: [] }),
      search: async () => {
        throw error
      },
    }
    const memory = attributeMem0Memory(failingMemory, {
      privateKey,
      logSubmission: 'disabled',
    })

    await expect(memory.search('movie preference')).rejects.toThrow(error)

    const records = memory.getSignedRecords()
    const sidecars = memory.getSidecars()
    expect(records).toHaveLength(1)
    expect(records[0]!.tool_name).toBe('mem0.memory.search')
    expect(sidecars[0]!.status).toBe('error')
    expect(sidecars[0]!.status === 'error' ? sidecars[0]!.error.message : '').toBe(
      'vector store unavailable',
    )
    expect(await verifyRecord(records[0]!)).toBe(true)
  })

  it('accepts base64url and hex private key strings', () => {
    expect(resolveMem0PrivateKey(base64urlEncode(privateKey))).toEqual(privateKey)
    expect(resolveMem0PrivateKey(Buffer.from(privateKey).toString('hex'))).toEqual(privateKey)
  })
})

function extractMemory(content: string): string {
  if (content.toLowerCase().includes('sci-fi')) {
    return 'User prefers sci-fi movies.'
  }
  return content
}
