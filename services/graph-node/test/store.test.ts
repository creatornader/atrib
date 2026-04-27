// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import {
  base64urlEncode,
  signRecord,
  getPublicKey,
  genesisChainRoot,
} from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'
import { createRecordStore } from '../src/store.js'

const TEST_KEY = new Uint8Array(32).fill(7)
const CTX = 'a'.repeat(32)

async function makeRecord(overrides: { content_id?: string; timestamp?: number } = {}): Promise<AtribRecord> {
  const pk = await getPublicKey(TEST_KEY)
  const unsigned = {
    spec_version: 'atrib/1.0' as const,
    content_id: overrides.content_id ?? `sha256:${'c'.repeat(64)}`,
    creator_key: base64urlEncode(pk),
    chain_root: genesisChainRoot(CTX),
    event_type: 'tool_call' as const,
    context_id: CTX,
    timestamp: overrides.timestamp ?? 1_700_000_000_000,
    signature: '',
  }
  return signRecord(unsigned as AtribRecord, TEST_KEY)
}

describe('RecordStore dedup', () => {
  it('addRecord is idempotent on the same record_hash', async () => {
    const store = createRecordStore()
    const record = await makeRecord()

    store.addRecord(record)
    store.addRecord(record)
    store.addRecord(record)

    expect(store.getRecordsByContextId(record.context_id).length).toBe(1)
  })

  it('addRecord keeps distinct records with the same context_id', async () => {
    const store = createRecordStore()
    // Distinguish by content_id (changes record_hash). Same context_id.
    const r1 = await makeRecord({ content_id: `sha256:${'a'.repeat(64)}`, timestamp: 1_700_000_000_001 })
    const r2 = await makeRecord({ content_id: `sha256:${'b'.repeat(64)}`, timestamp: 1_700_000_000_002 })
    const r3 = await makeRecord({ content_id: `sha256:${'c'.repeat(64)}`, timestamp: 1_700_000_000_003 })

    store.addRecord(r1)
    store.addRecord(r2)
    store.addRecord(r3)
    store.addRecord(r1) // replay
    store.addRecord(r2) // replay

    expect(store.getRecordsByContextId(CTX).length).toBe(3)
  })

  it('hasContext is monotonic across replays', async () => {
    const store = createRecordStore()
    const record = await makeRecord()

    expect(store.hasContext(record.context_id)).toBe(false)
    store.addRecord(record)
    expect(store.hasContext(record.context_id)).toBe(true)
    store.addRecord(record)
    expect(store.hasContext(record.context_id)).toBe(true)
  })
})
