// SPDX-License-Identifier: Apache-2.0

/**
 * Keychain integration tests.
 *
 * These tests interact with the actual macOS Keychain. They are skipped on
 * non-macOS platforms (CI on Linux runners). Each test uses a unique
 * service name with a per-test random suffix so concurrent CI jobs and
 * developer machines don't collide.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { platform } from 'node:os'
import { randomBytes } from 'node:crypto'
import {
  isKeychainSupported,
  loadSeed,
  storeSeed,
  deleteSeed,
  resolveServiceAccount,
  KeychainNotSupportedError,
} from '../src/keychain.js'

const onMacos = platform() === 'darwin'
const macosOnly = onMacos ? describe : describe.skip

describe('keychain helpers (platform-agnostic)', () => {
  it('isKeychainSupported reflects platform', () => {
    expect(isKeychainSupported()).toBe(onMacos)
  })

  it('resolveServiceAccount uses defaults', () => {
    const { service, account } = resolveServiceAccount()
    expect(service).toBe('atrib-creator')
    expect(typeof account).toBe('string')
    expect(account.length).toBeGreaterThan(0)
  })

  it('resolveServiceAccount honors overrides', () => {
    const { service, account } = resolveServiceAccount({
      service: 'atrib-merchant',
      account: 'alice',
    })
    expect(service).toBe('atrib-merchant')
    expect(account).toBe('alice')
  })
})

describe('keychain unsupported-platform behavior', () => {
  it('throws KeychainNotSupportedError off macOS', () => {
    if (onMacos) {
      // On macOS the call should NOT throw — exercised in macos-only suite.
      return
    }
    expect(() => storeSeed('AAAA')).toThrow(KeychainNotSupportedError)
    expect(() => loadSeed()).toThrow(KeychainNotSupportedError)
    expect(() => deleteSeed()).toThrow(KeychainNotSupportedError)
  })
})

macosOnly('keychain on macOS', () => {
  let testService: string

  beforeEach(() => {
    // Per-test service name to isolate runs and avoid collisions with the
    // operator's real atrib-creator entry.
    testService = `atrib-test-${randomBytes(8).toString('hex')}`
  })

  afterEach(() => {
    // Best-effort cleanup; ignore "not found" errors.
    try {
      deleteSeed({ service: testService })
    } catch {
      // ignore
    }
  })

  it('store + load round-trips', () => {
    const seed = randomBytes(32).toString('base64url')
    storeSeed(seed, { service: testService })
    expect(loadSeed({ service: testService })).toBe(seed)
  })

  it('store overwrites existing entries', () => {
    const seed1 = randomBytes(32).toString('base64url')
    const seed2 = randomBytes(32).toString('base64url')
    storeSeed(seed1, { service: testService })
    storeSeed(seed2, { service: testService })
    expect(loadSeed({ service: testService })).toBe(seed2)
  })

  it('load returns null when no entry exists', () => {
    expect(loadSeed({ service: testService })).toBeNull()
  })

  it('delete removes the entry and returns true', () => {
    const seed = randomBytes(32).toString('base64url')
    storeSeed(seed, { service: testService })
    expect(deleteSeed({ service: testService })).toBe(true)
    expect(loadSeed({ service: testService })).toBeNull()
  })

  it('delete returns false when no entry exists', () => {
    expect(deleteSeed({ service: testService })).toBe(false)
  })

  it('different services do not collide', () => {
    const otherService = `${testService}-other`
    const seed1 = randomBytes(32).toString('base64url')
    const seed2 = randomBytes(32).toString('base64url')
    try {
      storeSeed(seed1, { service: testService })
      storeSeed(seed2, { service: otherService })
      expect(loadSeed({ service: testService })).toBe(seed1)
      expect(loadSeed({ service: otherService })).toBe(seed2)
    } finally {
      try { deleteSeed({ service: otherService }) } catch { /* ignore */ }
    }
  })
})
