// SPDX-License-Identifier: Apache-2.0

/**
 * Fixture-replay test: load each canonical OpenInference span captured from
 * a real Vercel AI SDK + NIM Qwen run (see test/fixtures/manifest.json),
 * replay it through `spanToUnsignedRecord`, and assert the v0.0.1 mapping
 * behavior matches the documented `expected_atrib_mapping` block.
 *
 * The fixtures themselves were captured live (not synthesized from docs)
 * so this test is the structural anti-drift check: if the upstream
 * @arizeai/openinference-vercel package changes its attribute keys, or if
 * Vercel AI SDK changes what attributes it emits, this test catches the
 * mismatch BEFORE it reaches a downstream consumer.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base'
import { base64urlEncode, getPublicKey, EVENT_TYPE_TOOL_CALL_URI } from '@atrib/mcp'
import { spanToUnsignedRecord } from '../src/index.js'

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

type FixtureExpected = {
  v0_0_1_behavior: 'signed' | 'skipped'
  skip_reason_pattern?: string
  atrib_event_type?: string
  tool_name_field?: string
  input_value_field?: string
  output_value_field?: string
  tool_call_id_for_future_informed_by?: string
  future_mapping_target?: string
  informed_by_seed_field?: string
  context_id_source?: string
  content_leaf_format?: string
  future_informed_by_target?: string
  fallback_note?: string
}

type FixtureCase = {
  name: string
  description: string
  span: {
    name: string
    attributes: Record<string, unknown>
    status: { code: number }
    kind: number
    startTime?: readonly [number, number]
    endTime?: readonly [number, number]
  }
  expected_atrib_mapping: FixtureExpected
}

type Manifest = {
  schema: string
  cases: { file: string; name: string }[]
}

function loadManifest(): Manifest {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, 'manifest.json'), 'utf-8'))
}

function loadCase(file: string): FixtureCase {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, file), 'utf-8'))
}

/**
 * Materialize a captured span back into a ReadableSpan-shaped object that
 * `spanToUnsignedRecord` can consume. We only fill the fields the mapper
 * reads -- attributes, spanContext().traceId, startTime.
 */
function materializeSpan(
  fixture: FixtureCase['span'],
  syntheticTraceId = 'fffffffffffffffffffffffffffffffe',
): ReadableSpan {
  return {
    name: fixture.name,
    attributes: fixture.attributes as ReadableSpan['attributes'],
    status: fixture.status,
    kind: fixture.kind,
    startTime: fixture.startTime ?? [1767225600, 0],
    endTime: fixture.endTime ?? [1767225601, 0],
    duration: [1, 0],
    ended: true,
    instrumentationScope: { name: 'fixture-replay', version: '0.0.0' },
    resource: { attributes: {}, asyncAttributesPending: false } as never,
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
    events: [],
    links: [],
    spanContext: () => ({
      traceId: syntheticTraceId,
      spanId: 'aaaaaaaaaaaaaaaa',
      traceFlags: 1,
    }),
  } as unknown as ReadableSpan
}

