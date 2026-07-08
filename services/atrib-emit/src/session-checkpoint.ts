// Producer-side session-checkpoint emission (D139, spec §1.2.10).
//
// emitSessionCheckpoint() layers on the existing emit pipeline stage by
// stage — the SAME key resolution (./keys.js resolveKey), the SAME signing
// owner (@atrib/mcp signRecord, the one path every emit-family record goes
// through via buildAndSignEmitRecord), the SAME D067 chain composition
// (@atrib/mcp inheritChainContext, never reimplemented), the SAME
// submission queue (@atrib/mcp createSubmissionQueue, non-blocking per
// §5.3.5), and the SAME §5.9 mirror convention (./storage.js mirrorRecord)
// — so checkpoint records are byte-identical to what any other emit-family
// producer would sign. There is NO new signing path here.
//
// It does not route through handleEmit/emitInProcess because their
// EmitInput schema (deliberately) cannot express the top-level `checkpoint`
// field; a checkpoint is not free-form `content`, it is a §1.2.10
// structural field that must land in the signed bytes. The record-assembly
// mirror of @atrib/mcp's `buildSessionCheckpointRecord` lives inline below
// until that module's exports land on the @atrib/mcp index (see the D139
// implementation notes); the tree math itself comes from the already-
// exported §2.3.2 helpers (`computeRoot`), reused verbatim.
//
// Leaf source (§1.2.10.1 leaf-ordering rule): the ordered record stream is
// read back from the local mirror in APPEND ORDER — the producer-declared
// session order for records read from a §5.9 mirror. Reading and writing
// target the same file (the ./storage.js convention: ATRIB_MIRROR_FILE,
// else ~/.atrib/records/atrib-emit-<agent>.jsonl) so every emitted
// checkpoint lands in the stream it formalizes and becomes a leaf of the
// next checkpoint's tree (self-exclusion is automatic: leaves are collected
// before the new checkpoint is appended).
//
// §5.8 degradation: emitSessionCheckpoint never throws. Every failure —
// missing key, unresolvable context, empty stream, mirror divergence,
// signing or submission errors — is logged with the `atrib-emit:` prefix,
// surfaced in `warnings`, and the checkpoint is simply skipped: a missed
// checkpoint just widens the next interval.

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as readline from 'node:readline'
import canonicalize from 'canonicalize'
import {
  base64urlEncode,
  canonicalRecord,
  computeContentId,
  computeRoot,
  createSubmissionQueue,
  getPublicKey,
  hexEncode,
  inheritChainContext,
  resolveEnvContextId,
  sha256,
  SHA256_REF_PATTERN,
  signRecord,
  type AtribRecord,
  type ProofBundle,
  type SubmissionQueue,
} from '@atrib/mcp'
import { resolveKey, type ResolvedKey } from './keys.js'
import { mirrorRecord } from './storage.js'

/** The session_checkpoint event_type URI (§1.2.10, D139; extension-staged per D073). */
export const SESSION_CHECKPOINT_EVENT_TYPE_URI = 'https://atrib.dev/v1/types/session_checkpoint'

const encoder = new TextEncoder()
const DEFAULT_FLUSH_DEADLINE_MS = 5000
const DAY_MS = 24 * 60 * 60 * 1000

/** §1.2.10 checkpoint body (producer-side; retroactive present-only-when-true). */
export interface SessionCheckpoint {
  first_index: number
  prior_checkpoint?: string
  retroactive?: true
  session_root: string
  tree_size: number
}

export type SessionCheckpointRecord = AtribRecord & { checkpoint: SessionCheckpoint }

export interface EmitSessionCheckpointOptions {
  /**
   * 32-hex context_id whose stream to checkpoint. Defaults to
   * `resolveEnvContextId()` (D078/D083 harness discovery). Without a
   * resolvable context the checkpoint is skipped: a checkpoint over a
   * synthesized orphan context would always be empty, which §1.2.10
   * prohibits.
   */
  contextId?: string | undefined
  /**
   * Mirror file to READ the ordered leaf stream from. Defaults to the
   * ./storage.js write path (ATRIB_MIRROR_FILE, else the per-agent file
   * under ~/.atrib/records). Overriding is for hosts that aggregate a
   * multi-producer stream in one file; the emitted checkpoint is still
   * WRITTEN via the storage convention, so keep the two aligned or the
   * next checkpoint will not see this one as a leaf.
   */
  mirrorPath?: string | undefined
  /** Override the resolved key (primarily for testing). */
  key?: ResolvedKey | null | undefined
  /** Override the log endpoint (defaults to ATRIB_LOG_ENDPOINT or the @atrib/mcp default). */
  logEndpoint?: string | undefined
  /**
   * §1.2.10.3 producer rule: set true when any newly covered leaf was not
   * observed live by this producer (mirror/archive backfill). Present-only-
   * when-true in the signed bytes; false and undefined are byte-identical
   * (the field is omitted).
   */
  retroactive?: boolean | undefined
  /** Sidecar `_local.producer` label. Defaults to 'atrib-emit'. */
  producer?: string | undefined
  /** Upper bound on the post-sign queue flush (see emitInProcess). Default 5000ms. */
  flushDeadlineMs?: number | undefined
  /** Clock override for tests. */
  now?: (() => number) | undefined
}

