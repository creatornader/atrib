// SPDX-License-Identifier: Apache-2.0

/**
 * Post-spawn addenda surfaces of the consolidated SDK:
 *
 * - `dev.atrib/attribution` receipt parsing (P049 draft): lenient extraction
 *   from a tool result's `_meta`; anything malformed yields null, wrong-typed
 *   fields are dropped, never a throw.
 * - Anchor-set resolution (P043 headroom): today's single-atrib-log posture
 *   with warn-never-error handling of unsupported anchor types and fan-out.
 * - Evidence envelope helpers (P042 draft): dedup key `(profile, payload.hash)`
 *   and the four-value tier ladder.
 */

import { describe, it, expect } from 'vitest'
import {
  ATTRIBUTION_EXTENSION_KEY,
  evidenceEnvelopeKey,
  evidenceTierRank,
  parseAttributionReceiptBlock,
  resolveAnchorSet,
  type AtribRecord,
  type EvidenceEnvelope,
} from '../src/index.js'

const RECORD: AtribRecord = {
  spec_version: 'atrib/1.0',
  content_id: `sha256:${'ab'.repeat(32)}`,
  creator_key: '0EqyMnQrtKs6E2i9RhXk5tAiSrcaAWuvhSCjMsl3hzc',
  chain_root: `sha256:${'12'.repeat(32)}`,
  event_type: 'https://atrib.dev/v1/types/observation',
  context_id: 'a'.repeat(32),
  timestamp: 1700000000000,
  signature: 'sig',
}

const FULL_RECEIPT = {
  record_hash: `sha256:${'cd'.repeat(32)}`,
  creator_key: '0EqyMnQrtKs6E2i9RhXk5tAiSrcaAWuvhSCjMsl3hzc',
  context_id: 'a'.repeat(32),
  event_type: 'https://atrib.dev/v1/types/observation',
  chain_root: `sha256:${'12'.repeat(32)}`,
  log_submission: 'queued',
}

function metaWith(block: unknown): Record<string, unknown> {
  return { [ATTRIBUTION_EXTENSION_KEY]: block }
}

describe('parseAttributionReceiptBlock (P049 receipts)', () => {
  it('exposes the extension key constant', () => {
    expect(ATTRIBUTION_EXTENSION_KEY).toBe('dev.atrib/attribution')
  })

  it('parses a valid full block: token + receipt + record', () => {
    const block = parseAttributionReceiptBlock(
      metaWith({ token: 'abc.def', receipt: FULL_RECEIPT, record: RECORD }),
    )
    expect(block).not.toBeNull()
    expect(block?.token).toBe('abc.def')
    expect(block?.receipt).toEqual(FULL_RECEIPT)
    expect(block?.record).toEqual(RECORD)
  })

  it('parses a token-only block', () => {
    const block = parseAttributionReceiptBlock(metaWith({ token: 'abc.def' }))
    expect(block).toEqual({ token: 'abc.def' })
    expect(block?.receipt).toBeUndefined()
    expect(block?.record).toBeUndefined()
  })

  it('parses a receipt-only block', () => {
    const block = parseAttributionReceiptBlock(metaWith({ receipt: FULL_RECEIPT }))
    expect(block).toEqual({ receipt: FULL_RECEIPT })
    expect(block?.token).toBeUndefined()
    expect(block?.record).toBeUndefined()
  })

  it('ignores unknown extra fields at both block and receipt level', () => {
    const block = parseAttributionReceiptBlock(
      metaWith({
        token: 'abc.def',
        receipt: { ...FULL_RECEIPT, surprise: 'yes', tier: 3 },
        future_field: { nested: true },
      }),
    )
    expect(block).not.toBeNull()
    expect(block?.token).toBe('abc.def')
    // Only the known string fields survive; unknown keys never leak through.
    expect(block?.receipt).toEqual(FULL_RECEIPT)
    expect(block && 'future_field' in block).toBe(false)
  })

  it('drops wrong-typed fields instead of throwing', () => {
    const block = parseAttributionReceiptBlock(
      metaWith({
        token: 42,
        receipt: {
          record_hash: 42,
          creator_key: null,
          context_id: ['a'.repeat(32)],
          event_type: { uri: 'x' },
          chain_root: true,
          log_submission: 'queued',
        },
      }),
    )
    expect(block).not.toBeNull()
    // token was a number → absent
    expect(block?.token).toBeUndefined()
    // receipt object survives with only the correctly-typed field
    expect(block?.receipt).toEqual({ log_submission: 'queued' })
    expect(block?.receipt?.record_hash).toBeUndefined()
  })

  it('accepts unknown future log_submission statuses as strings', () => {
    const block = parseAttributionReceiptBlock(
      metaWith({ receipt: { log_submission: 'replicated' } }),
    )
    expect(block?.receipt?.log_submission).toBe('replicated')
  })

  it('returns null when the dev.atrib/attribution key is missing', () => {
    expect(parseAttributionReceiptBlock({})).toBeNull()
    expect(parseAttributionReceiptBlock({ 'other.ext/key': { token: 'x' } })).toBeNull()
  })

  it('returns null for non-object meta values', () => {
    expect(parseAttributionReceiptBlock(null)).toBeNull()
    expect(parseAttributionReceiptBlock(undefined)).toBeNull()
    expect(parseAttributionReceiptBlock(42)).toBeNull()
    expect(parseAttributionReceiptBlock('x')).toBeNull()
  })

  it('returns null for a non-object or empty extension block', () => {
    expect(parseAttributionReceiptBlock(metaWith('token'))).toBeNull()
    expect(parseAttributionReceiptBlock(metaWith(null))).toBeNull()
    // Object with none of token/receipt/record recognized → null
    expect(parseAttributionReceiptBlock(metaWith({}))).toBeNull()
    expect(parseAttributionReceiptBlock(metaWith({ token: 42, record: 'x' }))).toBeNull()
  })
})

