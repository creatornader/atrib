// SPDX-License-Identifier: Apache-2.0

/**
 * File-backed outbox for the submission queue (Node only).
 *
 * One small file per record that a queue accepted and the log has not yet
 * confirmed. A process killed between signing and confirmation leaves its
 * file behind, and the next process that opens the same outbox resends it.
 * Files hold only the signed record, which is what the log receives anyway,
 * so the outbox discloses nothing the mirror beside it does not.
 */

import {
  link,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { SubmissionOutbox, SubmissionOutboxEntry } from './submission.js'
import type { AtribRecord } from './types.js'

const OUTBOX_SCHEMA = 'atrib.submission-outbox.v1'
const ENTRY_NAME = /^[0-9a-f]{64}\.json$/
const TEMP_SUFFIX = '.tmp'

// Longer than the queue's 30 s retry window, so a process that is still
// working on its own record is normally left alone.
const DEFAULT_MIN_AGE_MS = 60_000
const DEFAULT_MAX_CLAIM = 8
const DEFAULT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000
// Bounds the work one process does on a large backlog. Entries beyond the
// window are reached once earlier ones are confirmed or expire.
const SCAN_WINDOW = 256
const STALE_TEMP_AGE_MS = 10 * 60 * 1000

export interface FileSubmissionOutboxOptions {
  /** Directory holding the outbox files. Created on first use, mode 0700. */
  dir: string
  /** How long an entry rests after it was written or last claimed. */
  minAgeMs?: number
  /** Most entries one `claimDue` call returns. */
  maxClaim?: number
  /** Entries first queued longer ago than this are dropped unsent. */
  maxAgeMs?: number
}

interface OutboxFile {
  schema: typeof OUTBOX_SCHEMA
  endpoint: string
  priority: 'high' | 'normal'
  queued_at: number
  record: AtribRecord
}

function parseOutboxFile(raw: string): OutboxFile | undefined {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null) return undefined
  const file = value as Partial<OutboxFile>
  if (file.schema !== OUTBOX_SCHEMA) return undefined
  if (typeof file.endpoint !== 'string') return undefined
  if (file.priority !== 'high' && file.priority !== 'normal') return undefined
  if (typeof file.queued_at !== 'number' || !Number.isFinite(file.queued_at)) return undefined
  if (typeof file.record !== 'object' || file.record === null) return undefined
  return file as OutboxFile
}

export function createFileSubmissionOutbox(options: FileSubmissionOutboxOptions): SubmissionOutbox {
  const { dir } = options
  const minAgeMs = options.minAgeMs ?? DEFAULT_MIN_AGE_MS
  const maxClaim = options.maxClaim ?? DEFAULT_MAX_CLAIM
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS
  let ensured = false

  function entryPath(recordHash: string): string {
    return join(dir, `${recordHash}.json`)
  }

  async function removePath(path: string): Promise<void> {
    await rm(path, { force: true }).catch(() => undefined)
  }

  return {
    async put(recordHash: string, entry: SubmissionOutboxEntry, endpoint: string): Promise<void> {
      if (!/^[0-9a-f]{64}$/.test(recordHash)) return
      const file: OutboxFile = {
        schema: OUTBOX_SCHEMA,
        endpoint,
        priority: entry.priority,
        queued_at: Date.now(),
        record: entry.record,
      }
      const temporaryPath = join(dir, `${recordHash}.${process.pid}.${randomUUID()}${TEMP_SUFFIX}`)
      try {
        if (!ensured) {
          await mkdir(dir, { recursive: true, mode: 0o700 })
          ensured = true
        }
        await writeFile(temporaryPath, JSON.stringify(file), { encoding: 'utf-8', mode: 0o600 })
        // link() fails when the entry already exists, which keeps the first
        // queued_at across in-process retries, and a reader never sees a
        // partial file. A filesystem without hard links gets a rename.
        try {
          await link(temporaryPath, entryPath(recordHash))
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
            await rename(temporaryPath, entryPath(recordHash))
          }
        }
      } catch {
        // Best effort: without the entry the record is submitted from
        // memory only, as it was before the outbox existed.
      } finally {
        await removePath(temporaryPath)
      }
    },

    async remove(recordHash: string): Promise<void> {
      if (!/^[0-9a-f]{64}$/.test(recordHash)) return
      await removePath(entryPath(recordHash))
    },

    async claimDue(
      endpoint: string,
    ): Promise<Array<SubmissionOutboxEntry & { recordHash: string }>> {
      let names: string[]
      try {
        names = await readdir(dir)
      } catch {
        return []
      }
      const now = Date.now()
      const candidates: Array<{ name: string; path: string; mtimeMs: number }> = []
      let scanned = 0
      for (const name of names) {
        const path = join(dir, name)
        if (name.endsWith(TEMP_SUFFIX)) {
          // A writer killed between its write and its link leaves a temp
          // file. Anything this old cannot belong to a live write.
          const stats = await stat(path).catch(() => undefined)
          if (stats && stats.mtimeMs < now - STALE_TEMP_AGE_MS) await removePath(path)
          continue
        }
        if (!ENTRY_NAME.test(name)) continue
        if (scanned >= SCAN_WINDOW) continue
        scanned++
        const stats = await stat(path).catch(() => undefined)
        if (!stats?.isFile()) continue
        if (stats.mtimeMs > now - minAgeMs) continue
        candidates.push({ name, path, mtimeMs: stats.mtimeMs })
      }
      candidates.sort((a, b) => a.mtimeMs - b.mtimeMs)

      const claimed: Array<SubmissionOutboxEntry & { recordHash: string }> = []
      for (const candidate of candidates) {
        if (claimed.length >= maxClaim) break
        const raw = await readFile(candidate.path, 'utf-8').catch(() => undefined)
        if (raw === undefined) continue
        const file = parseOutboxFile(raw)
        if (!file || file.queued_at < now - maxAgeMs) {
          await removePath(candidate.path)
          continue
        }
        // Another log's records wait for a queue that talks to that log.
        if (file.endpoint !== endpoint) continue
        // Touching the file is the claim: other processes see a fresh
        // mtime and leave the entry alone for minAgeMs. Two processes can
        // still both claim it in a race; the log accepts the repeat.
        const claimTime = new Date(now)
        const touched = await utimes(candidate.path, claimTime, claimTime).then(
          () => true,
          () => false,
        )
        if (!touched) continue
        claimed.push({
          recordHash: candidate.name.slice(0, 64),
          record: file.record,
          priority: file.priority,
        })
      }
      return claimed
    },
  }
}
