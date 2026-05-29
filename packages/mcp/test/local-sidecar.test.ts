// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  deriveLocalContentFromSidecar,
  withDerivedLocalContent,
  EVENT_TYPE_OBSERVATION_URI,
  EVENT_TYPE_TOOL_CALL_URI,
} from '../src/index.js'

describe('local sidecar normalization', () => {
  it('preserves explicit _local.content when present', () => {
    const content = { what: 'already normalized' }
    expect(
      deriveLocalContentFromSidecar(EVENT_TYPE_OBSERVATION_URI, {
        content,
        input: 'legacy input should not win',
      }),
    ).toBe(content)
  })

  it('derives tool_call content from wrapper sidecar fields', () => {
    expect(
      deriveLocalContentFromSidecar(EVENT_TYPE_TOOL_CALL_URI, {
        toolName: 'search_web',
        args: { query: 'Langfuse trace model' },
        result: { hits: 3 },
      }),
    ).toEqual({
      tool_name: 'search_web',
      args: { query: 'Langfuse trace model' },
      result: { hits: 3 },
    })
  })

  it('derives OpenInference observation content from legacy callback fields', () => {
    expect(
      deriveLocalContentFromSidecar(EVENT_TYPE_OBSERVATION_URI, {
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        spanId: '00f067aa0ba902b7',
        spanKind: 'LLM',
        spanName: 'generate-text',
        input: '{"prompt":"compare observability tools"}',
        output: '{"text":"Langfuse is trace-native"}',
        agentName: 'researcher',
        llmOutputToolCallId: 'call_1',
      }),
    ).toEqual({
      source: 'openinference',
      span_kind: 'LLM',
      topics: ['openinference', 'llm'],
      span_name: 'generate-text',
      trace_id: '4bf92f3577b34da6a3ce929d0e0e4736',
      span_id: '00f067aa0ba902b7',
      input: '{"prompt":"compare observability tools"}',
      output: '{"text":"Langfuse is trace-native"}',
      agent_name: 'researcher',
      llm_output_tool_call_id: 'call_1',
      what: 'OpenInference llm span: generate-text',
    })
  })

  it('clones sidecars when adding derived content', () => {
    const sidecar = {
      producer: 'mcp-wrap',
      toolName: 'read_file',
      args: { path: 'ARCHITECTURE.md' },
    }
    const normalized = withDerivedLocalContent(EVENT_TYPE_TOOL_CALL_URI, sidecar)
    expect(normalized).not.toBe(sidecar)
    expect(normalized.producer).toBe('mcp-wrap')
    expect(normalized.content).toEqual({
      tool_name: 'read_file',
      args: { path: 'ARCHITECTURE.md' },
    })
  })
})
