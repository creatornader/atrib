// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  checkAndConsumeToken,
  computeActionBinding,
  createMemoryConsumptionStore,
  evaluateElevation,
  issueActionToken,
  type ActionBindingInput,
  type ElevationInput,
  type TokenConsumptionStore,
} from '../src/index.js'

const VALUE_HASH = `sha256:${'1'.repeat(64)}`
const INPUT: ActionBindingInput = {
  tool: 'payments.transfer',
  value_hash: VALUE_HASH,
  amount: '42.00',
  nonce: 'approval-nonce-1',
  issued_at_ms: 1_780_000_000_000,
}

const DRIVING_RECORD_HASH = 'sha256:untrusted-driving-record'

function untrustedElevationInput(overrides: Partial<ElevationInput>): ElevationInput {
  const drivingRecord = { record_hash: DRIVING_RECORD_HASH }
  return {
    drivingRecordHash: DRIVING_RECORD_HASH,
    graph: new Map([[DRIVING_RECORD_HASH, drivingRecord]]),
    originAuthority: () => 'untrusted',
    ...overrides,
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('action-bound authorization tokens', () => {
  it('computes the same binding for the same input', () => {
    expect(computeActionBinding(INPUT)).toBe(computeActionBinding(INPUT))
  })

  it('canonicalizes input independently of object key order', () => {
    const reordered: ActionBindingInput = {
      issued_at_ms: INPUT.issued_at_ms,
      nonce: INPUT.nonce,
      amount: INPUT.amount,
      value_hash: INPUT.value_hash,
      tool: INPUT.tool,
    }

    expect(computeActionBinding(reordered)).toBe(computeActionBinding(INPUT))
  })

  it('distinguishes an absent amount from present amounts', () => {
    const absent = computeActionBinding({
      tool: INPUT.tool,
      value_hash: INPUT.value_hash,
      nonce: INPUT.nonce,
      issued_at_ms: INPUT.issued_at_ms,
    })
    const present = computeActionBinding(INPUT)
    const zero = computeActionBinding({ ...INPUT, amount: '0' })

    expect(absent).not.toBe(present)
    expect(absent).not.toBe(zero)
  })

  it('rejects a mutated token without consuming the valid binding', async () => {
    const token = issueActionToken(INPUT)
    const memoryStore = createMemoryConsumptionStore()
    let consumeCalls = 0
    const store: TokenConsumptionStore = {
      consume(binding) {
        consumeCalls += 1
        return memoryStore.consume(binding)
      },
    }

    const invalid = await checkAndConsumeToken({
      token: { ...token, nonce: 'mutated-after-approval' },
      actionBinding: token.binding,
      store,
      nowMs: INPUT.issued_at_ms,
    })

    expect(invalid).toEqual({ ok: false, reason: 'binding-invalid', fresh: false })
    expect(consumeCalls).toBe(0)

    const valid = await checkAndConsumeToken({
      token,
      actionBinding: token.binding,
      store,
      nowMs: INPUT.issued_at_ms,
    })

    expect(valid).toEqual({ ok: true, reason: 'ok', fresh: true })
    expect(consumeCalls).toBe(1)
  })

  it('rejects a different action binding without consuming the token', async () => {
    const token = issueActionToken(INPUT)
    const store = createMemoryConsumptionStore()
    const otherActionBinding = computeActionBinding({ ...INPUT, nonce: 'other-action' })

    const mismatch = await checkAndConsumeToken({
      token,
      actionBinding: otherActionBinding,
      store,
      nowMs: INPUT.issued_at_ms,
    })
    const valid = await checkAndConsumeToken({
      token,
      actionBinding: token.binding,
      store,
      nowMs: INPUT.issued_at_ms,
    })

    expect(mismatch).toEqual({ ok: false, reason: 'binding-mismatch', fresh: false })
    expect(valid).toEqual({ ok: true, reason: 'ok', fresh: true })
  })

  it('expires beyond maxAgeMs but remains valid exactly at maxAgeMs', async () => {
    const token = issueActionToken(INPUT)
    const store = createMemoryConsumptionStore()

    const expired = await checkAndConsumeToken({
      token,
      actionBinding: token.binding,
      store,
      nowMs: INPUT.issued_at_ms + 301,
      maxAgeMs: 300,
    })
    const boundary = await checkAndConsumeToken({
      token,
      actionBinding: token.binding,
      store,
      nowMs: INPUT.issued_at_ms + 300,
      maxAgeMs: 300,
    })

    expect(expired).toEqual({ ok: false, reason: 'expired', fresh: false })
    expect(boundary).toEqual({ ok: true, reason: 'ok', fresh: true })
  })

  it('rejects a current time before issuance', async () => {
    const token = issueActionToken(INPUT)
    const result = await checkAndConsumeToken({
      token,
      actionBinding: token.binding,
      store: createMemoryConsumptionStore(),
      nowMs: INPUT.issued_at_ms - 1,
    })

    expect(result).toEqual({ ok: false, reason: 'expired', fresh: false })
  })

  it('accepts a valid fresh token', async () => {
    const token = issueActionToken(INPUT)
    const result = await checkAndConsumeToken({
      token,
      actionBinding: token.binding,
      store: createMemoryConsumptionStore(),
      nowMs: INPUT.issued_at_ms,
    })

    expect(result).toEqual({ ok: true, reason: 'ok', fresh: true })
  })

  it('rejects a second check of the same token', async () => {
    const token = issueActionToken(INPUT)
    const store = createMemoryConsumptionStore()

    const first = await checkAndConsumeToken({
      token,
      actionBinding: token.binding,
      store,
      nowMs: INPUT.issued_at_ms,
    })
    const second = await checkAndConsumeToken({
      token,
      actionBinding: token.binding,
      store,
      nowMs: INPUT.issued_at_ms,
    })

    expect(first).toEqual({ ok: true, reason: 'ok', fresh: true })
    expect(second).toEqual({ ok: false, reason: 'consumed', fresh: false })
  })

  it('keeps consumption state independent between stores', async () => {
    const token = issueActionToken(INPUT)
    const firstStoreResult = await checkAndConsumeToken({
      token,
      actionBinding: token.binding,
      store: createMemoryConsumptionStore(),
      nowMs: INPUT.issued_at_ms,
    })
    const secondStoreResult = await checkAndConsumeToken({
      token,
      actionBinding: token.binding,
      store: createMemoryConsumptionStore(),
      nowMs: INPUT.issued_at_ms,
    })

    expect(firstStoreResult.reason).toBe('ok')
    expect(secondStoreResult.reason).toBe('ok')
  })

  it('supports an asynchronous consumption store', async () => {
    const token = issueActionToken(INPUT)
    const consumed = new Set<string>()
    const store: TokenConsumptionStore = {
      async consume(binding) {
        await Promise.resolve()
        if (consumed.has(binding)) return false
        consumed.add(binding)
        return true
      },
    }

    const first = await checkAndConsumeToken({
      token,
      actionBinding: token.binding,
      store,
      nowMs: INPUT.issued_at_ms,
    })
    const second = await checkAndConsumeToken({
      token,
      actionBinding: token.binding,
      store,
      nowMs: INPUT.issued_at_ms,
    })

    expect(first.reason).toBe('ok')
    expect(second.reason).toBe('consumed')
  })

  it('allows exactly one concurrent check through an atomic async store', async () => {
    const token = issueActionToken(INPUT)
    const bothStarted = deferred()
    const release = deferred()
    const consumed = new Set<string>()
    let started = 0
    const store: TokenConsumptionStore = {
      async consume(binding) {
        started += 1
        if (started === 2) bothStarted.resolve()
        await release.promise
        if (consumed.has(binding)) return false
        consumed.add(binding)
        return true
      },
    }

    const checks = [
      checkAndConsumeToken({
        token,
        actionBinding: token.binding,
        store,
        nowMs: INPUT.issued_at_ms,
      }),
      checkAndConsumeToken({
        token,
        actionBinding: token.binding,
        store,
        nowMs: INPUT.issued_at_ms,
      }),
    ]

    await bothStarted.promise
    release.resolve()
    const results = await Promise.all(checks)

    expect(results.map((result) => result.reason).sort()).toEqual(['consumed', 'ok'])
  })

  it('allows D144 elevation after a successful token check', async () => {
    const token = issueActionToken(INPUT)
    const check = await checkAndConsumeToken({
      token,
      actionBinding: token.binding,
      store: createMemoryConsumptionStore(),
      nowMs: INPUT.issued_at_ms,
    })
    const decision = evaluateElevation(
      untrustedElevationInput({
        actionBinding: token.binding,
        token: { binding: token.binding, fresh: check.fresh },
      }),
    )

    expect(decision).toMatchObject({ outcome: 'allow', reason: 'token' })
  })

  it('escalates D144 elevation after the token is consumed', async () => {
    const token = issueActionToken(INPUT)
    const store = createMemoryConsumptionStore()
    await checkAndConsumeToken({
      token,
      actionBinding: token.binding,
      store,
      nowMs: INPUT.issued_at_ms,
    })
    const consumed = await checkAndConsumeToken({
      token,
      actionBinding: token.binding,
      store,
      nowMs: INPUT.issued_at_ms,
    })
    const decision = evaluateElevation(
      untrustedElevationInput({
        actionBinding: token.binding,
        token: { binding: token.binding, fresh: consumed.fresh },
      }),
    )

    expect(consumed).toEqual({ ok: false, reason: 'consumed', fresh: false })
    expect(decision).toMatchObject({ outcome: 'escalate', reason: 'uncorroborated' })
  })
})
