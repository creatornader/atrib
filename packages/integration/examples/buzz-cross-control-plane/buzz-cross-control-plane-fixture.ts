// SPDX-License-Identifier: Apache-2.0

import { runBuzzCrossControlPlaneFixture } from '../../src/buzz-cross-control-plane.js'

const result = await runBuzzCrossControlPlaneFixture()

process.stdout.write(
  `${JSON.stringify({
    strategy: result.strategy,
    fixture_level: result.fixture_level,
    local_only: result.local_only,
    producer: {
      observer_event_count: result.producer.observer_event_count,
      sequence_complete: result.producer.sequence_complete,
      effect_count: result.producer.effect_count,
    },
    evidence: {
      runtime_window_hash: result.evidence.runtime_window_hash,
      runtime_window_valid: result.evidence.runtime_window_verification.valid,
      coverage_manifest_hash: result.evidence.coverage_manifest_hash,
      coverage_valid: result.evidence.coverage_verification.valid,
      coverage_record_hash: result.evidence.coverage_record_hash,
      coverage_record_binding_valid: result.evidence.coverage_record_binding_valid,
      observer_record_hash: result.evidence.observer_record_hash,
      observer_record_binding_valid: result.evidence.observer_record_binding_valid,
      packet_all_accepted: result.evidence.packet.all_accepted,
      result_claim: result.evidence.result_claim.status,
      arbitrary_result_truth_established: result.evidence.result_claim.truth_established,
    },
    receiver: result.receiver,
    claims_not_made: result.claims_not_made,
    limitation: result.limitation,
  })}\n`,
)
