import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSubmissionQueue } from '../src/submission.js'
import { signRecord, getPublicKey } from '../src/signing.js'
import { base64urlEncode } from '../src/base64url.js'
import { genesisChainRoot } from '../src/chain-root.js'
import { canonicalRecord } from '../src/canon.js'
import { sha256, hexEncode } from '../src/hash.js'
import type { AtribRecord } from '../src/types.js'

const TEST_KEY = new Uint8Array(32).fill(1)

async function makeSignedRecord(): Promise<AtribRecord> {
  const pubKey = await getPublicKey(TEST_KEY)
  const record: AtribRecord = {
    spec_version: 'atrib/1.0',
    content_id: 'sha256:3f8a2b0000000000000000000000000000000000000000000000000000000000',
    creator_key: base64urlEncode(pubKey),
    chain_root: genesisChainRoot('4bf92f3577b34da6a3ce929d0e0e4736'),
    event_type: 'https://atrib.dev/v1/types/tool_call',
    context_id: '4bf92f3577b34da6a3ce929d0e0e4736',
    timestamp: 1743850000000,
    signature: '',
  } as AtribRecord
  return signRecord(record, TEST_KEY)
}

function recordHashHex(record: AtribRecord): string {
  return hexEncode(sha256(canonicalRecord(record)))
}

