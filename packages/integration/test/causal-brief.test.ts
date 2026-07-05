// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  buildCausalBrief,
  buildCausalRecords,
  CONTENT_TRUNC,
  type TraceDoc,
  type TraceSpan,
} from '../src/causal-brief/build-causal-brief.js'
import { ANOMALY_RULES } from '../src/causal-brief/build-causal-brief.js'

const span = (o: Partial<TraceSpan> & { span_id: string }): TraceSpan => ({
  parent_span_id: null,
  span_name: 'span',
  kind: 'CHAIN',
  timestamp_ms: 0,
  duration_ms: 0,
  status_code: 'OK',
  status_message: '',
  input_value: '',
  output_value: '',
  prompt_tokens: null,
  completion_tokens: null,
  total_tokens: null,
  ...o,
})

// A small tree: root -> (llm, tool); tool errors; llm retried 3x.
const DOC: TraceDoc = {
  trace_id: 'a'.repeat(32),
  spans: [
    span({ span_id: 'aaaaaaaaaaaaaaaa', span_name: 'main', kind: 'AGENT', timestamp_ms: 100, duration_ms: 900, input_value: 'solve the task' }),
    span({ span_id: 'bbbbbbbbbbbbbbbb', parent_span_id: 'aaaaaaaaaaaaaaaa', span_name: 'llm', kind: 'LLM', timestamp_ms: 200, duration_ms: 50, input_value: 'prompt', output_value: 'thought', total_tokens: 42 }),
    span({ span_id: 'cccccccccccccccc', parent_span_id: 'aaaaaaaaaaaaaaaa', span_name: 'search', kind: 'TOOL', timestamp_ms: 300, duration_ms: 800, input_value: 'query', output_value: 'HTTP 503 service unavailable', status_code: 'ERROR', status_message: 'upstream failed' }),
  ],
}

describe('buildCausalBrief', () => {
  it('is deterministic: identical input yields byte-identical output', async () => {
    const a = await buildCausalBrief(DOC, 'atrib')
    const b = await buildCausalBrief(DOC, 'atrib')
    expect(a).toBe(b)
  })

  it('records reuse the real §3.2.4 derivation: chain + informed_by resolve', async () => {
    const { records, hashBySpan } = await buildCausalRecords(DOC)
    expect(records.length).toBe(3)
    // Every record signed and verifiable.
    for (const r of records) expect(r.signature.length).toBeGreaterThan(0)
    // Children carry informed_by pointing at the parent record hash.
    const child = records.find((r) => r.context_id === DOC.trace_id && 'informed_by' in r)
    expect(child).toBeDefined()
    const parentHash = 'sha256:' + hashBySpan.get('aaaaaaaaaaaaaaaa')!
    const anyChildInformedByParent = records.some(
      (r) => Array.isArray((r as { informed_by?: string[] }).informed_by) &&
        (r as { informed_by?: string[] }).informed_by!.includes(parentHash),
    )
    expect(anyChildInformedByParent).toBe(true)
  })

  it('atrib mode adds structure the flat mode lacks', async () => {
    const flat = await buildCausalBrief(DOC, 'flat')
    const atrib = await buildCausalBrief(DOC, 'atrib')
    expect(flat).not.toContain('Causal structure')
    expect(flat).not.toContain('anomaly appendix')
    expect(atrib).toContain('Causal structure (atrib graph:')
    expect(atrib).toContain('Mechanical anomaly appendix')
    // The atrib brief surfaces the tool error via the uniform anomaly rules.
    expect(atrib).toContain('rule A @ cccccccccccccccc')
    expect(atrib).toContain('rule B @ cccccccccccccccc')
  })

  it('atrib_tree is the ablation midpoint: tree without the anomaly appendix', async () => {
    const tree = await buildCausalBrief(DOC, 'atrib_tree')
    expect(tree).toContain('Causal structure (atrib graph:')
    expect(tree).not.toContain('Mechanical anomaly appendix')
    // The causal tree itself is identical to the full atrib mode's tree.
    const atrib = await buildCausalBrief(DOC, 'atrib')
    const grabTree = (s: string): string => {
      const start = s.indexOf('## Causal structure')
      const rest = s.slice(start)
      const next = rest.indexOf('\n## ', 3)
      return (next === -1 ? rest : rest.slice(0, next)).trim()
    }
    expect(grabTree(tree)).toBe(grabTree(atrib))
  })

  it('holds content budget constant: the chronology block is byte-identical across all three modes', async () => {
    const grab = (s: string): string => {
      const start = s.indexOf('## Chronology')
      const rest = s.slice(start)
      const next = rest.indexOf('\n## ', 3)
      return (next === -1 ? rest : rest.slice(0, next)).trim()
    }
    const flat = await buildCausalBrief(DOC, 'flat')
    const treeOnly = await buildCausalBrief(DOC, 'atrib_tree')
    const atrib = await buildCausalBrief(DOC, 'atrib')
    expect(grab(flat)).toBe(grab(atrib))
    expect(grab(flat)).toBe(grab(treeOnly))
  })

  it('truncates span content to the shared budget in both modes', async () => {
    const big = 'x'.repeat(CONTENT_TRUNC * 3)
    const doc: TraceDoc = {
      trace_id: 'b'.repeat(32),
      spans: [span({ span_id: 'd'.repeat(16), span_name: 'main', input_value: big, output_value: big })],
    }
    const flat = await buildCausalBrief(doc, 'flat')
    const atrib = await buildCausalBrief(doc, 'atrib')
    // Full untruncated content must not appear in either brief.
    expect(flat).not.toContain(big)
    expect(atrib).not.toContain(big)
    // The truncated form (budget chars + ellipsis) appears in both.
    const truncated = 'x'.repeat(CONTENT_TRUNC) + '…'
    expect(flat).toContain(truncated)
    expect(atrib).toContain(truncated)
  })

  it('anomaly appendix drops duration and empty-output rules', async () => {
    const doc: TraceDoc = {
      trace_id: 'trace_c2_prune',
      spans: [
        span({
          span_id: 'p1',
          span_name: 'slow_step',
          timestamp_ms: 100,
          duration_ms: 10000,
          input_value: 'slow input',
          output_value: 'slow output',
        }),
        span({
          span_id: 'p2',
          span_name: 'empty_step',
          timestamp_ms: 110,
          duration_ms: 10,
          input_value: 'empty output input',
          output_value: '',
        }),
        span({
          span_id: 'p3',
          span_name: 'normal_step',
          timestamp_ms: 120,
          duration_ms: 12,
          input_value: 'normal input',
          output_value: 'normal output',
        }),
      ],
    }

    const brief = await buildCausalBrief(doc, 'atrib')

    expect(brief).toContain('Mechanical anomaly appendix')
    expect(brief).toContain('- none')
    expect(brief).not.toContain('rule D')
    expect(brief).not.toContain('rule E')
    expect(ANOMALY_RULES.length).toBe(3)
    expect(ANOMALY_RULES.join(' ')).not.toContain('duration')
    expect(ANOMALY_RULES.join(' ')).not.toContain('empty output')
  })
})
