import { describe, it, expect } from 'vitest'
import { canonicalSigningInput, canonicalRecord } from '../src/canon.js'
import type { AtribRecord } from '../src/types.js'

const decoder = new TextDecoder()

function makeRecord(overrides?: Partial<AtribRecord>): AtribRecord {
  return {
    spec_version: 'atrib/1.0',
    content_id: 'sha256:3f8a2b0000000000000000000000000000000000000000000000000000000000',
    creator_key: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    chain_root: 'sha256:7e1f4a0000000000000000000000000000000000000000000000000000000000',
    event_type: 'https://atrib.dev/v1/types/tool_call',
    context_id: '4bf92f3577b34da6a3ce929d0e0e4736',
    timestamp: 1743850000000,
    signature: 'placeholder_signature_that_gets_removed',
    ...overrides,
  } as AtribRecord
}

describe('canonicalSigningInput', () => {
  it('removes signature field from output', () => {
    const record = makeRecord()
    const bytes = canonicalSigningInput(record)
    const json = decoder.decode(bytes)
    expect(json).not.toContain('"signature"')
  })

  it('sorts keys lexicographically (JCS)', () => {
    const record = makeRecord()
    const bytes = canonicalSigningInput(record)
    const json = decoder.decode(bytes)
    const keys = [...json.matchAll(/"([a-z_]+)":/g)].map((m) => m[1])
    const sorted = [...keys].sort()
    expect(keys).toEqual(sorted)
  })

  it('produces no whitespace', () => {
    const record = makeRecord()
    const bytes = canonicalSigningInput(record)
    const json = decoder.decode(bytes)
    expect(json).not.toMatch(/\s/)
  })

  it('serializes timestamp as integer, not float or string', () => {
    const record = makeRecord({ timestamp: 1743850000000 })
    const bytes = canonicalSigningInput(record)
    const json = decoder.decode(bytes)
    // Must contain the integer directly, not quoted
    expect(json).toContain('"timestamp":1743850000000')
    expect(json).not.toContain('"timestamp":"1743850000000"')
    expect(json).not.toContain('1.74385e')
  })

  it('omits session_token when not present (different canonical form)', () => {
    const withoutToken = makeRecord()
    const withToken = makeRecord()
    // Manually add session_token to one record
    const withTokenRecord = { ...withToken, session_token: 'some_token' } as AtribRecord

    const bytesWithout = canonicalSigningInput(withoutToken)
    const bytesWith = canonicalSigningInput(withTokenRecord)
    const jsonWithout = decoder.decode(bytesWithout)
    const jsonWith = decoder.decode(bytesWith)

    expect(jsonWithout).not.toContain('session_token')
    expect(jsonWith).toContain('"session_token":"some_token"')
    // They must be different canonical forms
    expect(jsonWithout).not.toBe(jsonWith)
  })

  it('places session_token alphabetically between event_type and spec_version', () => {
    const record = { ...makeRecord(), session_token: 'abc' } as AtribRecord
    const bytes = canonicalSigningInput(record)
    const json = decoder.decode(bytes)
    const keys = [...json.matchAll(/"([a-z_]+)":/g)].map((m) => m[1])
    const sessionIdx = keys.indexOf('session_token')
    const eventIdx = keys.indexOf('event_type')
    const specIdx = keys.indexOf('spec_version')
    expect(sessionIdx).toBeGreaterThan(eventIdx)
    expect(sessionIdx).toBeLessThan(specIdx)
  })
})

describe('canonicalRecord', () => {
  it('includes signature field', () => {
    const record = makeRecord()
    const bytes = canonicalRecord(record)
    const json = decoder.decode(bytes)
    expect(json).toContain('"signature"')
  })

  it('produces deterministic output', () => {
    const record = makeRecord()
    const a = canonicalRecord(record)
    const b = canonicalRecord(record)
    expect(a).toEqual(b)
  })
})
