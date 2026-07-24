// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { createJsonCommitment, type AtribRecord } from '@atrib/mcp'
import { evaluateResultClaim } from '../src/index.js'

function recordWithResult(result: unknown): AtribRecord {
  const commitment = createJsonCommitment(result, 'salted-sha256', () => new Uint8Array(16).fill(9))
  return {
    spec_version: 'atrib/1.0',
    content_id: `sha256:${'a'.repeat(64)}`,
    creator_key: 'creator',
    chain_root: `sha256:${'b'.repeat(64)}`,
    event_type: 'https://atrib.dev/v1/types/tool_call',
    context_id: 'c'.repeat(32),
    timestamp: 1,
    result_hash: commitment.hash,
    result_salt: commitment.salt,
    signature: 'signature',
  }
}

describe('evaluateResultClaim', () => {
  it('distinguishes commitment, body consistency, and corroboration', () => {
    const result = { status: 'paid', amount: 42 }
    const record = recordWithResult(result)

    expect(evaluateResultClaim(record)).toMatchObject({
      status: 'committed_only',
      body_consistent: null,
      truth_established: false,
    })
    expect(evaluateResultClaim(record, { result })).toMatchObject({
      status: 'body_consistent_uncorroborated',
      body_consistent: true,
      truth_established: false,
    })
    expect(
      evaluateResultClaim(record, {
        result,
        trusted_signer_keys: new Set(['counterparty']),
        corroborations: [
          {
            signer_key: 'counterparty',
            result_hash: record.result_hash!,
            verified: true,
          },
        ],
      }),
    ).toMatchObject({
      status: 'corroborated',
      corroborating_signers: ['counterparty'],
      truth_established: false,
    })
  })

  it('surfaces evidence-inconsistent result material', () => {
    const record = recordWithResult({ status: 'paid' })
    expect(evaluateResultClaim(record, { result: { status: 'failed' } })).toMatchObject({
      status: 'evidence_inconsistent',
      body_consistent: false,
      truth_established: false,
    })
  })

  it('does not count the original claimant as independent corroboration', () => {
    const result = { status: 'paid' }
    const record = recordWithResult(result)
    expect(
      evaluateResultClaim(record, {
        result,
        trusted_signer_keys: new Set([record.creator_key]),
        corroborations: [
          {
            signer_key: record.creator_key,
            result_hash: record.result_hash!,
            verified: true,
          },
        ],
      }),
    ).toMatchObject({
      status: 'body_consistent_uncorroborated',
      corroborating_signers: [],
      corroboration_met: false,
      truth_established: false,
    })
  })
})
