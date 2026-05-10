#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

/**
 * @atrib/recall, recall_my_attribution_history MCP server.
 *
 * Exposes a single tool to the host agent: recall_my_attribution_history.
 * Reads signed-record jsonl mirrors (per spec §5.9), VERIFIES the Ed25519
 * signature on each record before returning it, and tags every entry with
 * signature_verified so the agent can distinguish provable past from tampered
 * or partial mirror state.
 *
 * Mirror discovery (in priority order):
 *   1. ATRIB_RECORD_FILE, single explicit jsonl file. Back-compat with
 *      pre-0.4.0 callers that pinned a specific producer's mirror.
 *   2. ATRIB_MIRROR_DIR, directory; recall reads every `*.jsonl` inside.
 *      Default: ~/.atrib/records (the spec §5.9 well-known mirror namespace).
 *
 * Two on-disk shapes are accepted, matching D062 / spec §5.9:
 *   - Bare AtribRecord (legacy producers):           {spec_version, ...}
 *   - Envelope (D062 sidecar form):                  {record: {...}, proof?, _local?}
 * Both round-trip through verifyRecord; the parser picks the right inner shape.
 *
 * Trust scope: signature verification is local-only. A passing signature_verified
 * proves the record was signed by the named creator_key; it does NOT prove the
 * record was committed to log.atrib.dev. To confirm log inclusion, the caller
 * should fetch the inclusion proof from the log API.
 *
 * Configuration via environment variables:
 *   ATRIB_RECORD_FILE, single explicit file (overrides directory scan).
 *   ATRIB_MIRROR_DIR, directory to scan. Default: ~/.atrib/records.
 *   ATRIB_LOG_ORIGIN, origin used in human-readable messages.
 *                        Default: log.atrib.dev
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  verifyRecord,
  EVENT_TYPE_TOOL_CALL_URI,
  EVENT_TYPE_TRANSACTION_URI,
} from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'

// Short-form event_type names accepted by the recall MCP schema map onto
// their atrib-normative URI form (spec §1.2.4). Records sign the URI form
// per §1.4.5 + isValidEventTypeUri; without this mapping, a recall caller
// passing `event_type: 'tool_call'` would silently get zero results because
// the raw equality compare against `r.event_type` would never match the URI.
const EVENT_TYPE_SHORT_TO_URI: Record<string, string> = {
  tool_call: EVENT_TYPE_TOOL_CALL_URI,
  transaction: EVENT_TYPE_TRANSACTION_URI,
}
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'

const ATRIB_RECORD_FILE = process.env.ATRIB_RECORD_FILE
const ATRIB_MIRROR_DIR = process.env.ATRIB_MIRROR_DIR ?? join(
  homedir(),
  '.atrib',
  'records',
)
const ATRIB_LOG_ORIGIN = process.env.ATRIB_LOG_ORIGIN ?? 'log.atrib.dev'

/**
 * Pull the inner AtribRecord out of either on-disk shape (D062 envelope or
 * legacy bare record). Returns null when the line is neither shape or is
 * missing required fields. Same shape contract as the wrapper-side
 * normalizeMirrorLine in @atrib/mcp-wrap.
 */
function extractRecord(parsed: unknown): AtribRecord | null {
  if (!parsed || typeof parsed !== 'object') return null
  const obj = parsed as Record<string, unknown>
  // D062 envelope: { record: {...}, proof?, _local?, written_at? }.
  // Legacy bare: the AtribRecord fields sit at the top level.
  const candidate = (typeof obj.record === 'object' && obj.record !== null)
    ? (obj.record as Record<string, unknown>)
    : obj
  if (
    typeof candidate.spec_version === 'string' &&
    typeof candidate.event_type === 'string' &&
    typeof candidate.context_id === 'string' &&
    typeof candidate.creator_key === 'string' &&
    typeof candidate.chain_root === 'string' &&
    typeof candidate.signature === 'string'
  ) {
    return candidate as unknown as AtribRecord
  }
  return null
}

export function loadRecords(path: string): AtribRecord[] {
  if (!existsSync(path)) return []
  const out: AtribRecord[] = []
  const raw = readFileSync(path, 'utf8')
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const rec = extractRecord(JSON.parse(trimmed))
      if (rec) out.push(rec)
    } catch {
      // Malformed JSON; skip.
    }
  }
  return out
}

