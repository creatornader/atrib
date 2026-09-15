// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import { checkArchiveDependencies } from './check-archive-dependencies.mjs'

const safeLockfile = `
  adm-zip@0.6.1:
    resolution: {}
  browser-use:
    dependencies:
      adm-zip: 0.6.1
`

assert.deepEqual(await checkArchiveDependencies({ readFileImpl: async () => safeLockfile }), {
  ok: true,
  extract_zip_present: false,
  adm_zip_vulnerable_version_present: false,
})

await assert.rejects(
  () => checkArchiveDependencies({ readFileImpl: async () => 'extract-zip@2.0.1:' }),
  /reintroduced extract-zip/,
)

await assert.rejects(
  () => checkArchiveDependencies({ readFileImpl: async () => 'adm-zip@0.6.0:' }),
  /vulnerable adm-zip 0\.6\.0/,
)
