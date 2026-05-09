// SPDX-License-Identifier: Apache-2.0

/**
 * Mirror-file inheritance helpers.
 *
 * Producers (mcp-wrap, atrib-emit, future signers) may persist their signed
 * records to a JSONL "mirror" file under `~/.atrib/records/`. The mirror is
 * the file-as-IPC channel for cross-producer chain handoff: when one
 * producer wants to chain on top of another's most recent record, it reads
 * the other's mirror, picks the most recent line matching its context, and
 * passes the canonical hash of that record to `resolveChainRoot` as
 * `mirrorTailHex`.
 *
 * Two on-disk shapes are accepted:
 *   - Bare record per line: `{...AtribRecord fields...}\n` (mcp-wrap).
 *   - Envelope per line: `{record: {...}, proof?: ..., _local?: ...}\n`
 *     (atrib-emit; sidecar fields per D062 §5.9).
 *
 * Both shapes are normalized to an `AtribRecord` here. Any malformed or
 * unparsable line is skipped (per §5.8 degradation: never throw to caller).
 *
 * Filter-by-context_id is critical for the multi-producer composition
 * contract (spec §1.2.3, D067): inheriting a tail whose context_id differs
 * from the caller's would produce a malformed record (chain_root pointing
 * into a chain on a different context). When `contextId` is supplied, only
 * records on that context_id are eligible.
 */

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import * as readline from 'node:readline'
import { canonicalRecord } from './canon.js'
import { resolveChainRoot, genesisChainRoot } from './chain-root.js'
import { sha256, hexEncode } from './hash.js'
import type { AtribRecord } from './types.js'

/**
 * Read the most recent record from a JSONL mirror file.
 *
 * @param opts.path Path to the mirror file. Returns null if the file does
 *   not exist (per §5.8 degradation).
 * @param opts.contextId Optional. When supplied, only the most recent record
 *   matching this context_id is returned. When omitted, the most recent
 *   record overall is returned (any context_id).
 * @returns The most recent matching record, or null if none found.
 */
export async function readMirrorTail(opts: {
  path: string
  contextId?: string | undefined
}): Promise<AtribRecord | null> {
  let exists = true
  try {
    const stats = await stat(opts.path)
    if (stats.size === 0) return null
  } catch {
    exists = false
  }
  if (!exists) return null

  // Stream line-by-line so file size doesn't bound memory. Track the most
  // recent matching record; later lines beat earlier ones (newest-wins
  // because mirrors are append-only and ordered by sign time).
  let mostRecent: AtribRecord | null = null
  try {
    const stream = createReadStream(opts.path, { encoding: 'utf-8' })
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
    for await (const line of rl) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const record = parseMirrorLine(trimmed)
      if (!record) continue
      if (opts.contextId && record.context_id !== opts.contextId) continue
      mostRecent = record
    }
  } catch {
    return null
  }
  return mostRecent
}

function parseMirrorLine(line: string): AtribRecord | null {
  try {
    const parsed = JSON.parse(line) as
      | Partial<AtribRecord>
      | { record?: Partial<AtribRecord> }
    const candidate =
      'record' in parsed && parsed.record
        ? parsed.record
        : (parsed as Partial<AtribRecord>)
    if (
      typeof candidate.context_id !== 'string' ||
      typeof candidate.creator_key !== 'string' ||
      typeof candidate.signature !== 'string' ||
      typeof candidate.chain_root !== 'string'
    ) {
      return null
    }
    return candidate as AtribRecord
  } catch {
    return null
  }
}

export interface ChainContext {
  contextId: string
  chainRoot: string
  inheritedFrom:
    | 'caller-supplied'
    | 'fresh-orphan'
    | 'env-tail'
    | 'mirror-tail'
    | 'fresh'
}

