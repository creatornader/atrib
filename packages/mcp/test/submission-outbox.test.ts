import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSubmissionQueue } from '../src/submission.js'
import { createFileSubmissionOutbox } from '../src/submission-outbox.js'
import { signRecord, getPublicKey } from '../src/signing.js'
import { base64urlEncode } from '../src/base64url.js'
import { genesisChainRoot } from '../src/chain-root.js'
import { canonicalRecord } from '../src/canon.js'
import { sha256, hexEncode } from '../src/hash.js'
import type { AtribRecord } from '../src/types.js'

const TEST_KEY = new Uint8Array(32).fill(1)
const ENDPOINT = 'https://log.test/v1/entries'
const PROOF = { log_index: 7, checkpoint: 'c', inclusion_proof: ['a'], leaf_hash: 'l' }

async function makeSignedRecord(timestamp: number): Promise<AtribRecord> {
  const pubKey = await getPublicKey(TEST_KEY)
  const record = {
    spec_version: 'atrib/1.0',
    content_id: 'sha256:3f8a2b0000000000000000000000000000000000000000000000000000000000',
    creator_key: base64urlEncode(pubKey),
    chain_root: genesisChainRoot('4bf92f3577b34da6a3ce929d0e0e4736'),
    event_type: 'https://atrib.dev/v1/types/observation',
    context_id: '4bf92f3577b34da6a3ce929d0e0e4736',
    timestamp,
    signature: '',
  } as AtribRecord
  return signRecord(record, TEST_KEY)
}

function recordHashHex(record: AtribRecord): string {
  return hexEncode(sha256(canonicalRecord(record)))
}

function endpointDir(dir: string, endpoint: string = ENDPOINT): string {
  return join(dir, createHash('sha256').update(endpoint).digest('hex').slice(0, 16))
}

async function entryNames(dir: string, endpoint: string = ENDPOINT): Promise<string[]> {
  return (await readdir(endpointDir(dir, endpoint)).catch(() => []))
    .filter((name) => name.endsWith('.json'))
    .sort()
}

async function age(path: string, ms: number): Promise<void> {
  const then = new Date(Date.now() - ms)
  await utimes(path, then, then)
}

function okResponse(): Response {
  return new Response(JSON.stringify(PROOF), { status: 200 })
}

