// SPDX-License-Identifier: Apache-2.0

import { createLiveMcpOAuthArchiveReceipt } from '../src/live-mcp-oauth-archive.js'

const receipt = await createLiveMcpOAuthArchiveReceipt({
  logEndpoint: process.env.ATRIB_LIVE_OAUTH_LOG_ENDPOINT,
  archiveEndpoint: process.env.ATRIB_LIVE_OAUTH_ARCHIVE_ENDPOINT,
  explorerOrigin: process.env.ATRIB_LIVE_OAUTH_EXPLORER_ORIGIN,
})

console.log(JSON.stringify(receipt, null, 2))
