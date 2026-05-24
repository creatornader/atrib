// SPDX-License-Identifier: Apache-2.0

/**
 * atrib-trace MCP server: registers the `trace` tool that walks a record's
 * informed_by chain backward to surface the reasoning chain that led to it.
 *
 * Closes the consumer-side cognitive-loop primitive: recall returns raw
 * records; trace returns the causal chain, so an agent asking "why did
 * I do X?" can see "X was informed by Y, which was informed by Z" without
 * manually walking informed_by hash-by-hash.
 *
 * Reads only the local mirror (~/.atrib/records/*.jsonl) for v1, same scope
 * as recall. v2 will fall back to log.atrib.dev/v1/lookup/<hash> for hashes
 * not in the local mirror. Forward-walk (records that reference THIS one)
 * is also a v2 concern; v1 is backward-only.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  resolveEnvContextId,
  logReadPrimitiveCall,
  extractRecordHashesFromMcpResult,
} from '@atrib/mcp'
import { loadAllRecords } from './storage.js'
import { traceBackward, traceForward, type TraceVisited } from './trace.js'

const SHA256_REF_PATTERN = /^sha256:[0-9a-f]{64}$/
const HEX_32_PATTERN = /^[0-9a-f]{32}$/

const TraceInput = z.object({
  record_hash: z.string().regex(SHA256_REF_PATTERN).describe(
    "The 'sha256:<64-hex>' record_hash to start from. Walks backward via " +
    'informed_by edges from this record.',
  ),
  context_id: z.string().regex(HEX_32_PATTERN).optional().describe(
    'Optional 32-hex context_id scope. When set, edges crossing into a ' +
    'different context_id surface as dangling rather than expanding the ' +
    'walk. Defaults to process.env.ATRIB_CONTEXT_ID when valid; omit at ' +
    'the env-var level to walk cross-context. Used by Inspect-style ' +
    'harnesses to keep each arm\'s trace inside its own context per D072.',
  ),
  depth: z.number().int().min(1).max(10).optional().describe(
    'Maximum hop count from the starting record. Defaults to 3. Bounded ' +
    'at 10 to keep responses tractable; deeper chains should be walked ' +
    'in pieces by re-rooting at a returned upstream hash.',
  ),
  max_nodes: z.number().int().min(1).max(500).optional().describe(
    'Hard cap on total visited records. Defaults to 200. Prevents pathological ' +
    'fan-out (a record with hundreds of informed_by entries) from exploding ' +
    'the response.',
  ),
  compact: z.boolean().optional().describe(
    'When true (the default), per-record output omits signature/content_id/' +
    'spec_version/chain_root to keep the response small. Set false for full ' +
    'record bytes (useful for re-verification).',
  ),
})

interface CompactVisited {
  depth: number
  record_hash: string
  parent_hashes: string[]
  source: string | null
  event_type: string | null
  context_id: string | null
  creator_key: string | null
  timestamp: number | null
  /** informed_by entries on this record. Empty if none or dangling. */
  next_informed_by: string[]
  /** Sub-set of next_informed_by that were resolved (present in mirror). */
  next_resolved: string[]
  /** Sub-set of next_informed_by that were dangling (not in mirror). */
  next_dangling: string[]
  /**
   * Semantic context from the local sidecar when present. Carries
   * tool name + brief content summary so the agent can reason about
   * the record's meaning without separately fetching it. Absent on
   * legacy bare-record entries that pre-date the sidecar.
   */
  sidecar_summary?: {
    tool_name?: string
    topics?: string[]
    /**
     * First 200 chars of the record's human-readable content, derived
     * per event_type from the @atrib/mcp normative shapes (D086):
     * observation `what`, annotation `summary`, revision `new_position`.
     * For legacy records using non-normative names (`summary` on
     * observation), falls back to `summary`.
     */
    what?: string
    /** Annotation `importance` field when present. */
    importance?: string
    producer?: string
  }
}

/** Pull a compact summary from the sidecar's content payload.
 * Exported for unit testing of the per-event_type content-shape handling. */
export function summarizeSidecar(
  loadedRecord: { local?: import('./storage.js').SidecarPayload } | undefined,
): CompactVisited['sidecar_summary'] {
  if (!loadedRecord?.local) return undefined
  const sc = loadedRecord.local
  const out: NonNullable<CompactVisited['sidecar_summary']> = {}
  if (sc.toolName) out.tool_name = sc.toolName
  if (sc.producer) out.producer = sc.producer
  const c = sc.content as Record<string, unknown> | undefined
  if (c && Array.isArray(c['topics'])) {
    out.topics = (c['topics'] as unknown[]).filter((t): t is string => typeof t === 'string').slice(0, 6)
  }
  // Per-event_type human-readable text. The `what` slot here is generic
  // (it's the human-scannable summary regardless of event_type); the
  // priority order pulls the normative D086 field for each shape, with
  // an explicit final fallback to `summary` for legacy records.
  //   observation: content.what
  //   annotation:  content.summary
  //   revision:    content.new_position (D086-normative) — surface this
  //                so trace consumers can read the agent's stance shift
  //                without a separate recall call
  //   legacy:      content.summary (catches pre-D086 extractor records)
  if (c) {
    let primary: string | undefined
    if (typeof c['what'] === 'string') {
      primary = c['what']
    } else if (typeof c['new_position'] === 'string') {
      primary = c['new_position']
    } else if (typeof c['summary'] === 'string') {
      primary = c['summary']
    }
    if (primary) {
      out.what = primary.length > 200 ? primary.slice(0, 197) + '…' : primary
    }
  }
  if (c && typeof c['importance'] === 'string') out.importance = c['importance']
  return Object.keys(out).length === 0 ? undefined : out
}