export interface EmitSessionCheckpointResult {
  /** Record hash of the signed checkpoint, or 'sha256:unknown' when skipped. */
  record_hash: string
  log_index: number | null
  inclusion_proof: ProofBundle['inclusion_proof'] | null
  context_id: string
  /** The signed checkpoint body, or null when emission was skipped. */
  checkpoint: SessionCheckpoint | null
  /** Number of leaves committed (0 when skipped). */
  covered_leaves: number
  warnings: string[]
}

interface MirrorLeaf {
  ref: string
  bytes: Uint8Array
  record: AtribRecord & { checkpoint?: SessionCheckpoint }
}

/** Same default as ./storage.js mirrorPath(): read where we write. */
function defaultMirrorPath(): string {
  return (
    process.env['ATRIB_MIRROR_FILE'] ??
    join(
      homedir(),
      '.atrib',
      'records',
      `atrib-emit-${process.env['ATRIB_AGENT'] ?? 'claude-code'}.jsonl`,
    )
  )
}

/**
 * Parse one mirror line into a record. Accepts both §5.9 on-disk shapes
 * (bare record, or `{record, proof?, _local?}` envelope); malformed lines
 * are skipped per §5.8. Mirrors @atrib/mcp's mirror.ts parseMirrorLine.
 */
function parseMirrorLine(line: string): (AtribRecord & { checkpoint?: SessionCheckpoint }) | null {
  try {
    const parsed = JSON.parse(line) as Partial<AtribRecord> | { record?: Partial<AtribRecord> }
    const candidate =
      'record' in parsed && parsed.record ? parsed.record : (parsed as Partial<AtribRecord>)
    if (
      typeof candidate.context_id !== 'string' ||
      typeof candidate.creator_key !== 'string' ||
      typeof candidate.signature !== 'string' ||
      typeof candidate.chain_root !== 'string'
    ) {
      return null
    }
    return candidate as AtribRecord & { checkpoint?: SessionCheckpoint }
  } catch {
    return null
  }
}

/**
 * Read the ordered leaf stream for one context_id from a §5.9 mirror:
 * every record on the context, in append order, with its §1.2.3 canonical
 * record hash. Returns [] when the mirror is missing or unreadable.
 */
async function readMirrorLeaves(path: string, contextId: string): Promise<MirrorLeaf[]> {
  try {
    const stats = await stat(path)
    if (stats.size === 0) return []
  } catch {
    return []
  }
  const leaves: MirrorLeaf[] = []
  try {
    const stream = createReadStream(path, { encoding: 'utf-8' })
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
    for await (const line of rl) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const record = parseMirrorLine(trimmed)
      if (!record) continue
      if (record.context_id !== contextId) continue
      const bytes = sha256(canonicalRecord(record))
      leaves.push({ ref: `sha256:${hexEncode(bytes)}`, bytes, record })
    }
  } catch {
    return []
  }
  return leaves
}

/** D099 content commitment: sha256(JCS({leaves: [...refs...]})), prefixed. */
function leavesArgsHash(leafRefs: readonly string[]): string {
  const json = canonicalize({ leaves: [...leafRefs] })
  if (json === undefined) {
    throw new Error('leaf list is not canonicalizable')
  }
  return `sha256:${hexEncode(sha256(encoder.encode(json)))}`
}

/** Bridge to the queue's bare-hex proof cache (same as ./index.js getProofFor). */
function getProofFor(queue: SubmissionQueue, recordHash: string): ProofBundle | undefined {
  return queue.getProof(
    recordHash.startsWith('sha256:') ? recordHash.slice('sha256:'.length) : recordHash,
  )
}

