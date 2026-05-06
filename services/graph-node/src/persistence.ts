// SPDX-License-Identifier: Apache-2.0

/**
 * Durable record archive for graph-node.
 *
 * graph-node holds the canonical in-memory store; this file is its
 * append-only mirror so a restart (OOM, deploy, fly machine reboot)
 * doesn't lose state. The full signed-record content lives ONLY here
 * and in producer-local mirror files — log-node persists only the
 * 90-byte log entries per spec §2.3.1, so log-node can't be the
 * recovery source.
 *
 * Format: one JSON object per line, shape `{record, log_index}`. The
 * log_index is preserved alongside the record so revocation logic per
 * §1.9.3 still applies after replay (revocation registry is built by
 * scanning records globally, and uses log_index for cutoff comparisons).
 *
 * Crash safety: every successful ingest appends a single LF-terminated
 * line via O_APPEND. The OS guarantees the line is atomic; a mid-write
 * crash leaves at most a torn final line which the replay's per-line
 * try/catch skips with a warning.
 *
 * Compaction: not implemented in v1. The file grows unboundedly with
 * record count (~1-3 KB per record). Sustainable until ~10^5 records
 * per graph-node instance; beyond that the sustainable shape is a
 * disk-backed graph store (Layer 4 in the architecture roadmap), at
 * which point this archive becomes redundant and can be removed.
 */

import { open, mkdir, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import * as readline from 'node:readline'
import { dirname } from 'node:path'

import type { AtribRecord } from '@atrib/mcp'

export interface ArchiveAppender {
  append(record: AtribRecord, logIndex?: number): Promise<void>
  close(): Promise<void>
}

export async function createArchiveAppender(path: string): Promise<ArchiveAppender> {
  await mkdir(dirname(path), { recursive: true })
  // 'a' = O_APPEND on POSIX. Concurrent appends from a single process
  // are safe per the filesystem; we serialize via the file handle.
  const handle = await open(path, 'a')
  return {
    async append(record, logIndex) {
      const line = JSON.stringify({
        record,
        log_index: typeof logIndex === 'number' ? logIndex : null,
      }) + '\n'
      await handle.write(line)
    },
    async close() {
      await handle.close()
    },
  }
}

export interface ReplayResult {
  total: number
  ingested: number
  skipped: number
}

/**
 * Read the archive file line-by-line and call `ingest` for each valid
 * record. Streams via readline so the file size doesn't bound graph-node's
 * startup memory.
 *
 * If the file doesn't exist (fresh cold start) returns zeros. Per-line
 * parse failures are logged and skipped — the line counter still advances
 * so the warnings are useful for spotting corruption.
 */
export async function replayArchive(
  path: string,
  ingest: (record: AtribRecord, logIndex?: number) => void,
): Promise<ReplayResult> {
  let exists = true
  try {
    await stat(path)
  } catch {
    exists = false
  }
  if (!exists) {
    return { total: 0, ingested: 0, skipped: 0 }
  }

  const stream = createReadStream(path, { encoding: 'utf-8' })
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
  let total = 0
  let ingested = 0
  let skipped = 0
  for await (const line of rl) {
    const trimmed = line.trim()
    if (!trimmed) continue
    total++
    try {
      const parsed = JSON.parse(trimmed) as { record: AtribRecord; log_index: number | null }
      const record = parsed.record
      const logIndex = typeof parsed.log_index === 'number' ? parsed.log_index : undefined
      ingest(record, logIndex)
      ingested++
    } catch (err) {
      skipped++
      // eslint-disable-next-line no-console
      console.warn(
        `graph-node: replay skipped malformed line ${total}: ${(err as Error).message}`,
      )
    }
  }
  return { total, ingested, skipped }
}