describe('resolveAnchorSet (P043 anchor headroom)', () => {
  const LOG_A = 'https://log.atrib.dev/v1/entries'
  const LOG_B = 'https://log-b.example.dev/v1/entries'
  const REKOR = 'https://rekor.example.dev'

  it('resolves undefined to no endpoint and no warnings', () => {
    expect(resolveAnchorSet(undefined)).toEqual({
      primaryLogEndpoint: undefined,
      warnings: [],
    })
  })

  it('resolves an empty set to no endpoint and no warnings', () => {
    expect(resolveAnchorSet([])).toEqual({
      primaryLogEndpoint: undefined,
      warnings: [],
    })
  })

  it('accepts a single bare-string anchor as an atrib-log endpoint', () => {
    expect(resolveAnchorSet([LOG_A])).toEqual({
      primaryLogEndpoint: LOG_A,
      warnings: [],
    })
  })

  it('accepts the object form without anchor_type', () => {
    expect(resolveAnchorSet([{ endpoint: LOG_A }])).toEqual({
      primaryLogEndpoint: LOG_A,
      warnings: [],
    })
  })

  it("accepts an explicit anchor_type of 'atrib-log'", () => {
    expect(resolveAnchorSet([{ endpoint: LOG_A, anchor_type: 'atrib-log' }])).toEqual({
      primaryLogEndpoint: LOG_A,
      warnings: [],
    })
  })

  it('skips unsupported anchor types with a warning naming the type', () => {
    const resolved = resolveAnchorSet([{ endpoint: REKOR, anchor_type: 'rekor' }])
    expect(resolved.primaryLogEndpoint).toBeUndefined()
    expect(resolved.warnings).toHaveLength(1)
    expect(resolved.warnings[0]).toContain("'rekor'")
    expect(resolved.warnings[0]).toContain(REKOR)
  })

  it('picks the first of two atrib-log anchors and warns about fan-out', () => {
    const resolved = resolveAnchorSet([LOG_A, { endpoint: LOG_B }])
    expect(resolved.primaryLogEndpoint).toBe(LOG_A)
    expect(resolved.warnings).toHaveLength(1)
    expect(resolved.warnings[0]).toContain('multi-anchor fan-out')
  })

  it('chooses the atrib-log endpoint when it follows a skipped anchor', () => {
    const resolved = resolveAnchorSet([{ endpoint: REKOR, anchor_type: 'rekor' }, LOG_A])
    expect(resolved.primaryLogEndpoint).toBe(LOG_A)
    // One skip warning; no fan-out warning for a single usable anchor.
    expect(resolved.warnings).toHaveLength(1)
    expect(resolved.warnings[0]).toContain("'rekor'")
  })
})

describe('evidence envelope helpers (P042 draft)', () => {
  const PAYLOAD_HASH = `sha256:${'ef'.repeat(32)}`

  function envelope(tier: EvidenceEnvelope['tier']): EvidenceEnvelope {
    return {
      envelope: 1,
      profile: 'https://atrib.dev/v1/evidence/oauth2',
      profile_version: '1.0.0',
      tier,
      payload: { hash: PAYLOAD_HASH },
    }
  }

  it('derives the dedup key from profile and payload hash', () => {
    expect(evidenceEnvelopeKey(envelope('verified'))).toBe(
      `https://atrib.dev/v1/evidence/oauth2 ${PAYLOAD_HASH}`,
    )
  })

  it('keys are tier-independent (same profile + hash collide)', () => {
    expect(evidenceEnvelopeKey(envelope('declared'))).toBe(
      evidenceEnvelopeKey(envelope('verified')),
    )
  })

  it('ranks the tier ladder declared < shape < attested < verified', () => {
    expect(evidenceTierRank('declared')).toBe(0)
    expect(evidenceTierRank('shape')).toBe(1)
    expect(evidenceTierRank('attested')).toBe(2)
    expect(evidenceTierRank('verified')).toBe(3)
    expect(evidenceTierRank('declared')).toBeLessThan(evidenceTierRank('shape'))
    expect(evidenceTierRank('shape')).toBeLessThan(evidenceTierRank('attested'))
    expect(evidenceTierRank('attested')).toBeLessThan(evidenceTierRank('verified'))
  })
})