function skipped(
  contextId: string,
  warnings: string[],
  warning: string,
): EmitSessionCheckpointResult {
  warnings.push(warning)
  console.warn(`atrib-emit: session checkpoint skipped: ${warning}`)
  return {
    record_hash: 'sha256:unknown',
    log_index: null,
    inclusion_proof: null,
    context_id: contextId,
    checkpoint: null,
    covered_leaves: 0,
    warnings,
  }
}

/**
 * Emit one session checkpoint over the local mirror's record stream for a
 * context_id (D139, §1.2.10).
 *
 * Reads the ordered record hashes from the §5.9 mirror (append order = the
 * producer-declared session order), links to the most recent prior
 * checkpoint on the context (first_index = prior tree_size,
 * prior_checkpoint = prior record hash), self-checks append-only extension
 * against the prior session_root (refusing to sign what would be
 * equivocation evidence against our own key), signs through the standard
 * owner, submits non-blocking, and mirrors the record with the full leaf
 * list in `_local.content.leaves` per D099.
 *
 * Never throws (§5.8): every failure returns a warnings-carrying result
 * and the missed checkpoint widens the next interval.
 */
export async function emitSessionCheckpoint(
  options: EmitSessionCheckpointOptions = {},
): Promise<EmitSessionCheckpointResult> {
  const warnings: string[] = []
  const contextId = options.contextId ?? resolveEnvContextId()
  if (contextId === undefined || !/^[0-9a-f]{32}$/.test(contextId)) {
    return skipped(
      contextId ?? 'unknown',
      warnings,
      'no valid 32-hex context_id resolved (pass contextId or set ATRIB_CONTEXT_ID); checkpoints are never emitted over synthesized orphan contexts',
    )
  }

  try {
    const key = options.key !== undefined ? options.key : await resolveKey()
    if (!key) {
      return skipped(
        contextId,
        warnings,
        'no signing key resolved (set ATRIB_PRIVATE_KEY, ATRIB_KEY_FILE, or store seed in Keychain)',
      )
    }

    const mirrorPath = options.mirrorPath ?? defaultMirrorPath()
    const leaves = await readMirrorLeaves(mirrorPath, contextId)
    if (leaves.length === 0) {
      return skipped(
        contextId,
        warnings,
        `no records for context_id ${contextId} in mirror ${mirrorPath}; empty checkpoints are prohibited (tree_size >= 1)`,
      )
    }

    // Most recent prior session_checkpoint on this context (its own leaf
    // stream position is irrelevant; what matters is its committed range).
    let prior: MirrorLeaf | undefined
    for (const leaf of leaves) {
      if (
        leaf.record.event_type === SESSION_CHECKPOINT_EVENT_TYPE_URI &&
        leaf.record.checkpoint !== undefined
      ) {
        prior = leaf
      }
    }

    let firstIndex = 0
    let priorCheckpoint: string | undefined
    if (prior?.record.checkpoint !== undefined) {
      const priorBody = prior.record.checkpoint
      if (!Number.isInteger(priorBody.tree_size) || priorBody.tree_size < 1) {
        return skipped(contextId, warnings, 'prior checkpoint in mirror carries a malformed tree_size')
      }
      if (priorBody.tree_size >= leaves.length) {
        return skipped(
          contextId,
          warnings,
          `no new leaves since prior checkpoint (tree_size ${priorBody.tree_size}, mirror has ${leaves.length}); producers skip empty intervals`,
        )
      }
      // Append-only self-check (§1.2.10.2): the current stream's prefix must
      // reproduce the prior session_root. Signing over a diverged prefix
      // would mint equivocation evidence against our own key; skip instead.
      const prefixRoot = `sha256:${hexEncode(
        computeRoot(leaves.slice(0, priorBody.tree_size).map((l) => l.bytes)),
      )}`
      if (prefixRoot !== priorBody.session_root) {
        return skipped(
          contextId,
          warnings,
          `mirror prefix (${priorBody.tree_size} leaves) recomputes to ${prefixRoot} but the prior checkpoint committed ${priorBody.session_root}; emitting would equivocate`,
        )
      }
      firstIndex = priorBody.tree_size
      priorCheckpoint = prior.ref
      if (!SHA256_REF_PATTERN.test(priorCheckpoint)) {
        return skipped(contextId, warnings, 'prior checkpoint record hash is malformed')
      }
    }

    const now = options.now ?? Date.now
    const timestamp = now()

    // §1.2.10.3 producer hint: warn (do not block) when the new interval is
    // stale against the default verifier bound and undeclared.
    const newestLeaf = leaves[leaves.length - 1] as MirrorLeaf
    const maxCoveredLeafTimestamp = leaves.reduce(
      (max, l) => (typeof l.record.timestamp === 'number' ? Math.max(max, l.record.timestamp) : max),
      typeof newestLeaf.record.timestamp === 'number' ? newestLeaf.record.timestamp : 0,
    )
    if (options.retroactive !== true && timestamp - maxCoveredLeafTimestamp > DAY_MS) {
      warnings.push(
        'checkpoint timestamp exceeds the max covered leaf timestamp by more than 24h without retroactive: true; verifiers will tier it stale-undeclared (§1.2.10.3)',
      )
    }

    const leafRefs = leaves.map((l) => l.ref)
    const sessionRoot = `sha256:${hexEncode(computeRoot(leaves.map((l) => l.bytes)))}`
    const checkpoint: SessionCheckpoint = {
      first_index: firstIndex,
      ...(priorCheckpoint !== undefined ? { prior_checkpoint: priorCheckpoint } : {}),
      ...(options.retroactive === true ? { retroactive: true as const } : {}),
      session_root: sessionRoot,
      tree_size: leafRefs.length,
    }

    // D067 chain composition through the shared helper — never reimplemented.
    // The mirror tail on this context is the newest record in the stream we
    // just committed, so the checkpoint chains directly onto it.
    const chain = await inheritChainContext({
      callerContextId: contextId,
      mirrorPath,
      randomContextId: () => contextId,
    })

    const creatorKey = base64urlEncode(await getPublicKey(key.privateKey))
    const unsigned: SessionCheckpointRecord = {
      spec_version: 'atrib/1.0',
      // §1.2.2 with the pseudo-origin "atrib" for origin-less cognitive
      // producers: input "atrib:session_checkpoint" (corpus-pinned).
      content_id: computeContentId('atrib', 'session_checkpoint'),
      creator_key: creatorKey,
      chain_root: chain.chainRoot,
      checkpoint,
      event_type: SESSION_CHECKPOINT_EVENT_TYPE_URI,
      context_id: contextId,
      timestamp,
      args_hash: leavesArgsHash(leafRefs),
      signature: '',
    }

    // Single signing owner: the same @atrib/mcp signRecord every emit-family
    // producer routes through.
    const record = (await signRecord(unsigned, key.privateKey)) as SessionCheckpointRecord
    const recordHash = `sha256:${hexEncode(sha256(canonicalRecord(record)))}`

    // Non-blocking submission per §5.3.5 / §5.8; the queue owns retries.
    const logEndpoint = options.logEndpoint ?? process.env['ATRIB_LOG_ENDPOINT']
    const queue: SubmissionQueue = createSubmissionQueue(logEndpoint)
    queue.submit(record, 'normal')

    // §5.9 mirror with the D099 sidecar: the flat leaf list stays local in
    // _local.content.leaves; the signed bytes carry only root + args_hash.
    await mirrorRecord(record, getProofFor(queue, recordHash) ?? null, {
      content: { leaves: leafRefs },
      producer: options.producer ?? 'atrib-emit',
    })

    // Bounded drain (same posture as emitInProcess): short-lived callers
    // must not inherit the queue's full retry budget on an unreachable log.
    const flushDeadlineMs = options.flushDeadlineMs ?? DEFAULT_FLUSH_DEADLINE_MS
    const flushed = await Promise.race([
      queue.flush().then(() => true as const),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), flushDeadlineMs)),
    ])
    if (!flushed) {
      warnings.push(
        `flush exceeded ${flushDeadlineMs}ms deadline; checkpoint signed and mirrored locally, log submission may still be in flight`,
      )
    }
    const proof = getProofFor(queue, recordHash)
    if (!proof && flushed) {
      warnings.push('submission queued; proof not yet available (poll the log later if needed)')
    }

    return {
      record_hash: recordHash,
      log_index: proof?.log_index ?? null,
      inclusion_proof: proof?.inclusion_proof ?? null,
      context_id: contextId,
      checkpoint: record.checkpoint,
      covered_leaves: leafRefs.length,
      warnings,
    }
  } catch (e) {
    // §5.8: no failure here may reach the caller as a throw.
    return skipped(
      contextId,
      warnings,
      `session checkpoint emission failed: ${e instanceof Error ? e.message : String(e)}`,
    )
  }
}

export const __test_only__ = { readMirrorLeaves, leavesArgsHash, defaultMirrorPath }
