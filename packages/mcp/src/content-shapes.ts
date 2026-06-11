// SPDX-License-Identifier: Apache-2.0

/**
 * Normative content shapes for indexable-text extraction.
 *
 * Per spec §1.2, AtribRecord carries structural metadata only — the actual
 * content body lives in the local mirror's D062 sidecar at `_local.content`.
 * The shape of that content varies per event_type and is dictated by:
 *
 *   - EmitInput (services/atrib-emit) for observation/annotation/revision
 *   - @atrib/mcp wrapper for tool_call
 *   - Payment-protocol adapters (future @atrib/x402, @atrib/acp) for transaction
 *   - Directory operators for directory_anchor
 *
 * This module codifies the shape contract once so producers and consumers
 * round-trip via the same definition. Prior to this module, each consumer
 * that wanted to read sidecar content reimplemented per-event_type parsing
 * (services/atrib-recall/src/legibility.ts switched on event_type for
 * display synthesis; services/atrib-recall/src/index.ts indexed only
 * annotation summaries for BM25 search). Both are migrated to consume this
 * module's `extractIndexableText`.
 *
 * Each `extract*` function returns a flat string suitable for tokenization
 * (BM25, embeddings, full-text search) or for display synthesis. Returns
 * empty string when the content is missing/malformed (silent failure per
 * §5.8 degradation).
 */

import {
  EVENT_TYPE_TOOL_CALL_URI,
  EVENT_TYPE_TRANSACTION_URI,
  EVENT_TYPE_OBSERVATION_URI,
  EVENT_TYPE_DIRECTORY_ANCHOR_URI,
  EVENT_TYPE_ANNOTATION_URI,
  EVENT_TYPE_REVISION_URI,
} from './types.js'

/**
 * Default per-field character cap when serializing content text. Bounds
 * the contribution of any single content field so a giant tool_call args
 * payload cannot dominate the BM25 corpus (or blow up an embedding pipeline
 * by tokenizing megabytes of code). 2048 chars is empirically chosen to
 * preserve most natural-language content while truncating large blobs.
 */
export const DEFAULT_FIELD_CAP = 2048

/**
 * Maximum recursion depth for the extension-URI generic string-walk.
 * Bounds work on adversarial / deeply-nested content from non-normative
 * event types.
 */
const MAX_WALK_DEPTH = 4

export interface ExtractIndexableTextOptions {
  /** Maximum characters drawn from any single content field (default 2048). */
  fieldCap?: number
}

/**
 * Observation content per the EmitInput Zod schema in services/atrib-emit.
 * Indexable fields: `what`, `why_noted`, `intent`, `rationale`, `topics`.
 * `informed_by` is a list of sha256 record_hash refs (not human-readable
 * text) and is omitted from the indexable surface.
 */
export interface ObservationContent {
  what?: unknown
  why_noted?: unknown
  intent?: unknown
  rationale?: unknown
  topics?: unknown
  informed_by?: unknown
  source?: unknown
  span_kind?: unknown
  span_name?: unknown
  trace_id?: unknown
  span_id?: unknown
  tool_name?: unknown
  input?: unknown
  output?: unknown
  agent_name?: unknown
  model_name?: unknown
  prompt?: unknown
  prompt_messages?: unknown
  prompt_tools?: unknown
  prompt_tool_choice?: unknown
  prompt_template?: unknown
  prompt_template_variables?: unknown
  prompt_version?: unknown
  prompt_id?: unknown
  prompt_url?: unknown
  invocation_parameters?: unknown
  usage_details?: unknown
  cost_details?: unknown
  score_details?: unknown
  metadata?: unknown
}

/**
 * Annotation content per services/atrib-annotate. The agent (or a separate
 * curator) tags a past record with `importance` + `summary` + `topics`.
 * `annotates` is a sha256 ref to the target record and is omitted from the
 * indexable surface.
 */
export interface AnnotationContent {
  annotates?: unknown
  importance?: unknown
  summary?: unknown
  topics?: unknown
}

/**
 * Revision content per services/atrib-revise. The agent supersedes a prior
 * position with a stated reason; indexable fields are `prior_position`,
 * `new_position`, `reason`, `topics`. `revises` is a sha256 ref and is
 * omitted from the indexable surface.
 */
