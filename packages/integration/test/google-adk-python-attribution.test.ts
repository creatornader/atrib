// SPDX-License-Identifier: Apache-2.0

import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const workspaceRoot = join(process.cwd(), '..', '..')
const tsxBin = join(
  workspaceRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
)

describe.skipIf(process.env.ATRIB_RUN_GOOGLE_ADK_PYTHON_SMOKE !== '1')(
  'Google ADK Python plugin attribution example',
  () => {
    it('signs a Python ADK FunctionTool call through the BasePlugin lifecycle', async () => {
      const { stdout } = await execFileAsync(
        tsxBin,
        ['examples/google-adk-python/google-adk-python-plugin-smoke.ts'],
        {
          cwd: process.cwd(),
          timeout: 120000,
          maxBuffer: 1024 * 1024 * 10,
        },
      )
      const result = JSON.parse(stdout.trim()) as {
        ok: boolean
        google_adk_python: {
          python_package: string
          version: string
          runner: string
          plugin: string
          tool: string
          model: string
          transient_python_packages: string[]
        }
        signed_records: number
        operations: string[]
        record_hashes: string[]
        event_counts: {
          yielded_events: number
          function_call_events: number
          function_response_events: number
          final_text: string
          plugin_event_count: number
          private_phrase_in_plugin_events: boolean
        }
        chain: {
          first_record_is_genesis: boolean
          subsequent_records_chain: boolean
          subsequent_records_inform_by_previous: boolean
        }
        privacy: {
          public_records_hash_only: boolean
          local_sidecars_keep_payloads: boolean
        }
        caveats: string[]
      }

      expect(result.ok).toBe(true)
      expect(result.google_adk_python).toEqual({
        python_package: 'google-adk',
        version: '2.3.0',
        runner: 'InMemoryRunner',
        plugin: 'BasePlugin',
        tool: 'FunctionTool',
        model: 'BaseLlm',
        transient_python_packages: ['google-adk==2.3.0'],
      })
      expect(result.signed_records).toBe(1)
      expect(result.operations).toEqual(['google.adk.python.tool.quote_price'])
      expect(result.record_hashes).toHaveLength(1)
      expect(result.event_counts).toEqual({
        yielded_events: 3,
        function_call_events: 1,
        function_response_events: 1,
        final_text: 'Quote ready for atlas-kit.',
        plugin_event_count: 1,
        private_phrase_in_plugin_events: true,
      })
      expect(result.chain).toEqual({
        first_record_is_genesis: true,
        subsequent_records_chain: true,
        subsequent_records_inform_by_previous: true,
        parent_informed_by: null,
        parent_informed_by_resolved: [],
        parent_informed_by_dangling: [],
      })
      expect(result.privacy).toEqual({
        public_records_hash_only: true,
        local_sidecars_keep_payloads: true,
      })
      expect(result.caveats.join(' ')).toContain('not Agent Platform Runtime')
      expect(stdout).not.toContain('quiet ADK Python tool note')
    })
  },
)
