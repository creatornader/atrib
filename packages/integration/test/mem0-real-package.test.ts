// SPDX-License-Identifier: Apache-2.0

import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const installed = JSON.parse(
  readFileSync(join(process.cwd(), 'node_modules/mem0ai/package.json'), 'utf8'),
)

describe('real Mem0 package compatibility', () => {
  it.each([
    'mem0-oss-full-cycle-smoke',
    'mem0-client-smoke',
    'mem0-oss-compat-smoke',
    'mem0-mutation-assurance-smoke',
  ])(
    'runs %s against the installed SDK',
    async (script) => {
      const { stdout } = await execFileAsync(
        join(process.cwd(), 'node_modules/tsx/dist/cli.mjs'),
        [`examples/mem0/${script}.ts`],
        { cwd: process.cwd(), timeout: 30_000, maxBuffer: 1024 * 1024 },
      )
      const result = JSON.parse(stdout.trim())
      expect(result.ok).toBe(true)
      expect(result.mem0_package).toBe(`mem0ai@${installed.version}`)
      if (script === 'mem0-oss-full-cycle-smoke') {
        expect(result.tenant_checks).toEqual({
          alice_only: true,
          bob_only: true,
          absent_tenant_empty: true,
          missing_scope_rejected_before_provider: true,
        })
        expect(result.signed_records).toBe(7)
      }
    },
    40_000,
  )
})
