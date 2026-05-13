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
import { loadAllRecords } from './storage.js'
import { traceBackward, type TraceVisited } from './trace.js'

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
    /** First 200 chars of `what` (observation) or summary (annotation). */
    what?: string
    /** Annotation `importance` field when present. */
    importance?: string
    producer?: string
  }
}

/** Pull a compact summary from the sidecar's content payload. */
function summarizeSidecar(
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
  if (c && typeof c['what'] === 'string') {
    const w = c['what']
    out.what = w.length > 200 ? w.slice(0, 197) + '…' : w
  } else if (c && typeof c['summary'] === 'string') {
    const s = c['summary']
    out.what = s.length > 200 ? s.slice(0, 197) + '…' : s
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

  mcp.registerTool(
    'trace',
    {
      title: 'trace informed_by chain backward',
      description:
        'Walk a record\'s informed_by chain backward to surface the reasoning ' +
        'chain that led to it. Reads from the local signed-record mirror ' +
        '(~/.atrib/records/*.jsonl). Returns the records visited, parent links ' +
        'so the caller can reconstruct the tree, and dangling hashes (records ' +
        'referenced via informed_by but not present in the local mirror).',
      inputSchema: TraceInput.shape,
    },
    async (args: z.infer<typeof TraceInput>) => {
      const depth = args.depth ?? 3
      const maxNodes = args.max_nodes ?? 200
      const compact = args.compact ?? true

      // ATRIB_CONTEXT_ID env-var default: when the caller omitted
      // context_id, fall back to the env var if it carries a valid
      // 32-hex value. Lets Inspect-style harnesses scope the trace walk
      // to a per-arm context_id via the MCP env block (per D072's
      // per-arm isolation contract). Explicit args.context_id always wins.
      const envContextId = process.env['ATRIB_CONTEXT_ID']
      const contextId =
        args.context_id ??
        (envContextId && HEX_32_PATTERN.test(envContextId) ? envContextId : undefined)

      const { byHash } = loadAllRecords()
      const result = traceBackward(args.record_hash, depth, byHash, {
        maxNodes,
        ...(contextId ? { contextId } : {}),
      })
      const danglingSet = new Set(result.dangling)

      const payload = compact
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
        : {
            ...result,
            // Full records included
          }

      return {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
      }
    },
  )

  return { mcp }
}
