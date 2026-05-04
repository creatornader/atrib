// Signed-record mirror + autoChain seed loader.
//
// log.atrib.dev stores commitments only (record_hash). The original signed
// JSON is unrecoverable from the log alone. A local jsonl mirror is what
// lets a verifier later replay verifyRecord() against creator_key to prove
// "this exact bytes were signed by that key", closing the chain seed →
// pubkey → record signature → log inclusion.
//
// The mirror also feeds autoChainSeed: without it, every wrapper restart
// breaks chain continuity and the next call becomes a fresh genesis even
// though chained records exist on disk.

import { existsSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AtribRecord } from '@atrib/mcp'
import { ensureSecureDir, secureAppend } from './paths.js'

/**
 * Append one signed record to the local jsonl mirror. Wrapped in try/catch
 * because @atrib/mcp's onRecord swallows observer errors per §5.8, but we
 * want a persistence failure to surface in the wrapper debug log so it
 * doesn't hide silently.
 */
export function persistRecord(
  recordFile: string,
  record: Record<string, unknown>,
  onError: (msg: string, extra: Record<string, unknown>) => void,
): void {
  if (!recordFile) return
  try {
    ensureSecureDir(dirname(recordFile))
    secureAppend(recordFile, JSON.stringify(record) + '\n')
  } catch (err) {
    onError('persistRecord failed', {
      error: err instanceof Error ? err.message : String(err),
      file: recordFile,
    })
  }
}

/**
 * Read the on-disk record mirror and return its contents for autoChainSeed.
 * This lets autoChain survive wrapper restarts: without it, every restart
 * starts a fresh genesis even though chained records exist on disk.
 *
 * Returns an empty array if the file is missing, unreadable, or empty,
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
        const r: unknown = JSON.parse(trimmed)
        // Defensive shape check, anything missing the load-bearing fields
        // can't be used as a chain anchor.
        if (
          typeof r === 'object' &&
          r !== null &&
          typeof (r as { context_id?: unknown }).context_id === 'string' &&
          typeof (r as { timestamp?: unknown }).timestamp === 'number' &&
          typeof (r as { chain_root?: unknown }).chain_root === 'string' &&
          typeof (r as { signature?: unknown }).signature === 'string' &&
          typeof (r as { creator_key?: unknown }).creator_key === 'string'
        ) {
          out.push(r as AtribRecord)
        }
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
