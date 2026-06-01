// SPDX-License-Identifier: Apache-2.0

import { runMcpOAuthEvidenceHarness } from '../src/mcp-oauth-evidence-harness.js'
import { canonicalRecord, hexEncode, sha256 } from '@atrib/mcp'

const result = await runMcpOAuthEvidenceHarness()

console.log(
  JSON.stringify(
    {
      record_hash: `sha256:${hexEncode(sha256(canonicalRecord(result.record)))}`,
      context_id: result.record.context_id,
      tool_name: result.sidecar.resolvedFacts?.tool_name,
      record_valid: result.verification.valid,
      evidence: result.verification.evidence,
      authorization_evidence_captured: result.sidecar.authorizationEvidence?.length ?? 0,
    },
    null,
    2,
  ),
)
