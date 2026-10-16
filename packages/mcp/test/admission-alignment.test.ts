import { describe, expect, it, vi } from 'vitest'
import { validateSubmission } from '../src/validation.js'
import { signRecord, signTransactionRecord, verifyRecord, getPublicKey } from '../src/signing.js'
import { base64urlEncode } from '../src/base64url.js'
import { canonicalRecord } from '../src/canon.js'
import type { AtribRecord } from '../src/types.js'
import { hasCreatorSignerEntry } from '../src/types.js'

const seed = new Uint8Array(32).fill(7)
const now = 1_800_000_000_000
const base = {
  spec_version: 'atrib/1.0' as const,
  event_type: 'https://atrib.dev/v1/types/observation',
  timestamp: now,
  context_id: '00112233445566778899aabbccddeeff',
  creator_key: '',
  chain_root: 'sha256:' + 'a'.repeat(64),
  signature: '',
}

describe('record admission alignment', () => {
  it('checks creator signer structure without claiming signature validity', () => {
    const transaction = {
      event_type: 'https://atrib.dev/v1/types/transaction',
      creator_key: 'creator',
    }
    const signers = [{ creator_key: 'creator', signature: '' }]
    expect(hasCreatorSignerEntry({ ...transaction, signers })).toBe(true)
    for (const signers of [
      null,
      [],
      [null],
      ['sig'],
      [{ creator_key: 'creator' }],
      [{ creator_key: 'creator', signature: 7 }],
      [{ creator_key: 'other', signature: 'sig' }],
    ]) {
      expect(hasCreatorSignerEntry({ ...transaction, signers })).toBe(false)
    }
    expect(hasCreatorSignerEntry({ event_type: transaction.event_type, signers })).toBe(false)
    expect(hasCreatorSignerEntry({ ...transaction, event_type: base.event_type, signers })).toBe(
      false,
    )
  })

  it('verifies against an explicit clock without changing the default clock', async () => {
    const record = await signRecord(
      { ...base, creator_key: base64urlEncode(await getPublicKey(seed)) } as AtribRecord,
      seed,
    )
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now - 600_000)
    try {
      expect(await verifyRecord(record)).toBe(false)
      expect(await verifyRecord(record, { nowMs: now })).toBe(true)
      expect(await verifyRecord(record, { nowMs: now - 300_000 })).toBe(true)
      expect(await verifyRecord(record, { nowMs: now - 300_001 })).toBe(false)
      for (const nowMs of [NaN, Infinity, -1, 1.5]) {
        expect(await verifyRecord(record, { nowMs })).toBe(false)
      }
      expect(await verifyRecord(record)).toBe(false)
    } finally {
      clock.mockRestore()
    }
  })

  it('round trips a signed observation without inventing content_id', async () => {
    const record = await signRecord(
      { ...base, creator_key: base64urlEncode(await getPublicKey(seed)) } as AtribRecord,
      seed,
    )
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    try {
      expect(validateSubmission(record).ok).toBe(true)
      expect(await verifyRecord(record)).toBe(true)
      expect(JSON.parse(new TextDecoder().decode(canonicalRecord(record)))).toEqual(record)
      expect(record).not.toHaveProperty('content_id')
    } finally {
      clock.mockRestore()
    }
  })

  it.each(['tool_call', 'transaction', 'directory_anchor', 'session_checkpoint'])(
    'requires content_id for %s',
    (type) => {
      expect(
        validateSubmission({ ...base, event_type: `https://atrib.dev/v1/types/${type}` }).ok,
      ).toBe(false)
    },
  )

  it('rejects malformed content_id even for observations', () => {
    for (const content_id of [null, undefined, '', 'sha256:abc']) {
      expect(validateSubmission({ ...base, content_id } as unknown as AtribRecord).ok).toBe(false)
    }
  })

  it('accepts transaction creator signers without a top-level signature', async () => {
    const signed = await signTransactionRecord(
      {
        ...base,
        event_type: 'https://atrib.dev/v1/types/transaction',
        content_id: 'sha256:' + 'b'.repeat(64),
      } as AtribRecord,
      seed,
    )
    const { signature: _, ...record } = signed
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    try {
      expect(validateSubmission(record).ok).toBe(true)
      expect(await verifyRecord(record as AtribRecord)).toBe(true)
      expect(validateSubmission({ ...record, signers: [] }).ok).toBe(false)
      expect(
        validateSubmission({ ...record, signers: [{ creator_key: 'another', signature: 'sig' }] })
          .ok,
      ).toBe(false)
      expect(validateSubmission({ ...record, event_type: base.event_type }).ok).toBe(false)
    } finally {
      clock.mockRestore()
    }
  })

  it('uses the same five-minute boundary as record verification', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    try {
      const record = { ...base, content_id: 'sha256:' + 'b'.repeat(64) }
      expect(validateSubmission({ ...record, timestamp: now + 5 * 60_000 }).ok).toBe(true)
      expect(validateSubmission({ ...record, timestamp: now + 5 * 60_000 + 1 }).ok).toBe(false)
      expect(validateSubmission({ ...record, timestamp: now + 7 * 60_000 }).ok).toBe(false)
    } finally {
      clock.mockRestore()
    }
  })
})
