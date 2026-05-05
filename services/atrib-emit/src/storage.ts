// Local JSONL mirror — same convention as the wrapper, so atrib-recall
// surfaces emit-signed records identically to wrapper-signed ones. Each
// line is one envelope around a signed AtribRecord plus optional proof
// and an OPTIONAL `_local` sidecar carrying pre-sign payload content.
//
// The `_local` sidecar is the local-only complement to the public log.
// Public log gets only the signed AtribRecord (with content_id as the
// commitment to the original content). Local mirror additionally keeps
// the pre-sign content so consumers (recall, trace, summarize) can
// surface semantic context — `topics`, `what`, `why_noted` — alongside
// the cryptographic evidence. Without the sidecar, mirror readers see
// only event_type + hashes and must guess at semantics.
//
// Sidecar shape rules:
//   - Lives at the ENVELOPE level (not inside `record`). Never affects
//     the signature — the signed bytes only ever contain the canonical
//     AtribRecord fields.
//   - Marked with underscore prefix (`_local`) per Python/etc. convention
//     for "private to this layer".
//   - Stripped at submission time by construction: the submission queue
//     only ever sees the bare AtribRecord, so the sidecar can never
//     leak to the public log.
//   - Backward-compatible: existing mirror entries with no `_local`
//     parse identically; readers must tolerate its absence.
//
// v1 keeps this minimal: append-only, no rotation, no compression. Path
// defaults to ATRIB_MIRROR_FILE; if unset, mirroring is skipped (the
// in-log record is still authoritative).

import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { AtribRecord } from '@atrib/mcp'
import type { ProofBundle } from '@atrib/mcp'

/**
 * Pre-sign payload preserved locally. For atrib-emit, this is the original
 * `content: { what, why_noted, topics, ... }` object the caller passed.
 * Free-form per event_type (the same way `content` is on the input schema).
 */
export type LocalSidecar = {
  /** Original pre-sign content payload as supplied by the caller. */
  content?: Record<string, unknown>
  /** Producer that emitted this record, for cross-source disambiguation. */
  producer?: string
}

export interface MirrorLine {
  record: AtribRecord
  proof: ProofBundle | null
  written_at: number
  /** Optional local-only sidecar; absent on legacy entries. */
  _local?: LocalSidecar
}

let ensuredDirs = new Set<string>()

/**
 * Append one record + optional proof + optional local sidecar to the
 * mirror file. Failures log with the atrib-emit prefix and otherwise
 * no-op — per §5.8 the mirror is best-effort and never blocks the
 * agent.
 */
export async function mirrorRecord(
  record: AtribRecord,
  proof: ProofBundle | null,
  localSidecar?: LocalSidecar,
): Promise<void> {
  const path = process.env['ATRIB_MIRROR_FILE']
  if (!path) return
  const line: MirrorLine = { record, proof, written_at: Date.now() }
  if (localSidecar) {
    line._local = localSidecar
  }
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
