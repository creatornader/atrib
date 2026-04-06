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
    event_type: 'tool_call',
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
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ logIndex: 1 }), { status: 200 }))
    const queue = createSubmissionQueue('https://log.test/v1/entries')
    const record = await makeSignedRecord()

    const result = queue.submit(record, 'normal')
    expect(result).toBeUndefined()

    await advanceUntilSettled()
    await queue.flush()
  })

  it('caches proof bundle on successful submission', async () => {
    const proof = { logIndex: 42, inclusionProof: {}, checkpoint: 'test' }
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
        JSON.stringify({ logIndex: 99, inclusionProof: {}, checkpoint: '' }),
        { status: 200 },
      )
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const queue = createSubmissionQueue('https://log.test/v1/entries')
    const record = await makeSignedRecord()
    const hash = recordHashHex(record)

    queue.submit(record, 'normal')
    await advanceUntilSettled()
    // flush retries pending records — this time fetch succeeds
    await queue.flush()

    const proof = queue.getProof(hash)
    expect(proof).toBeDefined()
    expect(proof!.logIndex).toBe(99)

    warnSpy.mockRestore()
  })

  it('sends to the configured endpoint', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ logIndex: 1 }), { status: 200 }))
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

  it('sends record and priority in request body', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ logIndex: 1 }), { status: 200 }))
    const queue = createSubmissionQueue('https://log.test/v1/entries')
    const record = await makeSignedRecord()

    queue.submit(record, 'high')
    await advanceUntilSettled()
    await queue.flush()

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.record).toBeDefined()
    expect(body.priority).toBe('high')
  })
})
