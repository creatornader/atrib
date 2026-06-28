// SPDX-License-Identifier: Apache-2.0

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { classifyProofX401NodeReadme } from '../src/proof-x401-sdk-compat.js'

const execFileAsync = promisify(execFile)
const PACKAGE_NAME = '@proof.com/x401-node'

async function npmViewJson(field: string): Promise<unknown> {
  const { stdout } = await execFileAsync('npm', ['view', `${PACKAGE_NAME}@latest`, field, '--json'], {
    timeout: 30000,
    maxBuffer: 1024 * 1024,
  })
  return JSON.parse(stdout)
}

async function main(): Promise<void> {
  const [version, readme] = await Promise.all([npmViewJson('version'), npmViewJson('readme')])
  const report = classifyProofX401NodeReadme({
    packageName: PACKAGE_NAME,
    version: typeof version === 'string' ? version : 'unknown',
    readme: typeof readme === 'string' ? readme : '',
  })

  console.log(JSON.stringify(report, null, 2))

  if (process.argv.includes('--require-compatible') && !report.compatible_with_current_spec) {
    process.exitCode = 1
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exitCode = 2
})
