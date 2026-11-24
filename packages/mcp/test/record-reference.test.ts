import {
  appendFile,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  base64urlEncode,
  canonicalRecord,
  clearRecordReferenceResolverCacheForTests,
  defaultRecordReferenceResolver,
  genesisChainRoot,
  getPublicKey,
  hexEncode,
  recordHashExistsInMirror,
  recordReferenceResolverCacheStatsForTests,
  sha256,
  signRecord,
  signTransactionRecord,
} from '../src/index.js'
import type { AtribRecord } from '../src/index.js'
import { setRecordHashIndexScanHookForTests } from '../src/record-hash-index.js'

const TEST_KEY = new Uint8Array(32).fill(23)
const CTX = 'c'.repeat(32)

let tmpDir: string
let priorRecordsDir: string | undefined

async function makeRecord(
  hexSeed = 'd',
  timestampOffset = 0,
): Promise<{ record: AtribRecord; recordHash: string }> {
  const pubKey = await getPublicKey(TEST_KEY)
  const unsigned = {
    spec_version: 'atrib/1.0' as const,
    content_id: `sha256:${hexSeed.repeat(64)}`,
    creator_key: base64urlEncode(pubKey),
    chain_root: genesisChainRoot(CTX),
    event_type: 'https://atrib.dev/v1/types/tool_call',
    context_id: CTX,
    timestamp: 1_700_000_000_000 + timestampOffset,
    signature: '',
  }
  const record = await signRecord(unsigned as AtribRecord, TEST_KEY)
  return {
    record,
    recordHash: `sha256:${hexEncode(sha256(canonicalRecord(record)))}`,
  }
}

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'atrib-record-ref-test-'))
  priorRecordsDir = process.env['ATRIB_RECORDS_DIR']
  process.env['ATRIB_RECORDS_DIR'] = tmpDir
  clearRecordReferenceResolverCacheForTests()
})

