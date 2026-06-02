import { InMemoryStore } from '@langchain/langgraph'
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
  attributeLangGraphStore,
  resolveLangGraphStorePrivateKey,
  type AtribLangGraphStoreSidecar,
  type LangGraphStoreLike,
} from '../src/langgraph-store-attribution.js'

const privateKey = new Uint8Array(32).fill(31)
const contextId = 'd17c88e97872490db1dd3e9d9b4f1a10'
const namespace = ['users', 'alice', 'memories']
const preference = {
  text: 'Alice prefers quiet sci-fi movies.',
  kind: 'preference',
}

describe('LangGraph store attribution wrapper', () => {
  it('preserves store values while signing hash-only records', async () => {
    const records: AtribRecord[] = []
    const sidecars: AtribLangGraphStoreSidecar[] = []
    const backing = new InMemoryStore()
    const store = attributeLangGraphStore(backing, {
      privateKey,
      contextId,
      logSubmission: 'disabled',
      now: () => 1_780_354_200_000,
      onRecord: (record, sidecar) => {
        records.push(record)
        sidecars.push(sidecar)
      },
    })

    await store.put(namespace, 'movie-preference', preference)
    const expectedGet = await backing.get(namespace, 'movie-preference')
    const actualGet = await store.get(namespace, 'movie-preference')
    const expectedSearch = await backing.search(namespace, {
      filter: { kind: 'preference' },
      limit: 5,
    })
    const actualSearch = await store.search(namespace, {
      filter: { kind: 'preference' },
      limit: 5,
    })

    expect(actualGet).toEqual(expectedGet)
    expect(actualSearch).toEqual(expectedSearch)
    expect(records.map((record) => record.tool_name)).toEqual([
      'langgraph.store.put',
      'langgraph.store.get',
      'langgraph.store.search',
    ])
    expect(records[0]!.args_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(records[0]!.result_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(records[1]!.args_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(records[1]!.result_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(JSON.stringify(records)).not.toContain('quiet sci-fi')
    expect(JSON.stringify(sidecars[0]!.args)).toContain('quiet sci-fi')
    const getSidecar = sidecars[1]!
    expect(getSidecar.status === 'ok' ? JSON.stringify(getSidecar.result) : '').toContain(
      'quiet sci-fi',
    )
    expect(await verifyRecord(records[0]!)).toBe(true)
    expect(await verifyRecord(records[1]!)).toBe(true)
    expect(await verifyRecord(records[2]!)).toBe(true)
  })

  it('chains store records in one context', async () => {
    const store = attributeLangGraphStore(new InMemoryStore(), {
      privateKey,
      contextId,
      logSubmission: 'disabled',
    })

    await store.put(namespace, 'movie-preference', preference)
    await store.get(namespace, 'movie-preference')

    const records = store.getSignedRecords()
    const firstHash = `sha256:${hexEncode(sha256(canonicalRecord(records[0]!)))}`
    expect(records).toHaveLength(2)
    expect(records[0]!.chain_root).toBe(genesisChainRoot(contextId))
    expect(records[1]!.chain_root).toBe(firstHash)
  })

  it('passes through without signing when no private key is configured', async () => {
    const store = attributeLangGraphStore(new InMemoryStore(), {
      privateKey: '',
      logSubmission: 'disabled',
    })

    await store.put(namespace, 'movie-preference', preference)
    const item = await store.get(namespace, 'movie-preference')

    expect(item).toMatchObject({ value: preference })
    expect(store.creatorKey).toBe('')
    expect(store.getSignedRecords()).toHaveLength(0)
  })

  it('signs delete and list namespace calls', async () => {
    const store = attributeLangGraphStore(new InMemoryStore(), {
      privateKey,
      contextId,
      logSubmission: 'disabled',
    })

    await store.put(namespace, 'movie-preference', preference)
    const namespaces = await store.listNamespaces({ prefix: ['users'] })
    await store.delete(namespace, 'movie-preference')
    const item = await store.get(namespace, 'movie-preference')

    expect(namespaces).toEqual([namespace])
    expect(item).toBeNull()
    expect(store.getSignedRecords().map((record) => record.tool_name)).toEqual([
      'langgraph.store.put',
      'langgraph.store.list_namespaces',
      'langgraph.store.delete',
      'langgraph.store.get',
    ])
  })

  it('signs failed store calls without changing the thrown error', async () => {
    const error = new Error('graph store unavailable')
    const failingStore: LangGraphStoreLike = {
      put: async () => {},
      get: async () => null,
      search: async () => {
        throw error
      },
      delete: async () => {},
      batch: async () => [],
      listNamespaces: async () => [],
    }
    const store = attributeLangGraphStore(failingStore, {
      privateKey,
      logSubmission: 'disabled',
    })

    await expect(store.search(namespace, { query: 'movie' })).rejects.toThrow(error)

    const records = store.getSignedRecords()
    const sidecars = store.getSidecars()
    expect(records).toHaveLength(1)
    expect(records[0]!.tool_name).toBe('langgraph.store.search')
    expect(sidecars[0]!.status).toBe('error')
    expect(sidecars[0]!.status === 'error' ? sidecars[0]!.error.message : '').toBe(
      'graph store unavailable',
    )
    expect(await verifyRecord(records[0]!)).toBe(true)
  })

  it('accepts base64url and hex private key strings', () => {
    expect(resolveLangGraphStorePrivateKey(base64urlEncode(privateKey))).toEqual(privateKey)
    expect(resolveLangGraphStorePrivateKey(Buffer.from(privateKey).toString('hex'))).toEqual(
      privateKey,
    )
  })
})
