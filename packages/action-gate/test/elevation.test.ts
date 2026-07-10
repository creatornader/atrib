// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { evaluateElevation, type Corroborator, type ElevationInput } from '../src/index.js'

const DRIVING_RECORD_HASH = 'sha256:driving-record'

function elevationInput(
  authority: 'untrusted' | 'agent' | 'trusted',
  overrides: Partial<ElevationInput> = {},
): ElevationInput {
  const drivingRecord = { record_hash: DRIVING_RECORD_HASH }
  return {
    drivingRecordHash: DRIVING_RECORD_HASH,
    graph: new Map([[DRIVING_RECORD_HASH, drivingRecord]]),
    originAuthority: () => authority,
    ...overrides,
  }
}

const TRUSTED_CORROBORATORS: Corroborator[] = [
  { signer_key: 'trusted-key-1', authority: 'trusted' },
  { signer_key: 'trusted-key-2', authority: 'trusted' },
]

describe('evaluateElevation', () => {
  it('allows a trusted-origin value', () => {
    const decision = evaluateElevation(elevationInput('trusted'))

    expect(decision).toMatchObject({
      outcome: 'allow',
      reason: 'trusted-origin',
      valueAuthority: 'trusted',
    })
  })

  it('allows an agent-origin value', () => {
    const decision = evaluateElevation(elevationInput('agent'))

    expect(decision).toMatchObject({
      outcome: 'allow',
      reason: 'trusted-origin',
      valueAuthority: 'agent',
    })
  })

  it('escalates an untrusted value without corroborators', () => {
    const decision = evaluateElevation(elevationInput('untrusted'))

    expect(decision).toMatchObject({
      outcome: 'escalate',
      reason: 'uncorroborated',
      distinctTrustedCorroborators: 0,
    })
  })

  it('allows an untrusted value with two distinct trusted corroborators', () => {
    const decision = evaluateElevation(
      elevationInput('untrusted', { corroborators: TRUSTED_CORROBORATORS }),
    )

    expect(decision).toMatchObject({
      outcome: 'allow',
      reason: 'elevated',
      distinctTrustedCorroborators: 2,
    })
  })

  it('does not count a repeated trusted signer key twice', () => {
    const decision = evaluateElevation(
      elevationInput('untrusted', {
        corroborators: [
          { signer_key: 'same-key', authority: 'trusted' },
          { signer_key: 'same-key', authority: 'trusted' },
        ],
      }),
    )

    expect(decision).toMatchObject({
      outcome: 'escalate',
      reason: 'uncorroborated',
      distinctTrustedCorroborators: 1,
    })
  })

  it('does not count agent-authority corroborators toward elevation', () => {
    const decision = evaluateElevation(
      elevationInput('untrusted', {
        corroborators: [
          { signer_key: 'trusted-key', authority: 'trusted' },
          { signer_key: 'agent-key', authority: 'agent' },
        ],
      }),
    )

    expect(decision).toMatchObject({
      outcome: 'escalate',
      reason: 'uncorroborated',
      distinctTrustedCorroborators: 1,
    })
  })

  it('allows a fresh token bound to the exact action', () => {
    const decision = evaluateElevation(
      elevationInput('untrusted', {
        actionBinding: 'binding-for-current-action',
        token: { binding: 'binding-for-current-action', fresh: true },
      }),
    )

    expect(decision).toMatchObject({ outcome: 'allow', reason: 'token' })
  })

  it('does not allow a stale token', () => {
    const decision = evaluateElevation(
      elevationInput('untrusted', {
        actionBinding: 'binding-for-current-action',
        token: { binding: 'binding-for-current-action', fresh: false },
      }),
    )

    expect(decision).toMatchObject({
      outcome: 'escalate',
      reason: 'uncorroborated',
    })
  })

  it('does not allow a token bound to a different action', () => {
    const decision = evaluateElevation(
      elevationInput('untrusted', {
        actionBinding: 'binding-for-current-action',
        token: { binding: 'binding-for-other-action', fresh: true },
      }),
    )

    expect(decision).toMatchObject({
      outcome: 'escalate',
      reason: 'uncorroborated',
    })
  })

  it('returns an error when the driving record is absent from the graph', () => {
    const decision = evaluateElevation(elevationInput('untrusted', { graph: new Map() }))

    expect(decision).toEqual({
      outcome: 'error',
      reason: 'driving-record-not-in-graph',
      valueAuthority: 'untrusted',
      distinctTrustedCorroborators: 0,
    })
  })

  it('returns the same decision for the same input', () => {
    const input = elevationInput('untrusted', {
      corroborators: TRUSTED_CORROBORATORS,
    })

    expect(evaluateElevation(input)).toEqual(evaluateElevation(input))
  })

  it('honors an elevation threshold override of three', () => {
    const decision = evaluateElevation(
      elevationInput('untrusted', {
        corroborators: TRUSTED_CORROBORATORS,
        elevationThreshold: 3,
      }),
    )

    expect(decision).toMatchObject({
      outcome: 'escalate',
      reason: 'uncorroborated',
      distinctTrustedCorroborators: 2,
    })
  })
})
