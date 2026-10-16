// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from 'node:fs'

function installedVersion(specifier: string): string {
  const metadata = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.resolve(specifier)), 'utf8'),
  ) as { version?: unknown }
  if (typeof metadata.version !== 'string' || metadata.version.length === 0) {
    throw new Error(`missing installed version for ${specifier}`)
  }
  return metadata.version
}

export const proofSdkVersions = {
  common: installedVersion('@proof.com/proof-vc-common'),
  server: installedVersion('@proof.com/proof-vc-server'),
  x401: installedVersion('@proof.com/x401-node'),
} as const
