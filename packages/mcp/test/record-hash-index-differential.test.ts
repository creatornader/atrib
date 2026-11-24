import { appendFile, mkdtemp, readFile, rm, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  canonicalRecord,
  clearRecordReferenceResolverCacheForTests,
  defaultRecordReferenceResolver,
  hexEncode,
  recordHashExistsInMirror,
  sha256,
} from '../src/index.js'
import type { AtribRecord } from '../src/index.js'

// The cache must never change an answer. Each step mutates a mirror the way a
// producer or an operator might, then compares cached lookups against hashes
// recomputed from the bytes on disk.

let tmpDir: string
let priorRecordsDir: string | undefined

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'atrib-hash-index-diff-'))
  priorRecordsDir = process.env['ATRIB_RECORDS_DIR']
  process.env['ATRIB_RECORDS_DIR'] = tmpDir
  clearRecordReferenceResolverCacheForTests()
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 404 } as Response)
})

afterEach(async () => {
  if (priorRecordsDir === undefined) delete process.env['ATRIB_RECORDS_DIR']
  else process.env['ATRIB_RECORDS_DIR'] = priorRecordsDir
  clearRecordReferenceResolverCacheForTests()
  await rm(tmpDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function mulberry32(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeRecord(id: number): AtribRecord {
  // Shape-valid rows are enough: the index hashes rows, it does not verify them.
  return {
    spec_version: 'atrib/1.0',
    content_id: `sha256:${id.toString(16).padStart(64, '0')}`,
    creator_key: 'A'.repeat(43),
    chain_root: `sha256:${'c'.repeat(64)}`,
    event_type: 'https://atrib.dev/v1/types/observation',
    context_id: 'c'.repeat(32),
    timestamp: 1_700_000_000_000 + id,
    signature: 'S'.repeat(86),
  } as AtribRecord
}

const hashOf = (record: AtribRecord) => `sha256:${hexEncode(sha256(canonicalRecord(record)))}`

async function strictHashesOnDisk(path: string): Promise<Set<string>> {
  const hashes = new Set<string>()
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return hashes
  }
  for (const line of text.split('\n')) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>
      const candidate = (parsed['record'] ?? parsed) as Record<string, unknown>
      if (candidate['spec_version'] === 'atrib/1.0') hashes.add(hashOf(candidate as AtribRecord))
    } catch {
      continue
    }
  }
  return hashes
}

describe('record hash index differential', () => {
  it.each([1, 2, 3, 4, 5, 6])(
    'matches a fresh scan after every mutation, seed %i',
    async (seed) => {
      const random = mulberry32(seed)
      const pick = (n: number) => Math.floor(random() * n)
      const mirrors = [join(tmpDir, 'a.jsonl'), join(tmpDir, 'b.jsonl')]
      const seen: AtribRecord[] = []
      let nextId = seed * 10_000
      const fresh = (): AtribRecord => {
        const record = makeRecord(nextId++)
        seen.push(record)
        return record
      }
      const row = (record: AtribRecord) =>
        `${JSON.stringify(pick(2) === 0 ? record : { record, _local: { pad: 'x'.repeat(pick(64)) } })}\n`

      for (let step = 0; step < 60; step += 1) {
        const path = mirrors[pick(mirrors.length)]!
        const action = pick(10)
        if (action <= 3) {
          let rows = ''
          for (let n = 1 + pick(3); n > 0; n -= 1) rows += row(fresh())
          await appendFile(path, rows)
        } else if (action === 4) {
          let rows = ''
          for (let n = pick(4); n > 0; n -= 1) rows += row(fresh())
          await writeFile(path, rows)
        } else if (action === 5) {
          const size = (await readFile(path).catch(() => Buffer.alloc(0))).length
          if (size > 0) await truncate(path, pick(size))
        } else if (action === 6) {
          await appendFile(path, row(fresh()).slice(0, 20))
        } else if (action === 7) {
          await rm(path, { force: true })
        } else if (action === 8) {
          clearRecordReferenceResolverCacheForTests()
        } else {
          await appendFile(path, 'not json\n')
        }

        const onDisk = await Promise.all(mirrors.map((mirror) => strictHashesOnDisk(mirror)))
        const neverWritten = makeRecord(nextId++)
        const probed = seen.length > 0 ? [...seen.slice(-12), seen[pick(seen.length)]!] : []
        const probes = [neverWritten, ...probed].map(hashOf)
        for (const hash of probes) {
          for (const [position, mirror] of mirrors.entries()) {
            expect(
              await recordHashExistsInMirror({ path: mirror, recordHash: hash }),
              `seed ${seed} step ${step} action ${action} ${mirror}`,
            ).toBe(onDisk[position]!.has(hash))
          }
          expect(
            await defaultRecordReferenceResolver(hash),
            `seed ${seed} step ${step} action ${action} resolver`,
          ).toBe(onDisk.some((set) => set.has(hash)) ? 'found' : 'not-found')
        }
      }
    },
  )
})