/**
 * Resolve `{contextId, chainRoot}` for a producer about to sign a record,
 * orchestrating context_id inheritance + chain_root resolution end to end.
 *
 * Decision tree:
 *
 *   1. Caller supplies BOTH `callerContextId` and `callerChainRoot`:
 *      use both verbatim. inheritedFrom = 'caller-supplied'.
 *
 *   2. Caller supplies `callerContextId` only:
 *      - If `ATRIB_CHAIN_TAIL_<callerContextId>` env var is set with a
 *        valid `sha256:<64-hex>` value: chain to it. inheritedFrom = 'env-tail'.
 *      - Else if a mirror tail on the same `callerContextId` exists:
 *        chain to it. inheritedFrom = 'mirror-tail'.
 *      - Else: genesis chain_root for `callerContextId`. inheritedFrom = 'fresh'.
 *
 *   3. Caller supplies no `callerContextId`:
 *      Synthesize a fresh random context_id + genesis chain_root. The result
 *      is marked 'fresh-orphan' to signal that the runtime did NOT pass a
 *      session identifier to the producer (typically a Layer-2 hook miswire
 *      or a harness that doesn't expose its session_id). The orphan record
 *      lands in its own isolated context rather than being absorbed into
 *      whichever session happens to be at the mirror tail. See [D072] for
 *      the rationale; the prior 'mirror-context-and-tail' behavior collapsed
 *      every orphan into one giant pseudo-session ('1500+ records spanning
 *      6+ days under one context_id' in production), which made orphan
 *      provenance unrecoverable.
 *
 *      Consumers can identify orphans by `inheritedFrom === 'fresh-orphan'`
 *      and surface them as such; recall/trace/summarize MAY filter them.
 *
 * Inheriting only `callerContextId` from the caller WHILE pulling chain_root
 * from a mirror that is on a DIFFERENT context_id is forbidden, it would
 * produce a malformed record. The filter-by-context_id behavior in
 * `readMirrorTail` enforces this.
 */
export async function inheritChainContext(opts: {
  callerContextId?: string | undefined
  callerChainRoot?: string | undefined
  mirrorPath?: string | undefined
  env?: NodeJS.ProcessEnv
  randomContextId: () => string
}): Promise<ChainContext> {
  const env = opts.env ?? process.env

  // (1) Caller manages chain state explicitly.
  if (opts.callerContextId && opts.callerChainRoot) {
    return {
      contextId: opts.callerContextId,
      chainRoot: opts.callerChainRoot,
      inheritedFrom: 'caller-supplied',
    }
  }

  // (2) Caller-supplied context, no chain_root: consult env-var, then
  // mirror filtered by context_id, then genesis.
  if (opts.callerContextId) {
    const ctxId = opts.callerContextId
    const mirrorTailRecord = opts.mirrorPath
      ? await readMirrorTail({ path: opts.mirrorPath, contextId: ctxId })
      : null
    const mirrorTailHex = mirrorTailRecord
      ? hexEncode(sha256(canonicalRecord(mirrorTailRecord)))
      : undefined

    const chainRoot = resolveChainRoot({
      contextId: ctxId,
      mirrorTailHex,
      env,
    })

    let inheritedFrom: ChainContext['inheritedFrom']
    if (chainRoot === genesisChainRoot(ctxId)) {
      inheritedFrom = 'fresh'
    } else if (mirrorTailHex && chainRoot === `sha256:${mirrorTailHex}`) {
      inheritedFrom = 'mirror-tail'
    } else {
      inheritedFrom = 'env-tail'
    }
    return { contextId: ctxId, chainRoot, inheritedFrom }
  }

  // (3) No caller context_id, synthesize a fresh isolate. Do NOT inherit
  // context_id from the mirror tail; that absorbs records from runtimes
  // that failed to pass session_id into whichever session was active when
  // the orphan landed. The 'fresh-orphan' label distinguishes "caller
  // didn't pass context_id" from branch (2)'s 'fresh' (caller passed
  // context_id but no chain_root and the session is brand-new). Per [D072].
  const fresh = opts.randomContextId()
  return {
    contextId: fresh,
    chainRoot: genesisChainRoot(fresh),
    inheritedFrom: 'fresh-orphan',
  }
}
