// SPDX-License-Identifier: Apache-2.0

import { runBrowserWorkflowReceiptSmoke } from '../../src/browser-workflow-receipt.js'

const result = await runBrowserWorkflowReceiptSmoke()
console.log(JSON.stringify(result, null, 2))

if (
  result.signed_records !== 4 ||
  !result.privacy.public_records_hash_only ||
  !result.privacy.local_sidecars_keep_payloads
) {
  process.exitCode = 1
}
