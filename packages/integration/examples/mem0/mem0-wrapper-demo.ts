// SPDX-License-Identifier: Apache-2.0

import { deepStrictEqual, strict as assert } from 'node:assert'
import { canonicalRecord, hexEncode, sha256, verifyRecord } from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'
import { attributeMem0Memory, type AtribMem0Sidecar } from '../../src/mem0-attribution.js'

type Message = { role: 'user' | 'assistant'; content: string }
type AddOptions = { userId: string; metadata?: Record<string, unknown>; simulateLoss?: boolean }
type SearchOptions = { filters?: { userId?: string }; topK?: number }
type AddResult = { results: Array<{ id: string; memory: string; userId: string }> }
type SearchResult = {
  results: Array<{ id: string; memory: string; userId: string; score: number }>
}

const privateKey = new Uint8Array(32).fill(29)
const contextId = '4bf92f3577b34da6a3ce929d0e0e4736'

class DemoMem0Memory {
  private readonly memories: Array<{ id: string; memory: string; userId: string }> = []

  async add(messages: Message[], options: AddOptions): Promise<AddResult> {
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

const records: AtribRecord[] = []
const sidecars: AtribMem0Sidecar[] = []
const baseline = new DemoMem0Memory()
const attributed = attributeMem0Memory(new DemoMem0Memory(), {
  privateKey,
  contextId,
  logSubmission: 'disabled',
  onRecord: (record, sidecar) => {
    records.push(record)
    sidecars.push(sidecar)
  },
})

const messages: Message[] = [
  { role: 'user', content: 'I love sci-fi movies but do not like thrillers.' },
  { role: 'assistant', content: 'I will remember sci-fi and avoid thrillers.' },
]
const addOptions: AddOptions = {
  userId: 'alice',
  metadata: { category: 'movie_recommendations' },
}

const expectedAdd = await baseline.add(messages, addOptions)
const actualAdd = await attributed.add(messages, addOptions)
deepStrictEqual(actualAdd, expectedAdd)

const searchArgs = [
  'What movie preferences do you remember?',
  { filters: { userId: 'alice' }, topK: 3 },
] as const
const expectedSearch = await baseline.search(...searchArgs)
const actualSearch = await attributed.search(...searchArgs)
deepStrictEqual(actualSearch, expectedSearch)

const lossyAdd = await attributed.add(
  [
    { role: 'user', content: 'I also like space opera.' },
    { role: 'user', content: 'I prefer quiet theaters.' },
  ],
  { userId: 'alice', simulateLoss: true },
)
assert.equal(lossyAdd.results.length, 1)

const invalid = []
for (const record of records) {
  if (!(await verifyRecord(record))) invalid.push(record.tool_name)
}
if (invalid.length > 0) {
  throw new Error(`invalid signed record(s): ${invalid.join(', ')}`)
}

const publicRecordJson = JSON.stringify(records)
assert.equal(publicRecordJson.includes('sci-fi'), false)
assert.equal(publicRecordJson.includes('quiet theaters'), false)
assert.equal(JSON.stringify(sidecars[0]!.args).includes('sci-fi'), true)

console.log(
  JSON.stringify(
    {
      ok: true,
      note: 'Demo memory implements the mem0 add/search boundary without external LLM calls.',
      context_id: contextId,
      signed_records: records.length,
      operations: records.map((record) => record.tool_name),
      record_hashes: records.map(
        (record) => `sha256:${hexEncode(sha256(canonicalRecord(record)))}`,
      ),
      last_record_hash: attributed.getLastRecordHash(),
      mem0_returns_unchanged: true,
      lossy_add_still_signed: lossyAdd.results.length < 2,
      public_records_hash_only: true,
    },
    null,
    2,
  ),
)

function extractMemory(content: string): string {
  const lower = content.toLowerCase()
  if (lower.includes('sci-fi')) return 'User prefers sci-fi movies.'
  if (lower.includes('space opera')) return 'User likes space opera.'
  if (lower.includes('quiet theaters')) return 'User prefers quiet theaters.'
  return content
}
