// SPDX-License-Identifier: Apache-2.0

/**
 * OpenInference span recognition.
 *
 * OpenInference (Arize) defines OpenTelemetry semantic conventions for
 * LLM/agent telemetry. Every span emitted under those conventions carries
 * an `openinference.span.kind` attribute taking one of ten enum values:
 *   LLM, EMBEDDING, CHAIN, RETRIEVER, RERANKER, TOOL, AGENT, GUARDRAIL,
 *   EVALUATOR, PROMPT.
 *
 * This module mirrors the JS reference filter shipped by Arize at
 * `@arizeai/openinference-vercel`: `isOpenInferenceSpan(span)` returns
 * true if the span carries the canonical kind attribute. atrib's
 * SpanProcessor uses this filter to skip non-OpenInference spans cleanly
 * when its tracer provider is shared with non-LLM telemetry.
 */

import type { ReadableSpan } from '@opentelemetry/sdk-trace-base'
import { SemanticConventions } from '@arizeai/openinference-semantic-conventions'

export const OPENINFERENCE_SPAN_KIND_ATTR = SemanticConventions.OPENINFERENCE_SPAN_KIND

export type OpenInferenceSpanKind =
  | 'LLM'
  | 'EMBEDDING'
  | 'CHAIN'
  | 'RETRIEVER'
  | 'RERANKER'
  | 'TOOL'
  | 'AGENT'
  | 'GUARDRAIL'
  | 'EVALUATOR'
  | 'PROMPT'

const KNOWN_KINDS = new Set<OpenInferenceSpanKind>([
  'LLM',
  'EMBEDDING',
  'CHAIN',
  'RETRIEVER',
  'RERANKER',
  'TOOL',
  'AGENT',
  'GUARDRAIL',
  'EVALUATOR',
  'PROMPT',
])

/**
 * Returns the OpenInference span kind if the span carries one, otherwise
 * undefined. Treats unknown attribute values as undefined: callers that
 * want to handle forward-compat kinds should read the raw attribute
 * directly.
 */
export function getOpenInferenceSpanKind(
  span: ReadableSpan,
): OpenInferenceSpanKind | undefined {
  const value = span.attributes[OPENINFERENCE_SPAN_KIND_ATTR]
  if (typeof value !== 'string') return undefined
  return KNOWN_KINDS.has(value as OpenInferenceSpanKind)
    ? (value as OpenInferenceSpanKind)
    : undefined
}

/**
 * Mirrors `@arizeai/openinference-vercel`'s `isOpenInferenceSpan`.
 * Returns true only for spans that carry a recognized
 * `openinference.span.kind` attribute. Useful as the first filter in a
 * shared-tracer-provider pipeline.
 */
export function isOpenInferenceSpan(span: ReadableSpan): boolean {
  return getOpenInferenceSpanKind(span) !== undefined
}