export interface RevisionContent {
  revises?: unknown
  prior_position?: unknown
  new_position?: unknown
  reason?: unknown
  topics?: unknown
}

/**
 * Tool-call content per @atrib/mcp wrapper. The wrapper signs each MCP
 * tool invocation; sidecar typically carries tool_name + args + result.
 * Args and result are accepted under several legacy field names because
 * different host frameworks (Claude Agent SDK, Vercel AI SDK, LangChain)
 * historically wrote different keys. JSON-stringified args/result are
 * truncated to the field cap per `ExtractIndexableTextOptions.fieldCap`.
 */
export interface ToolCallContent {
  tool_name?: unknown
  args?: unknown
  input?: unknown
  arguments?: unknown
  result?: unknown
  output?: unknown
  response?: unknown
}

/**
 * Transaction content per payment-protocol adapters (x402, ACP, UCP, etc.).
 * Counterparty + memo are typically the most indexable fields; amounts are
 * numeric and don't tokenize usefully so they're omitted.
 */
export interface TransactionContent {
  counterparty?: unknown
  recipient?: unknown
  merchant?: unknown
  to?: unknown
  memo?: unknown
  description?: unknown
  protocol?: unknown
  via?: unknown
}

/**
 * Directory-anchor content per directory operators (spec §6.2.4). Mostly
 * structural (tree_root, epoch_id); indexable text is minimal but preserved
 * for completeness so anchors are at least surface-able by tree_root.
 */
export interface DirectoryAnchorContent {
  tree_root?: unknown
  root?: unknown
  epoch_id?: unknown
}

/**
 * Extract indexable text from a sidecar content payload.
 *
 * Dispatches on the event_type URI to the per-event_type extractor for
 * normative event types; falls back to a recursive string-walk for
 * extension URIs. Returns `""` when content is undefined / not an object /
 * structurally malformed (silent failure per §5.8 degradation).
 *
 * Suitable for tokenization (BM25, embeddings) or for display synthesis.
 * Per-field length caps prevent giant tool_call payloads from dominating
 * the corpus.
 *
 * @param eventTypeUri - the record's `event_type` field (absolute URI per §1.2.4)
 * @param content      - the D062 sidecar `_local.content` payload (typed
 *                       `unknown` because shape varies per event_type;
 *                       runtime shape-checking handles malformed input)
 * @param opts.fieldCap - max characters per single content field (default 2048)
 */
export function extractIndexableText(
  eventTypeUri: string,
  content: unknown,
  opts: ExtractIndexableTextOptions = {},
): string {
  const cap = opts.fieldCap ?? DEFAULT_FIELD_CAP
  if (!isObject(content)) return ''

  switch (eventTypeUri) {
    case EVENT_TYPE_OBSERVATION_URI:
      return extractObservationText(content as ObservationContent, cap)
    case EVENT_TYPE_ANNOTATION_URI:
      return extractAnnotationText(content as AnnotationContent, cap)
    case EVENT_TYPE_REVISION_URI:
      return extractRevisionText(content as RevisionContent, cap)
    case EVENT_TYPE_TOOL_CALL_URI:
      return extractToolCallText(content as ToolCallContent, cap)
    case EVENT_TYPE_TRANSACTION_URI:
      return extractTransactionText(content as TransactionContent, cap)
    case EVENT_TYPE_DIRECTORY_ANCHOR_URI:
      return extractDirectoryAnchorText(content as DirectoryAnchorContent, cap)
    default:
      return extractExtensionText(content, cap)
  }
}

