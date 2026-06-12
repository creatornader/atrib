// SPDX-License-Identifier: Apache-2.0

/**
 * Prompt construction for the summarize tool.
 *
 * Renders a chronological prose digest of N records and feeds it to an
 * LLM with instructions to synthesize a narrative. The records' semantic
 * content (from the local sidecar) is included when available; legacy
 * bare-record entries fall back to event_type + cryptographic metadata
 * only, with a flag so the LLM knows the input is impoverished.
 */

import type { IndexedRecord } from './storage.js'

const SYSTEM_PROMPT = `You synthesize narratives across signed agent activity records.

Each record has:
- A cryptographic identity (signature, hash, creator_key)
- A graph position (chain_root, informed_by)
- A semantic payload, EITHER carried in a local sidecar (rich) OR absent (impoverished, only event_type and metadata)

Your job: produce a coherent narrative across the records that surfaces:
- What the agent was doing (decisions, observations, revisions)
- What the signer claimed informed what (via informed_by)
- What shaped the outcome vs what was incidental
- Honest gaps (when records are impoverished, say so; do not invent semantics)

Cite specific records by short hash (first 12 chars of record_hash) when making claims.
Be concise. The reader is the same agent that signed these records, assume they want to be reminded, not lectured.`

export function buildSystemPrompt(): string {
  return SYSTEM_PROMPT
}

/**
 * Render the user message: a chronological digest of every record fed
 * to the LLM, followed by the focus question (if any).
 */
export function buildUserMessage(records: IndexedRecord[], focus: string | undefined): string {
  const sortedAsc = [...records].sort((a, b) => a.record.timestamp - b.record.timestamp)
  const lines: string[] = []
  lines.push(`# Records to synthesize (${records.length}, oldest-first)`)
  lines.push('')
  for (const r of sortedAsc) {
    lines.push(renderRecord(r))
    lines.push('')
  }
  lines.push('---')
  lines.push('')
  if (focus && focus.trim().length > 0) {
    lines.push(`# Focus`)
    lines.push(focus.trim())
  } else {
    lines.push(`# Default focus`)
    lines.push(
      'Summarize what the agent did and why, surfacing the decisions and signed relationship path that shaped the work.',
    )
  }
  return lines.join('\n')
}

function shortHash(h: string): string {
  // strip "sha256:" prefix and shorten
  const noPrefix = h.startsWith('sha256:') ? h.slice(7) : h
  return noPrefix.slice(0, 12) + '…'
}

function renderRecord(r: IndexedRecord): string {
  const ts = new Date(r.record.timestamp).toISOString()
  const evt = r.record.event_type.split('/').pop() ?? r.record.event_type
  const hashShort = shortHash(r.record_hash)
  const ctxShort = r.record.context_id.slice(0, 8) + '…'
  const informedBy = Array.isArray(r.record.informed_by) ? r.record.informed_by : []

  const out: string[] = []
  out.push(`## ${ts} · ${evt} · ${hashShort} · trace ${ctxShort}`)

  if (informedBy.length > 0) {
    out.push(`informed_by: ${informedBy.map(shortHash).join(', ')}`)
  }

  const sc = r.local
  if (sc) {
    if (sc.toolName) out.push(`tool: ${sc.toolName}`)
    const c = sc.content as Record<string, unknown> | undefined
    if (c) {
      if (typeof c['source'] === 'string') out.push(`source: ${c['source']}`)
      if (typeof c['span_kind'] === 'string') out.push(`span_kind: ${c['span_kind']}`)
      if (typeof c['span_name'] === 'string') out.push(`span_name: ${c['span_name']}`)
      if (typeof c['tool_name'] === 'string') out.push(`tool: ${c['tool_name']}`)
      if (typeof c['agent_name'] === 'string') out.push(`agent: ${c['agent_name']}`)
      if (typeof c['model_name'] === 'string') out.push(`model: ${c['model_name']}`)
      if (typeof c['what'] === 'string') out.push(`what: ${c['what']}`)
      if (typeof c['why_noted'] === 'string') out.push(`why_noted: ${c['why_noted']}`)
      if (typeof c['intent'] === 'string') out.push(`intent: ${c['intent']}`)
      if (typeof c['rationale'] === 'string') out.push(`rationale: ${c['rationale']}`)
      if (typeof c['summary'] === 'string') out.push(`summary: ${c['summary']}`)
      if (typeof c['importance'] === 'string') out.push(`importance: ${c['importance']}`)
      if (typeof c['prior_position'] === 'string')
        out.push(`prior_position: ${c['prior_position']}`)
      if (typeof c['new_position'] === 'string') out.push(`new_position: ${c['new_position']}`)
      if (typeof c['reason'] === 'string') out.push(`reason: ${c['reason']}`)
      if (typeof c['prompt'] === 'string') out.push(`prompt: ${c['prompt'].slice(0, 1200)}`)
      if (typeof c['prompt_messages'] === 'string')
        out.push(`prompt_messages: ${c['prompt_messages'].slice(0, 1200)}`)
      if (typeof c['prompt_template'] === 'string')
        out.push(`prompt_template: ${c['prompt_template'].slice(0, 1200)}`)
      if (typeof c['prompt_version'] === 'string')
        out.push(`prompt_version: ${c['prompt_version']}`)
      if (typeof c['input'] === 'string')
        out.push(`input (truncated): ${c['input'].slice(0, 1200)}`)
      if (typeof c['output'] === 'string')
        out.push(`output (truncated): ${c['output'].slice(0, 1200)}`)
      if (c['args']) out.push(`args (truncated): ${JSON.stringify(c['args']).slice(0, 1200)}`)
      if (c['result']) out.push(`result (truncated): ${JSON.stringify(c['result']).slice(0, 1200)}`)
      if (c['usage_details'])
        out.push(`usage_details: ${JSON.stringify(c['usage_details']).slice(0, 600)}`)
      if (c['cost_details'])
        out.push(`cost_details: ${JSON.stringify(c['cost_details']).slice(0, 600)}`)
      if (c['score_details'])
        out.push(`score_details: ${JSON.stringify(c['score_details']).slice(0, 600)}`)
      if (c['metadata']) out.push(`metadata: ${JSON.stringify(c['metadata']).slice(0, 600)}`)
      if (Array.isArray(c['topics'])) {
        out.push(
          `topics: ${(c['topics'] as unknown[]).filter((x): x is string => typeof x === 'string').join(', ')}`,
        )
      }
    }
    // Tool-call sidecar may have args/result; keep brief to control prompt size.
    if (sc.args) out.push(`args (truncated): ${JSON.stringify(sc.args).slice(0, 1200)}`)
    if (sc.result) out.push(`result (truncated): ${JSON.stringify(sc.result).slice(0, 1200)}`)
  } else {
    out.push(
      '(no semantic sidecar available, record predates local-mirror sidecar pattern; only cryptographic metadata is present)',
    )
  }
  return out.join('\n')
}
