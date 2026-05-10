// SPDX-License-Identifier: Apache-2.0

/**
 * OpenInference span → atrib unsigned-record mapping.
 *
 * The OpenInference semantic conventions specify the canonical attribute
 * names this module reads:
 *
 *   - `openinference.span.kind`  -- TOOL / LLM / AGENT / etc.
 *   - `tool.name`, `tool.id`, `tool.parameters`, `tool.json_schema`
 *   - `input.value`, `input.mime_type`, `output.value`, `output.mime_type`
 *   - `session.id`, `user.id`, `agent.name`
 *
 * The LLM message-array attributes (`llm.input_messages.<i>...`,
 * `llm.output_messages.<i>...`) are flattened and not used here for the
 * first pass. A future extension can reconstruct LLM message shape if
 * useful for atrib-substrate fidelity. For now, we focus on TOOL spans
 * which map cleanly to atrib's `tool_call` event_type.
 *
 * AGENT spans carry chain context (`agent.name`, `session.id`) but no
 * tool envelope; they are treated as informational and skipped at this
 * layer. A future extension could emit them as `observation` records
 * when the operator wants agent-boundary visibility on the substrate.
 */

import type { ReadableSpan } from '@opentelemetry/sdk-trace-base'
import { SemanticConventions } from '@arizeai/openinference-semantic-conventions'
import {
  type UnsignedAtribRecord,
  EVENT_TYPE_TOOL_CALL_URI,
  computeContentId,
  genesisChainRoot,
} from '@atrib/mcp'
import {
  getOpenInferenceSpanKind,
  type OpenInferenceSpanKind,
} from './openinference-filter.js'

const TOOL_NAME_ATTR = SemanticConventions.TOOL_NAME
const INPUT_VALUE_ATTR = SemanticConventions.INPUT_VALUE
const OUTPUT_VALUE_ATTR = SemanticConventions.OUTPUT_VALUE
const SESSION_ID_ATTR = SemanticConventions.SESSION_ID
const AGENT_NAME_ATTR = SemanticConventions.AGENT_NAME

export type SpanToRecordContext = {
  /**
   * Base64url Ed25519 public key of the operator. Required because the
   * OpenInference span itself doesn't know which atrib identity will sign
   * it -- the SpanProcessor's caller binds the identity.
   */
  readonly creatorKey: string
  /**
   * MCP server URL used in `content_id` derivation. The OpenInference
   * convention does not carry this; it must be supplied by the caller.
   * Atrib's content_id derivation requires (server_url, tool_name) per
   * the canonical pattern used by @atrib/mcp middleware.
   */
  readonly serverUrl: string
  /**
   * Optional override for the context_id. When omitted, the mapper uses
   * `session.id` from the span if present, otherwise falls back to the
   * trace_id (16-byte hex) which is always present on a ReadableSpan.
   */
  readonly contextId?: string
  /**
   * Optional override for the chain_root. When omitted, the mapper
   * computes a genesis chain_root from the resolved context_id.
   * Production callers should pass a tail-derived chain_root via
   * `resolveChainRoot()` from @atrib/mcp.
   */
  readonly chainRoot?: string
  /**
   * Optional override for the timestamp (ms since epoch). When omitted,
   * the mapper uses the span's start time, converted from
   * [seconds, nanoseconds] hr-time to milliseconds.
   */
  readonly timestamp?: number
}

export type SpanMappingResult =
  | { ok: true; record: UnsignedAtribRecord; kind: OpenInferenceSpanKind }
  | { ok: false; reason: string }

/**
 * Map a single OpenInference-shaped ReadableSpan to an unsigned atrib
 * record. The caller is responsible for signing (via @atrib/mcp's
 * `signRecord`) and submission to the log.
 *
 * Returns `{ ok: false }` when the span is not an OpenInference span,
 * not a TOOL kind, or missing the minimum attribute set required to
 * construct a tool_call record.
 */
export function spanToUnsignedRecord(
  span: ReadableSpan,
  ctx: SpanToRecordContext,
): SpanMappingResult {
  const kind = getOpenInferenceSpanKind(span)
  if (kind === undefined) return { ok: false, reason: 'not an openinference span' }
  if (kind !== 'TOOL') return { ok: false, reason: `kind ${kind} not yet mapped (TOOL only)` }

  const toolName = readStringAttr(span, TOOL_NAME_ATTR)
  if (toolName === undefined || toolName.length === 0) {
    return { ok: false, reason: 'missing tool.name attribute' }
  }

  const sessionAttr = readStringAttr(span, SESSION_ID_ATTR)
  const traceIdHex = span.spanContext().traceId
  const contextId = ctx.contextId ?? sessionAttr ?? traceIdHex
  const chainRoot = ctx.chainRoot ?? genesisChainRoot(contextId)
  const timestamp = ctx.timestamp ?? hrTimeToMs(span.startTime)
  const contentId = computeContentId(ctx.serverUrl, toolName)

  const record: UnsignedAtribRecord = {
    spec_version: 'atrib/1.0',
    content_id: contentId,
    creator_key: ctx.creatorKey,
    chain_root: chainRoot,
    event_type: EVENT_TYPE_TOOL_CALL_URI,
    context_id: contextId,
    timestamp,
  }

  return { ok: true, record, kind }
}

/**
 * Convenience: extract the agent.name attribute when present. Useful for
 * downstream callers that want to correlate atrib records with agent
 * boundaries in multi-agent OpenInference traces.
 */
export function readAgentName(span: ReadableSpan): string | undefined {
  return readStringAttr(span, AGENT_NAME_ATTR)
}

/**
 * Convenience: extract input/output value as string when present. Both
 * attributes can be JSON-encoded payloads, plain text, or absent. Atrib's
 * record format does not carry args/result inline (per §8.1 default
 * privacy posture); these are exposed here for callers that want to use
 * them in sidecar metadata or §8.3 args_hash computation.
 */
export function readIoValues(span: ReadableSpan): {
  input?: string
  output?: string
} {
  const result: { input?: string; output?: string } = {}
  const input = readStringAttr(span, INPUT_VALUE_ATTR)
  if (input !== undefined) result.input = input
  const output = readStringAttr(span, OUTPUT_VALUE_ATTR)
  if (output !== undefined) result.output = output
  return result
}

function readStringAttr(span: ReadableSpan, key: string): string | undefined {
  const value = span.attributes[key]
  return typeof value === 'string' ? value : undefined
}

function hrTimeToMs(hrTime: readonly [number, number]): number {
  const [seconds, nanos] = hrTime
  return seconds * 1000 + Math.floor(nanos / 1_000_000)
}
