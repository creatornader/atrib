// SPDX-License-Identifier: Apache-2.0

/**
 * Tracks `tool_call.id` -> atrib `record_hash` per trace, so that when a
 * TOOL span fires after an LLM span emitted a tool_call with the same id,
 * the TOOL atrib record can carry an `informed_by: [<llm_record_hash>]`
 * edge automatically.
 *
 * The empirical relationship (verified in fixture-replay tests against
 * Vercel AI SDK v6 + NIM Qwen output): the LLM span's
 * `llm.output_messages.<i>.message.tool_calls.<j>.tool_call.id` equals
 * the immediately-following TOOL span's `tool_call.id`.
 *
 * Memory bounds: per-trace map evicts oldest entries past
 * `maxToolCallsPerTrace`; the trace map itself evicts oldest traces past
 * `maxTracedTraceIds`. Both default to safe production values; pure
 * eviction means a TOOL span whose LLM partner was evicted simply won't
 * carry an `informed_by` edge (silent degradation per §5.8).
 */

const DEFAULT_MAX_TRACED_TRACE_IDS = 1024
const DEFAULT_MAX_TOOL_CALLS_PER_TRACE = 256

export type InformedByTrackerOptions = {
  readonly maxTracedTraceIds?: number
  readonly maxToolCallsPerTrace?: number
}

/**
 * Per-trace, per-tool_call_id -> record_hash map. Records emitted by the
 * processor go in here; records that need an `informed_by` edge query
 * here.
 */
export class InformedByTracker {
  private readonly maxTracedTraceIds: number
  private readonly maxToolCallsPerTrace: number

  // Outer map: traceId -> inner map.
  // Inner map: toolCallId -> record_hash (full "sha256:<64hex>" form).
  // Both maps use insertion-order iteration for LRU eviction.
  private readonly traces = new Map<string, Map<string, string>>()

  constructor(opts: InformedByTrackerOptions = {}) {
    this.maxTracedTraceIds = opts.maxTracedTraceIds ?? DEFAULT_MAX_TRACED_TRACE_IDS
    this.maxToolCallsPerTrace =
      opts.maxToolCallsPerTrace ?? DEFAULT_MAX_TOOL_CALLS_PER_TRACE
  }

  /**
   * Register that the LLM record signed for `traceId` carried output
   * tool_call_id `toolCallId`. The record_hash MUST be the full
   * `sha256:<64-hex>` form per spec.
   */
  recordLlmToolCallEmission(
    traceId: string,
    toolCallId: string,
    recordHash: string,
  ): void {
    let inner = this.traces.get(traceId)
    if (inner === undefined) {
      // Evict oldest trace if at capacity.
      if (this.traces.size >= this.maxTracedTraceIds) {
        const oldestKey = this.traces.keys().next().value
        if (oldestKey !== undefined) this.traces.delete(oldestKey)
      }
      inner = new Map()
      this.traces.set(traceId, inner)
    } else {
      // Touch trace's recency by re-inserting (LRU).
      this.traces.delete(traceId)
      this.traces.set(traceId, inner)
    }
    if (inner.size >= this.maxToolCallsPerTrace) {
      const oldestKey = inner.keys().next().value
      if (oldestKey !== undefined) inner.delete(oldestKey)
    }
    inner.set(toolCallId, recordHash)
  }

  /**
   * Look up the LLM record_hash that emitted `toolCallId` within
   * `traceId`. Returns undefined if no LLM record was registered for
   * this pair (e.g., the LLM span was filtered out, the TOOL span fired
   * with no preceding LLM, or the entry was evicted).
   */
  lookup(traceId: string, toolCallId: string): string | undefined {
    const inner = this.traces.get(traceId)
    return inner?.get(toolCallId)
  }

  /**
   * Diagnostic. Returns the count of (traceId, toolCallId) entries
   * tracked. Useful for production observability of the LRU size.
   */
  size(): number {
    let total = 0
    for (const inner of this.traces.values()) total += inner.size
    return total
  }

  /**
   * Reset all tracked entries. Useful for tests.
   */
  clear(): void {
    this.traces.clear()
  }
}