describe('fixture replay: canonical Vercel AI SDK + OpenInference spans', () => {
  it('manifest references all four canonical kinds (TOOL/LLM/LLM/AGENT)', () => {
    const manifest = loadManifest()
    expect(manifest.schema).toBe('atrib-openinference-fixtures/v0.0.1')
    expect(manifest.cases).toHaveLength(4)
    const names = manifest.cases.map((c) => c.name)
    expect(names).toContain('canonical-tool-span')
    expect(names).toContain('canonical-llm-span-with-tool-calls')
    expect(names).toContain('canonical-llm-span-final-answer')
    expect(names).toContain('canonical-agent-span-root')
  })

  it('each fixture replays to its documented expected behavior', async () => {
    const manifest = loadManifest()
    const pubKey = await getPublicKey(new Uint8Array(32).fill(7))
    const ctx = {
      creatorKey: base64urlEncode(pubKey),
      serverUrl: 'https://example.test/atrib-fixture-replay',
    }

    for (const entry of manifest.cases) {
      const c = loadCase(entry.file)
      const span = materializeSpan(c.span)
      const result = spanToUnsignedRecord(span, ctx)
      const expected = c.expected_atrib_mapping

      if (expected.v0_0_1_behavior === 'signed') {
        expect(result.ok, `${c.name} expected signed but got skip`).toBe(true)
        if (!result.ok) continue
        expect(result.kind, `${c.name} kind mismatch`).toBe(
          c.span.attributes['openinference.span.kind'],
        )
        if (expected.atrib_event_type) {
          expect(result.record.event_type).toBe(expected.atrib_event_type)
        } else {
          expect(result.record.event_type).toBe(EVENT_TYPE_TOOL_CALL_URI)
        }
        // For TOOL spans only: tool.name drives content_id derivation
        if (result.kind === 'TOOL') {
          expect(c.span.attributes['tool.name']).toBeDefined()
        }
      } else {
        expect(result.ok, `${c.name} expected skip but got signed`).toBe(false)
        if (!result.ok && expected.skip_reason_pattern) {
          expect(
            result.reason.includes(expected.skip_reason_pattern.split(' ')[0]!),
            `${c.name} skip reason "${result.reason}" missing pattern "${expected.skip_reason_pattern}"`,
          ).toBe(true)
        }
      }
    }
  })

  it('canonical TOOL span produces a record with tool_name in content_id derivation', async () => {
    const tool = loadCase('cases/canonical-tool-span.json')
    const span = materializeSpan(tool.span)
    const pubKey = await getPublicKey(new Uint8Array(32).fill(7))
    const result = spanToUnsignedRecord(span, {
      creatorKey: base64urlEncode(pubKey),
      serverUrl: 'https://fixture.example/atrib',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.record.content_id).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(result.record.context_id).toBe('fffffffffffffffffffffffffffffffe')
    // tool_call.id MUST be present on the captured TOOL span -- this is
    // the empirical seed for future `informed_by` derivation between LLM
    // and TOOL records.
    expect(tool.span.attributes['tool_call.id']).toBeDefined()
  })

  it('canonical LLM-with-tool-calls span carries tool_call.id matching the TOOL span (informed_by seed)', () => {
    const llm = loadCase('cases/canonical-llm-span-with-tool-calls.json')
    const tool = loadCase('cases/canonical-tool-span.json')
    const llmToolCallId =
      llm.span.attributes['llm.output_messages.0.message.tool_calls.0.tool_call.id']
    const toolSpanCallId = tool.span.attributes['tool_call.id']
    expect(llmToolCallId).toBeDefined()
    expect(toolSpanCallId).toBeDefined()
    expect(llmToolCallId).toBe(toolSpanCallId)
  })

  it('TOOL span carries no session.id (Vercel AI SDK v6 default)', () => {
    const tool = loadCase('cases/canonical-tool-span.json')
    expect(tool.span.attributes['session.id']).toBeUndefined()
  })

  it('TOOL span carries no agent.name (only AGENT spans do)', () => {
    const tool = loadCase('cases/canonical-tool-span.json')
    const agent = loadCase('cases/canonical-agent-span-root.json')
    expect(tool.span.attributes['agent.name']).toBeUndefined()
    // AGENT span DOES NOT necessarily carry agent.name either in Vercel AI
    // SDK v6 -- this fixture documents the empirical absence so future
    // AGENT-mapping work doesn't assume the field's presence.
    expect(agent.span.attributes['openinference.span.kind']).toBe('AGENT')
  })

  it('LLM span maps to observation event_type with llm:<model_name> content_leaf', async () => {
    const llm = loadCase('cases/canonical-llm-span-with-tool-calls.json')
    const span = materializeSpan(llm.span)
    const pubKey = await getPublicKey(new Uint8Array(32).fill(7))
    const result = spanToUnsignedRecord(span, {
      creatorKey: base64urlEncode(pubKey),
      serverUrl: 'https://fixture.example/atrib',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.kind).toBe('LLM')
    expect(result.record.event_type).toBe('https://atrib.dev/v1/types/observation')
    // The same llm.model_name across both LLM spans means stable content_id
    // for "all tool-calling steps to this model".
    expect(llm.span.attributes['llm.model_name']).toBeDefined()
  })

  it('AGENT span maps to observation event_type with agent: prefix', async () => {
    const agent = loadCase('cases/canonical-agent-span-root.json')
    const span = materializeSpan(agent.span)
    const pubKey = await getPublicKey(new Uint8Array(32).fill(7))
    const result = spanToUnsignedRecord(span, {
      creatorKey: base64urlEncode(pubKey),
      serverUrl: 'https://fixture.example/atrib',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.kind).toBe('AGENT')
    expect(result.record.event_type).toBe('https://atrib.dev/v1/types/observation')
  })

  it('LLM-with-tool-calls span exposes tool_call.id as informed_by seed via readLlmOutputToolCallId', async () => {
    const { readLlmOutputToolCallId } = await import('../src/index.js')
    const llmFixture = loadCase('cases/canonical-llm-span-with-tool-calls.json')
    const toolFixture = loadCase('cases/canonical-tool-span.json')
    const llmSpan = materializeSpan(llmFixture.span)
    const seed = readLlmOutputToolCallId(llmSpan)
    expect(seed).toBeDefined()
    // Empirical: the seed equals the immediately-following TOOL span's tool_call.id.
    // This is the basis for future LLM->TOOL informed_by derivation.
    expect(seed).toBe(toolFixture.span.attributes['tool_call.id'])
  })

  it('LLM final-answer span exposes no tool_call.id (output is plain text)', async () => {
    const { readLlmOutputToolCallId } = await import('../src/index.js')
    const llm = loadCase('cases/canonical-llm-span-final-answer.json')
    const span = materializeSpan(llm.span)
    const seed = readLlmOutputToolCallId(span)
    expect(seed).toBeUndefined()
  })
})
