// SPDX-License-Identifier: Apache-2.0

import { runBrokeredSignInReceiptSmoke } from '../../src/brokered-sign-in-receipt.js'

const result = await runBrokeredSignInReceiptSmoke()
const { records: _records, sidecars: _sidecars, ...summary } = result
// eslint-disable-next-line no-console
console.log(JSON.stringify(summary, null, 2))

if (
  result.broker_outcome !== 'granted' ||
  result.signed_records !== 3 ||
  !result.later_actions_cite_credential_record
) {
  process.exitCode = 1
}
