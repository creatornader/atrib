import { describe, expect, it } from 'vitest'
import { verifyRecord } from '@atrib/mcp'
import { buildCanaryRecord, runLiveGraphCanary } from '../scripts/live-graph-canary.mjs'

describe('live graph canary', () => {
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

  it('fails when graph never indexes the submitted canary record', async () => {
    await expect(
      runLiveGraphCanary({
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
      }),
    ).rejects.toThrow(/graph did not index canary/)
  })
})

function resultRecordHashFromUrl(url: string): string {
  const hash = decodeURIComponent(url.split('/trace/')[1] ?? '')
  if (!hash.startsWith('sha256:')) throw new Error(`missing trace hash in ${url}`)
  return hash
}
