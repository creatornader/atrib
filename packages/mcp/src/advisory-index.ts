// SPDX-License-Identifier: Apache-2.0

/**
 * Atomic writer shared by the deletable advisory indexes kept beside mirror
 * files (the corpus tail index and the record hash index).
 */

import { randomUUID } from 'node:crypto'
import { readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

// A writer killed between its write and its rename leaves a temp file behind.
// Anything this old cannot belong to a write that is still in progress.
const STALE_TEMP_AGE_MS = 10 * 60 * 1000

/**
 * Write `contents` to `path` through a private temp file and a rename, so a
 * reader never sees a partial index. Throws when the write fails. Temp files
 * abandoned by earlier writers are swept after a successful write.
 */
export async function writeAdvisoryIndexFile(path: string, contents: string): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, contents, { encoding: 'utf-8', mode: 0o600 })
    await rename(temporaryPath, path)
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
  await removeStaleIndexTemps(path)
}

async function removeStaleIndexTemps(path: string): Promise<void> {
  const directory = dirname(path)
  const prefix = `${basename(path)}.`
  try {
    const cutoff = Date.now() - STALE_TEMP_AGE_MS
    for (const name of await readdir(directory)) {
      if (!name.startsWith(prefix) || !name.endsWith('.tmp')) continue
      const candidate = join(directory, name)
      try {
        const stats = await stat(candidate)
        if (stats.isFile() && stats.mtimeMs < cutoff) await rm(candidate, { force: true })
      } catch {
        continue
      }
    }
  } catch {
    // Best effort: a leftover temp file is clutter, never incorrect state.
  }
}
