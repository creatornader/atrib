#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

import { readFile } from 'node:fs/promises'

const LOCKFILE = new URL('../pnpm-lock.yaml', import.meta.url)

export async function checkArchiveDependencies({ readFileImpl = readFile } = {}) {
  const lockfile = await readFileImpl(LOCKFILE, 'utf8')

  if (/^\s*['"]?extract-zip(?:@|['"]?:)/m.test(lockfile)) {
    throw new Error(
      'pnpm-lock.yaml reintroduced extract-zip; use the patched browser-use archive reader',
    )
  }
  if (/adm-zip@0\.6\.0\b|^\s+adm-zip:\s+0\.6\.0\b/m.test(lockfile)) {
    throw new Error('pnpm-lock.yaml contains vulnerable adm-zip 0.6.0; keep the 0.6.1 override')
  }

  for (const [name, ceiling] of [
    ['braces', [3, 0, 3]],
    ['sprintf-js', [1, 1, 3]],
  ]) {
    const versions = lockfile.matchAll(
      new RegExp(`^\\s*['"]?${name}@(\\d+)\\.(\\d+)\\.(\\d+)`, 'gm'),
    )
    for (const match of versions) {
      const version = match.slice(1).map(Number)
      const difference = version
        .map((part, index) => part - ceiling[index])
        .find((part) => part !== 0)
      if (difference === undefined || difference < 0) {
        throw new Error(`pnpm-lock.yaml reintroduced vulnerable ${name} ${version.join('.')}`)
      }
    }
  }

  return {
    ok: true,
    extract_zip_present: false,
    adm_zip_vulnerable_version_present: false,
    vulnerable_braces_or_sprintf_present: false,
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