/**
 * Load every `*.jsonl` file in `dir` and merge their records. Files that
 * don't exist or aren't readable are silently skipped (a file rotated out
 * mid-scan shouldn't error the whole call). Returns the union of records;
 * de-duplication and ordering are caller responsibilities.
 *
 * Spec §5.9 establishes `~/.atrib/records/` as the well-known per-agent
 * mirror namespace; every producer running under one identity writes a
 * file there with the convention `<producer>-<agent>.jsonl`. Scanning the
 * directory unifies recall across producers without recall having to know
 * the naming scheme, any producer that follows §5.9 just shows up.
 */
export function loadRecordsFromDir(dir: string): { records: AtribRecord[]; files: string[] } {
  if (!existsSync(dir)) return { records: [], files: [] }
  let entries: string[] = []
  try {
    entries = readdirSync(dir).filter((name) => name.endsWith('.jsonl'))
  } catch {
    return { records: [], files: [] }
  }
  const records: AtribRecord[] = []
  const files: string[] = []
  for (const name of entries) {
    const full = join(dir, name)
    try {
      const stat = statSync(full)
      if (!stat.isFile()) continue
    } catch {
      continue
    }
    const loaded = loadRecords(full)
    if (loaded.length > 0) {
      records.push(...loaded)
      files.push(full)
    } else {
      // Surface empty/unreadable files too so the operator can see them in
      // the response if they care, but only if the file existed (which it
      // does, readdirSync returned it).
      files.push(full)
    }
  }
  return { records, files }
}

interface RecallArgs {
  context_id?: string
  event_type?: 'tool_call' | 'transaction'
  /**
   * Optional exact match on `record.content_id` (`sha256:<64-hex>`). Per spec
   * §1.2.2, content_id is `sha256(serverUrl + ":" + toolName)`. Filtering by
   * content_id groups all records emitted by the same tool on the same MCP
   * server. Useful for "all calls to this tool, ever." Coarser than tool_name
   * because two tools on different servers share no content_id even if their
   * names match.
   */
  content_id?: string
  /**
   * Optional exact match on the §8.2 disclosed `tool_name`. Records that did
   * NOT opt in to tool-name disclosure (the §8.1 default posture) carry no
   * tool_name field and are excluded from results when this filter is set.
   * Use this to query by human-readable name (e.g. tool_name="Edit") across
   * MCP servers, when the producer disclosed it.
   */
  tool_name?: string
  /**
   * Optional exact match on `record.args_hash` (`sha256:<64-hex>`). Per spec
   * §8.3, args_hash commits to canonical args bytes. Salted (D045) and plain
   * forms hash identically on the wire; this filter does not distinguish
   * them. Most useful for replay detection (same args, same hash) and for
   * agent-side keyed lookup when the agent computes a probe hash over a
   * normalized {tool, target} dict.
   */
  args_hash?: string
  limit?: number
  offset?: number
  /**
   * When true (the default), the response omits signature/content_id/
   * chain_root/spec_version. Set verbose=true to include them.
   */
  compact?: boolean
  /**
   * When true (the default), the response includes only records whose
   * Ed25519 signature verified locally. Set include_unverified=true to also
   * include tampered/unverified records (always with signature_verified=false
   * so the agent can decide).
   */
  include_unverified?: boolean
}

/**
 * The shape returned to the agent. Each record is annotated with
 * signature_verified, true if the local Ed25519 signature check passed.
 * In compact mode the heavy fields (signature, content_id, chain_root,
 * spec_version) are dropped; the verified status is preserved.
 */
type RecallRecordCompact = {
  event_type: AtribRecord['event_type']
  context_id: string
  creator_key: string
  timestamp: number
  signature_verified: boolean
  session_token?: string
}

type RecallRecordFull = AtribRecord & { signature_verified: boolean }

