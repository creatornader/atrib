// SPDX-License-Identifier: Apache-2.0

import { createProofLogReceipt } from '../../src/proof-log-receipt.js'

const receipt = await createProofLogReceipt({
  logEndpoint: process.env.ATRIB_PROOF_LOG_ENDPOINT,
  archiveEndpoint: process.env.ATRIB_PROOF_ARCHIVE_ENDPOINT,
  explorerOrigin: process.env.ATRIB_PROOF_EXPLORER_ORIGIN,
})

console.log(JSON.stringify(receipt, null, 2))