export function extractObservationText(c: ObservationContent, cap: number): string {
  const parts: string[] = []
  pushString(parts, c.what, cap)
  pushString(parts, c.why_noted, cap)
  pushString(parts, c.intent, cap)
  pushString(parts, c.rationale, cap)
  pushTopics(parts, c.topics)
  pushString(parts, c.source, cap)
  pushString(parts, c.span_kind, cap)
  pushString(parts, c.span_name, cap)
  pushString(parts, c.tool_name, cap)
  pushString(parts, c.agent_name, cap)
  pushString(parts, c.model_name, cap)
  pushString(parts, c.prompt, cap)
  pushString(parts, c.prompt_messages, cap)
  pushString(parts, c.prompt_tools, cap)
  pushString(parts, c.prompt_tool_choice, cap)
  pushString(parts, c.prompt_template, cap)
  pushString(parts, c.prompt_template_variables, cap)
  pushString(parts, c.prompt_version, cap)
  pushString(parts, c.prompt_id, cap)
  pushString(parts, c.prompt_url, cap)
  pushString(parts, c.input, cap)
  pushString(parts, c.output, cap)
  pushString(parts, jsonExcerpt(c.invocation_parameters, cap), cap)
  pushString(parts, jsonExcerpt(c.usage_details, cap), cap)
  pushString(parts, jsonExcerpt(c.cost_details, cap), cap)
  pushString(parts, jsonExcerpt(c.score_details, cap), cap)
  pushString(parts, jsonExcerpt(c.metadata, cap), cap)
  return parts.join(' ')
}

export function extractAnnotationText(c: AnnotationContent, cap: number): string {
  const parts: string[] = []
  pushString(parts, c.summary, cap)
  pushTopics(parts, c.topics)
  return parts.join(' ')
}

export function extractRevisionText(c: RevisionContent, cap: number): string {
  const parts: string[] = []
  pushString(parts, c.prior_position, cap)
  pushString(parts, c.new_position, cap)
  pushString(parts, c.reason, cap)
  pushTopics(parts, c.topics)
  return parts.join(' ')
}

export function extractToolCallText(c: ToolCallContent, cap: number): string {
  const parts: string[] = []
  pushString(parts, c.tool_name, cap)
  const args = c.args ?? c.input ?? c.arguments
  if (args !== undefined) pushString(parts, jsonExcerpt(args, cap), cap)
  const result = c.result ?? c.output ?? c.response
  if (result !== undefined) pushString(parts, jsonExcerpt(result, cap), cap)
  return parts.join(' ')
}

export function extractTransactionText(c: TransactionContent, cap: number): string {
  const parts: string[] = []
  pushString(parts, c.counterparty, cap)
  pushString(parts, c.recipient, cap)
  pushString(parts, c.merchant, cap)
  pushString(parts, c.to, cap)
  pushString(parts, c.memo, cap)
  pushString(parts, c.description, cap)
  pushString(parts, c.protocol, cap)
  pushString(parts, c.via, cap)
  return parts.join(' ')
}

export function extractDirectoryAnchorText(c: DirectoryAnchorContent, cap: number): string {
  const parts: string[] = []
  pushString(parts, c.tree_root, cap)
  pushString(parts, c.root, cap)
  pushString(parts, c.epoch_id, cap)
  return parts.join(' ')
}

/**
 * Generic recursive string-walk for extension URI content. Walks
 * objects/arrays up to MAX_WALK_DEPTH, concatenating primitive string
 * values. Each string is truncated to the field cap. Returns `""` for
 * inputs with no string content.
 */
function extractExtensionText(content: unknown, cap: number): string {
  const out: string[] = []
  walkStrings(content, out, 0, cap)
  return out.join(' ')
}

function walkStrings(v: unknown, out: string[], depth: number, cap: number): void {
  if (depth > MAX_WALK_DEPTH) return
  if (typeof v === 'string') {
    if (v.length === 0) return
    out.push(v.length > cap ? v.slice(0, cap) : v)
    return
  }
  if (Array.isArray(v)) {
    for (const item of v) walkStrings(item, out, depth + 1, cap)
    return
  }
  if (v !== null && typeof v === 'object') {
    for (const val of Object.values(v as Record<string, unknown>)) {
      walkStrings(val, out, depth + 1, cap)
    }
  }
}

function pushString(parts: string[], v: unknown, cap: number): void {
  if (typeof v !== 'string' || v.length === 0) return
  parts.push(v.length > cap ? v.slice(0, cap) : v)
}

function pushTopics(parts: string[], v: unknown): void {
  if (!Array.isArray(v)) return
  for (const t of v) {
    if (typeof t === 'string' && t.length > 0) parts.push(t)
  }
}

function jsonExcerpt(v: unknown, cap: number): string {
  try {
    const s = typeof v === 'string' ? v : JSON.stringify(v)
    if (typeof s !== 'string') return ''
    return s.length > cap ? s.slice(0, cap) : s
  } catch {
    return ''
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}
