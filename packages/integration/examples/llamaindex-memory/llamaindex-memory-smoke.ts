// SPDX-License-Identifier: Apache-2.0

import { deepStrictEqual, strict as assert } from 'node:assert'
import { createMemory, loadMemory, staticBlock } from 'llamaindex'
import { canonicalRecord, hexEncode, sha256, verifyRecord } from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'
import {
  attributeLlamaIndexMemory,
  type AtribLlamaIndexMemorySidecar,
} from '../../src/llamaindex-memory-attribution.js'

const privateKey = new Uint8Array(32).fill(43)
const contextId = '4c4f6f8f4cb44c33a7df6f65a728bcbb'
const userMemory = 'Alice prefers quiet sci-fi movies.'
const attributedMemory = attributeLlamaIndexMemory(
  createMemory({
    tokenLimit: 1000,
    memoryBlocks: [
      staticBlock({
        content: 'The user likes verifiable logs.',
      }),
    ],
  }),
  {
    privateKey,
    contextId,
    logSubmission: 'disabled',
  },
)

await attributedMemory.add({ role: 'user', content: userMemory })
await attributedMemory.add({ role: 'assistant', content: 'Saved.' })
const messages = await attributedMemory.get()
const llmMessages = await attributedMemory.getLLM()
const snapshot = attributedMemory.snapshot()
await attributedMemory.flushAtrib()
const restoredMessages = await loadMemory(snapshot).get()

deepStrictEqual(messageSummaries(messages), [
  { role: 'user', content: userMemory },
  { role: 'assistant', content: 'Saved.' },
])
deepStrictEqual(messageSummaries(restoredMessages), messageSummaries(messages))
deepStrictEqual(messageSummaries(llmMessages), [
  { role: 'user', content: 'The user likes verifiable logs.' },
  { role: 'user', content: userMemory },
  { role: 'assistant', content: 'Saved.' },
])

const records = attributedMemory.getSignedRecords()
const sidecars = attributedMemory.getSidecars()
assert.equal(records.length, 5)
assert.deepEqual(
  records.map((record: AtribRecord) => record.tool_name),
  [
    'llamaindex.memory.add',
    'llamaindex.memory.add',
    'llamaindex.memory.get',
    'llamaindex.memory.get_llm',
    'llamaindex.memory.snapshot',
  ],
)

const invalid = []
for (const record of records) {
  if (!(await verifyRecord(record))) invalid.push(record.tool_name)
}
if (invalid.length > 0) {
  throw new Error(`invalid signed record(s): ${invalid.join(', ')}`)
}

const publicRecordJson = JSON.stringify(records)
const sidecarJson = JSON.stringify(sidecars)
assert.equal(publicRecordJson.includes('quiet sci-fi'), false)
assert.equal(sidecarJson.includes('quiet sci-fi'), true)

console.log(
  JSON.stringify(
    {
      ok: true,
      note: 'Runs a real llamaindex createMemory() instance through an attributed memory wrapper.',
      context_id: contextId,
      signed_records: records.length,
      operations: records.map((record: AtribRecord) => record.tool_name),
      record_hashes: records.map(
        (record: AtribRecord) => `sha256:${hexEncode(sha256(canonicalRecord(record)))}`,
      ),
      last_record_hash: attributedMemory.getLastRecordHash(),
      llamaindex_returns_unchanged: true,
      snapshot_restores_unchanged: true,
      public_records_hash_only: true,
      sidecar_operations: sidecars.map(
        (sidecar: AtribLlamaIndexMemorySidecar) => sidecar.operation,
      ),
    },
    null,
    2,
  ),
)

function messageSummaries(messages: unknown): Array<{ role: string; content: unknown }> {
  if (!Array.isArray(messages)) throw new Error('expected messages array')
  return messages.map((message) => {
    if (!message || typeof message !== 'object') throw new Error('expected message object')
    const item = message as { role?: unknown; content?: unknown }
    if (typeof item.role !== 'string') throw new Error('expected message role')
    return { role: item.role, content: item.content }
  })
}
