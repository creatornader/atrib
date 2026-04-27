// SPDX-License-Identifier: Apache-2.0

/**
 * Tests for decideKeyConfig — the production fail-fast guard introduced in
 * production-environment fail-fast guard of the comprehensive gap-closure plan. Without this, log-node
 * starts with a random checkpoint key in production, silently invalidating
 * every prior inclusion proof on the next restart.
 */

import { describe, it, expect } from 'vitest'
import { decideKeyConfig } from '../src/main.js'

const VALID_SEED_B64URL = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

describe('decideKeyConfig', () => {
  it('accepts a valid key in any NODE_ENV', () => {
    for (const NODE_ENV of [undefined, 'development', 'test', 'production']) {
      const d = decideKeyConfig({
        ATRIB_LOG_KEY: VALID_SEED_B64URL,
        ...(NODE_ENV !== undefined ? { NODE_ENV } : {}),
      })
      expect(d.ok).toBe(true)
      expect(d.logPrivateKey).toBeInstanceOf(Uint8Array)
      expect(d.logPrivateKey!.length).toBe(32)
    }
  })

  it('rejects a key that does not decode to 32 bytes', () => {
    const d = decideKeyConfig({ ATRIB_LOG_KEY: 'tooshort' })
    expect(d.ok).toBe(false)
    expect(d.message).toMatch(/32 bytes/)
  })

  it('fails fast in production when ATRIB_LOG_KEY is unset', () => {
    const d = decideKeyConfig({ NODE_ENV: 'production' })
    expect(d.ok).toBe(false)
    expect(d.message).toMatch(/NODE_ENV=production/)
    expect(d.message).toMatch(/ATRIB_LOG_KEY/)
  })

  it('respects the explicit allow-random override in production', () => {
    const d = decideKeyConfig({
      NODE_ENV: 'production',
      ATRIB_LOG_KEY_ALLOW_RANDOM: '1',
    })
    expect(d.ok).toBe(true)
    expect(d.logPrivateKey).toBeUndefined() // random fallback
    expect(d.message).toMatch(/random keypair/)
  })

  it('does not require the override outside production', () => {
    const d = decideKeyConfig({})
    expect(d.ok).toBe(true)
    expect(d.message).toMatch(/random keypair/)
  })

  it('does not accept allow-random values other than "1"', () => {
    // Defensive: typos like "true" or "yes" must not succeed in prod.
    const d = decideKeyConfig({
      NODE_ENV: 'production',
      ATRIB_LOG_KEY_ALLOW_RANDOM: 'true',
    })
    expect(d.ok).toBe(false)
  })
})
