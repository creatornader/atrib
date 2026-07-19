// SPDX-License-Identifier: Apache-2.0

import { runMcpInterceptorAuditProof } from '../../src/mcp-interceptor-audit.js'

const result = await runMcpInterceptorAuditProof()
console.log(JSON.stringify(result, null, 2))

if (
  !result.sdk.capability_declared ||
  result.paired.request.info.pairing.status !== 'pending_response' ||
  result.paired.response.info.pairing.status !== 'paired' ||
  !result.paired.receipt_valid ||
  !result.paired.record_valid ||
  result.missing_identity.response.info.pairing.status !== 'unpaired' ||
  result.missing_identity.receipt_emitted ||
  !result.privacy.private_sidecar_contains_phrase ||
  result.privacy.public_record_contains_phrase
) {
  process.exitCode = 1
}
