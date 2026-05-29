// SPDX-License-Identifier: Apache-2.0

/**
 * End-to-end MCP protocol smoke test.
 *
 * Spawns the built atrib-recall binary as a child process and exercises the
 * real JSON-RPC stdio loop the way Claude Code does. Without this, regressions
 * in the MCP wiring (request schemas, transport, tool registration) only
 * surface in production. The function-level recall.test.ts can pass while the
 * MCP surface is broken.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  signRecord,
  getPublicKey,
  base64urlEncode,
  genesisChainRoot,
  EVENT_TYPE_OBSERVATION_URI,
  EVENT_TYPE_TOOL_CALL_URI,
} from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'

const KEY = new Uint8Array(32).fill(31)
const CTX = 'a'.repeat(32)

const BINARY = resolve(__dirname, '..', 'dist', 'index.js')

async function makeSigned(timestamp = 1700000000000): Promise<AtribRecord> {
  return makeSignedEvent(timestamp, EVENT_TYPE_TOOL_CALL_URI)
}

async function makeSignedEvent(
  timestamp = 1700000000000,
  eventType = EVENT_TYPE_TOOL_CALL_URI,
): Promise<AtribRecord> {
  const pub = await getPublicKey(KEY)
  const record = {
    spec_version: 'atrib/1.0' as const,
    // URI form per spec §1.2.4 + §1.4.5; verifyRecord rejects the legacy
    // short form 'tool_call' that this fixture used pre-URI-migration.
    event_type: eventType,
    context_id: CTX,
    creator_key: base64urlEncode(pub),
    chain_root: genesisChainRoot(CTX),
    content_id: `sha256:${timestamp.toString(16).padStart(64, '0')}`,
    timestamp,
    signature: '',
  }
  return signRecord(record as AtribRecord, KEY)
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number
  result?: unknown
  error?: { code: number; message: string }
}

class McpClient {
  private child: ChildProcessWithoutNullStreams
  private buffer = ''
  private pending = new Map<number, (msg: JsonRpcResponse) => void>()

  constructor(env: NodeJS.ProcessEnv) {
    this.child = spawn('node', [BINARY], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child.stdout.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf8')
      let idx = this.buffer.indexOf('\n')
      while (idx >= 0) {
        const line = this.buffer.slice(0, idx).trim()
        this.buffer = this.buffer.slice(idx + 1)
        if (line) {
          try {
            const msg = JSON.parse(line) as JsonRpcResponse
            const cb = this.pending.get(msg.id)
            if (cb) {
              this.pending.delete(msg.id)
              cb(msg)
            }
          } catch {
            // ignore malformed line
          }
        }
        idx = this.buffer.indexOf('\n')
      }
    })
  }

  send(method: string, params: unknown, id: number): Promise<JsonRpcResponse> {
    return new Promise((resolveResp, rejectResp) => {
      this.pending.set(id, resolveResp)
      const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params })
      this.child.stdin.write(payload + '\n')
      // 4 second per-call timeout - plenty for local stdio.
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          rejectResp(new Error(`mcp call ${method} timed out`))
        }
      }, 4000)
    })
  }

  async initialize(): Promise<void> {
    await this.send(
      'initialize',
      {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'atrib-recall-test', version: '0.0.0' },
      },
      0,
    )
    // notifications/initialized has no response per spec - fire-and-forget.
    this.child.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n',
    )
  }

  close(): void {
    this.child.stdin.end()
    this.child.kill('SIGTERM')
  }
}

let tmp: string
let recordFile: string

beforeAll(() => {
  // Ensure the binary is built. Tests run after `npm test`, which is invoked
  // post-build in CI; locally a stale dist will surface here as a missing-file
  // child process error.
})

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'atrib-recall-mcp-'))
  recordFile = join(tmp, 'records.jsonl')
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

afterAll(() => {
  // no-op
})

describe('MCP protocol surface', () => {
  it('lists recall_my_attribution_history under tools/list', async () => {
    const client = new McpClient({ ATRIB_RECORD_FILE: recordFile })
    try {
      await client.initialize()
      const res = await client.send('tools/list', {}, 1)
      expect(res.error).toBeUndefined()
      const tools = (res.result as { tools: { name: string }[] }).tools
      // Layer 1 registers eight tools: the existing recall_my_attribution_history
      // plus siblings recall_annotations / recall_revisions / recall_walk /
      // recall_by_content (the original four), plus the post-D086 audit-pass
      // additions recall_session_chain / recall_orphans / recall_by_signer
      // — all functional and exposing the cognitive surface beyond base
      // filter-and-page.
      expect(tools).toHaveLength(8)
      const names = tools.map((t) => t.name).sort()
      expect(names).toEqual([
        'recall_annotations',
        'recall_by_content',
        'recall_by_signer',
        'recall_my_attribution_history',
        'recall_orphans',
        'recall_revisions',
        'recall_session_chain',
        'recall_walk',
      ])
    } finally {
      client.close()
    }
  })

  it('returns the local mirror via tools/call', async () => {
    const r = await makeSigned(1700000000000)
    writeFileSync(recordFile, JSON.stringify(r))

    const client = new McpClient({ ATRIB_RECORD_FILE: recordFile })
    try {
      await client.initialize()
      const res = await client.send(
        'tools/call',
        {
          name: 'recall_my_attribution_history',
          arguments: { compact: true },
        },
        2,
      )
      expect(res.error).toBeUndefined()
      const result = res.result as { content: { type: string; text: string }[] }
      expect(result.content).toHaveLength(1)
      const payload = JSON.parse(result.content[0]!.text) as {
        total: number
        records: {
          signature_verified: boolean
          context_id: string
          // Layer 1 v2 legibility fields on compact responses. Asserted
          // here at the MCP wire layer in addition to the direct-recall()
          // integration test in layer1-filters.test.ts, so that JSON
          // serialization or transport-layer regressions get caught.
          display_summary?: string
          display_producer?: string
          age?: string
        }[]
      }
      expect(payload.total).toBe(1)
      expect(payload.records[0]!.signature_verified).toBe(true)
      expect(payload.records[0]!.context_id).toBe(CTX)
      expect(typeof payload.records[0]!.display_summary).toBe('string')
      expect(typeof payload.records[0]!.display_producer).toBe('string')
      expect(typeof payload.records[0]!.age).toBe('string')
    } finally {
      client.close()
    }
  })

  it('rejects unknown tool names with a JSON-RPC error', async () => {
    const client = new McpClient({ ATRIB_RECORD_FILE: recordFile })
    try {
      await client.initialize()
      const res = await client.send('tools/call', { name: 'nonexistent_tool', arguments: {} }, 3)
      // The MCP SDK surfaces unknown tools either as a JSON-RPC error or as
      // an error-bearing result (isError: true). Accept either shape.
      const errored =
        res.error !== undefined || (res.result as { isError?: boolean })?.isError === true
      expect(errored).toBe(true)
    } finally {
      client.close()
    }
  })

  it('recall_annotations returns the aggregated summary for a target record', async () => {
    // Construct an annotation envelope pointing at a tool_call record; verify
    // recall_annotations returns the AnnotationSummary via the MCP wire.
    const target = await makeSigned(1700000000000)
    const { computeRecordHash } = await import('../src/aggregations.js')
    const targetHash = computeRecordHash(target)
    const annoRecord = {
      spec_version: 'atrib/1.0' as const,
      event_type: 'https://atrib.dev/v1/types/annotation',
      context_id: CTX,
      creator_key: base64urlEncode(await getPublicKey(KEY)),
      chain_root: genesisChainRoot(CTX),
      content_id: `sha256:${'a'.repeat(64)}`,
      timestamp: 1700000001000,
      signature: '',
    }
    const annoSigned = await signRecord(annoRecord as AtribRecord, KEY)
    writeFileSync(
      recordFile,
      [
        JSON.stringify(target),
        JSON.stringify({
          record: annoSigned,
          _local: {
            content: {
              annotates: targetHash,
              importance: 'high',
              topic_tags: ['security'],
              summary: 'flagged for review',
            },
          },
        }),
      ].join('\n'),
    )
    const client = new McpClient({ ATRIB_RECORD_FILE: recordFile })
    try {
      await client.initialize()
      const res = await client.send(
        'tools/call',
        {
          name: 'recall_annotations',
          arguments: { record_hash: targetHash },
        },
        2,
      )
      expect(res.error).toBeUndefined()
      const result = res.result as { content: { type: string; text: string }[] }
      const payload = JSON.parse(result.content[0]!.text) as {
        record_hash: string
        annotations: {
          max_importance: string
          topics: string[]
          summary: string
        } | null
      }
      expect(payload.record_hash).toBe(targetHash)
      expect(payload.annotations).toEqual({
        max_importance: 'high',
        topics: ['security'],
        summary: 'flagged for review',
      })
    } finally {
      client.close()
    }
  })

  it('recall_my_attribution_history returns TOC shape when toc=true', async () => {
    const r = await makeSigned(1700000000000)
    writeFileSync(recordFile, JSON.stringify(r))
    const client = new McpClient({ ATRIB_RECORD_FILE: recordFile })
    try {
      await client.initialize()
      const res = await client.send(
        'tools/call',
        {
          name: 'recall_my_attribution_history',
          arguments: { toc: true },
        },
        2,
      )
      expect(res.error).toBeUndefined()
      const result = res.result as { content: { type: string; text: string }[] }
      const payload = JSON.parse(result.content[0]!.text) as {
        total: number
        returned: number
        records: Array<{ record_hash?: string; timestamp: number; event_type?: string }>
        layer_1_warnings?: unknown[]
      }
      expect(payload.total).toBe(1)
      expect(payload.returned).toBe(1)
      const entry = payload.records[0]!
      expect(entry.record_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(entry.timestamp).toBe(1700000000000)
      // TOC drops the heavy AtribRecord fields.
      expect(entry.event_type).toBeUndefined()
      // toc is no longer stub-accepted; layer_1_warnings is not surfaced.
      expect(payload.layer_1_warnings).toBeUndefined()
    } finally {
      client.close()
    }
  })

  it('recall_by_content ranks records by Park et al. weighted-sum against a query', async () => {
    const { computeRecordHash } = await import('../src/aggregations.js')
    const target = await makeSigned(1700000000000)
    const targetHash = computeRecordHash(target)
    const pub = await getPublicKey(KEY)
    const anno = await signRecord(
      {
        spec_version: 'atrib/1.0',
        event_type: 'https://atrib.dev/v1/types/annotation',
        context_id: CTX,
        creator_key: base64urlEncode(pub),
        chain_root: genesisChainRoot(CTX),
        content_id: `sha256:${'a'.repeat(64)}`,
        timestamp: 1700000001000,
        signature: '',
      } as AtribRecord,
      KEY,
    )
    writeFileSync(
      recordFile,
      [
        JSON.stringify(target),
        JSON.stringify({
          record: anno,
          _local: {
            content: {
              annotates: targetHash,
              importance: 'high',
              topic_tags: ['security'],
              summary: 'authentication bypass found',
            },
          },
        }),
      ].join('\n'),
    )
    const client = new McpClient({ ATRIB_RECORD_FILE: recordFile })
    try {
      await client.initialize()
      const res = await client.send(
        'tools/call',
        {
          name: 'recall_by_content',
          arguments: { query: 'authentication bypass', k: 5 },
        },
        2,
      )
      expect(res.error).toBeUndefined()
      const result = res.result as { content: { type: string; text: string }[] }
      const payload = JSON.parse(result.content[0]!.text) as {
        query: string
        k: number
        count: number
        results: Array<{
          record_hash: string
          score: number
          components: { recency: number; importance: number; relevance: number }
          // Layer 1 v2 legibility fields extended to recall_by_content
          // in the audit-pass-1 follow-up (0.9.0). The shape should match
          // recall_my_attribution_history compact responses so agents see
          // consistent surfaces across the recall tool family.
          display_summary?: string
          display_producer?: string
          age?: string
        }>
      }
      expect(payload.query).toBe('authentication bypass')
      expect(payload.k).toBe(5)
      // The annotated target should rank above the un-annotated annotation
      // record itself (annotated record has importance + relevance signal).
      const top = payload.results[0]
      expect(top?.record_hash).toBe(targetHash)
      expect(top?.components.relevance).toBeGreaterThan(0)
      // Audit-pass-1: every result carries the legibility fields. Top hit
      // is the annotated target; display_summary should surface the
      // annotation summary verbatim (annotation summary wins the synthesis
      // fallback chain when present).
      expect(typeof top?.display_summary).toBe('string')
      expect(top?.display_summary).toBe('authentication bypass found')
      expect(typeof top?.display_producer).toBe('string')
      expect(typeof top?.age).toBe('string')
    } finally {
      client.close()
    }
  })

  it('recall_by_content retrieves OpenInference sidecar fields across prompt, model, usage, cost, score, and output', async () => {
    const { computeRecordHash } = await import('../src/aggregations.js')
    const target = await makeSignedEvent(1700000001000, EVENT_TYPE_OBSERVATION_URI)
    const targetHash = computeRecordHash(target)
    const distractor = await makeSignedEvent(1700000000000, EVENT_TYPE_OBSERVATION_URI)
    writeFileSync(
      recordFile,
      [
        JSON.stringify({
          record: target,
          _local: {
            content: {
              source: 'openinference',
              span_kind: 'LLM',
              span_name: 'generate-text',
              model_name: 'qwen3.5-large',
              prompt_version: 'refund-policy-v7',
              prompt: 'Apply refund policy to late return',
              output: 'Denied because the return window elapsed',
              usage_details: { input_tokens: 111, output_tokens: 222 },
              cost_details: { cost_bucket: 'micro-usd-42', currency: 'usd' },
              score_details: { evaluator: 'faithfulness', verdict: 'pass' },
              metadata: { release: 'canary-2026' },
            },
          },
        }),
        JSON.stringify({
          record: distractor,
          _local: {
            content: {
              source: 'openinference',
              span_kind: 'EMBEDDING',
              span_name: 'embed-docs',
              model_name: 'text-embedding-3',
              prompt_version: 'inventory-v1',
              output: 'Indexed warehouse labels',
              usage_details: { input_tokens: 9, output_tokens: 0 },
              cost_details: { cost_bucket: 'micro-usd-1', currency: 'usd' },
              score_details: { evaluator: 'coverage', verdict: 'ok' },
            },
          },
        }),
      ].join('\n'),
    )
    const client = new McpClient({ ATRIB_RECORD_FILE: recordFile })
    try {
      await client.initialize()
      for (const query of [
        'refund policy v7',
        'qwen3 large',
        'input tokens 111 output tokens 222',
        'micro usd 42 faithfulness pass',
        'denied return window elapsed',
        'generate text canary 2026',
      ]) {
        const res = await client.send(
          'tools/call',
          {
            name: 'recall_by_content',
            arguments: { query, k: 2 },
          },
          20 + query.length,
        )
        expect(res.error).toBeUndefined()
        const result = res.result as { content: { type: string; text: string }[] }
        const payload = JSON.parse(result.content[0]!.text) as {
          results: Array<{ record_hash: string; components: { relevance: number } }>
        }
        expect(payload.results[0]?.record_hash).toBe(targetHash)
        expect(payload.results[0]?.components.relevance).toBeGreaterThan(0)
      }
    } finally {
      client.close()
    }
  })

  it('recall_walk walks chain-precedes edges from an anchor', async () => {
    const { canonicalRecord, sha256, hexEncode } = await import('@atrib/mcp')
    const chainRootFor = (r: AtribRecord) => `sha256:${hexEncode(sha256(canonicalRecord(r)))}`
    const { computeRecordHash } = await import('../src/aggregations.js')
    const r1 = await makeSigned(1700000000000)
    const r1Hash = computeRecordHash(r1)
    const pub = await getPublicKey(KEY)
    const r2 = await signRecord(
      {
        spec_version: 'atrib/1.0',
        event_type: EVENT_TYPE_TOOL_CALL_URI,
        context_id: CTX,
        creator_key: base64urlEncode(pub),
        chain_root: chainRootFor(r1),
        content_id: `sha256:${'2'.repeat(64)}`,
        timestamp: 1700000001000,
        signature: '',
      } as AtribRecord,
      KEY,
    )
    const r2Hash = computeRecordHash(r2)
    writeFileSync(recordFile, [JSON.stringify(r1), JSON.stringify(r2)].join('\n'))
    const client = new McpClient({ ATRIB_RECORD_FILE: recordFile })
    try {
      await client.initialize()
      const res = await client.send(
        'tools/call',
        {
          name: 'recall_walk',
          arguments: { from_record_hash: r1Hash, depth: 2 },
        },
        2,
      )
      expect(res.error).toBeUndefined()
      const result = res.result as { content: { type: string; text: string }[] }
      const payload = JSON.parse(result.content[0]!.text) as {
        from_record_hash: string
        count: number
        walk: Array<{
          record_hash: string
          distance: number
          // Layer 1 v2 legibility fields (added in 0.8.0+ when the loaded
          // record can be joined back to the walked hash).
          event_type?: string
          timestamp?: number
          display_summary?: string
          display_producer?: string
          age?: string
        }>
      }
      expect(payload.from_record_hash).toBe(r1Hash)
      expect(payload.count).toBe(1)
      // Assert structural fields without locking the exact display values
      // (those depend on test-fixture content + clock time).
      const step = payload.walk[0]!
      expect(step.record_hash).toBe(r2Hash)
      expect(step.distance).toBe(1)
      expect(typeof step.display_summary).toBe('string')
      expect(typeof step.display_producer).toBe('string')
      expect(typeof step.age).toBe('string')
    } finally {
      client.close()
    }
  })

  it('recall_revisions returns the linked chain of revisions', async () => {
    // orig <- r1 <- r2 chain. Calling on orig should return [r1Hash, r2Hash].
    const orig = await makeSigned(1700000000000)
    const { computeRecordHash } = await import('../src/aggregations.js')
    const origHash = computeRecordHash(orig)
    const r1 = await signRecord(
      {
        spec_version: 'atrib/1.0',
        event_type: 'https://atrib.dev/v1/types/revision',
        context_id: CTX,
        creator_key: base64urlEncode(await getPublicKey(KEY)),
        chain_root: genesisChainRoot(CTX),
        content_id: `sha256:${'b'.repeat(64)}`,
        timestamp: 1700000001000,
        signature: '',
      } as AtribRecord,
      KEY,
    )
    const r1Hash = computeRecordHash(r1)
    const r2 = await signRecord(
      {
        spec_version: 'atrib/1.0',
        event_type: 'https://atrib.dev/v1/types/revision',
        context_id: CTX,
        creator_key: base64urlEncode(await getPublicKey(KEY)),
        chain_root: genesisChainRoot(CTX),
        content_id: `sha256:${'c'.repeat(64)}`,
        timestamp: 1700000002000,
        signature: '',
      } as AtribRecord,
      KEY,
    )
    const r2Hash = computeRecordHash(r2)
    writeFileSync(
      recordFile,
      [
        JSON.stringify(orig),
        JSON.stringify({ record: r1, _local: { content: { revises: origHash } } }),
        JSON.stringify({ record: r2, _local: { content: { revises: r1Hash } } }),
      ].join('\n'),
    )
    const client = new McpClient({ ATRIB_RECORD_FILE: recordFile })
    try {
      await client.initialize()
      const res = await client.send(
        'tools/call',
        {
          name: 'recall_revisions',
          arguments: { record_hash: origHash },
        },
        2,
      )
      expect(res.error).toBeUndefined()
      const result = res.result as { content: { type: string; text: string }[] }
      // Post-D086 the chain entries carry per-revision content (record_hash,
      // timestamp, and the D086-normative new_position/reason/importance
      // fields when present) rather than bare hash strings; this test's
      // fixtures only set `revises` in content (no new_position/reason/
      // importance), so only record_hash + timestamp are populated.
      const payload = JSON.parse(result.content[0]!.text) as {
        record_hash: string
        revision_chain: { record_hash: string; timestamp?: number }[]
      }
      expect(payload.record_hash).toBe(origHash)
      expect(payload.revision_chain.map((e) => e.record_hash)).toEqual([r1Hash, r2Hash])
      expect(payload.revision_chain[0]?.timestamp).toBe(1700000001000)
      expect(payload.revision_chain[1]?.timestamp).toBe(1700000002000)
    } finally {
      client.close()
    }
  })

  it('recall_revisions surfaces per-revision content (new_position, reason, importance) when present', async () => {
    // Same chain shape as above but with D086-normative revision content
    // fields populated; each chain entry should carry them inline so the
    // agent reads the chain without follow-up recall calls per revision.
    const orig = await makeSigned(1700000000000)
    const { computeRecordHash } = await import('../src/aggregations.js')
    const origHash = computeRecordHash(orig)
    const r1 = await signRecord(
      {
        spec_version: 'atrib/1.0',
        event_type: 'https://atrib.dev/v1/types/revision',
        context_id: CTX,
        creator_key: base64urlEncode(await getPublicKey(KEY)),
        chain_root: genesisChainRoot(CTX),
        content_id: `sha256:${'1'.repeat(64)}`,
        timestamp: 1700000001000,
        signature: '',
      } as AtribRecord,
      KEY,
    )
    const r1Hash = computeRecordHash(r1)
    const r2 = await signRecord(
      {
        spec_version: 'atrib/1.0',
        event_type: 'https://atrib.dev/v1/types/revision',
        context_id: CTX,
        creator_key: base64urlEncode(await getPublicKey(KEY)),
        chain_root: genesisChainRoot(CTX),
        content_id: `sha256:${'2'.repeat(64)}`,
        timestamp: 1700000002000,
        signature: '',
      } as AtribRecord,
      KEY,
    )
    const r2Hash = computeRecordHash(r2)
    writeFileSync(
      recordFile,
      [
        JSON.stringify(orig),
        JSON.stringify({
          record: r1,
          _local: {
            content: {
              revises: origHash,
              new_position: 'accept localhost in non-strict mode',
              reason: 'developer feedback during testing',
              importance: 'high',
            },
          },
        }),
        JSON.stringify({
          record: r2,
          _local: {
            content: {
              revises: r1Hash,
              new_position: 'also accept invalid TLDs in non-strict mode',
              reason: 'aligning with WHATWG URL spec',
              importance: 'medium',
            },
          },
        }),
      ].join('\n'),
    )
    const client = new McpClient({ ATRIB_RECORD_FILE: recordFile })
    try {
      await client.initialize()
      const res = await client.send(
        'tools/call',
        {
          name: 'recall_revisions',
          arguments: { record_hash: origHash },
        },
        2,
      )
      expect(res.error).toBeUndefined()
      const result = res.result as { content: { type: string; text: string }[] }
      const payload = JSON.parse(result.content[0]!.text) as {
        record_hash: string
        revision_chain: {
          record_hash: string
          timestamp?: number
          new_position?: string
          reason?: string
          importance?: string
        }[]
      }
      expect(payload.revision_chain).toHaveLength(2)
      expect(payload.revision_chain[0]).toMatchObject({
        record_hash: r1Hash,
        timestamp: 1700000001000,
        new_position: 'accept localhost in non-strict mode',
        reason: 'developer feedback during testing',
        importance: 'high',
      })
      expect(payload.revision_chain[1]).toMatchObject({
        record_hash: r2Hash,
        timestamp: 1700000002000,
        new_position: 'also accept invalid TLDs in non-strict mode',
        reason: 'aligning with WHATWG URL spec',
        importance: 'medium',
      })
    } finally {
      client.close()
    }
  })

  it('recall_revisions exposes sibling_hashes when multiple revisions target the same record', async () => {
    // Fork at the original: r1a (chosen by first-by-timestamp) AND r1b
    // both revise orig. The chain should follow r1a; r1b should appear
    // as the entry's `sibling_hashes`.
    const orig = await makeSigned(1700000000000)
    const { computeRecordHash } = await import('../src/aggregations.js')
    const origHash = computeRecordHash(orig)
    const r1a = await signRecord(
      {
        spec_version: 'atrib/1.0',
        event_type: 'https://atrib.dev/v1/types/revision',
        context_id: CTX,
        creator_key: base64urlEncode(await getPublicKey(KEY)),
        chain_root: genesisChainRoot(CTX),
        content_id: `sha256:${'a'.repeat(64)}`,
        timestamp: 1700000001000,
        signature: '',
      } as AtribRecord,
      KEY,
    )
    const r1aHash = computeRecordHash(r1a)
    const r1b = await signRecord(
      {
        spec_version: 'atrib/1.0',
        event_type: 'https://atrib.dev/v1/types/revision',
        context_id: CTX,
        creator_key: base64urlEncode(await getPublicKey(KEY)),
        chain_root: genesisChainRoot(CTX),
        content_id: `sha256:${'b'.repeat(64)}`,
        timestamp: 1700000002000,
        signature: '',
      } as AtribRecord,
      KEY,
    )
    const r1bHash = computeRecordHash(r1b)
    writeFileSync(
      recordFile,
      [
        JSON.stringify(orig),
        JSON.stringify({
          record: r1a,
          _local: { content: { revises: origHash, new_position: 'branch A' } },
        }),
        JSON.stringify({
          record: r1b,
          _local: { content: { revises: origHash, new_position: 'branch B' } },
        }),
      ].join('\n'),
    )
    const client = new McpClient({ ATRIB_RECORD_FILE: recordFile })
    try {
      await client.initialize()
      const res = await client.send(
        'tools/call',
        { name: 'recall_revisions', arguments: { record_hash: origHash } },
        2,
      )
      const result = res.result as { content: { type: string; text: string }[] }
      const payload = JSON.parse(result.content[0]!.text) as {
        revision_chain: { record_hash: string; new_position?: string; sibling_hashes?: string[] }[]
      }
      expect(payload.revision_chain).toHaveLength(1)
      expect(payload.revision_chain[0]?.record_hash).toBe(r1aHash)
      expect(payload.revision_chain[0]?.new_position).toBe('branch A')
      expect(payload.revision_chain[0]?.sibling_hashes).toEqual([r1bHash])
    } finally {
      client.close()
    }
  })

  it('recall_session_chain returns context_id records in chronological order', async () => {
    const ctx1 = 'a'.repeat(32)
    const ctx2 = 'b'.repeat(32)
    const pub = await getPublicKey(KEY)
    const ck = base64urlEncode(pub)
    async function rec(ctx: string, ts: number, cid: string) {
      return signRecord(
        {
          spec_version: 'atrib/1.0' as const,
          event_type: EVENT_TYPE_TOOL_CALL_URI,
          context_id: ctx,
          creator_key: ck,
          chain_root: genesisChainRoot(ctx),
          content_id: cid,
          timestamp: ts,
          signature: '',
        } as AtribRecord,
        KEY,
      )
    }
    const records = [
      await rec(ctx1, 3000, `sha256:${'c'.repeat(64)}`),
      await rec(ctx2, 5000, `sha256:${'d'.repeat(64)}`),
      await rec(ctx1, 1000, `sha256:${'a'.repeat(64)}`),
      await rec(ctx1, 2000, `sha256:${'b'.repeat(64)}`),
    ]
    writeFileSync(recordFile, records.map((r) => JSON.stringify(r)).join('\n'))
    const client = new McpClient({ ATRIB_RECORD_FILE: recordFile })
    try {
      await client.initialize()
      const res = await client.send(
        'tools/call',
        { name: 'recall_session_chain', arguments: { context_id: ctx1 } },
        2,
      )
      const result = res.result as { content: { type: string; text: string }[] }
      const payload = JSON.parse(result.content[0]!.text) as {
        context_id: string
        total: number
        returned: number
        records: { timestamp: number }[]
      }
      expect(payload.context_id).toBe(ctx1)
      expect(payload.total).toBe(3)
      expect(payload.records.map((r) => r.timestamp)).toEqual([1000, 2000, 3000])
    } finally {
      client.close()
    }
  })

  it('recall_session_chain can return D062 local content when requested', async () => {
    const ctx = 'c'.repeat(32)
    const pub = await getPublicKey(KEY)
    const record = await signRecord(
      {
        spec_version: 'atrib/1.0' as const,
        event_type: EVENT_TYPE_TOOL_CALL_URI,
        context_id: ctx,
        creator_key: base64urlEncode(pub),
        chain_root: genesisChainRoot(ctx),
        content_id: `sha256:${'e'.repeat(64)}`,
        timestamp: 1700000000000,
        signature: '',
        tool_name: 'diagnostic_config_parser_probe',
        args_hash: `sha256:${'1'.repeat(64)}`,
        result_hash: `sha256:${'2'.repeat(64)}`,
        informed_by: [`sha256:${'3'.repeat(64)}`],
      } as AtribRecord,
      KEY,
    )
    writeFileSync(
      recordFile,
      JSON.stringify({
        record,
        _local: {
          content: { tool_name: 'python_atrib', result: 'edge decisions' },
          producer: 'test-producer',
        },
      }),
    )
    const readLog = join(tmp, 'read-primitives.jsonl')
    const client = new McpClient({
      ATRIB_RECORD_FILE: recordFile,
      ATRIB_READ_PRIMITIVES_LOG: readLog,
    })
    try {
      await client.initialize()
      const res = await client.send(
        'tools/call',
        {
          name: 'recall_session_chain',
          arguments: { context_id: ctx, include_content: true },
        },
        2,
      )
      const result = res.result as { content: { type: string; text: string }[] }
      const payload = JSON.parse(result.content[0]!.text) as {
        records: Array<{
          record_hash: string
          tool_name?: string
          args_hash?: string
          result_hash?: string
          informed_by?: string[]
          local_content?: unknown
          local_producer?: string
        }>
      }
      expect(payload.records[0]?.tool_name).toBe('diagnostic_config_parser_probe')
      expect(payload.records[0]?.args_hash).toBe(`sha256:${'1'.repeat(64)}`)
      expect(payload.records[0]?.result_hash).toBe(`sha256:${'2'.repeat(64)}`)
      expect(payload.records[0]?.informed_by).toEqual([`sha256:${'3'.repeat(64)}`])
      expect(payload.records[0]?.local_content).toEqual({
        tool_name: 'python_atrib',
        result: 'edge decisions',
      })
      expect(payload.records[0]?.local_producer).toBe('test-producer')
      const logRows = readFileSync(readLog, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { sample_result_hashes?: string[] })
      expect(logRows.at(-1)?.sample_result_hashes).toEqual([payload.records[0]?.record_hash])
      expect(logRows.at(-1)?.sample_result_hashes).not.toContain(`sha256:${'1'.repeat(64)}`)
      expect(logRows.at(-1)?.sample_result_hashes).not.toContain(`sha256:${'2'.repeat(64)}`)
    } finally {
      client.close()
    }
  })

  it('recall_orphans returns records that nothing else cites via informed_by', async () => {
    // r1 is cited by r2 via informed_by; r3 is uncited (orphan).
    const pub = await getPublicKey(KEY)
    const ck = base64urlEncode(pub)
    async function rec(cid: string, ts: number, informed_by?: string[]) {
      return signRecord(
        {
          spec_version: 'atrib/1.0' as const,
          event_type: EVENT_TYPE_TOOL_CALL_URI,
          context_id: CTX,
          creator_key: ck,
          chain_root: genesisChainRoot(CTX),
          content_id: cid,
          timestamp: ts,
          signature: '',
          ...(informed_by && informed_by.length > 0 ? { informed_by } : {}),
        } as AtribRecord,
        KEY,
      )
    }
    const r1 = await rec(`sha256:${'1'.repeat(64)}`, 100)
    const r1Hash = (await import('../src/aggregations.js')).computeRecordHash(r1)
    const r2 = await rec(`sha256:${'2'.repeat(64)}`, 200, [r1Hash])
    const r3 = await rec(`sha256:${'3'.repeat(64)}`, 300)
    writeFileSync(
      recordFile,
      [JSON.stringify(r1), JSON.stringify(r2), JSON.stringify(r3)].join('\n'),
    )
    const r3Hash = (await import('../src/aggregations.js')).computeRecordHash(r3)
    const r2Hash = (await import('../src/aggregations.js')).computeRecordHash(r2)

    const client = new McpClient({ ATRIB_RECORD_FILE: recordFile })
    try {
      await client.initialize()
      const res = await client.send('tools/call', { name: 'recall_orphans', arguments: {} }, 2)
      const result = res.result as { content: { type: string; text: string }[] }
      const payload = JSON.parse(result.content[0]!.text) as {
        total: number
        records: { record_hash: string }[]
      }
      // r1 is cited (NOT orphan). r2 is uncited (orphan). r3 is uncited (orphan).
      // Newest-first ordering: r3, r2.
      expect(payload.total).toBe(2)
      expect(payload.records.map((r) => r.record_hash)).toEqual([r3Hash, r2Hash])
    } finally {
      client.close()
    }
  })

  it('recall_by_signer aggregates the mirror by creator_key', async () => {
    const KEY2 = new Uint8Array(32).fill(0x77)
    const pub2 = await getPublicKey(KEY2)
    const key2 = base64urlEncode(pub2)
    const pub1 = await getPublicKey(KEY)
    const key1 = base64urlEncode(pub1)
    async function rec1(cid: string, ts: number) {
      return signRecord(
        {
          spec_version: 'atrib/1.0' as const,
          event_type: EVENT_TYPE_TOOL_CALL_URI,
          context_id: CTX,
          creator_key: key1,
          chain_root: genesisChainRoot(CTX),
          content_id: cid,
          timestamp: ts,
          signature: '',
        } as AtribRecord,
        KEY,
      )
    }
    // Two records signed by KEY (different timestamps), one signed by KEY2.
    const r1 = await rec1(`sha256:${'a'.repeat(64)}`, 1000)
    const r2 = await rec1(`sha256:${'b'.repeat(64)}`, 3000)
    const ctx = 'b'.repeat(32)
    const unsigned3 = {
      spec_version: 'atrib/1.0' as const,
      event_type: 'https://atrib.dev/v1/types/tool_call',
      context_id: ctx,
      creator_key: key2,
      chain_root: genesisChainRoot(ctx),
      content_id: `sha256:${'c'.repeat(64)}`,
      timestamp: 2000,
      signature: '',
    }
    const r3 = await signRecord(unsigned3 as AtribRecord, KEY2)
    writeFileSync(
      recordFile,
      [JSON.stringify(r1), JSON.stringify(r2), JSON.stringify(r3)].join('\n'),
    )
    const client = new McpClient({ ATRIB_RECORD_FILE: recordFile })
    try {
      await client.initialize()
      const res = await client.send('tools/call', { name: 'recall_by_signer', arguments: {} }, 2)
      const result = res.result as { content: { type: string; text: string }[] }
      const payload = JSON.parse(result.content[0]!.text) as {
        total_signers: number
        total_records: number
        signers: {
          creator_key: string
          count: number
          latest_timestamp: number
          earliest_timestamp: number
        }[]
      }
      expect(payload.total_records).toBe(3)
      expect(payload.total_signers).toBe(2)
      // Sorted by count desc; KEY (2 records) before KEY2 (1).
      expect(payload.signers[0]).toMatchObject({
        creator_key: key1,
        count: 2,
        earliest_timestamp: 1000,
        latest_timestamp: 3000,
      })
      expect(payload.signers[1]).toMatchObject({
        creator_key: key2,
        count: 1,
        earliest_timestamp: 2000,
        latest_timestamp: 2000,
      })
    } finally {
      client.close()
    }
  })
})
