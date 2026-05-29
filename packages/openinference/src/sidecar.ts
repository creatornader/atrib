// SPDX-License-Identifier: Apache-2.0

import type { ReadableSpan } from '@opentelemetry/sdk-trace-base'
import { SemanticConventions } from '@arizeai/openinference-semantic-conventions'
import type { OpenInferenceSpanKind } from './openinference-filter.js'

const INPUT_VALUE_ATTR = SemanticConventions.INPUT_VALUE
const OUTPUT_VALUE_ATTR = SemanticConventions.OUTPUT_VALUE
const INPUT_MIME_TYPE_ATTR = SemanticConventions.INPUT_MIME_TYPE
const OUTPUT_MIME_TYPE_ATTR = SemanticConventions.OUTPUT_MIME_TYPE
const TOOL_NAME_ATTR = SemanticConventions.TOOL_NAME
const AGENT_NAME_ATTR = SemanticConventions.AGENT_NAME
const LLM_MODEL_NAME_ATTR = SemanticConventions.LLM_MODEL_NAME
const LLM_INPUT_MESSAGES_ATTR = SemanticConventions.LLM_INPUT_MESSAGES
const LLM_PROMPTS_ATTR = SemanticConventions.LLM_PROMPTS
const LLM_INVOCATION_PARAMETERS_ATTR = SemanticConventions.LLM_INVOCATION_PARAMETERS
const PROMPT_TEMPLATE_ATTR = SemanticConventions.PROMPT_TEMPLATE_TEMPLATE
const PROMPT_TEMPLATE_VARIABLES_ATTR = SemanticConventions.PROMPT_TEMPLATE_VARIABLES
const PROMPT_TEMPLATE_VERSION_ATTR = SemanticConventions.PROMPT_TEMPLATE_VERSION
const PROMPT_ID_ATTR = SemanticConventions.PROMPT_ID
const PROMPT_URL_ATTR = SemanticConventions.PROMPT_URL
const METADATA_ATTR = SemanticConventions.METADATA
const DOCUMENT_SCORE_ATTR = SemanticConventions.DOCUMENT_SCORE
const EMBEDDING_MODEL_NAME_ATTR = 'embedding.model_name'
const RERANKER_MODEL_NAME_ATTR = 'reranker.model_name'
const RETRIEVAL_MODEL_NAME_ATTR = 'retrieval.model_name'
const TOOL_CALL_ID_ATTR = 'tool_call.id'
const LLM_OUTPUT_TOOL_CALL_ID_ATTR =
  'llm.output_messages.0.message.tool_calls.0.tool_call.id'

/**
 * Local-only content payload for the D062 `_local.content` sidecar when
 * @atrib/openinference consumes OpenInference spans. These fields are not
 * part of the signed AtribRecord. The signed record may commit to `input`
 * and `output` through args_hash / result_hash when the caller enables an
 * argsResultHashPosture.
 */
export interface OpenInferenceSidecarContent {
  source: 'openinference'
  span_kind: OpenInferenceSpanKind
  span_name: string
  trace_id: string
  span_id: string
  what?: string
  why_noted?: string
  topics?: string[]
  tool_name?: string
  args?: string
  result?: string
  input?: string
  output?: string
  input_mime_type?: string
  output_mime_type?: string
  agent_name?: string
  model_name?: string
  tool_call_id?: string
  llm_output_tool_call_id?: string
  invocation_parameters?: string
  prompt?: string
  prompt_messages?: string
  prompt_tools?: string
  prompt_tool_choice?: string
  prompt_template?: string
  prompt_template_variables?: string
  prompt_version?: string
  prompt_id?: string
  prompt_url?: string
  usage_details?: Record<string, number>
  cost_details?: Record<string, number>
  score_details?: Record<string, number>
  metadata?: Record<string, string | number | boolean>
}

export type AtribSpanSidecar = {
  /**
   * Span attributes the caller may want to capture in the local mirror
   * but not in the public record. The atrib spec §1.2 record format does
   * not carry args/result inline.
   */
  readonly input?: string
  readonly output?: string
  readonly agentName?: string
  /**
   * For LLM spans whose output is a tool call, the tool_call.id from
   * `llm.output_messages.<i>.message.tool_calls.<j>.tool_call.id`.
   * Matches the corresponding TOOL span's `tool_call.id`, the empirical
   * seed for processor-level `informed_by` derivation between LLM and TOOL
   * atrib records.
   */
  readonly llmOutputToolCallId?: string
  readonly traceId: string
  readonly spanId: string
  readonly spanKind: OpenInferenceSpanKind
  readonly spanName: string
  readonly content: OpenInferenceSidecarContent
}

