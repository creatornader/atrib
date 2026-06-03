// SPDX-License-Identifier: Apache-2.0

import { runTraceRepairSuspect } from '../../src/trace-repair-suspect.js'

const result = await runTraceRepairSuspect()
console.log(JSON.stringify(result, null, 2))

if (
  !result.summary.current_trace_accepts ||
  !result.summary.stale_packet_rejects ||
  !result.summary.top_suspect_is_failed_tool_action ||
  !result.summary.diagnostic_signature_ok ||
  !result.summary.diagnostic_links_failure_and_suspect
) {
  process.exitCode = 1
}
