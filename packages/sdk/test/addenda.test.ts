// SPDX-License-Identifier: Apache-2.0

/**
 * Post-spawn addenda surfaces of the consolidated SDK:
 *
 * - `dev.atrib/attribution` receipt parsing (D141): lenient extraction
 *   from a tool result's `_meta`; anything malformed yields null, wrong-typed
 *   fields are dropped, never a throw.
 * - Anchor-set resolution (D138): normalization into the §2.11.12
 *   `AnchorSetConfig` with warn-never-error handling of hostile entries,
 *   plus the posture the fan-out resolves over it.
 * - Evidence envelope helpers (D137): dedup key `(profile, payload.hash)`
 *   and the four-value tier ladder.
 */

import { describe, it, expect } from 'vitest'
import {
  ATTRIBUTION_EXTENSION_ID,
  ATTRIBUTION_EXTENSION_KEY,
  BUILT_IN_DEFAULT_ANCHOR_SET,
  evidenceEnvelopeKey,
  evidenceTierRank,
  parseAttributionReceiptBlock,
  resolveAnchorPosture,
  resolveAnchorSet,
  type AnchorSpec,
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
  it('exposes the extension key constant, aliasing @atrib/mcp ATTRIBUTION_EXTENSION_ID', () => {
    expect(ATTRIBUTION_EXTENSION_KEY).toBe('dev.atrib/attribution')
    // One identifier, one source of truth: the SDK key IS the mcp id.
    expect(ATTRIBUTION_EXTENSION_KEY).toBe(ATTRIBUTION_EXTENSION_ID)
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

describe('resolveAnchorSet (D138 anchor plurality)', () => {
  const LOG_A = 'https://log.atrib.dev/v1/entries'
  const LOG_B = 'https://log-b.example.dev/v1/entries'
  const REKOR = 'https://rekor.example.dev'

  it('resolves undefined to an empty config (built-in default set applies downstream)', () => {
    const resolved = resolveAnchorSet(undefined)
    expect(resolved).toEqual({
      config: {},
      primaryLogEndpoint: undefined,
      warnings: [],
    })
    // No anchor config at all ⇒ §2.11.12 rule 1: default two-anchor set.
    expect(resolveAnchorPosture(resolved.config)).toEqual({
      effective_anchor_count: BUILT_IN_DEFAULT_ANCHOR_SET.length,
      used_default_set: true,
      warn: false,
      sidecar_anchor_config: null,
    })
  })

  it('resolves an explicit empty set to a zero-anchor config that the posture warns on', () => {
    const resolved = resolveAnchorSet([])
    expect(resolved.config).toEqual({ anchors: [] })
    expect(resolved.primaryLogEndpoint).toBeUndefined()
    expect(resolved.warnings).toEqual([])
    const posture = resolveAnchorPosture(resolved.config)
    expect(posture.used_default_set).toBe(false)
    expect(posture.warn).toBe(true)
  })

  it('normalizes a bare-string anchor to a url descriptor (atrib-log)', () => {
    const resolved = resolveAnchorSet([LOG_A])
    expect(resolved.config.anchors).toEqual([{ url: LOG_A }])
    expect(resolved.primaryLogEndpoint).toBe(LOG_A)
    expect(resolved.warnings).toEqual([])
  })

  it('accepts the descriptor object form without anchor_type', () => {
    const resolved = resolveAnchorSet([{ endpoint: LOG_A }])
    expect(resolved.config.anchors).toEqual([{ endpoint: LOG_A }])
    expect(resolved.primaryLogEndpoint).toBe(LOG_A)
    expect(resolved.warnings).toEqual([])
  })

  it("accepts an explicit anchor_type of 'atrib-log', with url winning over endpoint", () => {
    const resolved = resolveAnchorSet([
      { url: LOG_A, endpoint: LOG_B, anchor_type: 'atrib-log' },
    ])
    expect(resolved.primaryLogEndpoint).toBe(LOG_A)
    expect(resolved.warnings).toEqual([])
  })

  it('accepts registered non-atrib-log anchor types without requiring a url', () => {
    const resolved = resolveAnchorSet([
      LOG_A,
      { anchor_type: 'opentimestamps', calendars: ['https://a.pool.opentimestamps.org'] },
    ])
    expect(resolved.config.anchors).toHaveLength(2)
    expect(resolved.primaryLogEndpoint).toBe(LOG_A)
    expect(resolved.warnings).toEqual([])
  })

  it('skips unregistered anchor types with a warning naming the type', () => {
    const resolved = resolveAnchorSet([
      { endpoint: REKOR, anchor_type: 'rekor' } as unknown as AnchorSpec,
    ])
    expect(resolved.config.anchors).toEqual([])
    expect(resolved.primaryLogEndpoint).toBeUndefined()
    expect(resolved.warnings).toHaveLength(1)
    expect(resolved.warnings[0]).toContain("'rekor'")
    expect(resolved.warnings[0]).toContain(REKOR)
  })

  it('keeps every atrib-log anchor in the config (fan-out) with the first as primary', () => {
    const resolved = resolveAnchorSet([LOG_A, { endpoint: LOG_B }])
    expect(resolved.config.anchors).toEqual([{ url: LOG_A }, { endpoint: LOG_B }])
    expect(resolved.primaryLogEndpoint).toBe(LOG_A)
    // Multi-anchor fan-out is live (D138); no warning for extra anchors.
    expect(resolved.warnings).toEqual([])
    expect(resolveAnchorPosture(resolved.config).warn).toBe(false)
  })

  it('chooses the atrib-log endpoint when it follows a skipped anchor', () => {
    const resolved = resolveAnchorSet([
      { endpoint: REKOR, anchor_type: 'rekor' } as unknown as AnchorSpec,
      LOG_A,
    ])
    expect(resolved.primaryLogEndpoint).toBe(LOG_A)
    expect(resolved.warnings).toHaveLength(1)
    expect(resolved.warnings[0]).toContain("'rekor'")
  })

  it('maps allowSingleAnchor to AnchorSetConfig.allow_single_anchor (§2.11.12 rule 3)', () => {
    const resolved = resolveAnchorSet([LOG_A], true)
    expect(resolved.config).toEqual({
      anchors: [{ url: LOG_A }],
      allow_single_anchor: true,
    })
    expect(resolveAnchorPosture(resolved.config).warn).toBe(false)
    // Without the flag, the same single-anchor config warns (rule 4).
    expect(resolveAnchorPosture(resolveAnchorSet([LOG_A]).config).warn).toBe(true)
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
