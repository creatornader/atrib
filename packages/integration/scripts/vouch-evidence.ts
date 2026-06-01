// SPDX-License-Identifier: Apache-2.0

import { canonicalRecord, hexEncode, sha256 } from '@atrib/mcp'
import { runVouchEvidenceHarness } from '../src/vouch-evidence-harness.js'

const result = await runVouchEvidenceHarness()

console.log(
  JSON.stringify(
    {
      record_hash: `sha256:${hexEncode(sha256(canonicalRecord(result.record)))}`,
      context_id: result.record.context_id,
      record_valid: result.verification.valid,
      evidence: result.verification.evidence,
      vouch_issuer: result.verification.evidence?.[0]?.issuer,
      vouch_subject: result.verification.evidence?.[0]?.subject,
      vouch_resource: result.verification.evidence?.[0]?.scope[0],
    },
    null,
    2,
  ),
)
