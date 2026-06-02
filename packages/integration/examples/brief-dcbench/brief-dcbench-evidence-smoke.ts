// SPDX-License-Identifier: Apache-2.0

import { runBriefDcbenchEvidenceSmoke } from '../../src/brief-dcbench-evidence.js'

const result = await runBriefDcbenchEvidenceSmoke()
console.log(JSON.stringify(result, null, 2))

if (
  result.signed_records !== 3 ||
  !result.lineage.action_informed_by_context_lookup ||
  !result.lineage.score_informed_by_action ||
  !result.privacy.public_records_hash_only
) {
  process.exitCode = 1
}
