// SPDX-License-Identifier: Apache-2.0

import { EVENT_TYPE_TOOL_CALL_URI, EVENT_TYPE_OBSERVATION_URI } from './types.js'

/**
 * Local mirror sidecar helpers.
 *
 * D062 envelope producers should write semantic payloads under
 * `_local.content`. Older producers and some direct integration callbacks
 * instead wrote sibling fields such as `_local.toolName`, `_local.args`,
 * `_local.result`, `_local.input`, and `_local.output`. Those fields are
 * still local-only evidence, so recall, trace, and summarize should not
 * drop them just because the producer used the older shape.
 */

export type LocalSidecarLike = object

export function isLocalSidecarLike(value: unknown): value is LocalSidecarLike {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Return the recall-readable content payload for a local sidecar.
 *
 * If `_local.content` exists, it wins. If not, derive the equivalent
 * content shape from known legacy fields. The returned value is still
 * local-only data. It is never part of the signed AtribRecord bytes.
 */
export function deriveLocalContentFromSidecar(
  eventTypeUri: string,
  local: unknown,
): unknown | undefined {
  if (!isLocalSidecarLike(local)) return undefined
  const obj = local as Record<string, unknown>
  if ('content' in obj) return obj.content

  if (eventTypeUri === EVENT_TYPE_TOOL_CALL_URI) {
    const tool = deriveToolCallContent(obj)
    if (tool !== undefined) return tool
  }

  const openInference = deriveOpenInferenceContent(eventTypeUri, obj)
  if (openInference !== undefined) return openInference

  return undefined
}

/**
 * Clone a local sidecar and populate `content` when it can be derived.
 * Consumers that need the full sidecar keep the original fields; consumers
 * that only know D062 `_local.content` get a stable shape.
 */
export function withDerivedLocalContent<T extends object>(
  eventTypeUri: string,
  local: T,
): T & { content?: unknown } {
  if ('content' in local) return local as T & { content?: unknown }
  const content = deriveLocalContentFromSidecar(eventTypeUri, local)
  if (content === undefined) return local as T & { content?: unknown }
  return { ...local, content }
}

function deriveToolCallContent(
  local: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {}
  const toolName = firstString(local.tool_name, local.toolName)
  if (toolName !== undefined) out.tool_name = toolName
  copyIfPresent(out, 'args', local.args ?? local.input ?? local.arguments)
  copyIfPresent(out, 'result', local.result ?? local.output ?? local.response)
  copyIfPresent(out, 'authorization_evidence', local.authorizationEvidence)
  copyIfPresent(out, 'resolved_facts', local.resolvedFacts)
  copyOpenInferenceIdentity(out, local)
  return Object.keys(out).length > 0 ? out : undefined
}

function deriveOpenInferenceContent(
  eventTypeUri: string,
  local: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const traceId = firstString(local.trace_id, local.traceId)
  const spanId = firstString(local.span_id, local.spanId)
  const spanKind = firstString(local.span_kind, local.spanKind)
  const spanName = firstString(local.span_name, local.spanName)
  const hasOpenInferenceShape =
    traceId !== undefined ||
    spanId !== undefined ||
    spanKind !== undefined ||
    spanName !== undefined ||
    'input' in local ||
    'output' in local ||
    'agentName' in local ||
    'llmOutputToolCallId' in local

  if (!hasOpenInferenceShape) return undefined

  const out: Record<string, unknown> = { source: 'openinference' }
  if (spanKind !== undefined) {
    out.span_kind = spanKind
    out.topics = ['openinference', spanKind.toLowerCase()]
  } else {
    out.topics = ['openinference']
  }
  if (spanName !== undefined) out.span_name = spanName
  if (traceId !== undefined) out.trace_id = traceId
  if (spanId !== undefined) out.span_id = spanId
  copyIfPresent(out, 'input', local.input)
  copyIfPresent(out, 'output', local.output)
  setString(out, 'agent_name', firstString(local.agent_name, local.agentName))
  setString(out, 'model_name', firstString(local.model_name, local.modelName))
  setString(
    out,
    'llm_output_tool_call_id',
    firstString(local.llm_output_tool_call_id, local.llmOutputToolCallId),
  )
  if (eventTypeUri === EVENT_TYPE_OBSERVATION_URI && spanKind !== undefined) {
    const label =
      spanName !== undefined
        ? `${spanKind.toLowerCase()} span: ${spanName}`
        : `${spanKind.toLowerCase()} span`
    out.what = `OpenInference ${label}`
  }
  return Object.keys(out).length > 1 ? out : undefined
}

function copyOpenInferenceIdentity(
  out: Record<string, unknown>,
  local: Record<string, unknown>,
): void {
  setString(out, 'source', firstString(local.source))
  setString(out, 'span_kind', firstString(local.span_kind, local.spanKind))
  setString(out, 'span_name', firstString(local.span_name, local.spanName))
  setString(out, 'trace_id', firstString(local.trace_id, local.traceId))
  setString(out, 'span_id', firstString(local.span_id, local.spanId))
}

function copyIfPresent(out: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined) out[key] = value
}

function setString(out: Record<string, unknown>, key: string, value: string | undefined): void {
  if (value !== undefined) out[key] = value
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}