export interface RecallResult {
  total: number
  returned: number
  /**
   * Count of records dropped because their Ed25519 signature did not verify.
   * Always 0 when include_unverified=true was passed.
   */
  filtered_out_by_verification: number
  /**
   * Mirror files actually scanned. When ATRIB_RECORD_FILE was set, this is
   * a single-element list (back-compat). Otherwise it lists every `*.jsonl`
   * found in ATRIB_MIRROR_DIR.
   */
  record_files: string[]
  /**
   * @deprecated Use `record_files`. Preserved as the first entry of
   * `record_files` for callers still reading this field.
   */
  record_file: string
  log_origin: string
  pagination_caveat: string
  records: RecallRecordFull[] | RecallRecordCompact[]
}

async function annotateVerification(records: AtribRecord[]): Promise<RecallRecordFull[]> {
  return Promise.all(
    records.map(async (r) => {
      let ok = false
      try {
        ok = await verifyRecord(r)
      } catch {
        ok = false
      }
      return { ...r, signature_verified: ok }
    }),
  )
}

function compactify(records: RecallRecordFull[]): RecallRecordCompact[] {
  return records.map((r) => {
    const out: RecallRecordCompact = {
      event_type: r.event_type,
      context_id: r.context_id,
      creator_key: r.creator_key,
      timestamp: r.timestamp,
      signature_verified: r.signature_verified,
    }
    if (r.session_token) out.session_token = r.session_token
    return out
  })
}

/**
 * Discover and load records per the mirror-discovery contract:
 *   - If `recordFile` is provided, load just that file.
 *   - Else if ATRIB_RECORD_FILE is set, load just that file (back-compat).
 *   - Else scan ATRIB_MIRROR_DIR (default ~/.atrib/records).
 *
 * Returns the union of records and the list of files scanned. Callers that
 * dedupe should key on `record.signature` (signatures are unique per record
 * per spec §1.4); the same record present in two mirrors will appear twice
 * here unless the caller dedupes.
 */
export function discoverRecords(
  recordFile?: string,
): { records: AtribRecord[]; files: string[] } {
  const explicit = recordFile ?? ATRIB_RECORD_FILE
  if (explicit) {
    return { records: loadRecords(explicit), files: [explicit] }
  }
  return loadRecordsFromDir(ATRIB_MIRROR_DIR)
}

export async function recall(
  args: RecallArgs,
  recordFile?: string,
): Promise<RecallResult> {
  // Defaults: compact=true (small responses) and include_unverified=false
  // (no tampered records). The verbose+include-tampered combo is opt-in.
  // Rationale: a poorly-written agent that doesn't check signature_verified
  // would otherwise treat tampered records as provable. Default to safe.
  const compact = args.compact !== false
  const includeUnverified = args.include_unverified === true

  const { records: all, files } = discoverRecords(recordFile)
  let filtered = all
  if (args.context_id) filtered = filtered.filter((r) => r.context_id === args.context_id)
  if (args.event_type) {
    // Schema accepts short form ('tool_call'|'transaction'); records carry
    // the URI form. Normalize before comparison; pass URIs through as-is so
    // a forward-compatible caller passing the URI directly still matches.
    const targetUri = EVENT_TYPE_SHORT_TO_URI[args.event_type] ?? args.event_type
    filtered = filtered.filter((r) => r.event_type === targetUri)
  }
  if (args.content_id) filtered = filtered.filter((r) => r.content_id === args.content_id)
  if (args.tool_name) filtered = filtered.filter((r) => r.tool_name === args.tool_name)
  if (args.args_hash) filtered = filtered.filter((r) => r.args_hash === args.args_hash)

  // Newest first, the agent typically wants its most-recent provable
  // actions, not the genesis of the log.
  filtered.sort((a, b) => b.timestamp - a.timestamp)

  const offset = Math.max(0, args.offset ?? 0)
  const limit = Math.max(1, Math.min(200, args.limit ?? 25))
  const page = filtered.slice(offset, offset + limit)
  let verified = await annotateVerification(page)

  // Apply verification filter post-paging so `total` reflects the unfiltered
  // count (matches user expectation of "how many records exist that match
  // your context_id+event_type filters?"). filtered_out distinguishes the
  // verification-rejection count.
  let filteredOutByVerification = 0
  if (!includeUnverified) {
    const before = verified.length
    verified = verified.filter((r) => r.signature_verified === true)
    filteredOutByVerification = before - verified.length
  }

  const records = compact ? compactify(verified) : verified

  return {
    total: filtered.length,
    returned: verified.length,
    filtered_out_by_verification: filteredOutByVerification,
    record_files: files,
    record_file: files[0] ?? '',
    log_origin: ATRIB_LOG_ORIGIN,
    pagination_caveat:
      'offset is not stable when new records are appended. For consistent paging, capture the' +
      ' first-page timestamps and re-page using a context_id or event_type filter instead.',
    records,
  }
}

