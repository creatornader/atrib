// SPDX-License-Identifier: Apache-2.0

/**
 * OpenInference span → atrib unsigned-record mapping.
 *
 * Maps all ten OpenInference span kinds to atrib records:
 *
 *   - **TOOL** -> `tool_call` event_type. Tool name drives content_id.
 *   - **LLM** / **AGENT** / **EMBEDDING** / **RETRIEVER** / **RERANKER** /
 *     **CHAIN** / **GUARDRAIL** / **EVALUATOR** / **PROMPT** ->
 *     `observation` event_type. Kind-specific model or span names drive
 *     content_id.
 *
 * Canonical attribute keys imported from `@arizeai/openinference-semantic-
 * conventions` so schema upgrades in upstream package flow through
 * automatically.
 *
 * Empirical fixtures captured from a real Vercel AI SDK v6 + NIM Qwen run
 * live in `test/fixtures/`. The fixture-replay test asserts each canonical
 * span shape replays to its documented mapping; if Vercel AI SDK or
 * `@arizeai/openinference-vercel` changes attribute keys upstream, that
 * test fails before consumers are affected.
 */

import type { ReadableSpan } from '@opentelemetry/sdk-trace-base'
import { SemanticConventions } from '@arizeai/openinference-semantic-conventions'
import {
  type UnsignedAtribRecord,
  EVENT_TYPE_TOOL_CALL_URI,
  EVENT_TYPE_OBSERVATION_URI,
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
const LLM_MODEL_NAME_ATTR = SemanticConventions.LLM_MODEL_NAME
const EMBEDDING_MODEL_NAME_ATTR = 'embedding.model_name'
const RERANKER_MODEL_NAME_ATTR = 'reranker.model_name'
const RETRIEVAL_MODEL_NAME_ATTR = 'retrieval.model_name'

/** Attribute key for the LLM-output tool_call id, when the model returns a tool_call. */
const LLM_OUTPUT_TOOL_CALL_ID_ATTR =
  'llm.output_messages.0.message.tool_calls.0.tool_call.id'

/** Attribute key for a TOOL span's own tool_call id (matches the LLM emission). */
const TOOL_CALL_ID_ATTR = 'tool_call.id'

export type SpanToRecordContext = {
  /**
   * Base64url Ed25519 public key of the operator. Required because the
   * OpenInference span itself doesn't know which atrib identity will sign
   * it -- the SpanProcessor's caller binds the identity.
   */
  readonly creatorKey: string
  /**
   * Server URL used in `content_id` derivation. The OpenInference
   * convention does not carry this; it must be supplied by the caller.
   * For TOOL spans the content_id is derived from `(serverUrl, tool.name)`;
   * for LLM spans from `(serverUrl, "llm:" + model_name)`; for AGENT spans
   * from `(serverUrl, "agent:" + agent_name)`. The leaf prefix keeps the
   * three namespaces distinct on a single operator's server URL.
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
 * Returns `{ ok: false }` for non-OpenInference spans, unrecognized kinds,
 * and recognized spans missing the minimum attribute set for their mapper.
 */
export function spanToUnsignedRecord(
  span: ReadableSpan,
  ctx: SpanToRecordContext,
): SpanMappingResult {
  const kind = getOpenInferenceSpanKind(span)
  if (kind === undefined) return { ok: false, reason: 'not an openinference span' }

  switch (kind) {
    case 'TOOL':
      return mapToolSpan(span, ctx, kind)
    case 'LLM':
      return mapLlmSpan(span, ctx, kind)
    case 'AGENT':
      return mapAgentSpan(span, ctx, kind)
    case 'EMBEDDING':
      return mapModelKindSpan(span, ctx, kind, 'embedding', EMBEDDING_MODEL_NAME_ATTR)
    case 'RETRIEVER':
      return mapModelKindSpan(span, ctx, kind, 'retriever', RETRIEVAL_MODEL_NAME_ATTR)
    case 'RERANKER':
      return mapModelKindSpan(span, ctx, kind, 'reranker', RERANKER_MODEL_NAME_ATTR)
    case 'CHAIN':
      return mapNamedKindSpan(span, ctx, kind, 'chain')
    case 'GUARDRAIL':
      return mapNamedKindSpan(span, ctx, kind, 'guardrail')
    case 'EVALUATOR':
      return mapNamedKindSpan(span, ctx, kind, 'evaluator')
    case 'PROMPT':
      return mapNamedKindSpan(span, ctx, kind, 'prompt')
    default:
      return {
        ok: false,
        reason: `kind ${kind as string} not recognized`,
      }
  }
}

/**
 * Generic mapper for kinds that namespace by model name (EMBEDDING /
 * RETRIEVER / RERANKER). Falls back to span.name when no model name
 * attribute is present.
 */
function mapModelKindSpan(
  span: ReadableSpan,
  ctx: SpanToRecordContext,
  kind: 'EMBEDDING' | 'RETRIEVER' | 'RERANKER',
  prefix: string,
  modelAttrKey: string,
): SpanMappingResult {
  const modelName = readStringAttr(span, modelAttrKey) ?? span.name
  if (modelName === undefined || modelName.length === 0) {
    return { ok: false, reason: `${kind} span has no ${modelAttrKey} and no span.name` }
  }
  const record = buildRecord(span, ctx, {
    contentLeaf: `${prefix}:${modelName}`,
    eventType: EVENT_TYPE_OBSERVATION_URI,
  })
  return { ok: true, record, kind }
}

/**
 * Generic mapper for kinds that namespace by span name only (CHAIN /
 * GUARDRAIL / EVALUATOR / PROMPT). These OpenInference kinds don't
 * carry a stable model_name attribute; the span's own name is the
 * natural namespace leaf.
 */
function mapNamedKindSpan(
  span: ReadableSpan,
  ctx: SpanToRecordContext,
  kind: 'CHAIN' | 'GUARDRAIL' | 'EVALUATOR' | 'PROMPT',
  prefix: string,
): SpanMappingResult {
  const name = span.name
  if (name === undefined || name.length === 0) {
    return { ok: false, reason: `${kind} span has no span.name` }
  }
  const record = buildRecord(span, ctx, {
    contentLeaf: `${prefix}:${name}`,
    eventType: EVENT_TYPE_OBSERVATION_URI,
  })
  return { ok: true, record, kind }
}

function mapToolSpan(
  span: ReadableSpan,
  ctx: SpanToRecordContext,
  kind: 'TOOL',
): SpanMappingResult {
  const toolName = readStringAttr(span, TOOL_NAME_ATTR)
  if (toolName === undefined || toolName.length === 0) {
    return { ok: false, reason: 'missing tool.name attribute on TOOL span' }
  }
  const record = buildRecord(span, ctx, {
    contentLeaf: toolName,
    eventType: EVENT_TYPE_TOOL_CALL_URI,
  })
  return { ok: true, record, kind }
}

function mapLlmSpan(
  span: ReadableSpan,
  ctx: SpanToRecordContext,
  kind: 'LLM',
): SpanMappingResult {
  const modelName = readStringAttr(span, LLM_MODEL_NAME_ATTR)
  if (modelName === undefined || modelName.length === 0) {
    return { ok: false, reason: 'missing llm.model_name attribute on LLM span' }
  }
  const record = buildRecord(span, ctx, {
    contentLeaf: `llm:${modelName}`,
    eventType: EVENT_TYPE_OBSERVATION_URI,
  })
  return { ok: true, record, kind }
}

function mapAgentSpan(
  span: ReadableSpan,
  ctx: SpanToRecordContext,
  kind: 'AGENT',
): SpanMappingResult {
  // AGENT spans don't always carry agent.name (Vercel AI SDK v6 omits it
  // by default). Fall back to the span's own name as the namespace leaf.
  const agentName = readStringAttr(span, AGENT_NAME_ATTR) ?? span.name
  if (agentName === undefined || agentName.length === 0) {
    return { ok: false, reason: 'AGENT span has no agent.name and no span.name' }
  }
  const record = buildRecord(span, ctx, {
    contentLeaf: `agent:${agentName}`,
    eventType: EVENT_TYPE_OBSERVATION_URI,
  })
  return { ok: true, record, kind }
}

function buildRecord(
  span: ReadableSpan,
  ctx: SpanToRecordContext,
  what: { contentLeaf: string; eventType: string },
): UnsignedAtribRecord {
  const sessionAttr = readStringAttr(span, SESSION_ID_ATTR)
  const traceIdHex = span.spanContext().traceId
  const contextId = ctx.contextId ?? sessionAttr ?? traceIdHex
  const chainRoot = ctx.chainRoot ?? genesisChainRoot(contextId)
  const timestamp = ctx.timestamp ?? hrTimeToMs(span.startTime)
  const contentId = computeContentId(ctx.serverUrl, what.contentLeaf)
  return {
    spec_version: 'atrib/1.0',
    content_id: contentId,
    creator_key: ctx.creatorKey,
    chain_root: chainRoot,
    event_type: what.eventType,
    context_id: contextId,
    timestamp,
  }
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
 * Convenience: extract the LLM-output tool_call id when present. Empirical
 * source for cross-span `informed_by` derivation: a TOOL span's
 * `tool_call.id` matches the LLM span's
 * `llm.output_messages.<i>.message.tool_calls.<j>.tool_call.id` (verified
 * against captured Vercel AI SDK v6 fixtures).
 */
export function readLlmOutputToolCallId(span: ReadableSpan): string | undefined {
  return readStringAttr(span, LLM_OUTPUT_TOOL_CALL_ID_ATTR)
}

/**
 * Convenience: extract a TOOL span's own `tool_call.id`. The matching
 * LLM span's `llm.output_messages.<i>.message.tool_calls.<j>.tool_call.id`
 * carries the same value -- the basis for auto `informed_by` derivation.
 */
export function readToolCallId(span: ReadableSpan): string | undefined {
  return readStringAttr(span, TOOL_CALL_ID_ATTR)
}

/**
 * Convenience: extract input/output value as string when present. Both
 * attributes can be JSON-encoded payloads, plain text, or absent. atrib's
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