export function buildAtribSpanSidecar(
  span: ReadableSpan,
  kind: OpenInferenceSpanKind,
): AtribSpanSidecar {
  const traceId = span.spanContext().traceId
  const spanId = span.spanContext().spanId
  const input = readStringAttr(span, INPUT_VALUE_ATTR)
  const output = readStringAttr(span, OUTPUT_VALUE_ATTR)
  const agentName = readStringAttr(span, AGENT_NAME_ATTR)
  const toolName = readStringAttr(span, TOOL_NAME_ATTR)
  const toolCallId = readStringAttr(span, TOOL_CALL_ID_ATTR)
  const llmOutputToolCallId = readStringAttr(span, LLM_OUTPUT_TOOL_CALL_ID_ATTR)
  const modelName = readModelName(span, kind)
  const usageDetails = readUsageDetails(span)
  const costDetails = readCostDetails(span)
  const scoreDetails = readScoreDetails(span)
  const metadata = readMetadata(span)

  const content: OpenInferenceSidecarContent = {
    source: 'openinference',
    span_kind: kind,
    span_name: span.name,
    trace_id: traceId,
    span_id: spanId,
    why_noted: 'OpenInference span captured as local-only atrib sidecar content.',
    topics: ['openinference', kind.toLowerCase()],
  }

  const what = describeSpan(kind, span.name, toolName, modelName, agentName)
  if (what !== undefined) content.what = what
  if (toolName !== undefined) content.tool_name = toolName
  if (input !== undefined) {
    content.input = input
    if (kind === 'TOOL') content.args = input
  }
  if (output !== undefined) {
    content.output = output
    if (kind === 'TOOL') content.result = output
  }
  setString(content, 'input_mime_type', readStringAttr(span, INPUT_MIME_TYPE_ATTR))
  setString(content, 'output_mime_type', readStringAttr(span, OUTPUT_MIME_TYPE_ATTR))
  setString(content, 'agent_name', agentName)
  setString(content, 'model_name', modelName)
  setString(content, 'tool_call_id', toolCallId)
  setString(content, 'llm_output_tool_call_id', llmOutputToolCallId)
  setString(content, 'invocation_parameters', readStringAttr(span, LLM_INVOCATION_PARAMETERS_ATTR))
  setString(content, 'prompt', readFirstStringAttr(span, [LLM_PROMPTS_ATTR, 'ai.prompt', 'prompt']))
  setString(content, 'prompt_messages', readFirstStringAttr(span, [LLM_INPUT_MESSAGES_ATTR, 'ai.prompt.messages']))
  setString(content, 'prompt_tools', readFirstStringAttr(span, ['ai.prompt.tools']))
  setString(content, 'prompt_tool_choice', readFirstStringAttr(span, ['ai.prompt.toolChoice']))
  setString(content, 'prompt_template', readStringAttr(span, PROMPT_TEMPLATE_ATTR))
  setString(content, 'prompt_template_variables', readStringAttr(span, PROMPT_TEMPLATE_VARIABLES_ATTR))
  setString(
    content,
    'prompt_version',
    readFirstStringAttr(span, [
      PROMPT_TEMPLATE_VERSION_ATTR,
      'prompt_version',
      'ai.prompt.version',
      'langfuse.prompt.version',
    ]),
  )
  setString(content, 'prompt_id', readStringAttr(span, PROMPT_ID_ATTR))
  setString(content, 'prompt_url', readStringAttr(span, PROMPT_URL_ATTR))
  if (usageDetails !== undefined) content.usage_details = usageDetails
  if (costDetails !== undefined) content.cost_details = costDetails
  if (scoreDetails !== undefined) content.score_details = scoreDetails
  if (metadata !== undefined) content.metadata = metadata

  return {
    ...(input !== undefined ? { input } : {}),
    ...(output !== undefined ? { output } : {}),
    ...(agentName !== undefined ? { agentName } : {}),
    ...(llmOutputToolCallId !== undefined ? { llmOutputToolCallId } : {}),
    traceId,
    spanId,
    spanKind: kind,
    spanName: span.name,
    content,
  }
}

function describeSpan(
  kind: OpenInferenceSpanKind,
  spanName: string,
  toolName: string | undefined,
  modelName: string | undefined,
  agentName: string | undefined,
): string | undefined {
  switch (kind) {
    case 'TOOL':
      return `OpenInference tool span: ${toolName ?? spanName}`
    case 'LLM':
      return `OpenInference LLM span: ${modelName ?? spanName}`
    case 'AGENT':
      return `OpenInference agent span: ${agentName ?? spanName}`
    case 'EMBEDDING':
    case 'RETRIEVER':
    case 'RERANKER':
      return `OpenInference ${kind.toLowerCase()} span: ${modelName ?? spanName}`
    case 'CHAIN':
    case 'GUARDRAIL':
    case 'EVALUATOR':
    case 'PROMPT':
      return `OpenInference ${kind.toLowerCase()} span: ${spanName}`
  }
}

function readModelName(span: ReadableSpan, kind: OpenInferenceSpanKind): string | undefined {
  switch (kind) {
    case 'LLM':
      return readStringAttr(span, LLM_MODEL_NAME_ATTR)
    case 'EMBEDDING':
      return readStringAttr(span, EMBEDDING_MODEL_NAME_ATTR)
    case 'RETRIEVER':
      return readStringAttr(span, RETRIEVAL_MODEL_NAME_ATTR)
    case 'RERANKER':
      return readStringAttr(span, RERANKER_MODEL_NAME_ATTR)
    case 'AGENT':
    case 'TOOL':
    case 'CHAIN':
    case 'GUARDRAIL':
    case 'EVALUATOR':
    case 'PROMPT':
      return readStringAttr(span, LLM_MODEL_NAME_ATTR)
  }
}

