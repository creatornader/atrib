#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

import { readFile } from 'node:fs/promises'

const PACKAGE_NAME = 'extract-zip'
const EXPECTED_LATEST_VERSION = '2.0.1'
const ALERT_URL = 'https://github.com/creatornader/atrib/security/dependabot/72'
const SCANNER_CONFIG = new URL('../osv-scanner.toml', import.meta.url)
const REQUIRED_EXCEPTION_IDS = [
  'GHSA-jmr9-qjv8-65gv',
  'GHSA-7pqw-9j4j-h8q3',
  'GHSA-vwc7-r8mq-g2x9',
]

export async function getLatestPackageVersion({ fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`, {
    headers: { accept: 'application/json' },
  })
  if (!response.ok) {
    throw new Error(`npm registry returned ${response.status} for ${PACKAGE_NAME}`)
  }
  const body = await response.json()
  if (typeof body.version !== 'string' || body.version.length === 0) {
    throw new Error(`npm registry response for ${PACKAGE_NAME} has no version`)
  }
  return body.version
}

export async function checkExtractZipException(options = {}) {
  const latestVersion = await getLatestPackageVersion(options)
  if (latestVersion !== EXPECTED_LATEST_VERSION) {
    throw new Error(
      `${PACKAGE_NAME} released ${latestVersion}; review the mitigated Dependabot alert ${ALERT_URL} before the next scheduled security scan`,
    )
  }
  const scannerConfig = await readFile(SCANNER_CONFIG, 'utf8')
  for (const id of REQUIRED_EXCEPTION_IDS) {
    if (!new RegExp(`id\\s*=\\s*"${id}"`).test(scannerConfig)) {
      throw new Error(`osv-scanner.toml is missing the reviewed archive exception ${id}`)
    }
  }
  return {
    package_name: PACKAGE_NAME,
    latest_version: latestVersion,
    alert_url: ALERT_URL,
    exception_ids: REQUIRED_EXCEPTION_IDS,
  }
}

async function main() {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ok: true, ...(await checkExtractZipException()) }))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
