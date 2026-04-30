// Local JSONL mirror, same convention as the wrapper, so atrib-recall
// surfaces emit-signed records identically to wrapper-signed ones. Each
// line is one signed AtribRecord plus its proof bundle if available.
//
// v1 keeps this minimal: append-only, no rotation, no compression. Path
// defaults to ATRIB_MIRROR_FILE; if unset, mirroring is skipped (the
// in-log record is still authoritative).

import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { AtribRecord } from '@atrib/mcp'
import type { ProofBundle } from '@atrib/mcp'

interface MirrorLine {
  record: AtribRecord
  proof: ProofBundle | null
  written_at: number
}

let ensuredDirs = new Set<string>()

/**
 * Append one record + optional proof to the mirror file. Failures log
 * with the atrib-emit prefix and otherwise no-op, per §5.8 the mirror
 * is best-effort and never blocks the agent.
 */
export async function mirrorRecord(record: AtribRecord, proof: ProofBundle | null): Promise<void> {
  const path = process.env['ATRIB_MIRROR_FILE']
  if (!path) return
  const line: MirrorLine = { record, proof, written_at: Date.now() }
  try {
    if (!ensuredDirs.has(path)) {
      await mkdir(dirname(path), { recursive: true })
      ensuredDirs.add(path)
    }
    await appendFile(path, JSON.stringify(line) + '\n', 'utf-8')
  } catch (e) {
    console.warn('atrib-emit: mirror append failed', e instanceof Error ? e.message : String(e))
  }
}
