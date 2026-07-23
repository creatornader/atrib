// Tests for the revocation registry (spec §1.9).

import { describe, it, expect } from 'vitest'
import { buildRevocationRegistry, applyRevocation } from '../src/revocations.js'
import type { MinimalRecord } from '../src/revocations.js'
import type { VerificationState } from '../src/types.js'

const KEY_A = 'A'.repeat(43)
const KEY_B = 'B'.repeat(43)
const KEY_C = 'C'.repeat(43)
const KEY_SUCC = 'S'.repeat(43)
const URI = 'https://atrib.dev/v1/types/key_revocation'

function rev(overrides: Partial<MinimalRecord> = {}): MinimalRecord {
  return {
    event_type: 'key_revocation',
    creator_key: KEY_A,
    log_index: 5,
    revoked_key: KEY_A,
    revocation_reason: 'rotation',
    successor_key: KEY_SUCC,
    ...overrides,
  }
}

describe('buildRevocationRegistry', () => {
  it('extracts a rotation revocation', () => {
    const reg = buildRevocationRegistry([rev()])
    expect(reg.size).toBe(1)
    const e = reg.get(KEY_A)!
    expect(e.revoked_key).toBe(KEY_A)
    expect(e.log_index).toBe(5)
    expect(e.revocation_reason).toBe('rotation')
    expect(e.successor_key).toBe(KEY_SUCC)
  })

  it('also matches event_type_uri form', () => {
    const reg = buildRevocationRegistry([rev({ event_type: undefined, event_type_uri: URI })])
    expect(reg.size).toBe(1)
  })

  it('skips non-revocation records', () => {
    const reg = buildRevocationRegistry([
      { event_type: 'tool_call', creator_key: KEY_A, log_index: 1 },
      rev(),
      { event_type: 'transaction', creator_key: KEY_B, log_index: 7 },
    ])
    expect(reg.size).toBe(1)
    expect(reg.has(KEY_A)).toBe(true)
  })

  it('keeps the EARLIEST revocation when same key revoked twice', () => {
    const reg = buildRevocationRegistry([
      rev({ log_index: 10 }),
      rev({ log_index: 5 }),
      rev({ log_index: 12 }),
    ])
    expect(reg.get(KEY_A)?.log_index).toBe(5)
  })

  it('skips revocations missing required fields', () => {
    const reg = buildRevocationRegistry([
      rev({ revoked_key: undefined }),
      rev({ log_index: undefined }),
      rev({ log_index: Number.NaN }),
      rev({ log_index: -1 }),
      rev({ revocation_reason: 'invalid-reason' }),
    ])
    expect(reg.size).toBe(0)
  })

  it('handles all three valid reasons', () => {
    const reg = buildRevocationRegistry([
      rev({ revoked_key: KEY_A, revocation_reason: 'rotation' }),
      rev({ revoked_key: KEY_B, revocation_reason: 'retirement', successor_key: undefined }),
      rev({ revoked_key: KEY_C, revocation_reason: 'compromise', emergency_signed_by: KEY_SUCC }),
    ])
    expect(reg.size).toBe(3)
    expect(reg.get(KEY_C)?.revocation_reason).toBe('compromise')
    expect(reg.get(KEY_C)?.emergency_signed_by).toBe(KEY_SUCC)
  })
})

describe('applyRevocation', () => {
  const node = (
    creator: string | null,
    idx: number | null,
    state: VerificationState = 'signature_valid',
  ) => ({ creator_key: creator, log_index: idx, verification_state: state })

  it('flags post-revocation records as revoked_after_revocation', () => {
    const reg = buildRevocationRegistry([rev({ log_index: 5 })])
    expect(applyRevocation(node(KEY_A, 6), reg)).toBe('revoked_after_revocation')
    expect(applyRevocation(node(KEY_A, 100), reg)).toBe('revoked_after_revocation')
  })

  it('preserves state for pre-revocation records', () => {
    const reg = buildRevocationRegistry([rev({ log_index: 5 })])
    expect(applyRevocation(node(KEY_A, 4, 'log_committed'), reg)).toBe('log_committed')
    expect(applyRevocation(node(KEY_A, 0, 'witnessed'), reg)).toBe('witnessed')
  })

  it('preserves state for the revocation record itself', () => {
    // The record AT log_index R is the revocation; it shouldn't flag itself.
    const reg = buildRevocationRegistry([rev({ log_index: 5 })])
    expect(applyRevocation(node(KEY_A, 5), reg)).toBe('signature_valid')
  })

  it('preserves state for unrelated keys', () => {
    const reg = buildRevocationRegistry([rev({ log_index: 5 })])
    expect(applyRevocation(node(KEY_B, 10), reg)).toBe('signature_valid')
  })

  it('handles null creator_key and null log_index gracefully', () => {
    const reg = buildRevocationRegistry([rev({ log_index: 5 })])
    expect(applyRevocation(node(null, 10), reg)).toBe('signature_valid')
    expect(applyRevocation(node(KEY_A, null), reg)).toBe('signature_valid')
  })
})
