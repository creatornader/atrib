// SPDX-License-Identifier: Apache-2.0

/**
 * File-backed outbox for the submission queue (Node only).
 *
 * One small file per record that a queue accepted and the log has not yet
 * confirmed, in a subdirectory per log endpoint. A process killed between
 * signing and confirmation leaves its file behind, and the next process
 * that opens the same outbox resends it.
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
import { createHash, randomUUID } from 'node:crypto'
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
// Bounds the work one process does on a large backlog. The window starts at
// a random entry, so every entry is reached over a few calls even when the
// ones at the front never leave.
const SCAN_WINDOW = 256
const STALE_TEMP_AGE_MS = 10 * 60 * 1000

export interface FileSubmissionOutboxOptions {
  /**
   * Directory holding the outbox. Created on first use, mode 0700. Each log
   * endpoint gets its own subdirectory, named by a hash of the endpoint.
   */
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
  const ensured = new Set<string>()
  // remove() is not told the endpoint, so it clears the record from every
  // endpoint directory this outbox has touched, plus any it finds on disk.
  const knownEndpointDirs = new Set<string>()

  function endpointDir(endpoint: string): string {
    const name = createHash('sha256').update(endpoint).digest('hex').slice(0, 16)
    const path = join(dir, name)
    knownEndpointDirs.add(path)
    return path
  }

  function entryPath(endpoint: string, recordHash: string): string {
    return join(endpointDir(endpoint), `${recordHash}.json`)
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
      const targetDir = endpointDir(endpoint)
      const targetPath = entryPath(endpoint, recordHash)
      const temporaryPath = join(
        targetDir,
        `${recordHash}.${process.pid}.${randomUUID()}${TEMP_SUFFIX}`,
      )
      try {
        if (!ensured.has(targetDir)) {
          await mkdir(targetDir, { recursive: true, mode: 0o700 })
          ensured.add(targetDir)
        }
        await writeFile(temporaryPath, JSON.stringify(file), { encoding: 'utf-8', mode: 0o600 })
        // link() fails when the entry already exists, which keeps the first
        // queued_at across in-process retries, and a reader never sees a
        // partial file. A filesystem without hard links gets a rename, but
        // only when no entry is there to overwrite.
        try {
          await link(temporaryPath, targetPath)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
            const exists = await stat(targetPath).then(
              () => true,
              () => false,
            )
            if (!exists) await rename(temporaryPath, targetPath)
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
      const dirs = new Set(knownEndpointDirs)
      const names = await readdir(dir).catch(() => [] as string[])
      for (const name of names) {
        if (/^[0-9a-f]{16}$/.test(name)) dirs.add(join(dir, name))
      }
      await Promise.all([...dirs].map((path) => removePath(join(path, `${recordHash}.json`))))
    },

    async claimDue(
      endpoint: string,
    ): Promise<Array<SubmissionOutboxEntry & { recordHash: string }>> {
      const fromDir = endpointDir(endpoint)
      let names: string[]
      try {
        names = await readdir(fromDir)
      } catch {
        return []
      }
      const now = Date.now()
      const entryNames: string[] = []
      for (const name of names) {
        if (name.endsWith(TEMP_SUFFIX)) {
          // A writer killed between its write and its link leaves a temp
          // file. Anything this old cannot belong to a live write.
          const path = join(fromDir, name)
          const stats = await stat(path).catch(() => undefined)
          if (stats && stats.mtimeMs < now - STALE_TEMP_AGE_MS) await removePath(path)
          continue
        }
        if (ENTRY_NAME.test(name)) entryNames.push(name)
      }
      const start =
        entryNames.length > SCAN_WINDOW ? Math.floor(Math.random() * entryNames.length) : 0
      const candidates: Array<{ name: string; path: string; mtimeMs: number }> = []
      for (let i = 0; i < Math.min(entryNames.length, SCAN_WINDOW); i++) {
        const name = entryNames[(start + i) % entryNames.length] as string
        const path = join(fromDir, name)
        const stats = await stat(path).catch(() => undefined)
        if (!stats?.isFile()) continue
        if (stats.mtimeMs > now - minAgeMs) continue
        candidates.push({ name, path, mtimeMs: stats.mtimeMs })
      }
      // Oldest first when everything due fits in one claim. With more due
      // than that, a random pick keeps processes that start together from
      // all choosing the same few.
      if (candidates.length > maxClaim) {
        for (let i = candidates.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1))
          const swap = candidates[i] as (typeof candidates)[number]
          candidates[i] = candidates[j] as (typeof candidates)[number]
          candidates[j] = swap
        }
      } else {
        candidates.sort((a, b) => a.mtimeMs - b.mtimeMs)
      }

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
        if (file.endpoint !== endpoint) continue
        // Touching the file is the claim: other processes see a fresh
        // mtime and leave the entry alone for minAgeMs. The check just
        // before it skips an entry another process claimed since the scan.
        // The two steps are not atomic, so a narrow race remains; the log
        // accepts the repeat.
        const current = await stat(candidate.path).catch(() => undefined)
        if (!current || current.mtimeMs !== candidate.mtimeMs) continue
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
