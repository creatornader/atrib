import { describe, it, expect } from 'vitest'
import {
  serializeEntry,
  ENTRY_VERSION,
  EVENT_TYPE_TOOL_CALL,
  EVENT_TYPE_TRANSACTION,
  type EntryInput,
} from '@atrib/mcp'

const ENTRY_SIZE = 90

// Stable test fixtures
const RECORD_HASH_HEX = 'a'.repeat(64) // 32 bytes of 0xaa
const CREATOR_KEY_B64URL = Buffer.alloc(32, 0xbb).toString('base64url')
const CONTEXT_ID = 'c'.repeat(32) // 32 hex chars = 16 bytes of 0xcc
const TIMESTAMP = 1_700_000_000_000 // a fixed ms timestamp

function makeInput(overrides: Partial<EntryInput> = {}): EntryInput {
  return {
    record_hash_hex: RECORD_HASH_HEX,
    creator_key_b64url: CREATOR_KEY_B64URL,
    context_id: CONTEXT_ID,
    timestamp: TIMESTAMP,
    event_type: 'tool_call',
    ...overrides,
  }
}

describe('serializeEntry', () => {
  it('produces exactly 90 bytes', () => {
    const entry = serializeEntry(makeInput())
    expect(entry.byteLength).toBe(ENTRY_SIZE)
  })

  it('starts with version byte 0x01', () => {
    const entry = serializeEntry(makeInput())
    expect(entry[0]).toBe(ENTRY_VERSION)
    expect(entry[0]).toBe(0x01)
  })

  it('encodes event_type 0x01 for tool_call', () => {
    const entry = serializeEntry(makeInput({ event_type: 'tool_call' }))
    expect(entry[89]).toBe(EVENT_TYPE_TOOL_CALL)
    expect(entry[89]).toBe(0x01)
  })

  it('encodes event_type 0x02 for transaction', () => {
    const entry = serializeEntry(makeInput({ event_type: 'transaction' }))
    expect(entry[89]).toBe(EVENT_TYPE_TRANSACTION)
    expect(entry[89]).toBe(0x02)
  })

  it('encodes timestamp as big-endian u64 at bytes 81-88', () => {
    const entry = serializeEntry(makeInput({ timestamp: TIMESTAMP }))
    const view = new DataView(entry.buffer, entry.byteOffset, entry.byteLength)
    // Read as two 32-bit halves because JS DataView doesn't support getBigUint64 in all targets,
    // but vitest runs in Node so BigInt is fine.
    const hi = view.getUint32(81, false) // big-endian
    const lo = view.getUint32(85, false)
    const recovered = BigInt(hi) * 0x1_0000_0000n + BigInt(lo)
    expect(recovered).toBe(BigInt(TIMESTAMP))
  })

  it('encodes record_hash at bytes 1-32', () => {
    const entry = serializeEntry(makeInput())
    const recordHash = entry.slice(1, 33)
    const expected = Buffer.from(RECORD_HASH_HEX, 'hex')
    expect(Buffer.from(recordHash).toString('hex')).toBe(expected.toString('hex'))
  })

  it('encodes creator_key at bytes 33-64', () => {
    const entry = serializeEntry(makeInput())
    const creatorKey = entry.slice(33, 65)
    const expected = Buffer.from(CREATOR_KEY_B64URL, 'base64url')
    expect(Buffer.from(creatorKey).toString('hex')).toBe(expected.toString('hex'))
  })

  it('encodes context_id at bytes 65-80', () => {
    const entry = serializeEntry(makeInput())
    const contextId = entry.slice(65, 81)
    const expected = Buffer.from(CONTEXT_ID, 'hex')
    expect(Buffer.from(contextId).toString('hex')).toBe(expected.toString('hex'))
  })

  it('is deterministic. two calls with identical input produce identical output', () => {
    const input = makeInput()
    const a = serializeEntry(input)
    const b = serializeEntry(input)
    expect(Buffer.from(a).toString('hex')).toBe(Buffer.from(b).toString('hex'))
  })

  it('different timestamps produce different bytes at offset 81-88', () => {
    const a = serializeEntry(makeInput({ timestamp: 1_000 }))
    const b = serializeEntry(makeInput({ timestamp: 2_000 }))
    const aTs = Buffer.from(a.slice(81, 89)).toString('hex')
    const bTs = Buffer.from(b.slice(81, 89)).toString('hex')
    expect(aTs).not.toBe(bTs)
  })
})
