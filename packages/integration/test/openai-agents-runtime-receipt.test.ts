// SPDX-License-Identifier: Apache-2.0

import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { canonicalRecord, genesisChainRoot, hexEncode, sha256, verifyRecord } from '@atrib/mcp'
import { describe, expect, it } from 'vitest'
import {
  Agent,
  handoff,
  run,
  setTracingDisabled,
  tool,
  Usage,
  type Model,
  type ModelRequest,
  type ModelResponse,
  type StreamEvent,
} from '@openai/agents'
import { z } from 'zod'
import canonicalize from 'canonicalize'
import { OpenAIAgentsRuntimeReceiptRecorder } from '../src/openai-agents-runtime-receipt.js'

const execFileAsync = promisify(execFile)
const workspaceRoot = join(process.cwd(), '..', '..')
const tsxBin = join(
  workspaceRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
)
const openAIAgentsPackagePath = join(
  process.cwd(),
  'node_modules',
  '@openai',
  'agents',
  'package.json',
)

describe('OpenAI Agents runtime receipt example', () => {
  it.each([
    { label: 'malformed JSON', args: '{', executes: false, message: null, observations: 0 },
    {
      label: 'schema-invalid arguments',
      args: '{"quantity":0}',
      executes: false,
      message: /invalid|validation|positive|greater/i,
      observations: 1,
    },
    {
      label: 'a throwing tool',
      args: '{"quantity":2}',
      executes: true,
      message: /fixture tool failure/,
      observations: 1,
    },
  ])(
    'handles $label without a successful tool receipt or handoff',
    async ({ args, executes, message, observations }) => {
      setTracingDisabled(true)
      const recorder = new OpenAIAgentsRuntimeReceiptRecorder({
        privateKey: new Uint8Array(32).fill(26),
        contextId: '44444444444444444444444444444444',
        logSubmission: 'disabled',
      })
      let executions = 0
      let handoffs = 0
      const quoteTool = tool({
        name: 'quote_price',
        description: 'Reject invalid input or simulate an execution failure.',
        parameters: z.object({ quantity: z.number().int().positive() }),
        errorFunction: null,
        execute: async () => {
          executions += 1
          throw new Error('fixture tool failure')
        },
      })
      const target = new Agent({ name: 'Target', model: new SingleCallModel('unexpected', '{}') })
      const model = new SingleCallModel('quote_price', args)
      const agent = recorder.attachAgent(
        new Agent({
          name: 'Reviewer',
          model,
          tools: [quoteTool],
          handoffs: [
            handoff(target, {
              onHandoff: async () => {
                handoffs += 1
              },
            }),
          ],
        }),
      )
      const result = run(agent, 'negative tool request', { maxTurns: 2 })
      if (message) await expect(result).rejects.toThrow(message)
      else {
        expect((await result).finalOutput).toBe('negative tool feedback received')
        expect(JSON.stringify(model.followupInput)).toMatch(/invalid|error/i)
      }
      await recorder.flushAtrib()
      expect(executions).toBe(executes ? 1 : 0)
      expect(handoffs).toBe(0)
      const records = recorder.getSignedRecords()
      const sidecars = recorder.getSidecars()
      expect(records).toHaveLength(observations)
      expect(sidecars).toHaveLength(observations)
      for (const [index, record] of records.entries()) {
        expect(sidecars[index]!.status).toBe('observed')
        expect(await verifyRecord(record)).toBe(true)
        const outcome = canonicalize({ status: 'observed', result: sidecars[index]!.result })!
        expect(record.result_hash).toBe(
          `sha256:${hexEncode(sha256(new TextEncoder().encode(outcome)))}`,
        )
      }
    },
  )

  it('propagates a failed handoff callback without a transferred receipt', async () => {
    setTracingDisabled(true)
    const recorder = new OpenAIAgentsRuntimeReceiptRecorder({
      privateKey: new Uint8Array(32).fill(26),
      contextId: '44444444444444444444444444444444',
      logSubmission: 'disabled',
    })
    let handoffs = 0
    const target = new Agent({ name: 'Target', model: new SingleCallModel('unexpected', '{}') })
    const transfer = handoff(target, {
      toolNameOverride: 'transfer_to_target',
      onHandoff: async () => {
        handoffs += 1
        throw new Error('fixture handoff failure')
      },
    })
    const agent = recorder.attachAgent(
      new Agent({
        name: 'Reviewer',
        model: new SingleCallModel('transfer_to_target', '{}'),
        handoffs: [transfer],
      }),
    )
    await expect(run(agent, 'negative handoff request', { maxTurns: 2 })).rejects.toThrow(
      'fixture handoff failure',
    )
    await recorder.flushAtrib()
    expect(handoffs).toBe(1)
    expect(recorder.getSignedRecords()).toEqual([])
    expect(recorder.getSidecars()).toEqual([])
  })

  it('signs an OpenAI Agents SDK function tool call through the runnable smoke', async () => {
    const installedOpenAIAgents = JSON.parse(await readFile(openAIAgentsPackagePath, 'utf8')) as {
      version: string
    }
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
        handoff: string
        lifecycle: {
          function_tool: string
          handoff: string
        }
        handoff_event_type: string
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
      handoff_receipt: {
        from_agent_name: string
        to_agent_name: string
        event_type: string
        record_hash: string
      }
      event_counts: {
        model_calls: number
        raw_function_call_items: number
        raw_function_call_output_items: number
        signed_function_tool_lifecycle_events: number
        signed_handoff_lifecycle_events: number
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
      version: installedOpenAIAgents.version,
      runner: 'run',
      agent: 'Agent',
      model: 'scripted',
      tool: 'tool',
      handoff: 'handoff',
      lifecycle: {
        function_tool: 'agent_tool_end',
        handoff: 'agent_handoff',
      },
      handoff_event_type: 'https://atrib.dev/v1/types/handoff',
    })
    expect(result.signed_records).toBe(2)
    expect(result.operations).toEqual([
      'openai.agents.function-tool.procurement_reviewer.quote_price',
      'openai.agents.handoff.procurement_reviewer.fulfillment_specialist',
    ])
    expect(result.record_hashes).toHaveLength(2)
    expect(result.final_output).toContain('openai-agents-atlas-kit-2')
    expect(result.final_receipt).toEqual({
      status: 'quoted',
      quote_id: 'openai-agents-atlas-kit-2',
      sku: 'atlas-kit',
      quantity: 2,
      total_usd: 84,
    })
    expect(result.handoff_receipt).toEqual({
      from_agent_name: 'Procurement Reviewer',
      to_agent_name: 'Fulfillment Specialist',
      event_type: 'https://atrib.dev/v1/types/handoff',
      record_hash: result.record_hashes[1],
    })
    expect(result.event_counts).toEqual({
      model_calls: 3,
      raw_function_call_items: 2,
      raw_function_call_output_items: 2,
      signed_function_tool_lifecycle_events: 1,
      signed_handoff_lifecycle_events: 1,
    })
    expect(result.privacy).toEqual({
      public_records_hash_only: true,
      local_sidecars_keep_payloads: true,
    })
    expect(result.caveats.join(' ')).toContain('not the Python Agents SDK')
    expect(stdout).not.toContain('lotus OpenAI agent runtime note')
  }, 30000)

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
    await recorder.recordHandoff({
      surface: 'handoff',
      fromAgentName: 'Procurement Reviewer',
      toAgentName: 'Fulfillment Specialist',
    })

    const records = recorder.getSignedRecords()
    const sidecars = recorder.getSidecars()
    expect(sidecars.map((entry) => entry.status)).toEqual(['ok', 'ok', 'transferred'])
    const firstHash = `sha256:${hexEncode(sha256(canonicalRecord(records[0]!)))}`
    const secondHash = `sha256:${hexEncode(sha256(canonicalRecord(records[1]!)))}`

    expect(records).toHaveLength(3)
    expect(records[0]!.chain_root).toBe(genesisChainRoot(contextId))
    expect(records[1]!.chain_root).toBe(firstHash)
    expect(records[2]!.chain_root).toBe(secondHash)
    expect(records[2]!.event_type).toBe('https://atrib.dev/v1/types/handoff')
    expect(JSON.stringify(records)).not.toContain(secret)
    expect(JSON.stringify(sidecars)).toContain(secret)
    expect(sidecars[2]).toMatchObject({
      surface: 'handoff',
      lifecycle: 'agent_handoff',
      from_agent_name: 'Procurement Reviewer',
      to_agent_name: 'Fulfillment Specialist',
    })
    expect(await verifyRecord(records[0]!)).toBe(true)
    expect(await verifyRecord(records[1]!)).toBe(true)
    expect(await verifyRecord(records[2]!)).toBe(true)
  })
})

class SingleCallModel implements Model {
  private calls = 0
  followupInput: ModelRequest['input'] | undefined
  constructor(
    private readonly name: string,
    private readonly args: string,
  ) {}

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    if (this.calls++ > 0) {
      this.followupInput = request.input
      return {
        usage: new Usage({ requests: 1 }),
        responseId: 'negative-feedback-response',
        output: [
          {
            type: 'message',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', text: 'negative tool feedback received' }],
          },
        ],
      }
    }
    return {
      usage: new Usage({ requests: 1 }),
      responseId: 'negative-response',
      output: [
        {
          type: 'function_call',
          callId: 'negative-call',
          name: this.name,
          arguments: this.args,
          status: 'completed',
        },
      ],
    }
  }

  getStreamedResponse(_request: ModelRequest): AsyncIterable<StreamEvent> {
    throw new Error('streaming is not used by this test')
  }
}
