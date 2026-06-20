// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'

import { __test_only__, type KeyRetryOptions } from '../src/local-substrate-host.js'

const { resolveSigningKeyWithRetry } = __test_only__

// The function never inspects the key shape; type a stand-in via the resolver
// return type so the test does not depend on the internal ResolvedKey export.
type ResolvedKeyLike = Awaited<ReturnType<NonNullable<KeyRetryOptions['resolve']>>>
const fakeKey = { privateKey: new Uint8Array(32), source: 'env' } as ResolvedKeyLike

describe('resolveSigningKeyWithRetry', () => {
  it('returns the key on the first success without sleeping', async () => {
    let attempts = 0
    let slept = 0
    const key = await resolveSigningKeyWithRetry({
      resolve: async () => {
        attempts += 1
        return fakeKey
      },
      now: () => 0,
      sleep: async () => {
        slept += 1
      },
      log: () => {},
    })
    expect(key).toBe(fakeKey)
    expect(attempts).toBe(1)
    expect(slept).toBe(0)
  })

  it('retries with exponential backoff until the key resolves (locked-Keychain-at-boot)', async () => {
    let attempts = 0
    const sleeps: number[] = []
    const key = await resolveSigningKeyWithRetry({
      resolve: async () => {
        attempts += 1
        return attempts >= 4 ? fakeKey : null
      },
      initialDelayMs: 10,
      maxDelayMs: 40,
      now: () => 0,
      sleep: async (ms) => {
        sleeps.push(ms)
      },
      log: () => {},
    })
    expect(key).toBe(fakeKey)
    expect(attempts).toBe(4)
    expect(sleeps).toEqual([10, 20, 40])
  })

  it('returns null when the maxWaitMs budget is exhausted', async () => {
    let attempts = 0
    let clock = 0
    const key = await resolveSigningKeyWithRetry({
      resolve: async () => {
        attempts += 1
        return null
      },
      initialDelayMs: 10,
      maxWaitMs: 25,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms
      },
      log: () => {},
    })
    expect(key).toBeNull()
    expect(attempts).toBeGreaterThanOrEqual(2)
  })

  it('treats a resolver throw as a retryable miss and logs it', async () => {
    let attempts = 0
    const logs: string[] = []
    const key = await resolveSigningKeyWithRetry({
      resolve: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('keychain hiccup')
        return fakeKey
      },
      initialDelayMs: 5,
      now: () => 0,
      sleep: async () => {},
      log: (message) => logs.push(message),
    })
    expect(key).toBe(fakeKey)
    expect(attempts).toBe(2)
    expect(logs.join('')).toContain('keychain hiccup')
  })
})
