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

describe.skipIf(process.env.ATRIB_RUN_LETTA_MEMORY_SMOKE !== '1')(
  'Letta memory attribution example',
  () => {
    it('signs Letta core-memory and external-MCP executor operations', async () => {
      const { stdout } = await execFileAsync(
        tsxBin,
        ['examples/letta-memory/letta-memory-smoke.ts'],
        {
          cwd: process.cwd(),
          timeout: 120000,
          maxBuffer: 1024 * 1024 * 10,
        },
      )
      const result = JSON.parse(stdout.trim()) as {
        ok: boolean
        letta: {
          package: string
          version: string
          core_executor: string
          external_executor: string
        }
        signed_records: number
        operations: string[]
        record_hashes: string[]
        event_counts: {
          core_memory_update_count: number
          archival_insert_count: number
          archival_search_count: number
          system_prompt_rebuild_count: number
          external_mcp_call_count: number
          final_core_memory_contains_private_phrase: boolean
          archival_search_contains_private_phrase: boolean
        }
        privacy: {
          public_records_hash_only: boolean
          local_sidecars_keep_payloads: boolean
        }
        caveats: string[]
      }

      expect(result.ok).toBe(true)
      expect(result.letta).toMatchObject({
        package: 'letta',
        version: '0.16.8',
        core_executor: 'LettaCoreToolExecutor',
        external_executor: 'ExternalMCPToolExecutor',
      })
      expect(result.signed_records).toBe(6)
      expect(result.operations).toEqual([
        'letta.core.core_memory_append',
        'letta.core.core_memory_replace',
        'letta.core.memory_apply_patch',
        'letta.core.archival_memory_insert',
        'letta.core.archival_memory_search',
        'letta.external_mcp.verify_memory_receipt',
      ])
      expect(result.record_hashes).toHaveLength(6)
      expect(result.event_counts).toMatchObject({
        core_memory_update_count: 3,
        archival_insert_count: 1,
        archival_search_count: 1,
        system_prompt_rebuild_count: 1,
        external_mcp_call_count: 1,
        final_core_memory_contains_private_phrase: false,
        archival_search_contains_private_phrase: true,
      })
      expect(result.privacy).toEqual({
        public_records_hash_only: true,
        local_sidecars_keep_payloads: true,
      })
      expect(result.caveats.join(' ')).toContain('fake managers')
      expect(stdout).not.toContain('cobalt cedar exact recall tier')
    })
  },
)
