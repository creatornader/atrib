// SPDX-License-Identifier: Apache-2.0

import { runA2aHandoffProof } from '../../src/a2a-handoff.js'

const result = await runA2aHandoffProof()
console.log(JSON.stringify(result, null, 2))

if (
  result.evidence.accepted_record_hashes.length !== 1 ||
  !result.agent_card.signature_valid ||
  result.evidence.rejected_count !== 0 ||
  !result.followup.signature_ok ||
  result.followup.informed_by_dangling.length !== 0 ||
  result.privacy.public_record_contains_private_phrase
) {
  process.exitCode = 1
}
