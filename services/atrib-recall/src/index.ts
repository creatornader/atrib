#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

/**
 * @atrib/recall, recall_my_attribution_history MCP server.
 *
 * Exposes a single tool to the host agent: recall_my_attribution_history.
 * The tool reads the local signed-record jsonl mirror that an @atrib/mcp-wrap
 * wrapper persists (~/.atrib/records/<wrapper-name>-<agent>.jsonl per spec §5.9
 * D062), VERIFIES the Ed25519 signature on each record before returning it,
 * and tags every entry with signature_verified so the agent can distinguish
 * provable past from tampered or partial mirror state.
 *
 * Trust scope: signature verification is local-only. A passing signature_verified
 * proves the record was signed by the named creator_key; it does NOT prove the
 * record was committed to log.atrib.dev. To confirm log inclusion, the caller
 * should fetch the inclusion proof from the log API.
 *
 * Configuration via environment variables:
 *   ATRIB_RECORD_FILE, path to the jsonl mirror.
 *                        Default: ~/.atrib/records/mcp-wrap-claude-code.jsonl
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
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'

const ATRIB_RECORD_FILE = process.env.ATRIB_RECORD_FILE ?? join(
  homedir(),
  '.atrib',
  'records',
  'mcp-wrap-claude-code.jsonl',
)
const ATRIB_LOG_ORIGIN = process.env.ATRIB_LOG_ORIGIN ?? 'log.atrib.dev'

export function loadRecords(path: string): AtribRecord[] {
  if (!existsSync(path)) return []
  const out: AtribRecord[] = []
  const raw = readFileSync(path, 'utf8')
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as AtribRecord
      // Light shape check: require the load-bearing fields. Anything missing
      // these is malformed jsonl from an older wrapper version; skip silently.
      if (
        parsed.spec_version &&
        parsed.event_type &&
        parsed.context_id &&
        parsed.creator_key &&
        parsed.chain_root &&
        parsed.signature
      ) {
        out.push(parsed)
      }
    } catch {
      // Malformed line; skip.
    }
  }
  return out
}

interface RecallArgs {
  context_id?: string
  event_type?: 'tool_call' | 'transaction'
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

export async function recall(
  args: RecallArgs,
  recordFile: string = ATRIB_RECORD_FILE,
): Promise<RecallResult> {
  // Defaults: compact=true (small responses) and include_unverified=false
  // (no tampered records). The verbose+include-tampered combo is opt-in.
  // Rationale: a poorly-written agent that doesn't check signature_verified
  // would otherwise treat tampered records as provable. Default to safe.
  const compact = args.compact !== false
  const includeUnverified = args.include_unverified === true

  const all = loadRecords(recordFile)
  let filtered = all
  if (args.context_id) filtered = filtered.filter((r) => r.context_id === args.context_id)
  if (args.event_type) {
    // Schema accepts short form ('tool_call'|'transaction'); records carry
    // the URI form. Normalize before comparison; pass URIs through as-is so
    // a forward-compatible caller passing the URI directly still matches.
    const targetUri = EVENT_TYPE_SHORT_TO_URI[args.event_type] ?? args.event_type
    filtered = filtered.filter((r) => r.event_type === targetUri)
  }

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
    record_file: recordFile,
    log_origin: ATRIB_LOG_ORIGIN,
    pagination_caveat:
      'offset is not stable when new records are appended. For consistent paging, capture the' +
      ' first-page timestamps and re-page using a context_id or event_type filter instead.',
    records,
  }
}

const server = new McpServer({
  name: 'atrib-recall',
  version: '0.3.0',
})

server.registerTool(
  'recall_my_attribution_history',
  {
    description:
      "Return signed atrib records from the local mirror, the agent's own past, with each record's " +
      'Ed25519 signature verified locally. By default the response is compact (no signature bytes) and ' +
      'includes only records that passed signature verification, both can be opted out of with ' +
      'compact=false and include_unverified=true respectively. Local signature verification proves ' +
      '"this record was signed by that creator_key"; it does NOT prove log inclusion (fetch a log ' +
      'inclusion proof to confirm). Filter by context_id (specific trace) or event_type ' +
      '(tool_call|transaction); omit filters for cross-trace history. Results are sorted newest-first. ' +
      'Pagination uses offset; new records appended between calls invalidate offset stability, see ' +
      'the pagination_caveat in the response. The filtered_out_by_verification field reports how many ' +
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
