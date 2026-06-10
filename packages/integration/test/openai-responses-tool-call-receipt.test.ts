// SPDX-License-Identifier: Apache-2.0

import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { canonicalRecord, genesisChainRoot, hexEncode, sha256, verifyRecord } from '@atrib/mcp'
import { describe, expect, it } from 'vitest'
import { OpenAIResponsesToolCallReceiptRecorder } from '../src/openai-responses-tool-call-receipt.js'

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

describe('OpenAI Responses tool-call receipt example', () => {
  it('signs a Responses API tool call through the runnable smoke', async () => {
    const { stdout } = await execFileAsync(
      tsxBin,
      ['examples/openai-responses/openai-responses-tool-call-smoke.ts'],
      {
        cwd: process.cwd(),
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      },
    )
    const result = JSON.parse(stdout.trim()) as {
      ok: boolean
      openai_responses: {
        package: string
        version: string
        client: string
        api: string
        base_url: string
        tool_item_type: string
        tool_output_item_type: string
      }
      signed_records: number
      operations: string[]
      record_hashes: string[]
      response_ids: {
        tool_call: string
        final: string
      }
      final_output_text: string
      final_receipt: {
        status: string
        quote_id: string
        sku: string
        quantity: number
        total_usd: number
      }
      event_counts: {
        responses_create_calls: number
        request_function_tools: number
        raw_function_call_items: number
        raw_function_call_output_items: number
        signed_function_tool_items: number
      }
      privacy: {
        public_records_hash_only: boolean
        local_sidecars_keep_payloads: boolean
      }
      caveats: string[]
    }

    expect(result.ok).toBe(true)
    expect(result.openai_responses).toMatchObject({
      package: 'openai',
      version: dependencyVersion('openai'),
      client: 'OpenAI',
      api: 'responses.create',
      base_url: 'local-fixture',
      tool_item_type: 'function_call',
      tool_output_item_type: 'function_call_output',
    })
    expect(result.signed_records).toBe(1)
    expect(result.operations).toEqual(['openai.responses.tool-call.procurement_quote'])
    expect(result.record_hashes).toHaveLength(1)
    expect(result.response_ids).toEqual({
      tool_call: 'resp_openai_responses_tool_001',
      final: 'resp_openai_responses_final_001',
    })
    expect(result.final_output_text).toContain('openai-responses-atlas-kit-2')
    expect(result.final_receipt).toEqual({
      status: 'quoted',
      quote_id: 'openai-responses-atlas-kit-2',
      sku: 'atlas-kit',
      quantity: 2,
      total_usd: 84,
    })
    expect(result.event_counts).toEqual({
      responses_create_calls: 2,
      request_function_tools: 1,
      raw_function_call_items: 1,
      raw_function_call_output_items: 1,
      signed_function_tool_items: 1,
    })
    expect(result.privacy).toEqual({
      public_records_hash_only: true,
      local_sidecars_keep_payloads: true,
    })
    expect(result.caveats.join(' ')).toContain('not a hosted OpenAI model call')
    expect(stdout).not.toContain('lotus OpenAI Responses note')
  }, 30000)

  it('chains records and keeps Responses tool payloads out of public records', async () => {
    const secret = 'private Responses tool payload'
    const contextId = '55555555555555555555555555555555'
    const recorder = new OpenAIResponsesToolCallReceiptRecorder({
      privateKey: new Uint8Array(32).fill(27),
      contextId,
      logSubmission: 'disabled',
      now: () => 1_779_840_300_000,
    })

    await recorder.recordFunctionToolCallNow({
      response: {
        id: 'resp-test-1',
        model: 'gpt-5-mini',
      } as Parameters<
        OpenAIResponsesToolCallReceiptRecorder['recordFunctionToolCallNow']
      >[0]['response'],
      toolCall: {
        type: 'function_call',
        name: 'quote_price',
        call_id: 'call-1',
        id: 'fc-1',
        arguments: JSON.stringify({ sku: 'atlas-kit', internal_note: secret }),
        status: 'completed',
      },
      result: { status: 'quoted', internal_note: secret },
    })
    await recorder.recordFunctionToolCallNow({
      response: {
        id: 'resp-test-2',
        model: 'gpt-5-mini',
      } as Parameters<
        OpenAIResponsesToolCallReceiptRecorder['recordFunctionToolCallNow']
      >[0]['response'],
      toolCall: {
        type: 'function_call',
        name: 'publish_receipt',
        call_id: 'call-2',
        id: 'fc-2',
        arguments: JSON.stringify({ receipt_id: 'receipt-1', internal_note: secret }),
        status: 'completed',
      },
      result: { status: 'published', internal_note: secret },
      previousResponseId: 'resp-test-1',
    })

    const records = recorder.getSignedRecords()
    const sidecars = recorder.getSidecars()
    const firstHash = `sha256:${hexEncode(sha256(canonicalRecord(records[0]!)))}`

    expect(records).toHaveLength(2)
    expect(records[0]!.chain_root).toBe(genesisChainRoot(contextId))
    expect(records[1]!.chain_root).toBe(firstHash)
    expect(JSON.stringify(records)).not.toContain(secret)
    expect(JSON.stringify(sidecars)).toContain(secret)
    expect(sidecars[1]).toMatchObject({
      framework: 'openai-responses',
      api: 'responses.create',
      response_id: 'resp-test-2',
      previous_response_id: 'resp-test-1',
      function_name: 'publish_receipt',
      call_id: 'call-2',
    })
    expect(await verifyRecord(records[0]!)).toBe(true)
    expect(await verifyRecord(records[1]!)).toBe(true)
  })
})

function dependencyVersion(name: string): string {
  const version = integrationPackageJson.devDependencies[name]
  if (!version) throw new Error(`missing integration devDependency: ${name}`)
  return version
}
