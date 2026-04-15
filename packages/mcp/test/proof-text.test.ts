import { describe, it, expect } from 'vitest'
import { formatProofBundle, parseProofBundle } from '../src/proof-text.js'
import type { ProofBundle } from '../src/submission.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SAMPLE_CHECKPOINT = [
  'log.atrib.dev/v1',
  '4821937',
  'CsUYapGGPo4dkMgIAUqom/Xajj7h2fB2MPA3j2jxq2I=',
  '',
  '\u2014 log.atrib.dev/v1 a3b2c1d0+base64signature',
  '\u2014 witness.example.com e1f2a3b4+cosignature',
].join('\n')

const SAMPLE_BUNDLE: ProofBundle = {
  log_index: 4821936,
  checkpoint: SAMPLE_CHECKPOINT,
  inclusion_proof: [
    'gSKyXoYZUgZ6jduWYrkDOARinOMGJveXjgMkBTcdPlQ=',
    'B95lDa8R83lS8n0eG+o0buTxRKQTYFi//1U8anccXmA=',
    'EKNzoDWG8LGC0Yp9o+sv3qllpMP9uHQ9B20KNL+Q1zs=',
  ],
  leaf_hash: 'abc123',
}

const EXPECTED_TEXT = [
  'c2sp.org/tlog-proof@v1',
  'index 4821936',
  'gSKyXoYZUgZ6jduWYrkDOARinOMGJveXjgMkBTcdPlQ=',
  'B95lDa8R83lS8n0eG+o0buTxRKQTYFi//1U8anccXmA=',
  'EKNzoDWG8LGC0Yp9o+sv3qllpMP9uHQ9B20KNL+Q1zs=',
  '',
  ...SAMPLE_CHECKPOINT.split('\n'),
].join('\n')

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('formatProofBundle', () => {
  it('produces the expected tlog-proof text', () => {
    const text = formatProofBundle(SAMPLE_BUNDLE)
    expect(text).toBe(EXPECTED_TEXT)
  })

  it('starts with the c2sp header line', () => {
    const text = formatProofBundle(SAMPLE_BUNDLE)
    expect(text.startsWith('c2sp.org/tlog-proof@v1\n')).toBe(true)
  })

  it('includes the index line with the correct value', () => {
    const text = formatProofBundle(SAMPLE_BUNDLE)
    const lines = text.split('\n')
    expect(lines[1]).toBe('index 4821936')
  })

  it('handles zero inclusion proof hashes', () => {
    const bundle: ProofBundle = {
      log_index: 0,
      checkpoint: 'origin\n1\nhash=\n\n\u2014 origin sig',
      inclusion_proof: [],
      leaf_hash: '',
    }
    const text = formatProofBundle(bundle)
    const lines = text.split('\n')
    expect(lines[0]).toBe('c2sp.org/tlog-proof@v1')
    expect(lines[1]).toBe('index 0')
    // Line 2 should be the empty separator (no proof hashes before it).
    expect(lines[2]).toBe('')
    // Line 3 onward is the checkpoint.
    expect(lines[3]).toBe('origin')
  })

  it('handles index 0', () => {
    const bundle: ProofBundle = {
      log_index: 0,
      checkpoint: 'origin\n1\nhash=',
      inclusion_proof: ['aaa='],
      leaf_hash: '',
    }
    const text = formatProofBundle(bundle)
    expect(text).toContain('index 0')
  })
})

describe('parseProofBundle', () => {
  it('round-trips with formatProofBundle (except leaf_hash)', () => {
    const text = formatProofBundle(SAMPLE_BUNDLE)
    const parsed = parseProofBundle(text)

    expect(parsed.log_index).toBe(SAMPLE_BUNDLE.log_index)
    expect(parsed.checkpoint).toBe(SAMPLE_BUNDLE.checkpoint)
    expect(parsed.inclusion_proof).toEqual(SAMPLE_BUNDLE.inclusion_proof)
    // leaf_hash is not preserved in the text format.
    expect(parsed.leaf_hash).toBe('')
  })

  it('parses the sample text correctly', () => {
    const parsed = parseProofBundle(EXPECTED_TEXT)
    expect(parsed.log_index).toBe(4821936)
    expect(parsed.inclusion_proof).toHaveLength(3)
    expect(parsed.inclusion_proof[0]).toBe('gSKyXoYZUgZ6jduWYrkDOARinOMGJveXjgMkBTcdPlQ=')
  })

  it('parses a bundle with zero inclusion proof hashes', () => {
    const text = 'c2sp.org/tlog-proof@v1\nindex 42\n\norigin\n1\nhash='
    const parsed = parseProofBundle(text)
    expect(parsed.log_index).toBe(42)
    expect(parsed.inclusion_proof).toEqual([])
    expect(parsed.checkpoint).toBe('origin\n1\nhash=')
  })

  it('throws on missing header', () => {
    expect(() => parseProofBundle('wrong header\nindex 1\n\ncheckpoint')).toThrow(
      'expected header',
    )
  })

  it('throws on missing index line', () => {
    expect(() => parseProofBundle('c2sp.org/tlog-proof@v1\nnotindex\n\ncheckpoint')).toThrow(
      'expected "index <N>"',
    )
  })

  it('throws on negative index', () => {
    expect(() => parseProofBundle('c2sp.org/tlog-proof@v1\nindex -1\n\ncheckpoint')).toThrow(
      'invalid index',
    )
  })

  it('throws on non-integer index', () => {
    expect(() => parseProofBundle('c2sp.org/tlog-proof@v1\nindex 1.5\n\ncheckpoint')).toThrow(
      'invalid index',
    )
  })

  it('throws on missing checkpoint', () => {
    expect(() => parseProofBundle('c2sp.org/tlog-proof@v1\nindex 1\n')).toThrow(
      'missing checkpoint',
    )
  })

  it('throws when no empty separator exists', () => {
    // No empty line between proof hashes and end of input.
    expect(() => parseProofBundle('c2sp.org/tlog-proof@v1\nindex 1\nhash1=\nhash2=')).toThrow(
      'missing empty line separator',
    )
  })

  it('throws on empty text', () => {
    expect(() => parseProofBundle('')).toThrow('expected header')
  })

  it('preserves checkpoint internal newlines', () => {
    const checkpoint = 'origin\n42\nhash=\n\n\u2014 origin sig\n\u2014 witness sig'
    const bundle: ProofBundle = {
      log_index: 7,
      checkpoint,
      inclusion_proof: ['proof1='],
      leaf_hash: '',
    }
    const text = formatProofBundle(bundle)
    const parsed = parseProofBundle(text)
    expect(parsed.checkpoint).toBe(checkpoint)
  })
})
