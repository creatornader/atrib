// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
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

await assert.rejects(
  () => checkExtractZipException({ fetchImpl: async () => latestResponse('2.0.2') }),
  /extract-zip released 2\.0\.2/,
)