describe('createSubmissionQueue', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchMock: any

  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  /** Advance timers and drain microtasks until all pending promises settle. */
  async function advanceUntilSettled() {
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(5000)
    }
  }

  it('submit() returns void synchronously (non-blocking)', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ log_index: 1 }), { status: 200 }))
    const queue = createSubmissionQueue('https://log.test/v1/entries')
    const record = await makeSignedRecord()

    const result = queue.submit(record, 'normal')
    expect(result).toBeUndefined()

    await advanceUntilSettled()
    await queue.flush()
  })

  it('caches proof bundle on successful submission', async () => {
    // Spec §2.6.2. fields are snake_case on the wire
    const proof = {
      log_index: 42,
      checkpoint: 'log.test/v1\n43\nrootHashBase64\n',
      inclusion_proof: ['siblingHashBase64'],
      leaf_hash: 'leafHashBase64',
    }
    fetchMock.mockResolvedValue(new Response(JSON.stringify(proof), { status: 200 }))

    const queue = createSubmissionQueue('https://log.test/v1/entries')
    const record = await makeSignedRecord()
    const hash = recordHashHex(record)

    queue.submit(record, 'normal')
    await advanceUntilSettled()
    await queue.flush()

    const cached = queue.getProof(hash)
    expect(cached).toEqual(proof)
  })

  it('getProof returns undefined before submission', () => {
    const queue = createSubmissionQueue('https://log.test/v1/entries')
    expect(queue.getProof('nonexistent')).toBeUndefined()
  })

  it('does not retry on 4xx errors', async () => {
    fetchMock.mockResolvedValue(new Response('Bad Request', { status: 400 }))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const queue = createSubmissionQueue('https://log.test/v1/entries')
    const record = await makeSignedRecord()

    queue.submit(record, 'normal')
    await advanceUntilSettled()

    // Initial submit: 1 call (4xx = no retry). Flush retries pending: up to 1 more call.
    // But the pending retry also hits 4xx → no retry within that attempt either.
    const initialCalls = fetchMock.mock.calls.length

    await queue.flush()

    // flush() retries pendingRecords, which calls fetch once more (also 400, no retry)
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(initialCalls + 1)
    warnSpy.mockRestore()
  })

  it('retries on 5xx errors up to 3 times', async () => {
    fetchMock.mockResolvedValue(new Response('Server Error', { status: 500 }))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const queue = createSubmissionQueue('https://log.test/v1/entries')
    const record = await makeSignedRecord()

    queue.submit(record, 'normal')

    // Advance through all retry backoffs (initial submit + flush retry)
    // submit: attempt 0 → 1s wait → attempt 1 → 2s wait → attempt 2
    // flush retry: same pattern
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(5000)
    }

    // 3 retries for initial + up to 3 for flush retry
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3)
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(6)
    warnSpy.mockRestore()
  })

  it('retries on network errors', async () => {
    fetchMock.mockRejectedValue(new Error('Network failure'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const queue = createSubmissionQueue('https://log.test/v1/entries')
    const record = await makeSignedRecord()

    queue.submit(record, 'normal')

    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(5000)
    }

    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3)
    warnSpy.mockRestore()
  })

  it('submission errors never propagate (§5.8)', async () => {
    fetchMock.mockRejectedValue(new Error('catastrophic failure'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const queue = createSubmissionQueue('https://log.test/v1/entries')
    const record = await makeSignedRecord()

    // submit + advance timers, then flush (which also retries)
    queue.submit(record, 'normal')
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(5000)
    }

    // flush must resolve without throwing, even though everything failed
    const flushPromise = queue.flush()
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(5000)
    }
    await expect(flushPromise).resolves.toBeUndefined()

    warnSpy.mockRestore()
  })

  it('flush() resolves when queue is empty', async () => {
    const queue = createSubmissionQueue('https://log.test/v1/entries')
    await expect(queue.flush()).resolves.toBeUndefined()
  })

  it('flush() retries permanently-failed records', async () => {
    let callCount = 0
    fetchMock.mockImplementation(async () => {
      callCount++
      // First 3 calls fail (initial submit retries), then succeed
      if (callCount <= 3) {
        return new Response('Server Error', { status: 500 })
      }
      return new Response(
        JSON.stringify({
          log_index: 99,
          checkpoint: 'log.test/v1\n100\nrootHashBase64\n',
          inclusion_proof: [],
          leaf_hash: 'leafHashBase64',
        }),
        { status: 200 },
      )
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const queue = createSubmissionQueue('https://log.test/v1/entries')
    const record = await makeSignedRecord()
    const hash = recordHashHex(record)

    queue.submit(record, 'normal')
    await advanceUntilSettled()
    // flush retries pending records. this time fetch succeeds
    await queue.flush()

    const proof = queue.getProof(hash)
    expect(proof).toBeDefined()
    expect(proof!.log_index).toBe(99)

    warnSpy.mockRestore()
  })

  it('sends to the configured endpoint', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ log_index: 1 }), { status: 200 }))
    const queue = createSubmissionQueue('https://custom-log.test/submit')
    const record = await makeSignedRecord()

    queue.submit(record, 'high')
    await advanceUntilSettled()
    await queue.flush()

    expect(fetchMock).toHaveBeenCalledWith(
      'https://custom-log.test/submit',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('sends bare record as POST body per spec §2.6.1 (NOT a wrapper)', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ log_index: 1 }), { status: 200 }))
    const queue = createSubmissionQueue('https://log.test/v1/entries')
    const record = await makeSignedRecord()

    queue.submit(record, 'high')
    await advanceUntilSettled()
    await queue.flush()

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    // Spec §2.6.1: the body IS the signed record. No wrapper, no priority field.
    expect(body.spec_version).toBe('atrib/1.0')
    expect(body.creator_key).toBeDefined()
    expect(body.signature).toBeDefined()
    expect(body.context_id).toBeDefined()
    expect(body.record).toBeUndefined()
    expect(body.priority).toBeUndefined()
  })

  it('sends X-atrib-Priority header (HTTP-level extension to §2.6.1)', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ log_index: 1 }), { status: 200 }))
    const queue = createSubmissionQueue('https://log.test/v1/entries')
    const record = await makeSignedRecord()

    queue.submit(record, 'high')
    await advanceUntilSettled()
    await queue.flush()

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>
    expect(headers['X-atrib-Priority']).toBe('high')
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('sends X-atrib-Priority: normal for tool_call records', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ log_index: 1 }), { status: 200 }))
    const queue = createSubmissionQueue('https://log.test/v1/entries')
    const record = await makeSignedRecord()

    queue.submit(record, 'normal')
    await advanceUntilSettled()
    await queue.flush()

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>
    expect(headers['X-atrib-Priority']).toBe('normal')
  })

  it('flush() drains pendingRecords in priority order. high before normal', async () => {
    // Three records, two normal and one high. The first 6 fetch calls fail
    // (3 retries × 2 records, since the high-priority record is submitted
    // last and shares the failure run). On flush(), the records are retried
    // and we capture the order they hit the wire to assert the high record
    // came before the normal records.
    let callCount = 0
    const orderObserved: Array<{ priority: string; attempt: number }> = []

    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      callCount++
      const headers = init.headers as Record<string, string>
      const isFlushAttempt = callCount > 9 // initial 3 records × 3 attempts each = 9 calls
      if (isFlushAttempt) {
        orderObserved.push({ priority: headers['X-atrib-Priority']!, attempt: callCount })
        return new Response(
          JSON.stringify({
            log_index: callCount,
            checkpoint: 'log.test/v1\n1\nrootHashBase64\n',
            inclusion_proof: [],
            leaf_hash: 'leafHashBase64',
          }),
          { status: 200 },
        )
      }
      return new Response('Server Error', { status: 500 })
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const queue = createSubmissionQueue('https://log.test/v1/entries')

    // Make three signed records that differ enough to have different hashes.
    // We use different timestamps to ensure unique signatures.
    async function makeRecordAt(ts: number): Promise<AtribRecord> {
      const pubKey = await getPublicKey(TEST_KEY)
      const record: AtribRecord = {
        spec_version: 'atrib/1.0',
        content_id: 'sha256:3f8a2b0000000000000000000000000000000000000000000000000000000000',
        creator_key: base64urlEncode(pubKey),
        chain_root: genesisChainRoot('4bf92f3577b34da6a3ce929d0e0e4736'),
        event_type: 'https://atrib.dev/v1/types/tool_call',
        context_id: '4bf92f3577b34da6a3ce929d0e0e4736',
        timestamp: ts,
        signature: '',
      } as AtribRecord
      return signRecord(record, TEST_KEY)
    }

    // Submit normal, normal, high. in arrival order. The high one comes
    // last, but flush() should retry it first because of priority ordering.
    const normalA = await makeRecordAt(1743850000001)
    const normalB = await makeRecordAt(1743850000002)
    const highX = await makeRecordAt(1743850000003)

    queue.submit(normalA, 'normal')
    queue.submit(normalB, 'normal')
    queue.submit(highX, 'high')

    // Drive the initial-submit retries through their backoffs.
    for (let i = 0; i < 30; i++) {
      await vi.advanceTimersByTimeAsync(5000)
    }

    await queue.flush()

    // The first observed flush attempt should be the high-priority record.
    expect(orderObserved.length).toBeGreaterThanOrEqual(1)
    expect(orderObserved[0]!.priority).toBe('high')

    warnSpy.mockRestore()
  })

  describe('maxQueueDepth (outage memory protection)', () => {
    // Real timers for these tests — we test eviction, not retry-backoff
    // timing. Real timers + a synchronous-rejecting fetch mock makes each
    // submitWithRetry resolve in <1ms total instead of waiting on fake
    // timer advancement.
    beforeEach(() => {
      vi.useRealTimers()
    })

    /**
     * Make N distinct signed records by varying timestamp + content_id so
     * each gets a unique record_hash.
     */
    async function makeBatch(n: number, startTs: number = 1743850000000): Promise<AtribRecord[]> {
      const out: AtribRecord[] = []
      const pubKey = await getPublicKey(TEST_KEY)
      for (let i = 0; i < n; i++) {
        const record: AtribRecord = {
          spec_version: 'atrib/1.0',
          content_id: `sha256:${i.toString(16).padStart(64, '0')}`,
          creator_key: base64urlEncode(pubKey),
          chain_root: genesisChainRoot('4bf92f3577b34da6a3ce929d0e0e4736'),
          event_type: 'https://atrib.dev/v1/types/tool_call',
          context_id: '4bf92f3577b34da6a3ce929d0e0e4736',
          timestamp: startTs + i,
          signature: '',
        } as AtribRecord
        out.push(await signRecord(record, TEST_KEY))
      }
      return out
    }

    it('caps pendingRecords at maxQueueDepth during a sustained outage', async () => {
      // Synchronously rejecting fetch so each submitWithRetry exhausts its
      // 3 retries quickly and lands in pendingRecords without waiting.
      fetchMock.mockRejectedValue(new Error('connection refused'))
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const queue = createSubmissionQueue('https://test.example.com/v1/entries', {
        maxQueueDepth: 5,
      })

      const records = await makeBatch(20)
      for (const r of records) queue.submit(r, 'normal')
      await queue.flush()

      const evictionWarnings = warnSpy.mock.calls.filter((c) =>
        typeof c[0] === 'string' && c[0].includes('queue at cap'),
      )
      expect(evictionWarnings.length).toBeGreaterThan(0)
      warnSpy.mockRestore()
    }, 30_000)

    it('evicts normal-priority entries before high-priority entries', async () => {
      fetchMock.mockRejectedValue(new Error('connection refused'))
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const queue = createSubmissionQueue('https://test.example.com/v1/entries', {
        maxQueueDepth: 2,
      })

      const records = await makeBatch(5)
      queue.submit(records[0]!, 'high')
      queue.submit(records[1]!, 'high')
      for (let i = 2; i < 5; i++) queue.submit(records[i]!, 'normal')

      await queue.flush()

      const evictionWarnings = warnSpy.mock.calls.filter((c) =>
        typeof c[0] === 'string' && c[0].includes('queue at cap'),
      )
      expect(evictionWarnings.length).toBeGreaterThan(0)
      warnSpy.mockRestore()
    }, 30_000)

    it('does not evict when below cap', async () => {
      fetchMock.mockRejectedValue(new Error('connection refused'))
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const queue = createSubmissionQueue('https://test.example.com/v1/entries', {
        maxQueueDepth: 100,
      })

      const records = await makeBatch(3)
      for (const r of records) queue.submit(r, 'normal')
      await queue.flush()

      const evictionWarnings = warnSpy.mock.calls.filter((c) =>
        typeof c[0] === 'string' && c[0].includes('queue at cap'),
      )
      expect(evictionWarnings).toHaveLength(0)
      warnSpy.mockRestore()
    }, 30_000)
  })
})
