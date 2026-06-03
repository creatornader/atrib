// SPDX-License-Identifier: Apache-2.0

import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { canonicalRecord, genesisChainRoot, hexEncode, sha256, verifyRecord } from '@atrib/mcp'
import { describe, expect, it } from 'vitest'
import { OpenAIAgentsRuntimeReceiptRecorder } from '../src/openai-agents-runtime-receipt.js'

const execFileAsync = promisify(execFile)
const workspaceRoot = join(process.cwd(), '..', '..')
const tsxBin = join(
  workspaceRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
)

describe('OpenAI Agents runtime receipt example', () => {
  it('signs an OpenAI Agents SDK function tool call through the runnable smoke', async () => {
    const { stdout } = await execFileAsync(
      tsxBin,
      ['examples/openai-agents-runtime/openai-agents-runtime-smoke.ts'],
      {
        cwd: process.cwd(),
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      },
    )
    const result = JSON.parse(stdout.trim()) as {
      ok: boolean
      openai_agents: {
        package: string
        version: string
        runner: string
        agent: string
        model: string
        tool: string
        lifecycle: string
      }
      signed_records: number
      operations: string[]
      record_hashes: string[]
      final_output: string
      final_receipt: {
        status: string
        quote_id: string
        sku: string
        quantity: number
        total_usd: number
      }
      event_counts: {
        model_calls: number
        tool_call_items: number
        tool_call_output_items: number
      }
      privacy: {
        public_records_hash_only: boolean
        local_sidecars_keep_payloads: boolean
      }
      caveats: string[]
    }

    expect(result.ok).toBe(true)
    expect(result.openai_agents).toMatchObject({
      package: '@openai/agents',
      version: '0.11.6',
      runner: 'run',
      agent: 'Agent',
      model: 'scripted',
      tool: 'tool',
      lifecycle: 'agent_tool_end',
    })
    expect(result.signed_records).toBe(1)
    expect(result.operations).toEqual([
      'openai.agents.function-tool.procurement_reviewer.quote_price',
    ])
    expect(result.record_hashes).toHaveLength(1)
    expect(result.final_output).toContain('openai-agents-atlas-kit-2')
    expect(result.final_receipt).toEqual({
      status: 'quoted',
      quote_id: 'openai-agents-atlas-kit-2',
      sku: 'atlas-kit',
      quantity: 2,
      total_usd: 84,
    })
    expect(result.event_counts).toEqual({
      model_calls: 2,
      tool_call_items: 1,
      tool_call_output_items: 1,
    })
    expect(result.privacy).toEqual({
      public_records_hash_only: true,
      local_sidecars_keep_payloads: true,
    })
    expect(result.caveats.join(' ')).toContain('not the Python Agents SDK')
    expect(stdout).not.toContain('lotus OpenAI agent runtime note')
  })

  it('chains records and keeps OpenAI Agents tool content out of public records', async () => {
    const secret = 'private OpenAI Agents note'
    const contextId = '44444444444444444444444444444444'
    const recorder = new OpenAIAgentsRuntimeReceiptRecorder({
      privateKey: new Uint8Array(32).fill(26),
      contextId,
      logSubmission: 'disabled',
      now: () => 1_779_840_200_000,
    })

    await recorder.recordToolEnd({
      surface: 'function-tool',
      agentName: 'Procurement Reviewer',
      toolName: 'quote_price',
      toolCallId: 'call-1',
      args: { sku: 'atlas-kit', internal_note: secret },
      result: { status: 'quoted', internal_note: secret },
    })
    await recorder.recordToolEnd({
      surface: 'function-tool',
      agentName: 'Procurement Reviewer',
      toolName: 'publish_receipt',
      toolCallId: 'call-2',
      args: { receipt_id: 'receipt-1', internal_note: secret },
      result: { status: 'published', internal_note: secret },
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
