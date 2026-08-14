import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyRecord } from '@atrib/mcp'
import {
  buildCanaryRecord,
  GraphCanaryError,
  readCanarySeed,
  runLiveGraphCanary,
  writeGraphCanaryFailureDiagnostics,
} from '../scripts/live-graph-canary.mjs'

describe('live graph canary', () => {
  it('refuses to use the public derivable development seed for a live run', () => {
    expect(() => readCanarySeed({})).toThrow(/ATRIB_GRAPH_CANARY_KEY is required/)
  })

  it('builds a self-verifying signed record', async () => {
    const { record, record_hash } = await buildCanaryRecord({
      now: () => 1_780_000_000_000,
      contextId: '0'.repeat(32),
    })

    expect(record_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(record.creator_key).toMatch(/^[A-Za-z0-9_-]{43}$/)
    await expect(verifyRecord(record)).resolves.toBe(true)
  })

  it('submits a signed canary record and polls graph until the record is indexed', async () => {
    const calls: Array<{ url: string; method: string }> = []
    const result = await runLiveGraphCanary({
      logEndpoint: 'https://log.example.test/v1',
      graphEndpoint: 'https://graph.example.test/v1',
      now: () => 1_780_000_000_000,
      contextId: '1'.repeat(32),
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), method: init?.method ?? 'GET' })
        if (String(url) === 'https://log.example.test/v1/entries') {
          return new Response(
            JSON.stringify({
              log_index: 123,
              checkpoint: 'log.test/v1\n124\nroot\n',
              inclusion_proof: [],
              leaf_hash: 'leaf',
            }),
            { status: 200 },
          )
        }
        if (calls.filter((c) => c.url.includes('/trace/')).length === 1) {
          return new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
        }
        return new Response(
          JSON.stringify({
            start_record_hash: resultRecordHashFromUrl(String(url)),
            record_count: 1,
            graph: {
              nodes: [{ id: resultRecordHashFromUrl(String(url)), log_index: 123 }],
            },
          }),
          { status: 200 },
        )
      },
      pollDelayMs: 1,
      timeoutMs: 500,
    })

    expect(result.log_index).toBe(123)
    expect(result.record_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(result.context_id).toBe('1'.repeat(32))
    expect(calls.map((c) => c.method)).toEqual(['POST', 'GET', 'GET'])
  })

  it('retains graph response diagnostics when the canary never indexes', async () => {
    let failure: unknown
    try {
      await runLiveGraphCanary({
        logEndpoint: 'https://log.example.test/v1',
        graphEndpoint: 'https://graph.example.test/v1',
        now: () => 1_780_000_000_000,
        contextId: '2'.repeat(32),
        fetchImpl: async (url, init) => {
          if (String(url) === 'https://log.example.test/v1/entries') {
            return new Response(
              JSON.stringify({
                log_index: 124,
                checkpoint: 'log.test/v1\n125\nroot\n',
                inclusion_proof: [],
                leaf_hash: 'leaf',
              }),
              { status: 200 },
            )
          }
          return new Response(JSON.stringify({ error: 'not found' }), {
            status: init?.method === 'POST' ? 500 : 404,
          })
        },
        pollDelayMs: 1,
        timeoutMs: 20,
      })
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(GraphCanaryError)
    expect(failure).toHaveProperty('message', expect.stringMatching(/graph did not index canary/))
    expect((failure as GraphCanaryError).diagnostics).toMatchObject({
      status: 'graph-indexing-timeout',
      record_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      context_id: '2'.repeat(32),
      log_index: 124,
      last_status: '404',
    })
    expect((failure as GraphCanaryError).diagnostics.retries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attempt: 1,
          status: 404,
          indexed: false,
          response: { error: 'not found' },
        }),
      ]),
    )
  })

  it('writes a failure artifact for workflow upload', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'atrib-graph-canary-'))
    const filePath = join(directory, 'diagnostics.json')
    const error = new GraphCanaryError('graph did not index canary', {
      schema_version: 1,
      status: 'graph-indexing-timeout',
      record_hash: 'sha256:test',
      log_index: 125,
    })

    try {
      await writeGraphCanaryFailureDiagnostics(filePath, error)
      await expect(readFile(filePath, 'utf8')).resolves.toContain('graph-indexing-timeout')
      await expect(readFile(filePath, 'utf8')).resolves.toContain('sha256:test')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

function resultRecordHashFromUrl(url: string): string {
  const hash = decodeURIComponent(url.split('/trace/')[1] ?? '')
  if (!hash.startsWith('sha256:')) throw new Error(`missing trace hash in ${url}`)
  return hash
}
