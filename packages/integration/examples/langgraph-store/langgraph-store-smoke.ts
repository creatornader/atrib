// SPDX-License-Identifier: Apache-2.0

import { deepStrictEqual, strict as assert } from 'node:assert'
import { entrypoint, getStore, InMemoryStore } from '@langchain/langgraph'
import { canonicalRecord, hexEncode, sha256, verifyRecord } from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'
import {
  attributeLangGraphStore,
  type AtribLangGraphStoreSidecar,
} from '../../src/langgraph-store-attribution.js'

const privateKey = new Uint8Array(32).fill(37)
const contextId = '8e1e944f6bb24d3685f936e8a1091d4d'
const attributedStore = attributeLangGraphStore(new InMemoryStore(), {
  privateKey,
  contextId,
  logSubmission: 'disabled',
})

const workflow = entrypoint(
  { name: 'rememberPreference', store: attributedStore },
  async (input: { userId: string; fact: string }) => {
    const store = getStore()
    const namespace = ['users', input.userId, 'memories']
    await store.put(namespace, 'movie-preference', {
      text: input.fact,
      kind: 'preference',
    })
    const item = await store.get(namespace, 'movie-preference')
    const results = await store.search(namespace, {
      filter: { kind: 'preference' },
      limit: 5,
    })
    return {
      text: item?.value?.text,
      count: results.length,
    }
  },
)

const result = await workflow.invoke(
  { userId: 'alice', fact: 'Alice prefers quiet sci-fi movies.' },
  { configurable: { thread_id: 'atrib-langgraph-store-smoke' } },
)

deepStrictEqual(result, {
  text: 'Alice prefers quiet sci-fi movies.',
  count: 1,
})

const records = attributedStore.getSignedRecords()
const sidecars = attributedStore.getSidecars()
const batchOperationKinds = sidecars.map((sidecar) => inferBatchOperationKind(sidecar.args))
assert.equal(records.length, 3)
assert.deepEqual(
  records.map((record: AtribRecord) => record.tool_name),
  ['langgraph.store.batch', 'langgraph.store.batch', 'langgraph.store.batch'],
)
assert.deepEqual(batchOperationKinds, ['put', 'get', 'search'])

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
      note: 'Runs a real @langchain/langgraph entrypoint with an attributed InMemoryStore.',
      context_id: contextId,
      signed_records: records.length,
      operations: records.map((record: AtribRecord) => record.tool_name),
      batch_internal_operations: batchOperationKinds,
      record_hashes: records.map(
        (record: AtribRecord) => `sha256:${hexEncode(sha256(canonicalRecord(record)))}`,
      ),
      last_record_hash: attributedStore.getLastRecordHash(),
      langgraph_returns_unchanged: true,
      public_records_hash_only: true,
      sidecar_operations: sidecars.map((sidecar: AtribLangGraphStoreSidecar) => sidecar.operation),
    },
    null,
    2,
  ),
)

function inferBatchOperationKind(args: unknown): 'put' | 'get' | 'search' | 'list' | 'unknown' {
  if (!Array.isArray(args) || !Array.isArray(args[0])) return 'unknown'
  const operation = args[0][0]
  if (!operation || typeof operation !== 'object') return 'unknown'
  if ('namespacePrefix' in operation) return 'search'
  if ('value' in operation) return 'put'
  if ('matchConditions' in operation) return 'list'
  if ('namespace' in operation && 'key' in operation) return 'get'
  return 'unknown'
}
