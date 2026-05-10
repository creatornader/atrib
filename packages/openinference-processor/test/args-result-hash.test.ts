// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import {
  base64urlEncode,
  base64urlDecode,
  getPublicKey,
  sha256,
  hexEncode,
  type AtribRecord,
} from '@atrib/mcp'
import {
  AtribSpanProcessor,
  deriveArgsResultHashFields,
} from '../src/index.js'

const TEST_KEY_BYTES = new Uint8Array(32).fill(7)

describe('deriveArgsResultHashFields', () => {
  it('posture none returns empty object', () => {
    expect(deriveArgsResultHashFields('none', { input: 'x', output: 'y' })).toEqual({})
  })

  it('posture plain emits sha256 of input + output', () => {
    const fields = deriveArgsResultHashFields('plain', {
      input: '{"city":"Austin"}',
      output: 'clear, 64F',
    })
    expect(fields.args_hash).toBeDefined()
    expect(fields.args_salt).toBeUndefined()
    expect(fields.result_hash).toBeDefined()
    expect(fields.result_salt).toBeUndefined()
    // Verify deterministic
    const expected_args = `sha256:${hexEncode(sha256(new TextEncoder().encode('{"city":"Austin"}')))}`
    expect(fields.args_hash).toBe(expected_args)
  })

  it('posture salted emits hash + 16-byte salt for each value', () => {
    const fields = deriveArgsResultHashFields('salted', {
      input: 'hello',
      output: 'world',
    })
    expect(fields.args_hash).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(fields.args_salt).toBeDefined()
    expect(fields.result_hash).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(fields.result_salt).toBeDefined()
    expect(base64urlDecode(fields.args_salt!).length).toBe(16)
    expect(base64urlDecode(fields.result_salt!).length).toBe(16)
    // Salts are random per-call, so two consecutive calls produce different salts
    const fields2 = deriveArgsResultHashFields('salted', {
      input: 'hello',
      output: 'world',
    })
    expect(fields.args_salt).not.toBe(fields2.args_salt)
    expect(fields.args_hash).not.toBe(fields2.args_hash) // different salts -> different hashes
  })

  it('omits args fields when input is absent', () => {
    const fields = deriveArgsResultHashFields('plain', { output: 'only-output' })
    expect(fields.args_hash).toBeUndefined()
    expect(fields.result_hash).toBeDefined()
  })

  it('salted hash is verifiable: sha256(salt || input) === args_hash', () => {
    const input = 'verifiable-input'
    const fields = deriveArgsResultHashFields('salted', { input })
    const salt = base64urlDecode(fields.args_salt!)
    const inputBytes = new TextEncoder().encode(input)
    const concat = new Uint8Array(salt.length + inputBytes.length)
    concat.set(salt, 0)
    concat.set(inputBytes, salt.length)
    const expected = `sha256:${hexEncode(sha256(concat))}`
    expect(fields.args_hash).toBe(expected)
  })
})

describe('AtribSpanProcessor with argsResultHashPosture', () => {
  it('default (no posture set) emits no hash fields', async () => {
    const submitted: AtribRecord[] = []
    const pubKey = await getPublicKey(TEST_KEY_BYTES)
    const processor = new AtribSpanProcessor({
      privateKey: TEST_KEY_BYTES,
      creatorKey: base64urlEncode(pubKey),
      serverUrl: 'https://test.example/atrib',
      submit: (signed) => {
        submitted.push(signed)
      },
    })
    const provider = new BasicTracerProvider({ spanProcessors: [processor] })
    const tracer = provider.getTracer('test')
    const span = tracer.startSpan('tool')
    span.setAttribute('openinference.span.kind', 'TOOL')
    span.setAttribute('tool.name', 'foo')
    span.setAttribute('input.value', 'bar')
    span.setAttribute('output.value', 'baz')
    span.end()
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))
    expect(submitted[0]!.args_hash).toBeUndefined()
    expect(submitted[0]!.result_hash).toBeUndefined()
  })

  it('plain posture emits args_hash + result_hash without salts', async () => {
    const submitted: AtribRecord[] = []
    const pubKey = await getPublicKey(TEST_KEY_BYTES)
    const processor = new AtribSpanProcessor({
      privateKey: TEST_KEY_BYTES,
      creatorKey: base64urlEncode(pubKey),
      serverUrl: 'https://test.example/atrib',
      submit: (signed) => {
        submitted.push(signed)
      },
      argsResultHashPosture: 'plain',
    })
    const provider = new BasicTracerProvider({ spanProcessors: [processor] })
    const tracer = provider.getTracer('test')
    const span = tracer.startSpan('tool')
    span.setAttribute('openinference.span.kind', 'TOOL')
    span.setAttribute('tool.name', 'foo')
    span.setAttribute('input.value', '{"k":"v"}')
    span.setAttribute('output.value', 'result')
    span.end()
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))
    expect(submitted[0]!.args_hash).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(submitted[0]!.result_hash).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(submitted[0]!.args_salt).toBeUndefined()
    expect(submitted[0]!.result_salt).toBeUndefined()
  })

  it('salted posture emits all four fields', async () => {
    const submitted: AtribRecord[] = []
    const pubKey = await getPublicKey(TEST_KEY_BYTES)
    const processor = new AtribSpanProcessor({
      privateKey: TEST_KEY_BYTES,
      creatorKey: base64urlEncode(pubKey),
      serverUrl: 'https://test.example/atrib',
      submit: (signed) => {
        submitted.push(signed)
      },
      argsResultHashPosture: 'salted',
    })
    const provider = new BasicTracerProvider({ spanProcessors: [processor] })
    const tracer = provider.getTracer('test')
    const span = tracer.startSpan('tool')
    span.setAttribute('openinference.span.kind', 'TOOL')
    span.setAttribute('tool.name', 'foo')
    span.setAttribute('input.value', 'in')
    span.setAttribute('output.value', 'out')
    span.end()
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))
    expect(submitted[0]!.args_hash).toBeDefined()
    expect(submitted[0]!.args_salt).toBeDefined()
    expect(submitted[0]!.result_hash).toBeDefined()
    expect(submitted[0]!.result_salt).toBeDefined()
  })
})
