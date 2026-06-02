// SPDX-License-Identifier: Apache-2.0

import { runBrowserUseWorkflowReceiptSmoke } from '../../src/browser-workflow-receipt.js'

const result = await runBrowserUseWorkflowReceiptSmoke()
console.log(JSON.stringify(result, null, 2))

if (
  result.host.framework !== 'browser-use' ||
  result.signed_records !== 4 ||
  !result.privacy.public_records_hash_only ||
  !result.privacy.local_sidecars_keep_payloads
) {
  process.exitCode = 1
}
