// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  base64urlDecode,
  createJsonCommitment,
  createToolNameCommitment,
  hexEncode,
  sha256,
  verifyJsonCommitment,
} from '../src/index.js'
import { commitEvidenceBody, isEvidenceLocator } from '../src/evidence-body.js'

describe('JSON commitment helpers', () => {
  it('creates deterministic plain JCS commitments', () => {
    const first = createJsonCommitment({ b: 2, a: 1 }, 'plain-sha256')
    const second = createJsonCommitment({ a: 1, b: 2 }, 'plain-sha256')
    expect(first).toEqual(second)
    expect(first.salt).toBeUndefined()
  })

  it('creates replayable salted commitments with a 16-byte salt', () => {
    const commitment = createJsonCommitment({ a: 1 }, 'salted-sha256', () =>
      new Uint8Array(16).fill(7),
    )
    const salt = base64urlDecode(commitment.salt)
    const value = new TextEncoder().encode('{"a":1}')
    const combined = new Uint8Array(salt.length + value.length)
    combined.set(salt, 0)
    combined.set(value, salt.length)

    expect(salt).toHaveLength(16)
    expect(commitment.hash).toBe(`sha256:${hexEncode(sha256(combined))}`)
  })

  it('hashes tool names as raw UTF-8 bytes', () => {
    expect(createToolNameCommitment('read_file')).toBe(
      `sha256:${hexEncode(sha256(new TextEncoder().encode('read_file')))}`,
    )
  })
})

describe('evidence body commitments', () => {
  const id = { namespace: 'https://example.test/objects', id: 'one' }
  const hash = `sha256:${'1'.repeat(64)}`
  function body(kind: 'request' | 'effect', value: unknown) {
    const common = { nonce: 'AAAAAAAAAAAAAAAAAAAAAA', subject: id }
    return kind === 'request'
      ? {
          ...common,
          source: { kind: 'declared', identity: id, method: 'https://example.test/method/v1' },
          basis: [],
          assertion: {
            descriptor: {
              service: 'https://example.test',
              operation: 'write',
              resource: id,
              parameters: value,
            },
            execution: id,
          },
        }
      : {
          ...common,
          source: {
            kind: 'query',
            identity: id,
            method: 'https://example.test/method/v1',
            observed_at: 1,
          },
          target: { record_hash: hash },
          basis: [{ relation: 'source', kind: 'artifact', hash }],
          assertion: {
            object: id,
            payload_hash: hash,
            version: { kind: 'native', value: '1' },
            state: value,
          },
        }
  }

  it.each(['request', 'effect'] as const)('commits every raw JSON key in %s bodies', (kind) => {
    const opening = body(
      kind,
      JSON.parse('{"__proto__":{"allowed":true},"constructor":1,"prototype":2}'),
    )
    const expected = createJsonCommitment(opening, 'plain-sha256')
    expect(commitEvidenceBody(kind, opening)).toBe(expected.hash)
    expect(verifyJsonCommitment(opening, { hash: commitEvidenceBody(kind, opening) })).toBe(true)
  })

  it.each(['request', 'effect'] as const)(
    'binds special JSON key mutations in %s bodies',
    (kind) => {
      const original = body(kind, JSON.parse('{"__proto__":{"allowed":true}}'))
      const changed = body(kind, JSON.parse('{"__proto__":{"allowed":false}}'))
      const committed = commitEvidenceBody(kind, original)
      expect(verifyJsonCommitment(changed, { hash: committed })).toBe(false)
      expect(commitEvidenceBody(kind, changed)).not.toBe(committed)
    },
  )

  it.each([undefined, NaN, new Date(), () => {}])(
    'rejects non-JSON parameter values: %s',
    (value) => {
      expect(() => commitEvidenceBody('request', body('request', value))).toThrow()
    },
  )

  it('rejects cyclic and excessive JSON inputs before schema parsing', () => {
    const cycle: unknown[] = []
    cycle.push(cycle)
    expect(() => commitEvidenceBody('request', body('request', cycle))).toThrow('resource_limit')
    expect(() => commitEvidenceBody('request', body('request', Array(100_001).fill(null)))).toThrow(
      'resource_limit',
    )
  })
})

describe('evidence locators', () => {
  it.each([
    'https://example.test:bad/path',
    ['https://', ['reader', 'secret'].join(':'), '@example.test:bad/path'].join(''),
    'https://example.test:bad/path?token=secret',
    'https://[::1/path',
    ['https://', ['reader', 'secret'].join(':'), '@example.test/path'].join(''),
    'https://example.test/path?token=secret',
    'https://example.test/path#api_key=secret',
  ])('rejects malformed or credential-bearing locator %s', (value) => {
    expect(isEvidenceLocator(value)).toBe(false)
  })

  it.each([
    'artifacts/receipt.json',
    '../receipts/one',
    '/artifacts/one?revision=2',
    'https://example.test/receipt#section',
  ])('accepts a retrieval hint %s', (value) => {
    expect(isEvidenceLocator(value)).toBe(true)
  })
})
