// SPDX-License-Identifier: Apache-2.0

// Reference tests for the read-side families of
// spec/conformance/attest-recall/: read-equivalence (every legacy read
// tool and the recall-verb shape that maps onto it MUST return
// JSON-identical results against the fixed mirror fixture) and
// persisted-labels (producer labels and D084 primitive values from both
// vocabularies MUST be accepted).

import { readFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const CORPUS = resolve(HERE, '..', '..', '..', 'spec', 'conformance', 'attest-recall', 'cases')
const MIRROR = join(CORPUS, 'read-equivalence', 'mirror.jsonl')

interface Vectors {
  query_timestamp_ms: number
  record_hashes: Record<string, string>
  vectors: Array<{
    name: string
    legacy: { tool: string; arguments: Record<string, unknown> }
    recall: Record<string, unknown>
  }>
  verification: Array<{
    name: string
    arguments: Record<string, unknown>
    expected: { status: string; all_accepted?: boolean; accepted_record_hashes?: string[] }
  }>
}

const vectors = JSON.parse(
  readFileSync(join(CORPUS, 'read-equivalence', 'vectors.json'), 'utf8'),
) as Vectors

// The recall module reads ATRIB_RECORD_FILE at module init, so the env must
// be set before the dynamic import below.
process.env['ATRIB_RECORD_FILE'] = MIRROR
delete process.env['ATRIB_MIRROR_DIR']

type RecallModule = typeof import('../src/index.js')
type VerificationModule = typeof import('../src/verification.js')

let recallModule: RecallModule
let verificationModule: VerificationModule
let client: Client
let closeServer: () => Promise<void>

async function callTool(
  tool: string,
  args: Record<string, unknown>,
): Promise<{ isError?: boolean; payload: Record<string, unknown> }> {
  const result = (await client.callTool({ name: tool, arguments: args })) as {
    isError?: boolean
    content: Array<{ type: string; text: string }>
  }
  if (result.isError) {
    return { isError: true, payload: { message: result.content[0]?.text } }
  }
  return { payload: JSON.parse(result.content[0]!.text) as Record<string, unknown> }
}

beforeAll(async () => {
  recallModule = await import('../src/index.js')
  verificationModule = await import('../src/verification.js')
  recallModule.clearRecallMirrorCache()
  // Freeze wall-clock reads (age strings, recency scoring) without faking
  // timers, so both surfaces of each vector see one instant.
  vi.spyOn(Date, 'now').mockReturnValue(vectors.query_timestamp_ms)

  const { mcp } = recallModule.createAtribRecallServer()
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await mcp.connect(serverTransport)
  client = new Client({ name: 'read-equivalence-conformance', version: '0.0.0' })
  await client.connect(clientTransport)
  closeServer = async () => {
    await client.close()
    await mcp.close()
  }
})

afterAll(async () => {
  await closeServer()
  vi.restoreAllMocks()
  delete process.env['ATRIB_RECORD_FILE']
})

describe('attest-recall corpus: read-equivalence', () => {
  for (const vector of vectors.vectors) {
    it(vector.name, async () => {
      const legacy = await callTool(vector.legacy.tool, vector.legacy.arguments)
      const verb = await callTool('recall', vector.recall)
      expect(legacy.isError).not.toBe(true)
      expect(verb.isError).not.toBe(true)
      // JSON-for-JSON: result set AND ordering must match.
      expect(verb.payload).toEqual(legacy.payload)
    })
  }

  it('keeps record_hash on compact results so calls can be chained (D084)', async () => {
    const { payload } = await callTool('recall', { shape: 'history', limit: 50 })
    const records = payload['records'] as Array<Record<string, unknown>>
    expect(records.length).toBeGreaterThan(0)
    for (const record of records) {
      expect(typeof record['record_hash']).toBe('string')
    }
  })

  for (const verification of vectors.verification.filter(
    (entry) => entry.expected.status === 'ok',
  )) {
    it(verification.name, async () => {
      const { payload } = await callTool('recall', verification.arguments)
      const block = payload['verification'] as {
        status: string
        result?: { all_accepted: boolean; accepted_record_hashes: string[] }
      }
      expect(block.status).toBe('ok')
      expect(block.result?.all_accepted).toBe(verification.expected.all_accepted)
      if (verification.expected.accepted_record_hashes) {
        expect(block.result?.accepted_record_hashes).toEqual(
          verification.expected.accepted_record_hashes,
        )
      }
    })
  }

  it('verifier-absent-degrades: typed verifier_unavailable block, unchanged read result', async () => {
    const vector = vectors.verification.find(
      (entry) => entry.expected.status === 'verifier_unavailable',
    )!
    const bare = { ...vector.arguments }
    delete bare['verification']
    const withoutVerification = await callTool('recall', bare)

    verificationModule.__resetVerifyModuleForTests(() => Promise.resolve(null))
    try {
      const degraded = await callTool('recall', vector.arguments)
      const block = degraded.payload['verification'] as { status: string; reason?: string }
      expect(block.status).toBe('verifier_unavailable')
      expect(block.reason).toContain('@atrib/verify')
      const { verification: _v, ...rest } = degraded.payload
      expect(rest).toEqual(withoutVerification.payload)
    } finally {
      verificationModule.__resetVerifyModuleForTests()
    }
  })

  it('requires shape or verification', async () => {
    const result = await callTool('recall', {})
    expect(result.isError).toBe(true)
  })

  it('validates per-shape required args (walk requires start)', async () => {
    const result = await callTool('recall', { shape: 'walk' })
    expect(result.isError).toBe(true)
    expect(String(result.payload['message'])).toContain('start')
  })

  it('projects revision lineages through the state shape without adding a legacy tool', async () => {
    const result = await callTool('recall', {
      shape: 'state',
      include_content: false,
      limit: 20,
    })
    expect(result.isError).not.toBe(true)
    expect(result.payload['schema']).toBe('atrib.state-projection.v1')
    expect(result.payload['acceptance_basis']).toMatchObject({
      signature_verification: 'local_ed25519',
      log_inclusion_verified: false,
    })
  })
})

describe('attest-recall corpus: persisted-labels', () => {
  interface LabelExpectations {
    expected: { producer_labels: string[]; distinct_labels_accepted: string[] }
  }
  const expectations = JSON.parse(
    readFileSync(join(CORPUS, 'persisted-labels', 'expectations.json'), 'utf8'),
  ) as LabelExpectations

  it('accepts mixed legacy and attest-family producer labels as opaque pass-through (L1)', async () => {
    const { payload } = await callTool('recall', {
      shape: 'chain',
      filters: { context_id: 'a11ce000a11ce000a11ce000a11ce000' },
      limit: 50,
      include_content: true,
    })
    const records = payload['records'] as Array<Record<string, unknown>>
    const producers = new Set(
      records.map((record) => record['local_producer']).filter((p) => typeof p === 'string'),
    )
    // Every context-A label from the fixture surfaces verbatim; no reader
    // filters or joins on hardcoded producer equality.
    for (const label of [
      'atrib-emit',
      'atrib-attest',
      'atrib-annotate',
      'atrib-revise',
      'atrib-attest-cli',
      'atrib-emit-cli',
    ]) {
      expect(producers.has(label), label).toBe(true)
    }
    for (const label of expectations.expected.producer_labels) {
      expect(expectations.expected.distinct_labels_accepted).toContain(label)
    }
  })

  it('accepts a mixed-vocabulary D084 calls.jsonl (L2)', () => {
    const lines = readFileSync(join(CORPUS, 'persisted-labels', 'mixed-calls.jsonl'), 'utf8')
      .trim()
      .split('\n')
    expect(lines.length).toBeGreaterThan(0)
    const primitives: string[] = []
    for (const line of lines) {
      const entry = JSON.parse(line) as Record<string, unknown>
      // The stable wire schema per ReadPrimitiveCallLogEntry.
      expect(typeof entry['invoked_at']).toBe('number')
      expect(typeof entry['primitive']).toBe('string')
      expect(Array.isArray(entry['query_shape'])).toBe(true)
      expect(Array.isArray(entry['sample_result_hashes'])).toBe(true)
      expect(typeof entry['errored']).toBe('boolean')
      primitives.push(entry['primitive'] as string)
    }
    // Both vocabularies present; analyzers accept the union and never
    // rewrite history.
    expect(primitives).toContain('recall_my_attribution_history')
    expect(primitives).toContain('trace')
    expect(primitives.some((p) => p.startsWith('recall:'))).toBe(true)
  })
})
