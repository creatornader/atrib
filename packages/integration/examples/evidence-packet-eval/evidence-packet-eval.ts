// SPDX-License-Identifier: Apache-2.0

import { runEvidencePacketEval } from '../../src/evidence-packet-eval.js'

const result = await runEvidencePacketEval()
console.log(JSON.stringify(result, null, 2))

if (result.summary.passed_arms !== result.summary.total_arms) {
  process.exitCode = 1
}