function compactVisited(
  v: TraceVisited,
  danglingSet: Set<string>,
  byHash: Map<string, import('./storage.js').IndexedRecord>,
): CompactVisited {
  const indexed = byHash.get(v.record_hash)
  return {
    depth: v.depth,
    record_hash: v.record_hash,
    parent_hashes: v.parent_hashes,
    source: v.source,
    event_type: v.record?.event_type ?? null,
    context_id: v.record?.context_id ?? null,
    creator_key: v.record?.creator_key ?? null,
    timestamp: v.record?.timestamp ?? null,
    next_informed_by: v.next_informed_by,
    next_resolved: v.next_informed_by.filter((h) => !danglingSet.has(h)),
    next_dangling: v.next_informed_by.filter((h) => danglingSet.has(h)),
    ...(summarizeSidecar(indexed) ? { sidecar_summary: summarizeSidecar(indexed) } : {}),
  }
}

export interface AtribTraceServer {
  mcp: McpServer
}

export async function createAtribTraceServer(): Promise<AtribTraceServer> {
  const mcp = new McpServer({
    name: 'atrib-trace',
    version: '0.1.0',
  })

  // Shared shape: build a compact payload from a TraceResult.
  function buildPayload(
    result: ReturnType<typeof traceBackward>,
    byHash: Map<string, import('./storage.js').IndexedRecord>,
    compact: boolean,
  ) {
    const danglingSet = new Set(result.dangling)
    return compact
      ? {
          start_hash: result.start_hash,
          direction: result.direction,
          depth_requested: result.depth_requested,
          depth_reached: result.depth_reached,
          visited: result.visited.map((v) => compactVisited(v, danglingSet, byHash)),
          dangling: result.dangling,
          truncated_by_depth: result.truncated_by_depth,
          truncated_by_cap: result.truncated_by_cap,
          warnings: result.warnings,
        }
      : { ...result }
  }

  mcp.registerTool(
    'trace',
    {
      title: 'trace informed_by chain backward',
      description:
        'Walk a record\'s informed_by chain backward to surface the reasoning ' +
        'chain that led to it. Reads from the local signed-record mirror ' +
        '(~/.atrib/records/*.jsonl). Returns the records visited, parent links ' +
        'so the caller can reconstruct the tree, and dangling hashes (records ' +
        'referenced via informed_by but not present in the local mirror). ' +
        'Sibling tool `trace_forward` walks the opposite direction (records ' +
        'that cited THIS one via their informed_by).',
      inputSchema: TraceInput.shape,
    },
    async (args: z.infer<typeof TraceInput>) =>
      logReadPrimitiveCall(
        'trace',
        args,
        async () => {
          const depth = args.depth ?? 3
          const maxNodes = args.max_nodes ?? 200
          const compact = args.compact ?? true

          // Env-var context_id default: when the caller omitted context_id,
          // fall back to @atrib/mcp's resolveEnvContextId (D078 + D083
          // precedence: ATRIB_CONTEXT_ID, then a registered harness env var
          // like CLAUDE_CODE_SESSION_ID). Explicit args.context_id always wins.
          const contextId = args.context_id ?? resolveEnvContextId()

          const { byHash } = loadAllRecords()
          const result = traceBackward(args.record_hash, depth, byHash, {
            maxNodes,
            ...(contextId ? { contextId } : {}),
          })
          return {
            content: [{ type: 'text', text: JSON.stringify(buildPayload(result, byHash, compact), null, 2) }],
          }
        },
        extractRecordHashesFromMcpResult,
      ),
  )

  // Sibling tool: forward walk (records that cited THIS one). Mirrors
  // the trace input schema + response shape exactly so callers can use
  // it interchangeably; only the direction of the walk differs.
  mcp.registerTool(
    'trace_forward',
    {
      title: 'trace informed_by chain forward',
      description:
        'Walk forward from a record_hash, surfacing the records that cited ' +
        'it via their informed_by chain. The dual of `trace` (backward). ' +
        'Answers "I made decision X, what did I do because of it?" Reads from ' +
        'the local signed-record mirror (~/.atrib/records/*.jsonl). Returns ' +
        'the records visited, parent links (which upstream record at the ' +
        'prior level cited this one), and dangling hashes (rare; only if the ' +
        'reverse index references a record missing from the mirror).',
      inputSchema: TraceInput.shape,
    },
    async (args: z.infer<typeof TraceInput>) =>
      logReadPrimitiveCall(
        'trace_forward',
        args,
        async () => {
          const depth = args.depth ?? 3
          const maxNodes = args.max_nodes ?? 200
          const compact = args.compact ?? true
          const contextId = args.context_id ?? resolveEnvContextId()
          const { byHash } = loadAllRecords()
          const result = traceForward(args.record_hash, depth, byHash, {
            maxNodes,
            ...(contextId ? { contextId } : {}),
          })
          return {
            content: [{ type: 'text', text: JSON.stringify(buildPayload(result, byHash, compact), null, 2) }],
          }
        },
        extractRecordHashesFromMcpResult,
      ),
  )

  return { mcp }
}
