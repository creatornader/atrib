// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  base64urlDecode,
  createJsonCommitment,
  createToolNameCommitment,
  hexEncode,
  sha256,
} from '../src/index.js'

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
