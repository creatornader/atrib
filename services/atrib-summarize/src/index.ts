// SPDX-License-Identifier: Apache-2.0

/**
 * atrib-summarize MCP server: registers the `summarize` tool that reads
 * a set of records (by context_id, by record_hashes, or both) and asks
 * an OpenAI-compatible LLM to synthesize a narrative across them.
 *
 * Closes the consumer-side cognitive-loop primitive companion to trace:
 * trace returns the causal chain (structural); summarize returns the
 * synthesized meaning across that chain (semantic). Both read the same
 * local mirror including the optional _local sidecar.
 *
 * LLM access via OpenAI-compatible HTTP. Defaults to NVIDIA NIM with the
 * Qwen 397B model; override via env vars or per-call model override.
 * Without an API key, the tool returns a warnings-only response per the
 * §5.8 graceful-degradation pattern.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  resolveEnvContextId,
  logReadPrimitiveCall,
  extractRecordHashesFromMcpResult,
} from '@atrib/mcp'
import { loadAllRecords, type IndexedRecord } from './storage.js'
import { callLlm, resolveLlmConfig } from './llm.js'
import { buildSystemPrompt, buildUserMessage } from './prompt.js'

const SHA256_REF_PATTERN = /^sha256:[0-9a-f]{64}$/
const HEX_32_PATTERN = /^[0-9a-f]{32}$/

const SummarizeInput = z.object({
  context_id: z.string().regex(HEX_32_PATTERN).optional().describe(
    "When supplied, summarize every record sharing this 32-hex trace identifier. " +
    "Mutually composable with record_hashes: if both, the union of records is used.",
  ),
  record_hashes: z.array(z.string().regex(SHA256_REF_PATTERN)).optional().describe(
    "Explicit list of 'sha256:<64-hex>' record hashes to summarize. Records not " +
    "in the local mirror are silently skipped (use trace to inspect dangling).",
  ),
  focus: z.string().min(1).max(2000).optional().describe(
    'Optional steering for the synthesis (e.g. "what decisions did I make", ' +
    '"why did I revise X", "what are the load-bearing claims"). Defaults to a ' +
    'general "summarize what the agent did and why" focus.',
  ),
  max_records: z.number().int().min(1).max(200).optional().describe(
    'Cap on records fed to the LLM, default 50. Records beyond the cap (after ' +
    'sorting by timestamp ascending) are skipped and counted in records_skipped. ' +
    'Increase carefully, large prompts run slower + cost more + risk model ' +
    'context limits.',
  ),
  model: z.string().min(1).max(200).optional().describe(
    'Override the configured model for this call. Format depends on provider ' +
    '(NVIDIA NIM uses e.g. "qwen/qwen3.5-397b-a17b"). Defaults to env ' +
    'ATRIB_SUMMARIZE_MODEL or the package default.',
  ),
})

interface SummarizeOutput {
  narrative: string | null
  cited_record_hashes: string[]
  records_summarized: number
  records_skipped: number
  records_with_sidecar: number
  records_without_sidecar: number
  model_used: string | null
  warnings: string[]
}

export interface AtribSummarizeServer {
  mcp: McpServer
}

export async function createAtribSummarizeServer(): Promise<AtribSummarizeServer> {
  const mcp = new McpServer({ name: 'atrib-summarize', version: '0.1.0' })

  mcp.registerTool(
    'summarize',
    {
      title: 'synthesize narrative across signed records',
      description:
        'Read a set of records (by context_id and/or record_hashes) and ask ' +
        'an LLM to synthesize a coherent narrative across them. Reads the local ' +
        'signed-record mirror (~/.atrib/records/*.jsonl) including the optional ' +
        '_local sidecar for semantic content. Records without a sidecar are ' +
        'flagged so the LLM can be honest about impoverished input.',
      inputSchema: SummarizeInput.shape,
    },
    async (rawInput: z.infer<typeof SummarizeInput>) =>
      logReadPrimitiveCall(
        'summarize',
        rawInput,
        async () => {
          const input = SummarizeInput.parse(rawInput)
          const result = await handleSummarize(input)
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          }
        },
        extractRecordHashesFromMcpResult,
      ),
  )

  return { mcp }
}

async function handleSummarize(
  input: z.infer<typeof SummarizeInput>,
): Promise<SummarizeOutput> {
  const warnings: string[] = []
  const maxRecords = input.max_records ?? 50

  // Env-var context_id default: when the caller omitted context_id AND did
  // not supply record_hashes, fall back to @atrib/mcp's resolveEnvContextId
  // (D078 + D083 precedence: ATRIB_CONTEXT_ID, then a registered harness
  // env var like CLAUDE_CODE_SESSION_ID). Explicit input.context_id wins.
  const effectiveContextId = input.context_id ?? resolveEnvContextId()
  const effective: z.infer<typeof SummarizeInput> = {
    ...input,
    ...(effectiveContextId ? { context_id: effectiveContextId } : {}),
  }

  if (!effective.context_id && !effective.record_hashes) {
    warnings.push('one of context_id or record_hashes is required')
    return emptyOutput(warnings)
  }

  const llmCfg = resolveLlmConfig(input.model)
  if (!llmCfg) {
    warnings.push(
      'no LLM API key resolved (set ATRIB_SUMMARIZE_API_KEY, NVIDIA_API_KEY, or ~/.atrib/secrets/nvidia-api-key); cannot synthesize',
    )
    return emptyOutput(warnings)
  }

  // Load local mirror once; filter to the requested set.
  const { byHash, newestFirst } = loadAllRecords()
  const selected = selectRecords(effective, byHash, newestFirst)

  if (selected.length === 0) {
    warnings.push('no records matched the request')
    return { ...emptyOutput(warnings), model_used: llmCfg.model }
  }

  // Sort ascending by timestamp + apply max_records cap.
  selected.sort((a, b) => a.record.timestamp - b.record.timestamp)
  const summarized = selected.slice(0, maxRecords)
  const skipped = selected.length - summarized.length
  if (skipped > 0) {
    warnings.push(`${skipped} record${skipped === 1 ? '' : 's'} skipped beyond max_records=${maxRecords}`)
  }

  const withSidecar = summarized.filter((r) => r.local).length
  const withoutSidecar = summarized.length - withSidecar
  if (withoutSidecar > 0) {
    warnings.push(
      `${withoutSidecar} record${withoutSidecar === 1 ? '' : 's'} lacked a _local sidecar; LLM was given only event_type + cryptographic metadata for those`,
    )
  }

  const systemMsg = buildSystemPrompt()
  const userMsg = buildUserMessage(summarized, input.focus)

  let narrative = ''
  let modelUsed = llmCfg.model
  try {
    const llmResult = await callLlm(llmCfg, systemMsg, userMsg)
    narrative = llmResult.content
    modelUsed = llmResult.model
  } catch (e) {
    warnings.push(`LLM call failed: ${e instanceof Error ? e.message : String(e)}`)
    return {
      narrative: null,
      cited_record_hashes: summarized.map((r) => r.record_hash),
      records_summarized: summarized.length,
      records_skipped: skipped,
      records_with_sidecar: withSidecar,
      records_without_sidecar: withoutSidecar,
      model_used: llmCfg.model,
      warnings,
    }
  }

  return {
    narrative,
    cited_record_hashes: summarized.map((r) => r.record_hash),
    records_summarized: summarized.length,
    records_skipped: skipped,
    records_with_sidecar: withSidecar,
    records_without_sidecar: withoutSidecar,
    model_used: modelUsed,
    warnings,
  }
}

function selectRecords(
  input: z.infer<typeof SummarizeInput>,
  byHash: Map<string, IndexedRecord>,
  newestFirst: IndexedRecord[],
): IndexedRecord[] {
  const seen = new Set<string>()
  const out: IndexedRecord[] = []

  if (input.record_hashes) {
    for (const h of input.record_hashes) {
      const idx = byHash.get(h)
      if (idx && !seen.has(idx.record_hash)) {
        seen.add(idx.record_hash)
        out.push(idx)
      }
    }
  }

  if (input.context_id) {
    for (const r of newestFirst) {
      if (r.record.context_id === input.context_id && !seen.has(r.record_hash)) {
        seen.add(r.record_hash)
        out.push(r)
      }
    }
  }

  return out
}

function emptyOutput(warnings: string[]): SummarizeOutput {
  return {
    narrative: null,
    cited_record_hashes: [],
    records_summarized: 0,
    records_skipped: 0,
    records_with_sidecar: 0,
    records_without_sidecar: 0,
    model_used: null,
    warnings,
  }
}

// Test-only export, lets unit tests exercise the assembly logic without
// going through the McpServer transport.
export const __test_only__ = { handleSummarize, selectRecords }
