// SPDX-License-Identifier: Apache-2.0

import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { canonicalRecord, genesisChainRoot, hexEncode, sha256, verifyRecord } from '@atrib/mcp'
import { describe, expect, it } from 'vitest'
import { MastraRuntimeReceiptRecorder } from '../src/mastra-runtime-receipt.js'

const execFileAsync = promisify(execFile)
const workspaceRoot = join(process.cwd(), '..', '..')
const integrationPackageJson = JSON.parse(
  readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
) as { devDependencies: Record<string, string> }
const tsxBin = join(
  workspaceRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
)

describe('Mastra runtime receipt example', () => {
  it('signs a Mastra MCP client tool call through the runnable smoke', async () => {
    const { stdout } = await execFileAsync(
      tsxBin,
      ['examples/mastra-runtime/mastra-runtime-smoke.ts'],
      {
        cwd: process.cwd(),
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      },
    )
    const result = JSON.parse(stdout.trim()) as {
      ok: boolean
      mastra: {
        core: string
        mcp: string
        server: string
        client: string
        transport: string
      }
      signed_records: number
      operations: string[]
      record_hashes: string[]
      final_receipt: {
        status: string
        approval_id: string
        sku: string
        quantity: number
      }
      event_counts: {
        listed_tools: number
        executed_tools: number
      }
      privacy: {
        public_records_hash_only: boolean
        local_sidecars_keep_payloads: boolean
      }
      caveats: string[]
    }

    expect(result.ok).toBe(true)
    expect(result.mastra).toMatchObject({
      core: dependencyVersion('@mastra/core'),
      mcp: dependencyVersion('@mastra/mcp'),
      server: 'MCPServer',
      client: 'MCPClient',
      transport: 'stdio',
    })
    expect(result.signed_records).toBe(1)
    expect(result.operations).toEqual(['mastra.mcp-client-tool.procurement.approve_order'])
    expect(result.record_hashes).toHaveLength(1)
    expect(result.final_receipt).toEqual({
      status: 'approved',
      approval_id: 'mastra-atlas-kit-2',
      sku: 'atlas-kit',
      quantity: 2,
    })
    expect(result.event_counts).toEqual({
      listed_tools: 1,
      executed_tools: 1,
    })
    expect(result.privacy).toEqual({
      public_records_hash_only: true,
      local_sidecars_keep_payloads: true,
    })
    expect(result.caveats.join(' ')).toContain('not a full @atrib/agent Mastra adapter')
    expect(stdout).not.toContain('orchid Mastra procurement note')
  }, 30000)

  it('signs a Mastra workflow suspend and resume through the runnable smoke', async () => {
    const { stdout } = await execFileAsync(
      tsxBin,
      ['examples/mastra-runtime/mastra-workflow-suspend-resume-smoke.ts'],
      {
        cwd: process.cwd(),
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      },
    )
    const result = JSON.parse(stdout.trim()) as {
      ok: boolean
      mastra: {
        core: string
        storage: string
        workflow: string
        run: string
      }
      workflow: {
        name: string
        run_id: string
        suspended_status: string
        final_status: string
        resume_labels: string[]
      }
      signed_records: number
      operations: string[]
      record_hashes: string[]
      causal_links: {
        suspend_informed_by_start: boolean
        resume_informed_by_suspend: boolean
        result_informed_by_resume: boolean
      }
      final_receipt: {
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
    expect(result.mastra).toEqual({
      core: dependencyVersion('@mastra/core'),
      storage: 'InMemoryStore',
      workflow: 'createWorkflow/createStep',
      run: 'Run.start/Run.resume',
    })
    expect(result.workflow).toEqual({
      name: 'vendorApprovalWorkflow',
      run_id: 'mastra-workflow-run-1',
      suspended_status: 'suspended',
      final_status: 'success',
      resume_labels: ['human-approval'],
    })
    expect(result.signed_records).toBe(4)
    expect(result.operations).toEqual([
      'mastra.workflow.vendorApprovalWorkflow.workflow-start',
      'mastra.workflow.vendorApprovalWorkflow.step-suspended',
      'mastra.workflow.vendorApprovalWorkflow.workflow-resume',
      'mastra.workflow.vendorApprovalWorkflow.workflow-result',
    ])
    expect(result.record_hashes).toHaveLength(4)
    expect(result.causal_links).toEqual({
      suspend_informed_by_start: true,
      resume_informed_by_suspend: true,
      result_informed_by_resume: true,
    })
    expect(result.final_receipt).toEqual({
      status: 'approved',
      sku: 'atlas-kit',
      quantity: 2,
      approved_by: 'nora',
    })
    expect(result.privacy).toEqual({
      public_records_hash_only: true,
      local_sidecars_keep_payloads: true,
    })
    expect(result.caveats.join(' ')).toContain('not hosted Mastra Platform')
    expect(stdout).not.toContain('violet Mastra workflow note')
  }, 30000)

  it('chains records and keeps Mastra tool content out of public records', async () => {
    const secret = 'private Mastra note'
    const contextId = '33333333333333333333333333333333'
    const recorder = new MastraRuntimeReceiptRecorder({
      privateKey: new Uint8Array(32).fill(25),
      contextId,
      logSubmission: 'disabled',
      now: () => 1_779_840_100_000,
    })

    await recorder.toolCall({
      surface: 'mcp-client-tool',
      serverName: 'procurement',
      toolName: 'approve_order',
      namespacedToolName: 'procurement_approve_order',
      toolCallId: 'call-1',
      args: { sku: 'atlas-kit', internal_note: secret },
      run: () => ({ status: 'approved', internal_note: secret }),
    })
    await recorder.toolCall({
      surface: 'mcp-client-tool',
      serverName: 'procurement',
      toolName: 'publish_receipt',
      namespacedToolName: 'procurement_publish_receipt',
      toolCallId: 'call-2',
      args: { receipt_id: 'receipt-1', internal_note: secret },
      run: () => ({ status: 'published', internal_note: secret }),
    })

    const records = recorder.getSignedRecords()
    const sidecars = recorder.getSidecars()
    const firstHash = `sha256:${hexEncode(sha256(canonicalRecord(records[0]!)))}`

    expect(records).toHaveLength(2)
    expect(records[0]!.chain_root).toBe(genesisChainRoot(contextId))
    expect(records[1]!.chain_root).toBe(firstHash)
    expect(JSON.stringify(records)).not.toContain(secret)
    expect(JSON.stringify(sidecars)).toContain(secret)
    expect(await verifyRecord(records[0]!)).toBe(true)
    expect(await verifyRecord(records[1]!)).toBe(true)
  })
})

function dependencyVersion(name: string): string {
  const version = integrationPackageJson.devDependencies[name]
  if (!version) throw new Error(`missing integration devDependency: ${name}`)
  return version
}
