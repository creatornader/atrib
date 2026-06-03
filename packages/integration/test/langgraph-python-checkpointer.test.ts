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

describe.skipIf(process.env.ATRIB_RUN_LANGGRAPH_PYTHON_CHECKPOINTER_SMOKE !== '1')(
  'LangGraph Python checkpointer receipt example',
  () => {
    it('signs Python InMemorySaver checkpoint events through the runnable smoke', async () => {
      const { stdout } = await execFileAsync(
        tsxBin,
        ['examples/langgraph-python-checkpointer/langgraph-python-checkpointer-smoke.ts'],
        {
          cwd: process.cwd(),
          timeout: 120000,
          maxBuffer: 1024 * 1024 * 10,
        },
      )
      const result = JSON.parse(stdout.trim()) as {
        ok: boolean
        langgraph_python: {
          python_package: string
          version: string
          graph: string
          checkpointer: string
          transient_python_packages: string[]
        }
        signed_records: number
        operations: string[]
        record_hashes: string[]
        event_counts: {
          event_count: number
          get_tuple_count: number
          put_count: number
          put_writes_count: number
          private_phrase_in_events: boolean
          private_phrase_in_state: boolean
          workflow_completed: boolean
        }
        chain: {
          first_record_is_genesis: boolean
          subsequent_records_chain: boolean
          subsequent_records_inform_by_previous: boolean
        }
        final_output: {
          answer: string
          steps: string[]
        }
        privacy: {
          public_records_hash_only: boolean
          local_sidecars_keep_payloads: boolean
        }
        caveats: string[]
      }

      expect(result.ok).toBe(true)
      expect(result.langgraph_python).toEqual({
        python_package: 'langgraph',
        version: '1.2.4',
        graph: 'StateGraph',
        checkpointer: 'InMemorySaver',
        transient_python_packages: ['langgraph==1.2.4'],
      })
      expect(result.signed_records).toBe(9)
      expect(result.operations).toEqual([
        'langgraph.python.checkpointer.get_tuple',
        'langgraph.python.checkpointer.put',
        'langgraph.python.checkpointer.put_writes',
        'langgraph.python.checkpointer.put',
        'langgraph.python.checkpointer.put_writes',
        'langgraph.python.checkpointer.put',
        'langgraph.python.checkpointer.put_writes',
        'langgraph.python.checkpointer.put',
        'langgraph.python.checkpointer.get_tuple',
      ])
      expect(result.record_hashes).toHaveLength(9)
      expect(result.event_counts).toEqual({
        event_count: 9,
        get_tuple_count: 2,
        put_count: 4,
        put_writes_count: 3,
        private_phrase_in_events: true,
        private_phrase_in_state: true,
        workflow_completed: true,
      })
      expect(result.chain).toEqual({
        first_record_is_genesis: true,
        subsequent_records_chain: true,
        subsequent_records_inform_by_previous: true,
      })
      expect(result.final_output).toEqual({
        answer: 'approved atlas-kit order',
        steps: ['draft', 'approve'],
      })
      expect(result.privacy).toEqual({
        public_records_hash_only: true,
        local_sidecars_keep_payloads: true,
      })
      expect(result.caveats.join(' ')).toContain('not a LangGraph Platform deployment')
      expect(stdout).not.toContain('quiet LangGraph Python checkpoint note')
    })
  },
)