afterEach(async () => {
  if (priorRecordsDir === undefined) delete process.env['ATRIB_RECORDS_DIR']
  else process.env['ATRIB_RECORDS_DIR'] = priorRecordsDir
  clearRecordReferenceResolverCacheForTests()
  await rm(tmpDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('defaultRecordReferenceResolver', () => {
  it.each(['statement', 'transaction'])(
    'finds a %s with conditional fields omitted',
    async (kind) => {
      const original = (await makeRecord()).record
      const { content_id: _, ...base } = original
      const signed =
        kind === 'statement'
          ? await signRecord(
              { ...base, event_type: 'https://atrib.dev/evidence/v1/request' },
              TEST_KEY,
            )
          : await signTransactionRecord(
              { ...original, event_type: 'https://atrib.dev/v1/types/transaction' },
              TEST_KEY,
            )
      const { signature: _signature, ...withoutSignature } = signed
      const record = kind === 'statement' ? signed : withoutSignature
      const recordHash = `sha256:${hexEncode(sha256(canonicalRecord(record as AtribRecord)))}`
      await writeFile(join(tmpDir, 'producer.jsonl'), `${JSON.stringify({ record })}\n`)
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue({ ok: false, status: 404 } as Response)
      await expect(defaultRecordReferenceResolver(recordHash)).resolves.toBe('found')
      expect(fetchSpy).not.toHaveBeenCalled()
    },
  )

  it('finds records in local mirrors before consulting the log', async () => {
    const { record, recordHash } = await makeRecord()
    await writeFile(join(tmpDir, 'producer.jsonl'), `${JSON.stringify({ record })}\n`)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    await expect(defaultRecordReferenceResolver(recordHash)).resolves.toBe('found')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns not-found when local mirrors and log lookup miss', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 404 } as Response)

    await expect(defaultRecordReferenceResolver(`sha256:${'f'.repeat(64)}`)).resolves.toBe(
      'not-found',
    )
  })

  it('reuses local mirror file caches for repeated misses', async () => {
    const { record } = await makeRecord()
    await writeFile(join(tmpDir, 'producer.jsonl'), `${JSON.stringify({ record })}\n`)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 404 } as Response)
    const missingHash = `sha256:${'f'.repeat(64)}`

    await expect(defaultRecordReferenceResolver(missingHash)).resolves.toBe('not-found')
    expect(recordReferenceResolverCacheStatsForTests().full_file_scans).toBe(1)

    await expect(defaultRecordReferenceResolver(missingHash)).resolves.toBe('not-found')
    const stats = recordReferenceResolverCacheStatsForTests()
    expect(stats.full_file_scans).toBe(1)
    expect(stats.reused_file_caches).toBeGreaterThan(0)
  })

  it('loads appended local mirror rows without a full rescan', async () => {
    const first = await makeRecord('d', 0)
    const second = await makeRecord('e', 1)
    const mirrorPath = join(tmpDir, 'producer.jsonl')
    await writeFile(mirrorPath, `${JSON.stringify({ record: first.record })}\n`)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 404 } as Response)

    await expect(defaultRecordReferenceResolver(`sha256:${'f'.repeat(64)}`)).resolves.toBe(
      'not-found',
    )
    expect(recordReferenceResolverCacheStatsForTests().full_file_scans).toBe(1)

    await appendFile(mirrorPath, `${JSON.stringify({ record: second.record })}\n`)

    await expect(defaultRecordReferenceResolver(second.recordHash)).resolves.toBe('found')
    const stats = recordReferenceResolverCacheStatsForTests()
    expect(stats.full_file_scans).toBe(1)
    expect(stats.append_file_scans).toBe(1)
  })

  describe('persisted record hash index', () => {
    const missingHash = `sha256:${'f'.repeat(64)}`
    const indexPath = () => join(tmpDir, '.atrib-record-hash-index-v1.json')
    const line = (record: AtribRecord) => `${JSON.stringify({ record })}\n`

    // Each spawned producer starts with an empty in-memory cache.
    function simulateNewProcess(): void {
      clearRecordReferenceResolverCacheForTests()
    }

    beforeEach(() => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 404 } as Response)
    })

    it('lets a new process reuse hashes without rescanning the mirror', async () => {
      const { record, recordHash } = await makeRecord('d', 0)
      await writeFile(join(tmpDir, 'producer.jsonl'), line(record))

      await expect(defaultRecordReferenceResolver(missingHash)).resolves.toBe('not-found')
      expect(recordReferenceResolverCacheStatsForTests().full_file_scans).toBe(1)
      const index = JSON.parse(await readFile(indexPath(), 'utf8')) as {
        schema: string
        files: Array<{ name: string; hashes: string[] }>
      }
      expect(index.schema).toBe('atrib.record-hash-index.v1')
      expect(index.files.map((file) => file.name)).toEqual(['producer.jsonl'])
      expect(index.files[0]!.hashes).toEqual([recordHash.slice('sha256:'.length)])
      expect((await stat(indexPath())).mode & 0o777).toBe(0o600)

      simulateNewProcess()
      await expect(defaultRecordReferenceResolver(recordHash)).resolves.toBe('found')
      const stats = recordReferenceResolverCacheStatsForTests()
      expect(stats.full_file_scans).toBe(0)
      expect(stats.append_file_scans).toBe(0)
      expect(stats.persisted_file_caches).toBe(1)
    })

    it('scans only appended bytes in a new process', async () => {
      const first = await makeRecord('d', 0)
      const second = await makeRecord('e', 1)
      const mirrorPath = join(tmpDir, 'producer.jsonl')
      await writeFile(mirrorPath, line(first.record))
      await expect(defaultRecordReferenceResolver(missingHash)).resolves.toBe('not-found')

      await appendFile(mirrorPath, line(second.record))
      simulateNewProcess()
      await expect(defaultRecordReferenceResolver(second.recordHash)).resolves.toBe('found')
      await expect(defaultRecordReferenceResolver(first.recordHash)).resolves.toBe('found')
      const stats = recordReferenceResolverCacheStatsForTests()
      expect(stats.full_file_scans).toBe(0)
      expect(stats.append_file_scans).toBe(1)

      // A small append is not worth rewriting the whole index, so the next
      // process rescans the same short tail instead.
      simulateNewProcess()
      await expect(defaultRecordReferenceResolver(second.recordHash)).resolves.toBe('found')
      const later = recordReferenceResolverCacheStatsForTests()
      expect(later.full_file_scans).toBe(0)
      expect(later.append_file_scans).toBe(1)
    })

    it('rewrites the index once enough bytes have been appended', async () => {
      const first = await makeRecord('d', 0)
      const second = await makeRecord('e', 1)
      const mirrorPath = join(tmpDir, 'producer.jsonl')
      await writeFile(mirrorPath, line(first.record))
      await expect(defaultRecordReferenceResolver(missingHash)).resolves.toBe('not-found')
      const before = await readFile(indexPath(), 'utf8')

      await appendFile(mirrorPath, line(second.record))
      simulateNewProcess()
      await expect(defaultRecordReferenceResolver(second.recordHash)).resolves.toBe('found')
      expect(await readFile(indexPath(), 'utf8')).toBe(before)

      const padded = { record: second.record, _local: { content: 'x'.repeat(256 * 1024) } }
      await appendFile(mirrorPath, `${JSON.stringify(padded)}\n`)
      simulateNewProcess()
      await expect(defaultRecordReferenceResolver(second.recordHash)).resolves.toBe('found')
      expect(await readFile(indexPath(), 'utf8')).not.toBe(before)

      simulateNewProcess()
      await expect(defaultRecordReferenceResolver(second.recordHash)).resolves.toBe('found')
      const stats = recordReferenceResolverCacheStatsForTests()
      expect(stats.persisted_file_caches).toBe(1)
      expect(stats.append_file_scans).toBe(0)
    })

    it('falls back to a full scan after truncation', async () => {
      const first = await makeRecord('d', 0)
      const second = await makeRecord('e', 1)
      const mirrorPath = join(tmpDir, 'producer.jsonl')
      await writeFile(mirrorPath, line(first.record) + line(second.record))
      await expect(defaultRecordReferenceResolver(missingHash)).resolves.toBe('not-found')

      await writeFile(mirrorPath, line(first.record))
      simulateNewProcess()
      await expect(defaultRecordReferenceResolver(second.recordHash)).resolves.toBe('not-found')
      expect(recordReferenceResolverCacheStatsForTests().full_file_scans).toBe(1)
      await expect(defaultRecordReferenceResolver(first.recordHash)).resolves.toBe('found')
    })

    it('falls back to a full scan when the file is rewritten and grows', async () => {
      const first = await makeRecord('d', 0)
      const second = await makeRecord('e', 1)
      const third = await makeRecord('a', 2)
      const mirrorPath = join(tmpDir, 'producer.jsonl')
      await writeFile(mirrorPath, line(first.record))
      await expect(defaultRecordReferenceResolver(missingHash)).resolves.toBe('not-found')

      // Same inode, ends in a newline at the old size, but different bytes.
      await writeFile(mirrorPath, line(second.record) + line(third.record))
      simulateNewProcess()
      await expect(defaultRecordReferenceResolver(first.recordHash)).resolves.toBe('not-found')
      const stats = recordReferenceResolverCacheStatsForTests()
      expect(stats.full_file_scans).toBe(1)
      expect(stats.append_file_scans).toBe(0)
      await expect(defaultRecordReferenceResolver(third.recordHash)).resolves.toBe('found')
    })

    it('falls back to a full scan when the file is rewritten at the same size', async () => {
      const first = await makeRecord('d', 0)
      const second = await makeRecord('e', 0)
      const mirrorPath = join(tmpDir, 'producer.jsonl')
      await writeFile(mirrorPath, line(first.record))
      expect(line(first.record).length).toBe(line(second.record).length)
      await expect(defaultRecordReferenceResolver(missingHash)).resolves.toBe('not-found')

      await writeFile(mirrorPath, line(second.record))
      const later = new Date(Date.now() + 5_000)
      await utimes(mirrorPath, later, later)
      simulateNewProcess()
      await expect(defaultRecordReferenceResolver(first.recordHash)).resolves.toBe('not-found')
      expect(recordReferenceResolverCacheStatsForTests().full_file_scans).toBe(1)
      await expect(defaultRecordReferenceResolver(second.recordHash)).resolves.toBe('found')
    })

    it('rescans when the file was replaced by a new inode', async () => {
      const first = await makeRecord('d', 0)
      const second = await makeRecord('e', 1)
      const mirrorPath = join(tmpDir, 'producer.jsonl')
      await writeFile(mirrorPath, line(first.record))
      await expect(defaultRecordReferenceResolver(missingHash)).resolves.toBe('not-found')

      // Atomic replace: both files exist at once, so the inode must differ.
      const replacement = join(tmpDir, 'replacement.tmp')
      await writeFile(replacement, line(first.record) + line(second.record))
      await rename(replacement, mirrorPath)
      simulateNewProcess()
      await expect(defaultRecordReferenceResolver(second.recordHash)).resolves.toBe('found')
      const stats = recordReferenceResolverCacheStatsForTests()
      expect(stats.persisted_file_caches + stats.append_file_scans).toBe(0)
      expect(stats.full_file_scans).toBe(1)
    })

    it('ignores a corrupt index and rewrites it', async () => {
      const { record, recordHash } = await makeRecord('d', 0)
      await writeFile(join(tmpDir, 'producer.jsonl'), line(record))
      await expect(defaultRecordReferenceResolver(missingHash)).resolves.toBe('not-found')

      for (const corrupt of [
        '{not json',
        JSON.stringify({
          schema: 'atrib.record-hash-index.v1',
          files: [{ name: 'producer.jsonl' }],
        }),
      ]) {
        await writeFile(indexPath(), corrupt)
        simulateNewProcess()
        await expect(defaultRecordReferenceResolver(recordHash)).resolves.toBe('found')
        expect(recordReferenceResolverCacheStatsForTests().full_file_scans).toBe(1)
      }

      simulateNewProcess()
      await expect(defaultRecordReferenceResolver(recordHash)).resolves.toBe('found')
      expect(recordReferenceResolverCacheStatsForTests().full_file_scans).toBe(0)
    })

    it('does not trust a hash the index claims for a file whose state changed', async () => {
      const { record } = await makeRecord('d', 0)
      const mirrorPath = join(tmpDir, 'producer.jsonl')
      await writeFile(mirrorPath, line(record))
      await expect(defaultRecordReferenceResolver(missingHash)).resolves.toBe('not-found')

      const index = JSON.parse(await readFile(indexPath(), 'utf8')) as {
        files: Array<{ hashes: string[] }>
      }
      index.files[0]!.hashes.push('f'.repeat(64))
      await writeFile(indexPath(), JSON.stringify(index))
      const later = new Date(Date.now() + 5_000)
      await utimes(mirrorPath, later, later)
      simulateNewProcess()
      await expect(defaultRecordReferenceResolver(missingHash)).resolves.toBe('not-found')
      expect(recordReferenceResolverCacheStatsForTests().full_file_scans).toBe(1)
    })

    it('does not cache a scan the file was rewritten under', async () => {
      const first = await makeRecord('d', 0)
      const second = await makeRecord('e', 1)
      const third = await makeRecord('a', 2)
      const mirrorPath = join(tmpDir, 'producer.jsonl')
      await writeFile(mirrorPath, line(first.record))

      // Another producer rewrites the mirror, longer, right after the scan read it.
      setRecordHashIndexScanHookForTests(async () => {
        setRecordHashIndexScanHookForTests(undefined)
        await writeFile(mirrorPath, line(second.record) + line(third.record))
      })
      await expect(defaultRecordReferenceResolver(missingHash)).resolves.toBe('not-found')

      simulateNewProcess()
      await expect(defaultRecordReferenceResolver(first.recordHash)).resolves.toBe('not-found')
      await expect(defaultRecordReferenceResolver(third.recordHash)).resolves.toBe('found')
      expect(recordReferenceResolverCacheStatsForTests().append_file_scans).toBe(0)
    })

    it('keeps a scan that only saw concurrent appends', async () => {
      const first = await makeRecord('d', 0)
      const second = await makeRecord('e', 1)
      const mirrorPath = join(tmpDir, 'producer.jsonl')
      await writeFile(mirrorPath, line(first.record))

      setRecordHashIndexScanHookForTests(async () => {
        setRecordHashIndexScanHookForTests(undefined)
        await appendFile(mirrorPath, line(second.record))
      })
      await expect(defaultRecordReferenceResolver(missingHash)).resolves.toBe('not-found')

      simulateNewProcess()
      await expect(defaultRecordReferenceResolver(second.recordHash)).resolves.toBe('found')
      const stats = recordReferenceResolverCacheStatsForTests()
      expect(stats.full_file_scans).toBe(0)
      expect(stats.append_file_scans).toBe(1)
    })

    it('rescans when metadata matches but the bytes before the indexed size do not', async () => {
      const first = await makeRecord('d', 0)
      const mirrorPath = join(tmpDir, 'producer.jsonl')
      await writeFile(mirrorPath, line(first.record))
      await expect(defaultRecordReferenceResolver(missingHash)).resolves.toBe('not-found')

      // What a same-size rewrite inside one timestamp tick leaves behind: the
      // index metadata still matches the file, but it describes other bytes.
      const index = JSON.parse(await readFile(indexPath(), 'utf8')) as {
        files: Array<{ hashes: string[]; tailSha256: string }>
      }
      index.files[0]!.hashes = ['f'.repeat(64)]
      index.files[0]!.tailSha256 = 'e'.repeat(64)
      await writeFile(indexPath(), JSON.stringify(index))

      simulateNewProcess()
      await expect(defaultRecordReferenceResolver(missingHash)).resolves.toBe('not-found')
      await expect(defaultRecordReferenceResolver(first.recordHash)).resolves.toBe('found')
      const stats = recordReferenceResolverCacheStatsForTests()
      expect(stats.full_file_scans).toBe(1)
      expect(stats.persisted_file_caches).toBe(0)
    })

    it('ignores bytes past the stat it read', async () => {
      const first = await makeRecord('d', 0)
      const mirrorPath = join(tmpDir, 'producer.jsonl')
      // A writer is mid-line: the partial row must not poison the cache.
      const full = line(first.record)
      await writeFile(mirrorPath, full.slice(0, 40))
      await expect(defaultRecordReferenceResolver(first.recordHash)).resolves.toBe('not-found')

      await writeFile(mirrorPath, full)
      simulateNewProcess()
      await expect(defaultRecordReferenceResolver(first.recordHash)).resolves.toBe('found')
      expect(recordReferenceResolverCacheStatsForTests().full_file_scans).toBe(1)
    })
  })

  describe('explicit mirror files', () => {
    const missingHash = `sha256:${'f'.repeat(64)}`
    const line = (record: AtribRecord) => `${JSON.stringify({ record })}\n`

    it('answers repeated lookups from one scan', async () => {
      const first = await makeRecord('d', 0)
      const second = await makeRecord('e', 1)
      const mirrorPath = join(tmpDir, 'custom-mirror.log')
      await writeFile(mirrorPath, line(first.record))

      expect(await recordHashExistsInMirror({ path: mirrorPath, recordHash: missingHash })).toBe(
        false,
      )
      expect(
        await recordHashExistsInMirror({ path: mirrorPath, recordHash: first.recordHash }),
      ).toBe(true)
      expect(recordReferenceResolverCacheStatsForTests().full_file_scans).toBe(1)

      await appendFile(mirrorPath, line(second.record))
      expect(
        await recordHashExistsInMirror({ path: mirrorPath, recordHash: second.recordHash }),
      ).toBe(true)
      const stats = recordReferenceResolverCacheStatsForTests()
      expect(stats.full_file_scans).toBe(1)
      expect(stats.append_file_scans).toBe(1)
    })

    it('shares one scan between concurrent lookups', async () => {
      const { record, recordHash } = await makeRecord('d', 0)
      const mirrorPath = join(tmpDir, 'producer.jsonl')
      await writeFile(mirrorPath, line(record))

      const results = await Promise.all([
        recordHashExistsInMirror({ path: mirrorPath, recordHash }),
        recordHashExistsInMirror({ path: mirrorPath, recordHash: missingHash }),
        recordHashExistsInMirror({ path: mirrorPath, recordHash }),
      ])
      expect(results).toEqual([true, false, true])
      expect(recordReferenceResolverCacheStatsForTests().full_file_scans).toBe(1)
    })

    it('lets a new process reuse the persisted index', async () => {
      const { record, recordHash } = await makeRecord('d', 0)
      const mirrorPath = join(tmpDir, 'producer.jsonl')
      await writeFile(mirrorPath, line(record))
      expect(await recordHashExistsInMirror({ path: mirrorPath, recordHash })).toBe(true)

      clearRecordReferenceResolverCacheForTests()
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
      await expect(
        defaultRecordReferenceResolver(recordHash, undefined, { localMirrorPaths: [mirrorPath] }),
      ).resolves.toBe('found')
      expect(fetchSpy).not.toHaveBeenCalled()
      const stats = recordReferenceResolverCacheStatsForTests()
      expect(stats.full_file_scans).toBe(0)
      expect(stats.persisted_file_caches).toBe(1)
    })

    it('does not accept a hash a row only declares', async () => {
      const { record, recordHash } = await makeRecord('d', 0)
      const declaredHash = `sha256:${'a'.repeat(64)}`
      const mirrorPath = join(tmpDir, 'producer.jsonl')
      await writeFile(
        mirrorPath,
        `${JSON.stringify({ record_hash: declaredHash })}\n${JSON.stringify({ signed_record: record })}\n`,
      )
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 404 } as Response)

      for (const freshProcess of [false, true]) {
        if (freshProcess) clearRecordReferenceResolverCacheForTests()
        for (const hash of [declaredHash, recordHash]) {
          expect(await recordHashExistsInMirror({ path: mirrorPath, recordHash: hash })).toBe(false)
          // Process-wide discovery keeps accepting declared hashes.
          await expect(defaultRecordReferenceResolver(hash)).resolves.toBe('found')
        }
      }
    })

    it('returns false for a missing or empty mirror', async () => {
      const mirrorPath = join(tmpDir, 'producer.jsonl')
      expect(await recordHashExistsInMirror({ path: mirrorPath, recordHash: missingHash })).toBe(
        false,
      )
      await writeFile(mirrorPath, '')
      expect(await recordHashExistsInMirror({ path: mirrorPath, recordHash: missingHash })).toBe(
        false,
      )
    })
  })
})
