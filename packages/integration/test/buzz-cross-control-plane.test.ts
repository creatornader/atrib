// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { runBuzzCrossControlPlaneFixture } from '../src/buzz-cross-control-plane.js'

describe('Buzz cross-control-plane fixture', () => {
  it('verifies each source leg before one protected receiver effect', async () => {
    const result = await runBuzzCrossControlPlaneFixture()

    expect(result).toMatchObject({
      strategy: 'buzz-cross-control-plane-fixture-v0',
      fixture_level: true,
      local_only: true,
      producer: {
        observer_event_count: 2,
        observer_signatures_valid: true,
        sequence_complete: true,
        effect_count: 1,
      },
      evidence: {
        runtime_window_verification: { valid: true },
        coverage_verification: { valid: true },
        result_claim: {
          status: 'body_consistent_uncorroborated',
          truth_established: false,
        },
        source_outcome_signature_valid: true,
        observer_record_signature_valid: true,
        observer_record_binding_valid: true,
        coverage_record_signature_valid: true,
        coverage_record_binding_valid: true,
        packet: { all_accepted: true, rejected: [] },
        operating_bindings_valid: true,
        action_pair_linked: true,
      },
      receiver: {
        policy_outcome: 'allow',
        state: 'allowed',
        effect_count: 1,
        decision_signature_valid: true,
        outcome_signature_valid: true,
        gate_verification_valid: true,
        replay_rejection: 'authorization_consumed',
      },
    })
    expect(result.receiver.accepted_parent_hashes).toEqual(
      expect.arrayContaining([
        result.producer.request_record_hash,
        result.producer.outcome_record_hash,
        result.evidence.observer_record_hash,
        result.evidence.coverage_record_hash,
        result.producer.accepted_state_record_hash,
        result.producer.handoff_record_hash,
      ]),
    )
    expect(result.operating_view.cells).toContainEqual(
      expect.objectContaining({
        kind: 'accepted_state',
        status: 'accepted',
        accepted_head: result.producer.accepted_state_record_hash,
      }),
    )
    expect(result.operating_view.handoffs).toContainEqual(
      expect.objectContaining({
        record_hash: result.producer.handoff_record_hash,
      }),
    )
  }, 30_000)

  it('blocks inconsistent result evidence without invalidating source signature bytes', async () => {
    const result = await runBuzzCrossControlPlaneFixture({
      tamper_result_evidence: true,
    })

    expect(result.evidence.source_outcome_signature_valid).toBe(true)
    expect(result.evidence.result_claim).toMatchObject({
      status: 'evidence_inconsistent',
      body_consistent: false,
      truth_established: false,
    })
    expect(result.evidence.packet.all_accepted).toBe(false)
    expect(result.evidence.packet.rejected).toContainEqual(
      expect.objectContaining({
        record_hash: result.producer.outcome_record_hash,
        rejection_reasons: expect.arrayContaining(['body_hash_mismatch']),
      }),
    )
    expect(result.receiver).toMatchObject({
      policy_outcome: 'block',
      state: 'blocked',
      effect_count: 0,
      decision_signature_valid: true,
      outcome_signature_valid: true,
      gate_verification_valid: true,
      replay_rejection: null,
    })
  }, 30_000)

  it('rejects a missing observer result frame before any producer effect', async () => {
    await expect(runBuzzCrossControlPlaneFixture({ omit_result_frame: true })).rejects.toThrow(
      'Buzz observer sequence is incomplete: sequence_gap',
    )
  })
})
