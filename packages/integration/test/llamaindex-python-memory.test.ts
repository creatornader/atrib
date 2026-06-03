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

describe.skipIf(process.env.ATRIB_RUN_LLAMAINDEX_PYTHON_MEMORY_SMOKE !== '1')(
  'LlamaIndex Python memory receipt example',
  () => {
    it('signs Python Memory commands through the runnable smoke', async () => {
      const { stdout } = await execFileAsync(
        tsxBin,
        ['examples/llamaindex-python-memory/llamaindex-python-memory-smoke.ts'],
        {
          cwd: process.cwd(),
          timeout: 120000,
          maxBuffer: 1024 * 1024 * 10,
        },
      )
      const result = JSON.parse(stdout.trim()) as {
        ok: boolean
        llamaindex_python: {
          python_package: string
          version: string
          memory_class: string
          memory_blocks: string[]
          transient_python_packages: string[]
        }
        signed_records: number
        operations: string[]
        record_hashes: string[]
        event_counts: {
          operation_count: number
          put_count: number
          put_messages_count: number
          get_count: number
          get_all_count: number
          set_count: number
          reset_count: number
          static_block_returned: boolean
          private_phrase_in_get_result: boolean
          private_phrase_in_operations: boolean
          reset_cleared_active_history: boolean
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
      expect(result.llamaindex_python).toEqual({
        python_package: 'llama-index',
        version: '0.14.22',
        memory_class: 'Memory',
        memory_blocks: ['StaticMemoryBlock'],
        transient_python_packages: ['llama-index==0.14.22'],
      })
      expect(result.signed_records).toBe(8)
      expect(result.operations).toEqual([
        'llamaindex.python.memory.put',
        'llamaindex.python.memory.put_messages',
        'llamaindex.python.memory.get',
        'llamaindex.python.memory.get_all',
        'llamaindex.python.memory.set',
        'llamaindex.python.memory.get',
        'llamaindex.python.memory.reset',
        'llamaindex.python.memory.get_all',
      ])
      expect(result.record_hashes).toHaveLength(8)
      expect(result.event_counts).toEqual({
        operation_count: 8,
        put_count: 1,
        put_messages_count: 1,
        get_count: 2,
        get_all_count: 2,
        set_count: 1,
        reset_count: 1,
        static_block_returned: true,
        private_phrase_in_get_result: true,
        private_phrase_in_operations: true,
        reset_cleared_active_history: true,
      })
      expect(result.chain).toEqual({
        first_record_is_genesis: true,
        subsequent_records_chain: true,
        subsequent_records_inform_by_previous: true,
      })
      expect(result.privacy).toEqual({
        public_records_hash_only: true,
        local_sidecars_keep_payloads: true,
      })
      expect(result.caveats.join(' ')).toContain('not VectorMemoryBlock retrieval')
      expect(stdout).not.toContain('quiet LlamaIndex Python memory note')
    })
  },
)