function readUsageDetails(span: ReadableSpan): Record<string, number> | undefined {
  const out: Record<string, number> = {}
  setNumber(out, 'input', readFirstNumberAttr(span, [
    'gen_ai.usage.input_tokens',
    'llm.token_count.prompt',
    'ai.usage.inputTokens',
  ]))
  setNumber(out, 'output', readFirstNumberAttr(span, [
    'gen_ai.usage.output_tokens',
    'llm.token_count.completion',
    'ai.usage.outputTokens',
  ]))
  setNumber(out, 'total', readFirstNumberAttr(span, [
    'llm.token_count.total',
    'ai.usage.totalTokens',
  ]))
  setNumber(out, 'cached_input', readFirstNumberAttr(span, [
    'ai.usage.cachedInputTokens',
    'ai.usage.inputTokenDetails.cacheReadTokens',
  ]))
  setNumber(out, 'reasoning', readFirstNumberAttr(span, [
    'ai.usage.reasoningTokens',
    'ai.usage.outputTokenDetails.reasoningTokens',
  ]))
  return Object.keys(out).length > 0 ? out : undefined
}

function readCostDetails(span: ReadableSpan): Record<string, number> | undefined {
  const out: Record<string, number> = {}
  setNumber(out, 'input', readFirstNumberAttr(span, [
    'llm.cost.prompt',
    'llm.cost.prompt_details.input',
    'cost.input',
    'cost.input_usd',
    'ai.cost.input',
  ]))
  setNumber(out, 'output', readFirstNumberAttr(span, [
    'llm.cost.completion',
    'llm.cost.completion_details.output',
    'cost.output',
    'cost.output_usd',
    'ai.cost.output',
  ]))
  setNumber(out, 'total', readFirstNumberAttr(span, [
    'llm.cost.total',
    'cost.total',
    'cost.total_usd',
    'ai.cost.total',
  ]))
  return Object.keys(out).length > 0 ? out : undefined
}

function readScoreDetails(span: ReadableSpan): Record<string, number> | undefined {
  const out: Record<string, number> = {}
  setNumber(out, 'score', readFirstNumberAttr(span, [
    'score',
    'eval.score',
    'evaluator.score',
    'evaluation.score',
    'langfuse.score',
  ]))
  setNumber(out, 'document', readFirstNumberAttr(span, [DOCUMENT_SCORE_ATTR]))
  return Object.keys(out).length > 0 ? out : undefined
}

function readMetadata(span: ReadableSpan): Record<string, string | number | boolean> | undefined {
  const out: Record<string, string | number | boolean> = {}
  const parsed = readJsonObjectAttr(span, METADATA_ATTR)
  if (parsed !== undefined) {
    for (const [key, value] of Object.entries(parsed)) {
      if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        out[key] = value
      }
    }
  }
  const pairs: Array<[string, string[]]> = [
    ['operation_name', ['operation.name']],
    ['resource_name', ['resource.name']],
    ['provider', ['ai.model.provider', 'gen_ai.system']],
    ['response_id', ['gen_ai.response.id', 'ai.response.id']],
    ['response_model', ['gen_ai.response.model', 'ai.response.model']],
    ['finish_reason', ['ai.response.finishReason', 'gen_ai.response.finish_reasons']],
    ['telemetry_function_id', ['ai.telemetry.functionId']],
    ['operation_id', ['ai.operationId']],
    ['user_id', ['user.id', 'enduser.id', 'langfuse.user.id']],
    ['session_id', ['session.id', 'langfuse.session.id']],
    ['release', ['deployment.environment', 'service.version', 'langfuse.release']],
  ]
  for (const [name, keys] of pairs) {
    const value = readFirstScalarAttr(span, keys)
    if (value !== undefined) out[name] = value
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function setString(
  target: object,
  key: string,
  value: string | undefined,
): void {
  if (value !== undefined) (target as Record<string, unknown>)[key] = value
}

function setNumber(
  target: Record<string, number>,
  key: string,
  value: number | undefined,
): void {
  if (value !== undefined) target[key] = value
}

function readFirstStringAttr(span: ReadableSpan, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = readStringAttr(span, key)
    if (value !== undefined) return value
  }
  return undefined
}

function readFirstNumberAttr(span: ReadableSpan, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = span.attributes[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return undefined
}

function readFirstScalarAttr(
  span: ReadableSpan,
  keys: readonly string[],
): string | number | boolean | undefined {
  for (const key of keys) {
    const value = span.attributes[key]
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return value
    }
  }
  return undefined
}

function readJsonObjectAttr(
  span: ReadableSpan,
  key: string,
): Record<string, unknown> | undefined {
  const value = span.attributes[key]
  if (typeof value !== 'string' || value.length === 0) return undefined
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

function readStringAttr(span: ReadableSpan, key: string): string | undefined {
  const value = span.attributes[key]
  return typeof value === 'string' ? value : undefined
}
