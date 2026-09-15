// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { checkExtractZipException } from './check-extract-zip-exception.mjs'

const latestResponse = (version) =>
  new Response(JSON.stringify({ version }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

const result = await checkExtractZipException({
  fetchImpl: async () => latestResponse('2.0.1'),
})
assert.equal(result.latest_version, '2.0.1')
assert.deepEqual(result.exception_ids, [
  'GHSA-jmr9-qjv8-65gv',
  'GHSA-7pqw-9j4j-h8q3',
  'GHSA-vwc7-r8mq-g2x9',
])

await assert.rejects(
  () => checkExtractZipException({ fetchImpl: async () => latestResponse('2.0.2') }),
  /extract-zip released 2\.0\.2/,
)

const scannerConfig = await readFile(join(process.cwd(), 'osv-scanner.toml'), 'utf8')
assert.match(scannerConfig, /id\s*=\s*"GHSA-jmr9-qjv8-65gv"/)
assert.match(scannerConfig, /id\s*=\s*"GHSA-7pqw-9j4j-h8q3"/)
assert.match(scannerConfig, /id\s*=\s*"GHSA-vwc7-r8mq-g2x9"/)
assert.match(scannerConfig, /ignoreUntil\s*=\s*2026-12-14/)