describe('file submission outbox', () => {
  let dir: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchMock: any

  beforeEach(async () => {
    dir = join(await mkdtemp(join(tmpdir(), 'atrib-outbox-')), 'outbox')
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    await rm(join(dir, '..'), { recursive: true, force: true })
  })

  it('keeps a record until the log confirms it', async () => {
    let release: (response: Response) => void = () => undefined
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => (release = resolve)))
    const record = await makeSignedRecord(1)
    const hash = recordHashHex(record)
    const queue = createSubmissionQueue(ENDPOINT, { outbox: createFileSubmissionOutbox({ dir }) })

    queue.submit(record, 'normal')
    await vi.waitFor(async () => expect(await entryNames(dir)).toEqual([`${hash}.json`]))
    const stored = JSON.parse(await readFile(join(endpointDir(dir), `${hash}.json`), 'utf-8'))
    expect(stored.record).toEqual(record)
    expect(stored.endpoint).toBe(ENDPOINT)
    expect((await stat(join(endpointDir(dir), `${hash}.json`))).mode & 0o777).toBe(0o600)

    release(okResponse())
    await queue.flush()
    expect(await entryNames(dir)).toEqual([])
    expect(queue.getProof(hash)?.log_index).toBe(7)
  })

  it('a later queue resends what a killed process left behind', async () => {
    const record = await makeSignedRecord(2)
    const hash = recordHashHex(record)
    const outbox = createFileSubmissionOutbox({ dir })
    // The first process persisted the record and died before any response.
    await outbox.put(hash, { record, priority: 'high' }, ENDPOINT)
    await age(join(endpointDir(dir), `${hash}.json`), 120_000)

    fetchMock.mockResolvedValue(okResponse())
    const queue = createSubmissionQueue(ENDPOINT, { outbox: createFileSubmissionOutbox({ dir }) })
    await queue.flush()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(ENDPOINT)
    expect(JSON.parse(init.body)).toEqual(record)
    expect(init.headers['X-atrib-Priority']).toBe('high')
    expect(await entryNames(dir)).toEqual([])
  })

  it('leaves a fresh entry alone, since its writer may still be submitting', async () => {
    const record = await makeSignedRecord(3)
    const hash = recordHashHex(record)
    await createFileSubmissionOutbox({ dir }).put(hash, { record, priority: 'normal' }, ENDPOINT)

    const queue = createSubmissionQueue(ENDPOINT, { outbox: createFileSubmissionOutbox({ dir }) })
    await queue.flush()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(await entryNames(dir)).toEqual([`${hash}.json`])
  })

  it('keeps the entry when a resend fails and backs off before the next try', async () => {
    const record = await makeSignedRecord(4)
    const hash = recordHashHex(record)
    const path = join(endpointDir(dir), `${hash}.json`)
    await createFileSubmissionOutbox({ dir }).put(hash, { record, priority: 'normal' }, ENDPOINT)
    await age(path, 120_000)

    fetchMock.mockRejectedValue(new Error('offline'))
    await createSubmissionQueue(ENDPOINT, { outbox: createFileSubmissionOutbox({ dir }) }).flush()
    // One attempt only: a resend does not run the three-try backoff.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(await entryNames(dir)).toEqual([`${hash}.json`])

    // The claim refreshed the entry, so a process starting right after
    // does not resend it again.
    await createSubmissionQueue(ENDPOINT, { outbox: createFileSubmissionOutbox({ dir }) }).flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('drops an entry the log permanently rejects', async () => {
    const record = await makeSignedRecord(5)
    const hash = recordHashHex(record)
    await createFileSubmissionOutbox({ dir }).put(hash, { record, priority: 'normal' }, ENDPOINT)
    await age(join(endpointDir(dir), `${hash}.json`), 120_000)

    fetchMock.mockResolvedValue(new Response('bad', { status: 400 }))
    await createSubmissionQueue(ENDPOINT, { outbox: createFileSubmissionOutbox({ dir }) }).flush()
    expect(await entryNames(dir)).toEqual([])
  })

  it('keeps the entry when a 2xx body is not a proof', async () => {
    const record = await makeSignedRecord(6)
    const hash = recordHashHex(record)
    await createFileSubmissionOutbox({ dir }).put(hash, { record, priority: 'normal' }, ENDPOINT)
    await age(join(endpointDir(dir), `${hash}.json`), 120_000)

    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    await createSubmissionQueue(ENDPOINT, { outbox: createFileSubmissionOutbox({ dir }) }).flush()
    expect(await entryNames(dir)).toEqual([`${hash}.json`])
  })

  it('does not send one log another log’s records', async () => {
    const record = await makeSignedRecord(7)
    const hash = recordHashHex(record)
    await createFileSubmissionOutbox({ dir }).put(
      hash,
      { record, priority: 'normal' },
      'https://other.test/v1/entries',
    )
    const other = 'https://other.test/v1/entries'
    await age(join(endpointDir(dir, other), `${hash}.json`), 120_000)

    await createSubmissionQueue(ENDPOINT, { outbox: createFileSubmissionOutbox({ dir }) }).flush()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await entryNames(dir, other)).toEqual([`${hash}.json`])
  })

  it('never resends a record under a filename that is not its hash', async () => {
    const record = await makeSignedRecord(8)
    const wrong = 'ab'.repeat(32)
    await createFileSubmissionOutbox({ dir }).put(wrong, { record, priority: 'normal' }, ENDPOINT)
    await age(join(endpointDir(dir), `${wrong}.json`), 120_000)

    await createSubmissionQueue(ENDPOINT, { outbox: createFileSubmissionOutbox({ dir }) }).flush()
    expect(fetchMock).not.toHaveBeenCalled()
    // The mislabelled entry is removed, not left to be claimed forever.
    expect(await entryNames(dir)).toEqual([])
  })

  it('drops corrupt and expired entries, and sweeps stale temp files', async () => {
    const outbox = createFileSubmissionOutbox({ dir, maxAgeMs: 1000 })
    const record = await makeSignedRecord(9)
    const hash = recordHashHex(record)
    await outbox.put(hash, { record, priority: 'normal' }, ENDPOINT)
    const expired = join(endpointDir(dir), `${hash}.json`)
    const stored = JSON.parse(await readFile(expired, 'utf-8'))
    await writeFile(expired, JSON.stringify({ ...stored, queued_at: Date.now() - 5000 }))
    await age(expired, 120_000)
    const corrupt = join(endpointDir(dir), `${'cd'.repeat(32)}.json`)
    await writeFile(corrupt, '{not json')
    await age(corrupt, 120_000)
    const staleTemp = join(endpointDir(dir), `${'ef'.repeat(32)}.1.x.tmp`)
    await writeFile(staleTemp, 'partial')
    await age(staleTemp, 11 * 60 * 1000)
    const freshTemp = join(endpointDir(dir), `${'12'.repeat(32)}.2.y.tmp`)
    await writeFile(freshTemp, 'partial')

    expect(await outbox.claimDue(ENDPOINT)).toEqual([])
    expect(await readdir(endpointDir(dir))).toEqual([`${'12'.repeat(32)}.2.y.tmp`])
  })

  it('claims at most maxClaim entries per call', async () => {
    const outbox = createFileSubmissionOutbox({ dir, maxClaim: 2 })
    const hashes: string[] = []
    for (let i = 0; i < 4; i++) {
      const record = await makeSignedRecord(100 + i)
      const hash = recordHashHex(record)
      hashes.push(hash)
      await outbox.put(hash, { record, priority: 'normal' }, ENDPOINT)
      await age(join(endpointDir(dir), `${hash}.json`), 600_000 - i * 60_000)
    }
    const claimed = await outbox.claimDue(ENDPOINT)
    expect(claimed).toHaveLength(2)
    // The next call moves on to the ones not yet claimed.
    const next = await outbox.claimDue(ENDPOINT)
    expect(next).toHaveLength(2)
    expect([...claimed, ...next].map((entry) => entry.recordHash).sort()).toEqual(
      hashes.slice().sort(),
    )
    expect(await outbox.claimDue(ENDPOINT)).toEqual([])
  })

  it('confirming a record for one log leaves another log’s entry alone', async () => {
    const outbox = createFileSubmissionOutbox({ dir })
    const other = 'https://other.test/v1/entries'
    const record = await makeSignedRecord(250)
    const hash = recordHashHex(record)
    await outbox.put(hash, { record, priority: 'normal' }, ENDPOINT)
    await outbox.put(hash, { record, priority: 'normal' }, other)
    await outbox.remove(hash, ENDPOINT)
    expect(await entryNames(dir)).toEqual([])
    expect(await entryNames(dir, other)).toEqual([`${hash}.json`])
  })

  it('keeps writing after its directory is cleared', async () => {
    const outbox = createFileSubmissionOutbox({ dir })
    const first = await makeSignedRecord(251)
    await outbox.put(recordHashHex(first), { record: first, priority: 'normal' }, ENDPOINT)
    await rm(dir, { recursive: true, force: true })
    const second = await makeSignedRecord(252)
    const hash = recordHashHex(second)
    await outbox.put(hash, { record: second, priority: 'normal' }, ENDPOINT)
    expect(await entryNames(dir)).toEqual([`${hash}.json`])
  })

  it('claims oldest first when everything due fits in one claim', async () => {
    const outbox = createFileSubmissionOutbox({ dir })
    const hashes: string[] = []
    for (let i = 0; i < 3; i++) {
      const record = await makeSignedRecord(200 + i)
      const hash = recordHashHex(record)
      hashes.push(hash)
      await outbox.put(hash, { record, priority: 'normal' }, ENDPOINT)
      await age(join(endpointDir(dir), `${hash}.json`), 600_000 - i * 60_000)
    }
    const claimed = await outbox.claimDue(ENDPOINT)
    expect(claimed.map((entry) => entry.recordHash)).toEqual(hashes)
  })

  it('reaches a due entry behind a large backlog for another log', async () => {
    const outbox = createFileSubmissionOutbox({ dir })
    const other = 'https://other.test/v1/entries'
    const foreign = await makeSignedRecord(300)
    for (let i = 0; i < 300; i++) {
      const name = i.toString(16).padStart(64, '0')
      await outbox.put(name, { record: foreign, priority: 'normal' }, other)
    }
    const record = await makeSignedRecord(301)
    const hash = recordHashHex(record)
    await outbox.put(hash, { record, priority: 'normal' }, ENDPOINT)
    await age(join(endpointDir(dir), `${hash}.json`), 120_000)
    const claimed = await outbox.claimDue(ENDPOINT)
    expect(claimed.map((entry) => entry.recordHash)).toEqual([hash])
  })

  it('reaches every entry of a backlog larger than one scan', async () => {
    const outbox = createFileSubmissionOutbox({ dir, maxClaim: 400 })
    const record = await makeSignedRecord(302)
    for (let i = 0; i < 300; i++) {
      const name = i.toString(16).padStart(64, '0')
      await outbox.put(name, { record, priority: 'normal' }, ENDPOINT)
      await age(join(endpointDir(dir), `${name}.json`), 120_000)
    }
    const seen = new Set<string>()
    for (let call = 0; call < 20 && seen.size < 300; call++) {
      for (const entry of await outbox.claimDue(ENDPOINT)) seen.add(entry.recordHash)
    }
    expect(seen.size).toBe(300)
  })

  it('concurrent claimers mostly do not take the same entry', async () => {
    const outbox = createFileSubmissionOutbox({ dir })
    const record = await makeSignedRecord(303)
    for (let i = 0; i < 40; i++) {
      const name = i.toString(16).padStart(64, '0')
      await outbox.put(name, { record, priority: 'normal' }, ENDPOINT)
      await age(join(endpointDir(dir), `${name}.json`), 120_000)
    }
    const rounds = await Promise.all(
      Array.from({ length: 5 }, () => createFileSubmissionOutbox({ dir }).claimDue(ENDPOINT)),
    )
    const claims = rounds.flat().map((entry) => entry.recordHash)
    // Five claimers of eight each: without the re-check and the random
    // pick they would all take the same eight.
    expect(new Set(claims).size).toBeGreaterThan(8)
  })

  it('keeps the entry on a rejection that is not about the record', async () => {
    for (const [status, kept] of [
      [429, true],
      [401, true],
      [404, true],
      [413, false],
      [422, false],
    ] as const) {
      const record = await makeSignedRecord(400 + status)
      const hash = recordHashHex(record)
      await createFileSubmissionOutbox({ dir }).put(hash, { record, priority: 'normal' }, ENDPOINT)
      await age(join(endpointDir(dir), `${hash}.json`), 120_000)
      fetchMock.mockResolvedValue(new Response('no', { status }))
      await createSubmissionQueue(ENDPOINT, { outbox: createFileSubmissionOutbox({ dir }) }).flush()
      expect((await entryNames(dir)).includes(`${hash}.json`)).toBe(kept)
      await rm(endpointDir(dir), { recursive: true, force: true })
    }
  })

  it('a long-lived queue looks again when it submits, at most once a minute', async () => {
    fetchMock.mockImplementation(async () => okResponse())
    const outbox = createFileSubmissionOutbox({ dir })
    const queue = createSubmissionQueue(ENDPOINT, { outbox })
    await queue.flush()

    // Another process leaves a record behind after this queue was built.
    const left = await makeSignedRecord(500)
    const leftHash = recordHashHex(left)
    await createFileSubmissionOutbox({ dir }).put(
      leftHash,
      { record: left, priority: 'normal' },
      ENDPOINT,
    )
    await age(join(endpointDir(dir), `${leftHash}.json`), 120_000)

    queue.submit(await makeSignedRecord(501), 'normal')
    await queue.flush()
    expect(await entryNames(dir)).toEqual([`${leftHash}.json`])

    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 61_000)
    queue.submit(await makeSignedRecord(502), 'normal')
    await queue.flush()
    clock.mockRestore()
    expect(await entryNames(dir)).toEqual([])
    const bodies = fetchMock.mock.calls.map(([, init]: [string, { body: string }]) => init.body)
    expect(bodies).toContain(JSON.stringify(left))
  })

  it('retries a record from memory on flush and then clears its entry', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    try {
      fetchMock.mockRejectedValue(new Error('offline'))
      const record = await makeSignedRecord(600)
      const hash = recordHashHex(record)
      const queue = createSubmissionQueue(ENDPOINT, { outbox: createFileSubmissionOutbox({ dir }) })
      queue.submit(record, 'normal')
      const firstFlush = queue.flush()
      await vi.waitFor(async () => {
        await vi.advanceTimersByTimeAsync(5_000)
        expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(4)
      })
      fetchMock.mockImplementation(async () => okResponse())
      await vi.advanceTimersByTimeAsync(10_000)
      await firstFlush
      await queue.flush()
      expect(queue.getProof(hash)?.log_index).toBe(7)
      expect(await entryNames(dir)).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the first queued_at when the same record is put again', async () => {
    const outbox = createFileSubmissionOutbox({ dir })
    const record = await makeSignedRecord(10)
    const hash = recordHashHex(record)
    await outbox.put(hash, { record, priority: 'normal' }, ENDPOINT)
    const first = JSON.parse(
      await readFile(join(endpointDir(dir), `${hash}.json`), 'utf-8'),
    ).queued_at
    await new Promise((resolve) => setTimeout(resolve, 5))
    await outbox.put(hash, { record, priority: 'high' }, ENDPOINT)
    const second = JSON.parse(await readFile(join(endpointDir(dir), `${hash}.json`), 'utf-8'))
    expect(second.queued_at).toBe(first)
    expect(second.priority).toBe('normal')
    expect(await readdir(endpointDir(dir))).toEqual([`${hash}.json`])
  })

  it('an outbox that cannot write never fails the submission', async () => {
    const blocked = join(dir, '..', 'file-not-dir')
    await writeFile(blocked, 'x')
    fetchMock.mockResolvedValue(okResponse())
    const record = await makeSignedRecord(11)
    const queue = createSubmissionQueue(ENDPOINT, {
      outbox: createFileSubmissionOutbox({ dir: join(blocked, 'outbox') }),
    })
    queue.submit(record, 'normal')
    await queue.flush()
    expect(queue.getProof(recordHashHex(record))?.log_index).toBe(7)
  })
})