const server = new McpServer({
  name: 'atrib-recall',
  version: '0.4.0',
})

server.registerTool(
  'recall_my_attribution_history',
  {
    description:
      "Return signed atrib records from the local mirror. The agent's own past, with each record's " +
      'Ed25519 signature verified locally. By default the response is compact (no signature bytes) and ' +
      'includes only records that passed signature verification; both can be opted out of with ' +
      'compact=false and include_unverified=true respectively. Local signature verification proves ' +
      '"this record was signed by that creator_key"; it does NOT prove log inclusion (fetch a log ' +
      'inclusion proof to confirm). Filter by context_id (specific trace), event_type ' +
      '(tool_call|transaction), content_id (specific tool on specific server), tool_name (disclosed ' +
      'name per §8.2), or args_hash (canonical-args commitment per §8.3). Filters are AND-combined; ' +
      'omit all of them for cross-trace history. Results are sorted newest-first. Pagination uses ' +
      'offset; new records appended between calls invalidate offset stability. See the ' +
      'pagination_caveat in the response. The filtered_out_by_verification field reports how many ' +
      'records were dropped due to signature failures (always 0 when include_unverified=true).',
    inputSchema: {
      context_id: z
        .string()
        .optional()
        .describe(
          'Optional trace identifier (32 hex chars). Limits results to records signed within this trace. ' +
            'Omit for cross-trace recall.',
        ),
      event_type: z
        .enum(['tool_call', 'transaction'])
        .optional()
        .describe('Optional filter to a single event kind. Most calls leave this unset.'),
      content_id: z
        .string()
        .optional()
        .describe(
          'Optional exact match on record.content_id (sha256:<64-hex>). Per spec §1.2.2, content_id ' +
            'is sha256(serverUrl + ":" + toolName), so filtering groups all records emitted by the same ' +
            'tool on the same MCP server. Coarser than tool_name (different servers, same name -> ' +
            'different content_id).',
        ),
      tool_name: z
        .string()
        .optional()
        .describe(
          'Optional exact match on the §8.2 disclosed tool_name. Records that did NOT opt in to ' +
            'tool-name disclosure (the §8.1 default posture) carry no tool_name field and are excluded ' +
            'from results when this filter is set.',
        ),
      args_hash: z
        .string()
        .optional()
        .describe(
          'Optional exact match on record.args_hash (sha256:<64-hex>). Per spec §8.3, args_hash commits ' +
            'to canonical args bytes (salted or plain; both forms hash identically on the wire). Most ' +
            'useful for replay detection or agent-side keyed lookup over a normalized probe hash.',
        ),
      limit: z.number().optional().describe('Page size, default 25, max 200.'),
      offset: z
        .number()
        .optional()
        .describe(
          'Pagination offset, default 0. Note: not stable when new records land between calls, see ' +
            'pagination_caveat in the response.',
        ),
      compact: z
        .boolean()
        .optional()
        .describe(
          'Default true. When true, omit signature/content_id/chain_root/spec_version fields. ' +
            'signature_verified is still included. Set to false (or use the equivalent verbose=true) ' +
            'when you need the full record bytes for re-verification or downstream processing.',
        ),
      include_unverified: z
        .boolean()
        .optional()
        .describe(
          'Default false. When false, records with signature_verified=false are dropped from the ' +
            'response (their count is reported in filtered_out_by_verification). Set to true to ' +
            'include them, useful when investigating tampered or partial mirror state.',
        ),
    },
  },
  async (args) => {
    const result = await recall(args as RecallArgs)
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    }
  },
)

const transport = new StdioServerTransport()
await server.connect(transport)
