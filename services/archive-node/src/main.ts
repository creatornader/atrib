// SPDX-License-Identifier: Apache-2.0

import { bindArchiveServer } from './index.js'

const port = parseInt(process.env.PORT ?? '3400', 10)
const host = process.env.HOST ?? '127.0.0.1'
const trustedLogEndpoints = (process.env.ATRIB_ARCHIVE_LOG_ENDPOINTS ?? 'https://log.atrib.dev/v1')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean)
const retentionWindowMs = parseOptionalInt(process.env.ATRIB_ARCHIVE_RETENTION_WINDOW_MS)
const archivedAfterMs = parseOptionalInt(process.env.ATRIB_ARCHIVE_ARCHIVED_AFTER_MS)

const server = await bindArchiveServer(port, host, {
  origin: process.env.ATRIB_ARCHIVE_ORIGIN ?? 'archive.atrib.dev',
  trustedLogEndpoints,
  ...(process.env.ATRIB_ARCHIVE_PERSIST
    ? { persistencePath: process.env.ATRIB_ARCHIVE_PERSIST }
    : {}),
  ...(retentionWindowMs !== undefined ? { retentionWindowMs } : {}),
  ...(archivedAfterMs !== undefined ? { archivedAfterMs } : {}),
  ...(process.env.ATRIB_ARCHIVE_POLICY_URL
    ? { policyUrl: process.env.ATRIB_ARCHIVE_POLICY_URL }
    : {}),
  ...(process.env.ATRIB_ARCHIVE_ALLOW_UNCOMMITTED === '1' ? { allowUncommittedRecords: true } : {}),
})

// eslint-disable-next-line no-console
console.log(`atrib-archive listening on ${server.url}`)

process.on('SIGTERM', async () => {
  await server.close()
  process.exit(0)
})
process.on('SIGINT', async () => {
  await server.close()
  process.exit(0)
})

function parseOptionalInt(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined
}
