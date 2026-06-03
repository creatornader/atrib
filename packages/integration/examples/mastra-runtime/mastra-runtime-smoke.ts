// SPDX-License-Identifier: Apache-2.0

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MCPClient } from '@mastra/mcp'
import { canonicalRecord, hexEncode, sha256, verifyRecord } from '@atrib/mcp'
import { MastraRuntimeReceiptRecorder } from '../../src/mastra-runtime-receipt.js'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))
const integrationRoot = join(here, '..', '..')
const workspaceRoot = join(integrationRoot, '..', '..')
const tsxBin = join(
  workspaceRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
)

const contextId = '6d61737472612d72756e74696d652121'
const privateKey = Buffer.from(
  '102132435465768798a9babbdcddfeef102132435465768798a9babbdcddfeef',
  'hex',
)
const privatePhrase = 'orchid Mastra procurement note stays local'
const baseTimestamp = 1_779_840_100_000

type SmokeResult = {
  ok: true
  note: string
  mastra: {
    core: string
    mcp: string
    server: 'MCPServer'
    client: 'MCPClient'
    transport: 'stdio'
  }
  context_id: string
  signed_records: number
  operations: string[]
  record_hashes: string[]
  final_receipt: {
    status: 'approved'
    approval_id: string
    sku: string
    quantity: number
  }
  event_counts: {
    listed_tools: number
    executed_tools: number
  }
  privacy: {
    public_records_hash_only: true
    local_sidecars_keep_payloads: true
  }
  caveats: string[]
}

export async function runMastraRuntimeReceiptSmoke(): Promise<SmokeResult> {
  const serverScript = join(here, 'mastra-runtime-server.ts')
  const recorder = new MastraRuntimeReceiptRecorder({
    privateKey,
    contextId,
    serverUrl: 'mastra://atrib-runtime-smoke',
    logSubmission: 'disabled',
    now: timestampClock(baseTimestamp),
  })
  const mcp = new MCPClient({
    id: 'atrib-mastra-runtime-smoke',
    servers: {
      procurement: {
        command: tsxBin,
        args: [serverScript],
        cwd: integrationRoot,
        stderr: 'pipe',
      },
    },
    timeout: 30000,
  })

  try {
    const tools = await mcp.listTools()
    const namespacedToolName = 'procurement_approve_order'
    const approveOrder = tools[namespacedToolName]
    if (!approveOrder?.execute) {
      throw new Error(`Mastra MCP client did not expose ${namespacedToolName}`)
    }

    const args = {
      sku: 'atlas-kit',
      quantity: 2,
      internal_note: privatePhrase,
    }
    const result = await recorder.toolCall({
      surface: 'mcp-client-tool',
      serverName: 'procurement',
      toolName: 'approve_order',
      namespacedToolName,
      toolCallId: 'mastra-mcp-tool-call-1',
      args,
      run: () =>
        approveOrder.execute?.(args, {
          toolCallId: 'mastra-mcp-tool-call-1',
          runId: 'mastra-mcp-run-1',
        } as never),
    })

    await recorder.flushAtrib()
    const records = recorder.getSignedRecords()
    const sidecars = recorder.getSidecars()
    const invalid = []
    for (const record of records) {
      if (!(await verifyRecord(record))) invalid.push(record.tool_name)
    }
    if (invalid.length > 0) {
      throw new Error(`invalid signed record(s): ${invalid.join(', ')}`)
    }

    const publicRecordJson = JSON.stringify(records)
    if (publicRecordJson.includes(privatePhrase)) {
      throw new Error('public records leaked the private Mastra tool payload')
    }
    if (!JSON.stringify(sidecars).includes(privatePhrase)) {
      throw new Error('local sidecars should keep inspectable Mastra tool material')
    }

    const finalReceipt = unwrapMastraResult(result)
    const recordHashes = records.map(
      (record) => `sha256:${hexEncode(sha256(canonicalRecord(record)))}`,
    )

    return {
      ok: true,
      note: 'Runs a real @mastra/mcp MCPClient against a real MCPServer over stdio, then signs one hash-only atrib record for the tool call.',
      mastra: {
        core: packageVersion('@mastra/core'),
        mcp: packageVersion('@mastra/mcp'),
        server: 'MCPServer',
        client: 'MCPClient',
        transport: 'stdio',
      },
      context_id: contextId,
      signed_records: records.length,
      operations: records.map((record) => record.tool_name ?? ''),
      record_hashes: recordHashes,
      final_receipt: finalReceipt,
      event_counts: {
        listed_tools: Object.keys(tools).length,
        executed_tools: records.length,
      },
      privacy: {
        public_records_hash_only: true,
        local_sidecars_keep_payloads: true,
      },
      caveats: [
        'This proves the @mastra/mcp client/server tool path, not a full @atrib/agent Mastra adapter.',
        'It does not cover hosted Mastra Platform run imports or post-hoc event APIs.',
      ],
    }
  } finally {
    await mcp.disconnect()
  }
}

function unwrapMastraResult(result: unknown): SmokeResult['final_receipt'] {
  const value = parseMastraResultEnvelope(result) as {
    status?: unknown
    approval_id?: unknown
    sku?: unknown
    quantity?: unknown
  }
  if (
    value.status !== 'approved' ||
    typeof value.approval_id !== 'string' ||
    typeof value.sku !== 'string' ||
    typeof value.quantity !== 'number'
  ) {
    throw new Error(`unexpected Mastra result: ${JSON.stringify(result)}`)
  }
  return {
    status: 'approved',
    approval_id: value.approval_id,
    sku: value.sku,
    quantity: value.quantity,
  }
}

function parseMastraResultEnvelope(result: unknown): unknown {
  const envelope = result as {
    content?: Array<{ type?: string; text?: string }>
  }
  const firstText = envelope.content?.find((item) => item.type === 'text')?.text
  if (firstText) {
    try {
      return JSON.parse(firstText) as unknown
    } catch {
      return result
    }
  }
  return result
}

function packageVersion(name: '@mastra/core' | '@mastra/mcp'): string {
  const pkg = require(`${name}/package.json`) as { version: string }
  return pkg.version
}

function timestampClock(start: number): () => number {
  let offset = 0
  return () => start + offset++
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMastraRuntimeReceiptSmoke()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2))
    })
    .catch((err) => {
      console.error('mastra runtime receipt smoke failed:', err)
      process.exitCode = 1
    })
}
