// SPDX-License-Identifier: Apache-2.0

/**
 * The `recall` tool: atrib's read verb. One read-only handler absorbs the
 * eight legacy recall_* tools, trace / trace_forward, and atrib-verify
 * under a `shape` argument, a walk `direction`, and a `verification`
 * parameter. Every shape dispatches to the same runner the legacy tool
 * name dispatches to, so results are JSON-identical by construction
 * (read-equivalence conformance family). Signs nothing.
 *
 * Exact shape <-> legacy map:
 *   history                       recall_my_attribution_history
 *   walk (no direction)           recall_walk (local derived-graph walk)
 *   walk + direction=backward     trace          (informed_by walk)
 *   walk + direction=forward      trace_forward  (informed_by walk)
 *   content (+query)              recall_by_content
 *   chain                         recall_session_chain
 *   annotations (+start)          recall_annotations
 *   revisions (+start)            recall_revisions
 *   orphans                       recall_orphans
 *   by_signer                     recall_by_signer
 *   state                         deterministic accepted-state projection
 *
 * The `verification` parameter runs the Pattern 3 handoff-acceptance logic
 * (legacy atrib-verify) and attaches its tiered result to the response;
 * with `shape` omitted, the call is verification-only. There is no
 * summarize shape: the read surface returns verified material; the caller
 * synthesizes.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { logReadPrimitiveCall } from '@atrib/mcp'
import { EventTypeFilterSchema } from './event-type-filter.js'
import {
  recall,
  runRecallAnnotations,
  runRecallByContent,
  runRecallBySigner,
  runRecallOrphans,
  runRecallRevisions,
  runRecallSessionChain,
  runRecallState,
  runRecallWalk,
  type RecallArgs,
} from './index.js'
import type { EdgeType } from './graph.js'
import {
  extractRecordHashFieldsFromMcpResult,
  runTraceWalk,
  type TraceInputT,
} from './trace-tools.js'
import { tryHandleAtribVerify, VerifyInput } from './verification.js'

const SHA256_REF_PATTERN = /^sha256:[0-9a-f]{64}$/

export const RECALL_SHAPES = [
  'history',
  'walk',
  'content',
  'chain',
  'annotations',
  'revisions',
  'orphans',
  'by_signer',
  'state',
] as const

export type RecallShape = (typeof RECALL_SHAPES)[number]

const RecallFilters = z.object({
  context_id: z
    .string()
    .optional()
    .describe('32-hex context_id filter (history, chain, orphans; walk trace scoping).'),
  context_scope: z
    .enum(['all', 'env'])
    .optional()
    .describe(
      "History only. How to treat an omitted context_id: 'all' (default) searches cross-context; " +
        "'env' applies the D078/D083 env-derived current context.",
    ),
  creator_key: z.string().optional().describe('Exact creator_key match (history, orphans).'),
  event_type: EventTypeFilterSchema.optional().describe(
    'Event-kind filter: shorthand alias or full URI (history, orphans).',
  ),
  content_id: z.string().optional().describe('Exact content_id match (history).'),
  tool_name: z.string().optional().describe('Exact §8.2 disclosed tool_name match (history).'),
  args_hash: z.string().optional().describe('Exact §8.3 args_hash match (history).'),
  min_importance: z
    .enum(['critical', 'high', 'medium', 'low', 'noise'])
    .optional()
    .describe('History only. Minimum annotation-derived importance.'),
  topic_tags: z
    .array(z.string())
    .optional()
    .describe('History only. OR-match against annotation topic tags.'),
  include_revised: z
    .boolean()
    .optional()
    .describe('History only. Hide records superseded by a revision when true.'),
  min_signers: z.number().optional().describe('History only. Minimum count of distinct signers.'),
})

export const RecallVerbInput = z.object({
  shape: z
    .enum(RECALL_SHAPES)
    .optional()
    .describe(
      'Which read shape to run. Required unless `verification` is supplied (verification-only ' +
        'call). history = filter-and-page over the local mirror; walk = graph/causal walk from ' +
        '`start`; content = BM25 free-form retrieval over `query`; chain = chronological ' +
        'session chain; annotations / revisions = per-record aggregations from `start`; ' +
        'orphans = loose-end discovery; by_signer = per-creator aggregation; state = ' +
        'current heads of signed revision lineages without arbitrary conflict resolution.',
    ),
  direction: z
    .enum(['backward', 'forward'])
    .optional()
    .describe(
      "Walk only. Omit for the local derived-graph walk (legacy recall_walk). 'backward' walks " +
        "the informed_by chain that led to `start` (legacy trace); 'forward' walks the records " +
        'that cited `start` (legacy trace_forward).',
    ),
  start: z
    .string()
    .regex(SHA256_REF_PATTERN)
    .optional()
    .describe(
      "'sha256:<64-hex>' starting record_hash. REQUIRED for walk, annotations, and revisions.",
    ),
  query: z
    .string()
    .optional()
    .describe('Free-form BM25 content query per D086. REQUIRED for shape=content.'),
  filters: RecallFilters.optional().describe(
    'AND-combined filters. Which fields apply depends on the shape; see each field.',
  ),
  rank_by: z
    .enum(['timestamp', 'relevance', 'causal_distance'])
    .optional()
    .describe('History only. Result ordering; same semantics as the legacy tool.'),
  rank_anchor: z
    .string()
    .optional()
    .describe('History only. Anchor for non-timestamp rank_by modes.'),
  limit: z
    .number()
    .optional()
    .describe(
      'Page size / top-k. history: default 10, max 200. content: top-k, default 10, max 50. ' +
        'chain and orphans: default 50, max 500.',
    ),
  offset: z
    .number()
    .optional()
    .describe('History only. Pagination offset (explicit handle; never protocol-session state).'),
  compact: z
    .boolean()
    .optional()
    .describe('history and walk-with-direction: omit heavy record fields (default true).'),
  include_unverified: z
    .boolean()
    .optional()
    .describe('History only. Include records that failed local signature verification.'),
  toc: z.boolean().optional().describe('History only. Table-of-contents entry shape per record.'),
  edge_types: z
    .array(z.enum(['CHAIN_PRECEDES', 'INFORMED_BY', 'ANNOTATES', 'REVISES']))
    .optional()
    .describe('Walk (no direction) only. Layer 1 edge types to follow; default all four.'),
  depth: z
    .number()
    .optional()
    .describe(
      'Walk only. Maximum hop count. Graph walk default 3; directional walks default 3, max 10.',
    ),
  max_nodes: z
    .number()
    .optional()
    .describe('Walk with direction only. Hard cap on visited records (default 200, max 500).'),
  include_content: z
    .boolean()
    .optional()
    .describe('chain and walk-with-direction: include the D062 local mirror body per record.'),
  max_records: z
    .number()
    .optional()
    .describe('Content only. Maximum newest-first records to search before candidate scoring.'),
  evidence_mode: z
    .enum(['bounded', 'require_complete'])
    .optional()
    .describe('Content only. Coverage posture; same semantics as the legacy tool (D123/D125).'),
  include_tool_call_args: z
    .boolean()
    .optional()
    .describe('Content only. Lift the operational tool_call score suppression (D156).'),
  min_records: z
    .number()
    .optional()
    .describe('by_signer only. Minimum record count to include a creator.'),
  root_record_hashes: z
    .array(z.string().regex(SHA256_REF_PATTERN))
    .optional()
    .describe(
      'State only. Project these lineage roots. Omit to discover every verified revision root.',
    ),
  trusted_creator_keys: z
    .array(z.string())
    .optional()
    .describe(
      'State only. Accept records from these creator keys. Omit only for a local all-signers view.',
    ),
  allowed_context_ids: z
    .array(z.string().regex(/^[0-9a-f]{32}$/))
    .optional()
    .describe('State only. Accept records from these contexts. Omit for a cross-context view.'),
  head_limit: z
    .number()
    .optional()
    .describe(
      'State only. Maximum active heads returned per lineage cell. The projector reports truncation and the total head count.',
    ),
  verification: VerifyInput.extend({
    mode: z
      .literal('handoff')
      .optional()
      .describe("Verification mode. Only 'handoff' (Pattern 3 claim acceptance) exists today."),
  })
    .optional()
    .describe(
      'Run handoff-evidence verification (legacy atrib-verify) and attach the tiered result ' +
        'as a `verification` block on the response. When the optional @atrib/verify peer is ' +
        'not installed, the block is { status: "verifier_unavailable" } and the read result ' +
        'is unaffected (§5.8). Supply without `shape` for a verification-only call.',
    ),
})

export type RecallVerbInputT = z.infer<typeof RecallVerbInput>

function refusal(message: string): {
  isError: true
  content: Array<{ type: 'text'; text: string }>
} {
  return { isError: true, content: [{ type: 'text', text: message }] }
}

/** Dispatch one recall-verb call to the shape runners. Exported for tests. */
export async function runRecallVerb(
  input: RecallVerbInputT,
): Promise<{ payload: Record<string, unknown> } | { error: string }> {
  if (!input.shape && !input.verification) {
    return { error: 'recall requires `shape`, `verification`, or both' }
  }

  let payload: Record<string, unknown> = {}

  if (input.shape) {
    const f = input.filters ?? {}
    switch (input.shape) {
      case 'history': {
        payload = (await recall({
          ...(f.context_id !== undefined ? { context_id: f.context_id } : {}),
          ...(f.context_scope !== undefined ? { context_scope: f.context_scope } : {}),
          ...(f.creator_key !== undefined ? { creator_key: f.creator_key } : {}),
          ...(f.event_type !== undefined ? { event_type: f.event_type } : {}),
          ...(f.content_id !== undefined ? { content_id: f.content_id } : {}),
          ...(f.tool_name !== undefined ? { tool_name: f.tool_name } : {}),
          ...(f.args_hash !== undefined ? { args_hash: f.args_hash } : {}),
          ...(f.min_importance !== undefined ? { min_importance: f.min_importance } : {}),
          ...(f.topic_tags !== undefined ? { topic_tags: f.topic_tags } : {}),
          ...(f.include_revised !== undefined ? { include_revised: f.include_revised } : {}),
          ...(f.min_signers !== undefined ? { min_signers: f.min_signers } : {}),
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
          ...(input.offset !== undefined ? { offset: input.offset } : {}),
          ...(input.compact !== undefined ? { compact: input.compact } : {}),
          ...(input.include_unverified !== undefined
            ? { include_unverified: input.include_unverified }
            : {}),
          ...(input.rank_by !== undefined ? { rank_by: input.rank_by } : {}),
          ...(input.rank_anchor !== undefined ? { rank_anchor: input.rank_anchor } : {}),
          ...(input.toc !== undefined ? { toc: input.toc } : {}),
        } as RecallArgs)) as unknown as Record<string, unknown>
        break
      }
      case 'walk': {
        if (!input.start) return { error: "shape='walk' requires `start`" }
        if (input.direction) {
          const traceArgs: TraceInputT = {
            record_hash: input.start,
            ...(f.context_id !== undefined ? { context_id: f.context_id } : {}),
            ...(input.depth !== undefined ? { depth: input.depth } : {}),
            ...(input.max_nodes !== undefined ? { max_nodes: input.max_nodes } : {}),
            ...(input.compact !== undefined ? { compact: input.compact } : {}),
            ...(input.include_content !== undefined
              ? { include_content: input.include_content }
              : {}),
          }
          payload = runTraceWalk(input.direction, traceArgs)
        } else {
          payload = await runRecallWalk({
            from_record_hash: input.start,
            ...(input.edge_types !== undefined
              ? { edge_types: input.edge_types as EdgeType[] }
              : {}),
            ...(input.depth !== undefined ? { depth: input.depth } : {}),
          })
        }
        break
      }
      case 'content': {
        if (input.query === undefined) return { error: "shape='content' requires `query`" }
        payload = await runRecallByContent({
          query: input.query,
          ...(input.limit !== undefined ? { k: input.limit } : {}),
          ...(input.max_records !== undefined ? { max_records: input.max_records } : {}),
          ...(input.evidence_mode !== undefined ? { evidence_mode: input.evidence_mode } : {}),
          ...(input.include_tool_call_args !== undefined
            ? { include_tool_call_args: input.include_tool_call_args }
            : {}),
        })
        break
      }
      case 'chain': {
        payload = await runRecallSessionChain({
          ...(f.context_id !== undefined ? { context_id: f.context_id } : {}),
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
          ...(input.include_content !== undefined
            ? { include_content: input.include_content }
            : {}),
        })
        break
      }
      case 'annotations': {
        if (!input.start) return { error: "shape='annotations' requires `start`" }
        payload = await runRecallAnnotations({ record_hash: input.start })
        break
      }
      case 'revisions': {
        if (!input.start) return { error: "shape='revisions' requires `start`" }
        payload = await runRecallRevisions({ record_hash: input.start })
        break
      }
      case 'orphans': {
        payload = await runRecallOrphans({
          ...(f.context_id !== undefined ? { context_id: f.context_id } : {}),
          ...(f.event_type !== undefined ? { event_type: f.event_type } : {}),
          ...(f.creator_key !== undefined ? { creator_key: f.creator_key } : {}),
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
        })
        break
      }
      case 'by_signer': {
        payload = await runRecallBySigner({
          ...(input.min_records !== undefined ? { min_records: input.min_records } : {}),
        })
        break
      }
      case 'state': {
        payload = await runRecallState({
          ...(input.root_record_hashes !== undefined
            ? { root_record_hashes: input.root_record_hashes }
            : {}),
          ...(input.trusted_creator_keys !== undefined
            ? { trusted_creator_keys: input.trusted_creator_keys }
            : {}),
          ...(input.allowed_context_ids !== undefined
            ? { allowed_context_ids: input.allowed_context_ids }
            : {}),
          ...(input.include_content !== undefined
            ? { include_content: input.include_content }
            : {}),
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
          ...(input.head_limit !== undefined ? { head_limit: input.head_limit } : {}),
        })
        break
      }
    }
  }

  if (input.verification) {
    const { mode: _mode, ...verifyArgs } = input.verification
    payload = { ...payload, verification: await tryHandleAtribVerify(verifyArgs) }
  }

  return { payload }
}

/** Register the `recall` verb tool on a server. */
export function registerRecallVerbTool(mcp: McpServer): void {
  mcp.registerTool(
    'recall',
    {
      description:
        "Look up the agent's signed past: atrib's read verb. One read-only tool absorbs the " +
        'legacy recall_* tools (shape argument), trace / trace_forward (shape=walk with a ' +
        'direction), and atrib-verify (the verification parameter). Results are JSON-identical ' +
        'to the legacy tool they map onto; every compact result keeps record_hash so calls can ' +
        'be chained. Signs nothing.',
      inputSchema: RecallVerbInput.shape,
    },
    async (rawInput) => {
      const input = RecallVerbInput.parse(rawInput) as RecallVerbInputT
      const primitive = `recall:${input.shape ?? 'verification'}`
      return logReadPrimitiveCall(
        primitive,
        rawInput,
        async () => {
          const outcome = await runRecallVerb(input)
          if ('error' in outcome) return refusal(outcome.error)
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(outcome.payload, null, 2) }],
          }
        },
        extractRecordHashFieldsFromMcpResult,
      )
    },
  )
}
