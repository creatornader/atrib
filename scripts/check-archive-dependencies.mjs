#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

import { readFile } from 'node:fs/promises'

const LOCKFILE = new URL('../pnpm-lock.yaml', import.meta.url)

export async function checkArchiveDependencies({ readFileImpl = readFile } = {}) {
  const lockfile = await readFileImpl(LOCKFILE, 'utf8')

  if (/extract-zip(?:@|:)/m.test(lockfile)) {
    throw new Error(
      'pnpm-lock.yaml reintroduced extract-zip; use the patched browser-use archive reader',
    )
  }
  if (/adm-zip@0\.6\.0\b|^\s+adm-zip:\s+0\.6\.0\b/m.test(lockfile)) {
    throw new Error('pnpm-lock.yaml contains vulnerable adm-zip 0.6.0; keep the 0.6.1 override')
  }

  return {
    ok: true,
    extract_zip_present: false,
    adm_zip_vulnerable_version_present: false,
  }
}

async function main() {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(await checkArchiveDependencies()))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
