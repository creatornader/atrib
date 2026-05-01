// autoChain inheritance from the wrapper's local JSONL mirror.
//
// The wrapper service persists every signed record to a JSONL file under
// ~/.atrib/records/. Each line is a bare AtribRecord, newest at EOF. When
// atrib-emit runs in the same agent process, it can inherit the wrapper's
// active context_id by reading the most-recent line and chain its emit on
// top of that record (chain_root = sha256:<that record's hash>).
//
// This is the cognitive-feedback-loop convention: explicit observations
// chain seamlessly with the agent's mechanical tool calls in the same
// session, so the verifier sees one coherent chain per context_id.
//
// Per the scope doc design-question #2: same file as wrapper. Default path
// is the wrapper's default; override with ATRIB_MIRROR_FILE.
//
// Failure mode: never throws. Missing file → no inheritance → genesis
// record. Malformed last line → no inheritance → genesis record. The
// wrapper's autoChain across restarts uses the same file with the same
// silent-degradation contract.

import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { canonicalRecord, hexEncode, sha256, type AtribRecord } from '@atrib/mcp'

// Default path is parameterized by ATRIB_AGENT so each agent gets its own
// mirror file under ~/.atrib/records/. Wrappers that follow the same
// convention will write to the same file and atrib-emit's autoChain picks
// up inheritance for free. Wrappers that use a different filename should
// have the operator set ATRIB_AUTOCHAIN_SOURCE explicitly.
const DEFAULT_MIRROR = join(
  homedir(),
  '.atrib',
  'records',
  `${process.env.ATRIB_AGENT ?? 'claude-code'}.jsonl`,
)

export interface ChainContext {
  contextId: string
  chainRoot: string
  inheritedFrom: 'wrapper-mirror' | 'fresh'
}

/**
 * Decide what context_id + chain_root the next emit record should use.
 *
 * Resolution order:
 *   1. Caller-supplied context_id (with caller-supplied chain_root if known,
 *      otherwise genesis). Used when the host is explicit.
 *   2. Most-recent record in the wrapper's mirror file (when present).
 *      Inherits its context_id and chains on top of its record_hash.
 *   3. Fresh genesis context_id (random 16 bytes).
 *
 * Caller passes a chainRootForCallerContext callback that knows how to
 * compute the genesis chain_root for a given context_id (we accept it as
 * a parameter rather than depending on @atrib/mcp's genesisChainRoot
 * directly, so this module stays trivially testable without pulling in
 * the rest of the signing surface).
 */
export async function resolveChainContext(opts: {
  callerContextId?: string | undefined
  /** Path override. Defaults to ATRIB_MIRROR_FILE env, then the wrapper's default. */
  mirrorPath?: string | undefined
  /** Function returning genesis chain_root for a given context_id (spec §1.2.3). */
  genesisChainRoot: (contextId: string) => string
  /** Random context_id generator (16 bytes hex). Injected for determinism in tests. */
  randomContextId: () => string
}): Promise<ChainContext> {
  if (opts.callerContextId) {
    return {
      contextId: opts.callerContextId,
      chainRoot: opts.genesisChainRoot(opts.callerContextId),
      inheritedFrom: 'fresh',
    }
  }

  // Reads from ATRIB_AUTOCHAIN_SOURCE first, falling back to the wrapper's
  // mirror path (NOT emit's own mirror — they serve different concerns).
  // ATRIB_MIRROR_FILE controls where emit writes; ATRIB_AUTOCHAIN_SOURCE
  // controls what emit reads to inherit context. In a typical setup they
  // point at different files: emit writes its own mirror, but inherits the
  // wrapper's session context.
  const path =
    opts.mirrorPath ??
    process.env['ATRIB_AUTOCHAIN_SOURCE'] ??
    process.env['ATRIB_MIRROR_FILE'] ??
    DEFAULT_MIRROR
  const inherited = await readMostRecentRecord(path)
  if (inherited) {
    const recordHashHex = hexEncode(sha256(canonicalRecord(inherited)))
    return {
      contextId: inherited.context_id,
      chainRoot: `sha256:${recordHashHex}`,
      inheritedFrom: 'wrapper-mirror',
    }
  }

  const fresh = opts.randomContextId()
  return {
    contextId: fresh,
    chainRoot: opts.genesisChainRoot(fresh),
    inheritedFrom: 'fresh',
  }
}

/**
 * Read the JSONL mirror's last line and parse it as an AtribRecord.
 * Returns null on any failure (missing file, empty file, malformed JSON,
 * line missing required fields). Per §5.8 degradation: never throws.
 *
 * Implementation note: we read the whole file rather than seeking to the
 * end. Mirror files are bounded (one entry per tool call within a session
 * lifetime, single-digit MB at worst). If volume grows enough that this
 * matters, switch to a tail read. Until then, simplicity wins.
 */
async function readMostRecentRecord(path: string): Promise<AtribRecord | null> {
  try {
    const stats = await stat(path).catch(() => null)
    if (!stats || stats.size === 0) return null
    const contents = await readFile(path, 'utf-8')
    const lines = contents.split('\n').filter((l) => l.trim().length > 0)
    if (lines.length === 0) return null
    const last = lines[lines.length - 1]!
    // Accept BOTH conventions:
    //   (a) bare AtribRecord — the wrapper service's mirror writes one
    //       record per line.
    //   (b) envelope { record, proof?, written_at? } — atrib-emit's own
    //       mirror writes this shape so it can preserve proof + timestamp
    //       metadata for local recall. autoChain inheritance only needs the
    //       record itself.
    // Each line could come from either producer in a session that uses both.
    const parsed = JSON.parse(last) as Partial<AtribRecord> | { record?: Partial<AtribRecord> }
    const candidate = 'record' in parsed && parsed.record ? parsed.record : (parsed as Partial<AtribRecord>)
    if (
      typeof candidate.context_id !== 'string' ||
      typeof candidate.creator_key !== 'string' ||
      typeof candidate.signature !== 'string'
    ) {
      return null
    }
    return candidate as AtribRecord
  } catch {
    return null
  }
}

export const __test_only__ = { readMostRecentRecord, DEFAULT_MIRROR }
