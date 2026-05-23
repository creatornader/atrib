// SPDX-License-Identifier: Apache-2.0

/**
 * Read-primitive instrumentation (4th-pillar broadening, Surface 6).
 *
 * Each read primitive (atrib-recall family, atrib-trace, atrib-summarize)
 * wraps its handler in `logReadPrimitiveCall(...)`. The call appends one
 * jsonl line per invocation to ~/.atrib/state/read-primitives/calls.jsonl
 * with timing + query shape + sampled result hashes so the unified
 * analyzer (Surface 9) can correlate:
 *
 *   fires.jsonl   (Pre-tool-use surfacings: which records were offered)
 *     ⇄
 *   read-primitives/calls.jsonl (THIS surface: which records were fetched)
 *     ⇄
 *   atrib-emit mirror (which records were signed afterwards, with
 *                      informed_by referencing fetched hashes ↔ loop closure)
 *
 * Silent-failure contract: any write error is swallowed; the read primitive
 * MUST return its result regardless. The skill's §5.8 degradation contract
 * applies (instrumentation never breaks the primary tool path).
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { resolveEnvContextId } from './harness-context.js'

const SAMPLE_HASH_LIMIT = 10

function resolveLogPath(): string {
  // Read at call time so test overrides + per-process env changes take
  // effect without a module reimport.
  return process.env.ATRIB_READ_PRIMITIVES_LOG ?? join(
    homedir(),
    '.atrib',
    'state',
    'read-primitives',
    'calls.jsonl',
  )
}

/** Shape of one jsonl line. Stable wire schema for analyzer consumption. */
export interface ReadPrimitiveCallLogEntry {
  /** ms since epoch when the handler was entered. */
  invoked_at: number
  /** Session/context_id derived via resolveEnvContextId; null if unresolvable. */
  session_id: string | null
  /** Tool name as registered in the MCP server (e.g. "recall_my_attribution_history"). */
  primitive: string
  /**
   * Top-level keys of the input that were set (truthy) by the caller.
   * Captures query shape without leaking values. Sorted lex.
   */
  query_shape: string[]
  /** Total candidate-record count returned. -1 if not extractable. */
  result_count: number
  /** Elapsed wall time in ms from handler entry to instrumentation write. */
  elapsed_ms: number
  /**
   * Up to SAMPLE_HASH_LIMIT record_hash values from the response. The
   * analyzer correlates these against fires.jsonl top_k.record_hash to
   * answer "did surfacing drive reads?" without rebuilding result sets.
   */
  sample_result_hashes: string[]
  /** True if the handler threw / returned an error. */
  errored: boolean
}

/**
 * Wrap a read-primitive handler to log per-call instrumentation.
 *
 * Usage:
 *   server.registerTool('recall_my_attribution_history', { ... },
 *     async (args) => logReadPrimitiveCall(
 *       'recall_my_attribution_history',
 *       args,
 *       async () => handlerImpl(args),
 *       extractRecordHashes,
 *     ),
 *   )
 */
export async function logReadPrimitiveCall<TArgs, TResult>(
  primitive: string,
  args: TArgs,
  handler: () => Promise<TResult>,
  extractHashes: (result: TResult) => string[],
): Promise<TResult> {
  const invoked_at = Date.now()
  let errored = false
  let result: TResult | undefined
  let thrown: unknown
  try {
    result = await handler()
    return result
  } catch (e) {
    errored = true
    thrown = e
    throw e
  } finally {
    try {
      const elapsed_ms = Date.now() - invoked_at
      const query_shape = computeQueryShape(args)
      const sample_result_hashes = errored || !result
        ? []
        : extractHashes(result).slice(0, SAMPLE_HASH_LIMIT)
      const result_count = errored || !result ? -1 : extractHashes(result).length
      const entry: ReadPrimitiveCallLogEntry = {
        invoked_at,
        session_id: resolveEnvContextId() ?? null,
        primitive,
        query_shape,
        result_count,
        elapsed_ms,
        sample_result_hashes,
        errored,
      }
      appendJsonlLine(resolveLogPath(), entry)
    } catch {
      // Silent-failure contract: instrumentation MUST NOT affect the
      // primary tool path. Caller's handler result (or thrown error) is
      // already locked in by the outer try/finally. Swallow.
    }
    // Re-throw is implicit: the outer throw above re-runs after finally.
    void thrown
  }
}

/** Extract top-level truthy keys from a record-shaped input object. */
function computeQueryShape(args: unknown): string[] {
  if (args === null || args === undefined) return []
  if (typeof args !== 'object') return []
  const out: string[] = []
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    if (v === undefined || v === null) continue
    if (typeof v === 'string' && v.length === 0) continue
    if (Array.isArray(v) && v.length === 0) continue
    if (typeof v === 'object' && Object.keys(v as object).length === 0) continue
    out.push(k)
  }
  return out.sort()
}

/** Append one JSON line + newline. Ensures parent dir exists. */
function appendJsonlLine(path: string, entry: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, JSON.stringify(entry) + '\n', { encoding: 'utf8' })
}

/**
 * Convenience extractor: given an MCP tool response of the standard shape
 * { content: [{ type: 'text', text: '<json>' }] }, parse the text and pull
 * record_hash-like values out via deep traversal.
 *
 * Each read primitive's response shape is different; rather than asking each
 * call site to write a bespoke extractor, this default walks for any string
 * matching sha256:<64-hex> and dedupes. Caller-supplied extractors override
 * when they know a tighter path (e.g. trace's visited[].record_hash).
 */
export function extractRecordHashesFromMcpResult(result: unknown): string[] {
  const seen = new Set<string>()
  const pattern = /sha256:[0-9a-f]{64}/g
  walk(result)
  return Array.from(seen)
  function walk(node: unknown): void {
    if (node === null || node === undefined) return
    if (typeof node === 'string') {
      const matches = node.match(pattern)
      if (matches) for (const m of matches) seen.add(m)
      return
    }
    if (Array.isArray(node)) {
      for (const x of node) walk(x)
      return
    }
    if (typeof node === 'object') {
      for (const v of Object.values(node as object)) walk(v)
    }
  }
}
