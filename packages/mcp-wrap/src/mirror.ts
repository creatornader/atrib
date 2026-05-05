// Signed-record mirror + autoChain seed loader.
//
// log.atrib.dev stores commitments only (record_hash). The original signed
// JSON is unrecoverable from the log alone. A local jsonl mirror is what
// lets a verifier later replay verifyRecord() against creator_key to prove
// "this exact bytes were signed by that key", closing the chain seed →
// pubkey → record signature → log inclusion.
//
// The mirror also persists an optional `_local` sidecar carrying pre-sign
// payload context (toolName, args, result). The sidecar lives at the
// envelope level so it can never affect the signed bytes; the public log
// only ever sees the bare AtribRecord. Consumers (recall, atrib-trace,
// atrib-summarize) read the sidecar to surface semantic context alongside
// the cryptographic evidence.
//
// Two on-disk shapes coexist:
//   - LEGACY: bare AtribRecord JSON per line (older mirror writes).
//     Readers MUST tolerate this for autoChain seed continuity.
//   - ENVELOPE: { record, _local? } per line (current shape).
//     New writes use this shape unconditionally; the _local field is
//     present when the sidecar was supplied.
//
// The mirror also feeds autoChainSeed: without it, every wrapper restart
// breaks chain continuity and the next call becomes a fresh genesis even
// though chained records exist on disk.

import { existsSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AtribRecord, OnRecordSidecar } from '@atrib/mcp'
import { ensureSecureDir, secureAppend } from './paths.js'

/**
 * Local-only sidecar persisted alongside the signed record. Mirrors the
 * @atrib/mcp `OnRecordSidecar` shape exactly so consumers can pass it
 * through unchanged.
 */
export type LocalSidecar = OnRecordSidecar

/**
 * Envelope shape written to the mirror.
 * The `record` is the canonical signed AtribRecord — anything outside
 * `record` is local-only and is never sent to the public log.
 */
export interface MirrorEnvelope {
  record: AtribRecord
  /** Optional pre-sign sidecar; absent when no sidecar was supplied. */
  _local?: LocalSidecar
  /** Wall-clock time the line was written; for debugging staleness. */
  written_at: number
}

/**
 * Append one signed record to the local jsonl mirror, optionally with a
 * `_local` sidecar carrying pre-sign payload context. Wrapped in try/catch
 * because @atrib/mcp's onRecord swallows observer errors per §5.8 — but we
 * want a persistence failure to surface in the wrapper debug log so it
 * doesn't hide silently.
 *
 * Always writes the new envelope shape (record + optional _local +
 * written_at). Legacy bare-record entries from prior writes still parse
 * via loadAutoChainSeed below.
 */
export function persistRecord(
  recordFile: string,
  record: AtribRecord,
  onError: (msg: string, extra: Record<string, unknown>) => void,
  sidecar?: LocalSidecar,
): void {
  if (!recordFile) return
  const envelope: MirrorEnvelope = { record, written_at: Date.now() }
  if (sidecar) envelope._local = sidecar
  try {
    ensureSecureDir(dirname(recordFile))
    secureAppend(recordFile, JSON.stringify(envelope) + '\n')
  } catch (err) {
    onError('persistRecord failed', {
      error: err instanceof Error ? err.message : String(err),
      file: recordFile,
    })
  }
}

/**
 * Normalize a parsed mirror line to a bare AtribRecord. Tolerates both
 * legacy bare-record entries (legacy) and new envelope entries
 * ({record, _local?, written_at}). Returns null if neither shape parses
 * to a valid AtribRecord with the load-bearing fields.
 */
function normalizeMirrorLine(parsed: unknown): AtribRecord | null {
  if (typeof parsed !== 'object' || parsed === null) return null
  // Envelope shape: nested under `record`.
  const candidate =
    'record' in parsed &&
    typeof (parsed as { record?: unknown }).record === 'object' &&
    (parsed as { record?: unknown }).record !== null
      ? ((parsed as { record: unknown }).record as Record<string, unknown>)
      : (parsed as Record<string, unknown>)
  if (
    typeof candidate.context_id === 'string' &&
    typeof candidate.timestamp === 'number' &&
    typeof candidate.chain_root === 'string' &&
    typeof candidate.signature === 'string' &&
    typeof candidate.creator_key === 'string'
  ) {
    return candidate as unknown as AtribRecord
  }
  return null
}

/**
 * Read the on-disk record mirror and return its contents for autoChainSeed.
 * This lets autoChain survive wrapper restarts: without it, every restart
 * starts a fresh genesis even though chained records exist on disk.
 *
 * Tolerates both legacy bare-record lines (legacy) and new envelope
 * lines ({record, _local?, written_at}). Sidecar content is intentionally
 * dropped here — autoChain only cares about the chain anchor (context_id +
 * chain_root + record_hash). Consumers wanting the sidecar should read the
 * mirror directly.
 *
 * Returns an empty array if the file is missing, unreadable, or empty —
 * the wrapper continues without seeding (treats the restart as "fresh
 * trace begins now"), which is the correct degradation.
 */
export function loadAutoChainSeed(
  recordFile: string,
  onError: (msg: string, extra: Record<string, unknown>) => void,
): AtribRecord[] {
  if (!recordFile) return []
  if (!existsSync(recordFile)) return []
  try {
    const raw = readFileSync(recordFile, 'utf8')
    const out: AtribRecord[] = []
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const parsed: unknown = JSON.parse(trimmed)
        const rec = normalizeMirrorLine(parsed)
        if (rec) out.push(rec)
      } catch {
        // Skip malformed line.
      }
    }
    return out
  } catch (err) {
    onError('loadAutoChainSeed failed', {
      error: err instanceof Error ? err.message : String(err),
      file: recordFile,
    })
    return []
  }
}
