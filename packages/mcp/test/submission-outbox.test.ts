import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
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

async function entryNames(dir: string): Promise<string[]> {
  return (await readdir(dir).catch(() => [])).filter((name) => name.endsWith('.json')).sort()
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
    const stored = JSON.parse(await readFile(join(dir, `${hash}.json`), 'utf-8'))
    expect(stored.record).toEqual(record)
    expect(stored.endpoint).toBe(ENDPOINT)
    expect((await stat(join(dir, `${hash}.json`))).mode & 0o777).toBe(0o600)

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
    await age(join(dir, `${hash}.json`), 120_000)

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
    const path = join(dir, `${hash}.json`)
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
    await age(join(dir, `${hash}.json`), 120_000)

    fetchMock.mockResolvedValue(new Response('bad', { status: 400 }))
    await createSubmissionQueue(ENDPOINT, { outbox: createFileSubmissionOutbox({ dir }) }).flush()
    expect(await entryNames(dir)).toEqual([])
  })

  it('keeps the entry when a 2xx body is not a proof', async () => {
    const record = await makeSignedRecord(6)
    const hash = recordHashHex(record)
    await createFileSubmissionOutbox({ dir }).put(hash, { record, priority: 'normal' }, ENDPOINT)
    await age(join(dir, `${hash}.json`), 120_000)

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
    await age(join(dir, `${hash}.json`), 120_000)

    await createSubmissionQueue(ENDPOINT, { outbox: createFileSubmissionOutbox({ dir }) }).flush()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await entryNames(dir)).toEqual([`${hash}.json`])
  })

  it('never resends a record under a filename that is not its hash', async () => {
    const record = await makeSignedRecord(8)
    const wrong = 'ab'.repeat(32)
    await createFileSubmissionOutbox({ dir }).put(wrong, { record, priority: 'normal' }, ENDPOINT)
    await age(join(dir, `${wrong}.json`), 120_000)

    await createSubmissionQueue(ENDPOINT, { outbox: createFileSubmissionOutbox({ dir }) }).flush()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('drops corrupt and expired entries, and sweeps stale temp files', async () => {
    const outbox = createFileSubmissionOutbox({ dir, maxAgeMs: 1000 })
    const record = await makeSignedRecord(9)
    const hash = recordHashHex(record)
    await outbox.put(hash, { record, priority: 'normal' }, ENDPOINT)
    const expired = join(dir, `${hash}.json`)
    const stored = JSON.parse(await readFile(expired, 'utf-8'))
    await writeFile(expired, JSON.stringify({ ...stored, queued_at: Date.now() - 5000 }))
    await age(expired, 120_000)
    const corrupt = join(dir, `${'cd'.repeat(32)}.json`)
    await writeFile(corrupt, '{not json')
    await age(corrupt, 120_000)
    const staleTemp = join(dir, `${'ef'.repeat(32)}.1.x.tmp`)
    await writeFile(staleTemp, 'partial')
    await age(staleTemp, 11 * 60 * 1000)
    const freshTemp = join(dir, `${'12'.repeat(32)}.2.y.tmp`)
    await writeFile(freshTemp, 'partial')

    expect(await outbox.claimDue(ENDPOINT)).toEqual([])
    expect(await readdir(dir)).toEqual([`${'12'.repeat(32)}.2.y.tmp`])
  })

  it('claims at most maxClaim entries, oldest first', async () => {
    const outbox = createFileSubmissionOutbox({ dir, maxClaim: 2 })
    const hashes: string[] = []
    for (let i = 0; i < 4; i++) {
      const record = await makeSignedRecord(100 + i)
      const hash = recordHashHex(record)
      hashes.push(hash)
      await outbox.put(hash, { record, priority: 'normal' }, ENDPOINT)
      await age(join(dir, `${hash}.json`), 600_000 - i * 60_000)
    }
    const claimed = await outbox.claimDue(ENDPOINT)
    expect(claimed.map((entry) => entry.recordHash)).toEqual(hashes.slice(0, 2))
    // The next call moves on to the ones not yet claimed.
    const next = await outbox.claimDue(ENDPOINT)
    expect(next.map((entry) => entry.recordHash)).toEqual(hashes.slice(2))
  })

  it('keeps the first queued_at when the same record is put again', async () => {
    const outbox = createFileSubmissionOutbox({ dir })
    const record = await makeSignedRecord(10)
    const hash = recordHashHex(record)
    await outbox.put(hash, { record, priority: 'normal' }, ENDPOINT)
    const first = JSON.parse(await readFile(join(dir, `${hash}.json`), 'utf-8')).queued_at
    await new Promise((resolve) => setTimeout(resolve, 5))
    await outbox.put(hash, { record, priority: 'high' }, ENDPOINT)
    const second = JSON.parse(await readFile(join(dir, `${hash}.json`), 'utf-8'))
    expect(second.queued_at).toBe(first)
    expect(second.priority).toBe('normal')
    expect(await readdir(dir)).toEqual([`${hash}.json`])
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
