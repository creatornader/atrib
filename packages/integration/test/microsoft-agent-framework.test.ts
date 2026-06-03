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

describe.skipIf(process.env.ATRIB_RUN_MICROSOFT_AGENT_FRAMEWORK_SMOKE !== '1')(
  'Microsoft Agent Framework workflow receipt example',
  () => {
    it('signs Python WorkflowBuilder events through the runnable smoke', async () => {
      const { stdout } = await execFileAsync(
        tsxBin,
        ['examples/microsoft-agent-framework/microsoft-agent-framework-smoke.ts'],
        {
          cwd: process.cwd(),
          timeout: 120000,
          maxBuffer: 1024 * 1024 * 10,
        },
      )
      const result = JSON.parse(stdout.trim()) as {
        ok: boolean
        microsoft_agent_framework: {
          python_package: string
          version: string
          workflow: string
          execution: string
          executors: string[]
          transient_python_packages: string[]
        }
        signed_records: number
        operations: string[]
        record_hashes: string[]
        event_counts: {
          event_count: number
          output_count: number
          executor_invoked_count: number
          executor_completed_count: number
          output_contains_private_phrase: boolean
          workflow_completed: boolean
        }
        chain: {
          first_record_is_genesis: boolean
          subsequent_records_chain: boolean
          subsequent_records_inform_by_previous: boolean
        }
        final_output: {
          status: string
          sku: string
          quantity: number
          approved_by: string
        }
        privacy: {
          public_records_hash_only: boolean
          local_sidecars_keep_payloads: boolean
        }
        caveats: string[]
      }

      expect(result.ok).toBe(true)
      expect(result.microsoft_agent_framework).toEqual({
        python_package: 'agent-framework-core',
        version: '1.7.0',
        workflow: 'WorkflowBuilder',
        execution: 'Workflow.run',
        executors: ['ProposalExecutor', 'ApprovalExecutor'],
        transient_python_packages: ['agent-framework-core==1.7.0'],
      })
      expect(result.signed_records).toBe(7)
      expect(result.operations).toEqual([
        'microsoft.agent_framework.workflow.atribAgentFrameworkWorkflow.executor_invoked.proposal',
        'microsoft.agent_framework.workflow.atribAgentFrameworkWorkflow.executor_completed.proposal',
        'microsoft.agent_framework.workflow.atribAgentFrameworkWorkflow.superstep_started',
        'microsoft.agent_framework.workflow.atribAgentFrameworkWorkflow.executor_invoked.approval',
        'microsoft.agent_framework.workflow.atribAgentFrameworkWorkflow.output.approval',
        'microsoft.agent_framework.workflow.atribAgentFrameworkWorkflow.executor_completed.approval',
        'microsoft.agent_framework.workflow.atribAgentFrameworkWorkflow.superstep_completed',
      ])
      expect(result.record_hashes).toHaveLength(7)
      expect(result.event_counts).toEqual({
        event_count: 7,
        output_count: 1,
        executor_invoked_count: 2,
        executor_completed_count: 2,
        output_contains_private_phrase: true,
        workflow_completed: true,
      })
      expect(result.chain).toEqual({
        first_record_is_genesis: true,
        subsequent_records_chain: true,
        subsequent_records_inform_by_previous: true,
      })
      expect(result.final_output).toEqual({
        status: 'approved',
        sku: 'atlas-kit',
        quantity: 2,
        approved_by: 'nora',
      })
      expect(result.privacy).toEqual({
        public_records_hash_only: true,
        local_sidecars_keep_payloads: true,
      })
      expect(result.caveats.join(' ')).toContain('not Azure AI Foundry Agent Service')
      expect(stdout).not.toContain('silver Microsoft Agent Framework workflow note')
    })
  },
)
