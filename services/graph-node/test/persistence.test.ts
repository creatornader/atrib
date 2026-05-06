// SPDX-License-Identifier: Apache-2.0

/**
 * Tests for graph-node's durable record archive (services/graph-node/src/persistence.ts).
 *
 * The archive is graph-node's append-only mirror of the in-memory store,
 * the replay-on-cold-start path that recovers state after an OOM, deploy,
 * or fly machine reboot. log-node persists only the 90-byte log entries
 * per spec §2.3.1, so log-node cannot serve as the recovery source for
 * the full record content.
 *
 * Target cases per the 2026-05-06 17:13 handoff P1:
 *   1. replayArchive populates the store with N records in file order
 *   2. Torn-final-line is skipped via console.warn rather than thrown
 *   3. createArchiveAppender writes O_APPEND-correct lines that
 *      round-trip through replayArchive
 *   4. Lifecycle: open appender, write line, close appender; subsequent
 *      replay sees the line and reports total/ingested/skipped accurately
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  base64urlEncode,
  signRecord,
  getPublicKey,
  genesisChainRoot,
} from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'
import { createArchiveAppender, replayArchive } from '../src/persistence.js'
import { createRecordStore } from '../src/store.js'

const TEST_KEY = new Uint8Array(32).fill(11)
const CTX = 'p'.repeat(32)

async function makeRecord(seed: number): Promise<AtribRecord> {
  const pk = await getPublicKey(TEST_KEY)
  const contentHex = seed.toString(16).padStart(64, '0')
  const unsigned = {
    spec_version: 'atrib/1.0' as const,
    content_id: `sha256:${contentHex}`,
    creator_key: base64urlEncode(pk),
    chain_root: genesisChainRoot(CTX),
    event_type: 'https://atrib.dev/v1/types/tool_call' as const,
    context_id: CTX,
    timestamp: 1_700_000_000_000 + seed,
    signature: '',
  }
  return signRecord(unsigned as AtribRecord, TEST_KEY)
}

describe('persistence', () => {
  let dir: string
  let archivePath: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'atrib-graph-persistence-'))
    archivePath = join(dir, 'nested', 'records.jsonl')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  describe('replayArchive', () => {
    it('returns zeros when the archive file does not exist', async () => {
      const ingested: AtribRecord[] = []
      const result = await replayArchive(archivePath, (record) => {
        ingested.push(record)
      })
      expect(result).toEqual({ total: 0, ingested: 0, skipped: 0 })
      expect(ingested).toHaveLength(0)
    })

    it('replays every line into the ingest callback in file order', async () => {
      const r1 = await makeRecord(1)
      const r2 = await makeRecord(2)
      const r3 = await makeRecord(3)
      const lines = [
        JSON.stringify({ record: r1, log_index: 100 }),
        JSON.stringify({ record: r2, log_index: 101 }),
        JSON.stringify({ record: r3, log_index: 102 }),
      ].join('\n') + '\n'
      await mkdir(dirname(archivePath), { recursive: true })
      await writeFile(archivePath, lines)

      const seen: Array<{ record: AtribRecord; logIndex?: number }> = []
      const result = await replayArchive(archivePath, (record, logIndex) => {
        seen.push({ record, logIndex })
      })

      expect(result).toEqual({ total: 3, ingested: 3, skipped: 0 })
      expect(seen).toHaveLength(3)
      expect(seen[0]!.record.content_id).toBe(r1.content_id)
      expect(seen[1]!.record.content_id).toBe(r2.content_id)
      expect(seen[2]!.record.content_id).toBe(r3.content_id)
      expect(seen[0]!.logIndex).toBe(100)
      expect(seen[1]!.logIndex).toBe(101)
      expect(seen[2]!.logIndex).toBe(102)
    })

    it('treats null log_index as undefined to preserve the unsigned-int contract', async () => {
      const r1 = await makeRecord(1)
      await mkdir(dirname(archivePath), { recursive: true })
      await writeFile(
        archivePath,
        JSON.stringify({ record: r1, log_index: null }) + '\n',
      )

      const seen: Array<number | undefined> = []
      await replayArchive(archivePath, (_record, logIndex) => {
        seen.push(logIndex)
      })

      expect(seen).toEqual([undefined])
    })

    it('skips blank lines without counting them as malformed', async () => {
      const r1 = await makeRecord(1)
      const valid = JSON.stringify({ record: r1, log_index: 5 })
      await mkdir(dirname(archivePath), { recursive: true })
      await writeFile(archivePath, `\n${valid}\n\n`)

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const ingested: AtribRecord[] = []
      const result = await replayArchive(archivePath, (record) => {
        ingested.push(record)
      })

      expect(result).toEqual({ total: 1, ingested: 1, skipped: 0 })
      expect(ingested).toHaveLength(1)
      expect(warnSpy).not.toHaveBeenCalled()
      warnSpy.mockRestore()
    })

    it('skips a malformed JSON line via console.warn rather than throwing', async () => {
      const r1 = await makeRecord(1)
      const r2 = await makeRecord(2)
      const valid1 = JSON.stringify({ record: r1, log_index: 1 })
      const valid2 = JSON.stringify({ record: r2, log_index: 2 })
      // Truncated JSON object, half-written line that survived a crash.
      const torn = '{"record":{"spec_version":"atrib/1.0","content_id":"sha'
      await mkdir(dirname(archivePath), { recursive: true })
      // Newline-terminate the torn line so readline emits it as a real line
      // for replayArchive to fail-parse on. Without the newline, the torn
      // bytes would still be emitted as the final line by readline
      // (crlfDelay: Infinity), but the test is more deterministic when each
      // line is explicitly terminated.
      await writeFile(archivePath, `${valid1}\n${valid2}\n${torn}\n`)

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const ingested: AtribRecord[] = []
      const result = await replayArchive(archivePath, (record) => {
        ingested.push(record)
      })
      // Assert spy state BEFORE restore, vitest's mockRestore detaches the
      // implementation and any race in clear-on-restore could mask call records.
      expect(warnSpy).toHaveBeenCalledTimes(1)
      const warnMessage = String(warnSpy.mock.calls[0]?.[0] ?? '')
      expect(warnMessage).toMatch(/replay skipped malformed line 3/)
      warnSpy.mockRestore()

      expect(result.total).toBe(3)
      expect(result.ingested).toBe(2)
      expect(result.skipped).toBe(1)
      expect(ingested).toHaveLength(2)
    })
  })

  describe('createArchiveAppender', () => {
    it('creates parent directories if they do not exist', async () => {
      const appender = await createArchiveAppender(archivePath)
      const r1 = await makeRecord(1)
      await appender.append(r1, 7)
      await appender.close()

      const contents = await readFile(archivePath, 'utf-8')
      expect(contents.endsWith('\n')).toBe(true)
      expect(contents.trim().split('\n')).toHaveLength(1)
    })

    it('writes one LF-terminated JSON line per append, with log_index preserved', async () => {
      const appender = await createArchiveAppender(archivePath)
      const r1 = await makeRecord(1)
      const r2 = await makeRecord(2)
      await appender.append(r1, 100)
      await appender.append(r2)
      await appender.close()

      const lines = (await readFile(archivePath, 'utf-8'))
        .split('\n')
        .filter((l) => l.length)
      expect(lines).toHaveLength(2)
      const parsed1 = JSON.parse(lines[0]!)
      const parsed2 = JSON.parse(lines[1]!)
      expect(parsed1.record.content_id).toBe(r1.content_id)
      expect(parsed1.log_index).toBe(100)
      expect(parsed2.record.content_id).toBe(r2.content_id)
      expect(parsed2.log_index).toBeNull()
    })

    it('round-trips appended records through replayArchive into a real store', async () => {
      const appender = await createArchiveAppender(archivePath)
      const records = [await makeRecord(1), await makeRecord(2), await makeRecord(3)]
      await appender.append(records[0]!, 10)
      await appender.append(records[1]!, 11)
      await appender.append(records[2]!) // no logIndex
      await appender.close()

      const store = createRecordStore()
      const indexed: number[] = []
      const result = await replayArchive(archivePath, (record, logIndex) => {
        store.addRecord(record)
        indexed.push(logIndex ?? -1)
      })

      expect(result).toEqual({ total: 3, ingested: 3, skipped: 0 })
      expect(store.getRecordsByContextId(CTX)).toHaveLength(3)
      expect(indexed).toEqual([10, 11, -1])
    })

    it('lifecycle: open, write, close, replay sees the line', async () => {
      const r1 = await makeRecord(1)
      const appender = await createArchiveAppender(archivePath)
      await appender.append(r1, 42)
      await appender.close()

      const seen: Array<{ record: AtribRecord; logIndex?: number }> = []
      const result = await replayArchive(archivePath, (record, logIndex) => {
        seen.push({ record, logIndex })
      })

      expect(result).toEqual({ total: 1, ingested: 1, skipped: 0 })
      expect(seen).toHaveLength(1)
      expect(seen[0]!.record.content_id).toBe(r1.content_id)
      expect(seen[0]!.logIndex).toBe(42)
    })

    it('appends to an existing archive without truncating prior content', async () => {
      const r1 = await makeRecord(1)
      const r2 = await makeRecord(2)

      const appender1 = await createArchiveAppender(archivePath)
      await appender1.append(r1, 1)
      await appender1.close()

      const appender2 = await createArchiveAppender(archivePath)
      await appender2.append(r2, 2)
      await appender2.close()

      const ingested: AtribRecord[] = []
      const result = await replayArchive(archivePath, (record) => {
        ingested.push(record)
      })

      expect(result.total).toBe(2)
      expect(result.ingested).toBe(2)
      expect(ingested[0]!.content_id).toBe(r1.content_id)
      expect(ingested[1]!.content_id).toBe(r2.content_id)
    })
  })
})
