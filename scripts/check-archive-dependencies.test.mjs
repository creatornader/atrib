// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import { checkArchiveDependencies } from './check-archive-dependencies.mjs'

const safeLockfile = `
overrides:
  browser-use@0.8.0>extract-zip: '-'
packages:
  adm-zip@0.6.1:
    resolution: {}
snapshots:
  browser-use@0.8.0:
    dependencies:
      adm-zip: 0.6.1
`

assert.deepEqual(await checkArchiveDependencies({ readFileImpl: async () => safeLockfile }), {
  ok: true,
  extract_zip_present: false,
  adm_zip_vulnerable_version_present: false,
  vulnerable_braces_or_sprintf_present: false,
})

await assert.rejects(
  () => checkArchiveDependencies({ readFileImpl: async () => 'extract-zip@2.0.1:' }),
  /reintroduced extract-zip/,
)

await assert.rejects(
  () =>
    checkArchiveDependencies({
      readFileImpl: async () => `${safeLockfile}\n      extract-zip: 2.0.1\n`,
    }),
  /reintroduced extract-zip/,
)

await assert.rejects(
  () => checkArchiveDependencies({ readFileImpl: async () => "  'extract-zip@2.0.1':" }),
  /reintroduced extract-zip/,
)

await assert.rejects(
  () => checkArchiveDependencies({ readFileImpl: async () => 'adm-zip@0.6.0:' }),
  /vulnerable adm-zip 0\.6\.0/,
)

for (const name of ['braces', 'sprintf-js']) {
  const affected = name === 'braces' ? ['1.0.0', '3.0.3'] : ['1.0.0', '1.1.3']
  for (const version of affected) {
    await assert.rejects(
      () => checkArchiveDependencies({ readFileImpl: async () => `  '${name}@${version}':\n` }),
      new RegExp(`reintroduced vulnerable ${name}`),
    )
  }
}

await checkArchiveDependencies({
  readFileImpl: async () => '  braces@3.0.4:\n  sprintf-js@1.1.4:\n',
})
