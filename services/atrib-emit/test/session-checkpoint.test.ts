// emitSessionCheckpoint correctness tests (D139, spec §1.2.10).
//
// Exercises the producer helper end to end against a temp-dir mirror:
// leaf collection in §5.9 append order, first-checkpoint and linked
// continuation intervals, D067 chain composition through the shared
// helper, D099 args_hash + _local.content.leaves sidecar, the
// present-only-when-true retroactive flag, the append-only self-check
// (refusing to mint equivocation evidence), and the §5.8 degradation
// paths (no key, no context, empty stream, unreadable mirror — all
// warnings, never throws).

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import canonicalize from 'canonicalize'
import {
  base64urlEncode,
  canonicalRecord,
  chainRoot,
  computeRoot,
  genesisChainRoot,
  getPublicKey,
  hexDecode,
  hexEncode,
  sha256,
  signRecord,
  verifyRecord,
  type AtribRecord,
} from '@atrib/mcp'
import { emitSessionCheckpoint, SESSION_CHECKPOINT_EVENT_TYPE_URI } from '../src/session-checkpoint.js'
import type { ResolvedKey } from '../src/keys.js'
import type { MirrorLine } from '../src/storage.js'

const LOCAL_LOG = 'http://127.0.0.1:0/v1/entries'
const CONTEXT = 'ab'.repeat(16)
const OTHER_CONTEXT = 'cd'.repeat(16)
const OBSERVATION_URI = 'https://atrib.dev/v1/types/observation'

let tmp: string
let mirrorFile: string
let priorEnv: Record<string, string | undefined> = {}

const SEED = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 11) & 0xff)
const KEY: ResolvedKey = { privateKey: SEED, source: 'env' }

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'atrib-emit-checkpoint-test-'))
  mirrorFile = join(tmp, 'mirror.jsonl')
  priorEnv = {
    ATRIB_MIRROR_FILE: process.env['ATRIB_MIRROR_FILE'],
    ATRIB_AUTOCHAIN_SOURCE: process.env['ATRIB_AUTOCHAIN_SOURCE'],
    ATRIB_LOCAL_SUBSTRATE_ENDPOINT: process.env['ATRIB_LOCAL_SUBSTRATE_ENDPOINT'],
    ATRIB_CONTEXT_ID: process.env['ATRIB_CONTEXT_ID'],
  }
  process.env['ATRIB_MIRROR_FILE'] = mirrorFile
  delete process.env['ATRIB_AUTOCHAIN_SOURCE']
  delete process.env['ATRIB_LOCAL_SUBSTRATE_ENDPOINT']
  delete process.env['ATRIB_CONTEXT_ID']
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
  for (const [name, value] of Object.entries(priorEnv)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

function recordHashRef(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

async function signObservation(
  contextId: string,
  chainRootValue: string,
  timestamp: number,
  marker: string,
): Promise<AtribRecord> {
  const unsigned: AtribRecord = {
    spec_version: 'atrib/1.0',
    content_id: `sha256:${hexEncode(sha256(new TextEncoder().encode(`test:${marker}`)))}`,
    creator_key: base64urlEncode(await getPublicKey(SEED)),
    chain_root: chainRootValue,
    event_type: OBSERVATION_URI,
    context_id: contextId,
    timestamp,
    signature: '',
  }
  return signRecord(unsigned, SEED)
}

async function readMirrorLines(): Promise<MirrorLine[]> {
  const raw = await readFile(mirrorFile, 'utf-8')
  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as MirrorLine)
}

async function appendMirrorLine(record: AtribRecord): Promise<void> {
  const { appendFile } = await import('node:fs/promises')
  await appendFile(mirrorFile, JSON.stringify({ record, proof: null, written_at: Date.now() }) + '\n')
}

/** Seed the mirror with a two-record chain on CONTEXT plus one foreign record. */
async function seedMirror(): Promise<{ r1: AtribRecord; r2: AtribRecord }> {
  const r1 = await signObservation(CONTEXT, genesisChainRoot(CONTEXT), Date.now() - 3000, 'r1')
  const r2 = await signObservation(CONTEXT, chainRoot(r1), Date.now() - 2000, 'r2')
  const foreign = await signObservation(
    OTHER_CONTEXT,
    genesisChainRoot(OTHER_CONTEXT),
    Date.now() - 1000,
    'foreign',
  )
  await appendMirrorLine(r1)
  await appendMirrorLine(r2)
  await appendMirrorLine(foreign)
  return { r1, r2 }
}

describe('emitSessionCheckpoint', () => {
  it('emits a valid first checkpoint over the context stream in append order', async () => {
    const { r1, r2 } = await seedMirror()
    const result = await emitSessionCheckpoint({
      contextId: CONTEXT,
      key: KEY,
      logEndpoint: LOCAL_LOG,
      flushDeadlineMs: 500,
    })

    expect(result.checkpoint).not.toBeNull()
    expect(result.context_id).toBe(CONTEXT)
    expect(result.covered_leaves).toBe(2)
    expect(result.checkpoint!.tree_size).toBe(2)
    expect(result.checkpoint!.first_index).toBe(0)
    expect('prior_checkpoint' in result.checkpoint!).toBe(false)
    expect('retroactive' in result.checkpoint!).toBe(false)

    // Root recomputes over the raw 32-byte record hashes in append order.
    const leaves = [r1, r2].map((r) => hexDecode(recordHashRef(r).slice('sha256:'.length)))
    expect(result.checkpoint!.session_root).toBe(`sha256:${hexEncode(computeRoot(leaves))}`)

    // The checkpoint record landed in the same mirror stream with the D099
    // sidecar leaf list, and it verifies as an ordinary signed record.
    const lines = await readMirrorLines()
    const checkpointLine = lines[lines.length - 1]!
    const record = checkpointLine.record as AtribRecord & {
      checkpoint?: { session_root: string; tree_size: number; first_index: number }
    }
    expect(record.event_type).toBe(SESSION_CHECKPOINT_EVENT_TYPE_URI)
    expect(record.checkpoint).toEqual(result.checkpoint)
    expect(await verifyRecord(record)).toBe(true)
    expect(recordHashRef(record)).toBe(result.record_hash)

    // D067 chain composition: chains onto the mirror tail for this context.
    expect(record.chain_root).toBe(recordHashRef(r2))

    // content_id pins the origin-less "atrib:session_checkpoint" input.
    expect(record.content_id).toBe(
      `sha256:${hexEncode(sha256(new TextEncoder().encode('atrib:session_checkpoint')))}`,
    )

    // D099: args_hash = sha256(JCS({leaves})), full list in _local.content.
    const leafRefs = [r1, r2].map(recordHashRef)
    const jcs = canonicalize({ leaves: leafRefs })!
    expect(record.args_hash).toBe(`sha256:${hexEncode(sha256(new TextEncoder().encode(jcs)))}`)
    expect(checkpointLine._local?.content?.['leaves']).toEqual(leafRefs)
    expect(checkpointLine._local?.producer).toBe('atrib-emit')
  })

  it('links the second checkpoint to the first (first_index, prior_checkpoint, append-only)', async () => {
    const { r1, r2 } = await seedMirror()
    const first = await emitSessionCheckpoint({
      contextId: CONTEXT,
      key: KEY,
      logEndpoint: LOCAL_LOG,
      flushDeadlineMs: 500,
    })
    expect(first.checkpoint).not.toBeNull()

    // One more record after the first checkpoint.
    const lines = await readMirrorLines()
    const firstCheckpointRecord = lines[lines.length - 1]!.record
    const r3 = await signObservation(CONTEXT, recordHashRef(firstCheckpointRecord), Date.now(), 'r3')
    await appendMirrorLine(r3)

    const second = await emitSessionCheckpoint({
      contextId: CONTEXT,
      key: KEY,
      logEndpoint: LOCAL_LOG,
      flushDeadlineMs: 500,
    })
    expect(second.checkpoint).not.toBeNull()
    // Stream is now r1, r2, K1, r3 → tree_size 4, new interval starts at
    // K1's committed size (2).
    expect(second.covered_leaves).toBe(4)
    expect(second.checkpoint!.tree_size).toBe(4)
    expect(second.checkpoint!.first_index).toBe(2)
    expect(second.checkpoint!.prior_checkpoint).toBe(first.record_hash)

    // The first checkpoint is a leaf of the second tree (self-exclusion:
    // never a leaf of its own).
    const leafRefs = [r1, r2, firstCheckpointRecord, r3].map(recordHashRef)
    const leafBytes = leafRefs.map((ref) => hexDecode(ref.slice('sha256:'.length)))
    expect(second.checkpoint!.session_root).toBe(`sha256:${hexEncode(computeRoot(leafBytes))}`)
    expect(leafRefs).toContain(first.record_hash)
    expect(leafRefs).not.toContain(second.record_hash)
  })

  it('each checkpoint is a leaf of the next: back-to-back emits still make progress', async () => {
    await seedMirror()
    const first = await emitSessionCheckpoint({
      contextId: CONTEXT,
      key: KEY,
      logEndpoint: LOCAL_LOG,
      flushDeadlineMs: 500,
    })
    expect(first.checkpoint).not.toBeNull()

    // Immediately re-emit: the only new record is the checkpoint itself,
    // but the mirror stream grew by exactly that one leaf, so the interval
    // IS non-empty (checkpoints are part of the stream they formalize).
    const second = await emitSessionCheckpoint({
      contextId: CONTEXT,
      key: KEY,
      logEndpoint: LOCAL_LOG,
      flushDeadlineMs: 500,
    })
    expect(second.checkpoint).not.toBeNull()
    expect(second.checkpoint!.first_index).toBe(2)
    expect(second.checkpoint!.tree_size).toBe(3)
    expect(second.checkpoint!.prior_checkpoint).toBe(first.record_hash)
  })

  it('skips an interval that added no new leaves', async () => {
    // Forge a prior checkpoint that claims to have committed the entire
    // current stream (tree_size == mirror leaf count after it lands): the
    // next emit finds no new leaves and skips per §1.2.10 (producers SHOULD
    // skip intervals that added no leaves).
    const { r1 } = await seedMirror()
    const bogus: AtribRecord & { checkpoint: Record<string, unknown> } = {
      ...(await signObservation(CONTEXT, recordHashRef(r1), Date.now() - 1500, 'covers-all')),
      event_type: SESSION_CHECKPOINT_EVENT_TYPE_URI,
      checkpoint: {
        first_index: 0,
        session_root: `sha256:${'ab'.repeat(32)}`,
        tree_size: 3,
      },
    }
    const { signature: _sig, ...unsigned } = bogus
    const signedBogus = await signRecord({ ...unsigned, signature: '' } as AtribRecord, SEED)
    await appendMirrorLine(signedBogus)

    const result = await emitSessionCheckpoint({
      contextId: CONTEXT,
      key: KEY,
      logEndpoint: LOCAL_LOG,
      flushDeadlineMs: 500,
    })
    expect(result.checkpoint).toBeNull()
    expect(result.warnings.some((w) => w.includes('no new leaves'))).toBe(true)
  })

  it('refuses to emit over a stream whose prefix diverges from the prior checkpoint (equivocation guard)', async () => {
    const { r1 } = await seedMirror()
    // Forge a "prior checkpoint" whose session_root does not match the
    // stream prefix (a rewritten-history mirror).
    const bogusRoot = `sha256:${hexEncode(sha256(new TextEncoder().encode('not-the-real-root')))}`
    const forged: AtribRecord & { checkpoint: Record<string, unknown> } = {
      ...(await signObservation(CONTEXT, recordHashRef(r1), Date.now() - 1500, 'forged')),
      event_type: SESSION_CHECKPOINT_EVENT_TYPE_URI,
      checkpoint: { first_index: 0, session_root: bogusRoot, tree_size: 2 },
    }
    // Re-sign so the record parses as a signed checkpoint line.
    const { signature: _sig, ...unsigned } = forged
    const signedForged = await signRecord({ ...unsigned, signature: '' } as AtribRecord, SEED)
    await appendMirrorLine(signedForged)

    const result = await emitSessionCheckpoint({
      contextId: CONTEXT,
      key: KEY,
      logEndpoint: LOCAL_LOG,
      flushDeadlineMs: 500,
    })
    expect(result.checkpoint).toBeNull()
    expect(result.record_hash).toBe('sha256:unknown')
    expect(result.warnings.some((w) => w.includes('equivocate'))).toBe(true)
  })

  it('carries retroactive: true only when requested; false is byte-identical to absent', async () => {
    await seedMirror()
    const flagged = await emitSessionCheckpoint({
      contextId: CONTEXT,
      key: KEY,
      logEndpoint: LOCAL_LOG,
      flushDeadlineMs: 500,
      retroactive: true,
    })
    expect(flagged.checkpoint!.retroactive).toBe(true)

    const lines = await readMirrorLines()
    const record = lines[lines.length - 1]!.record as AtribRecord & {
      checkpoint?: Record<string, unknown>
    }
    expect(record.checkpoint!['retroactive']).toBe(true)
    expect(await verifyRecord(record)).toBe(true)
  })

  it('omits the retroactive key entirely when false or absent', async () => {
    await seedMirror()
    const result = await emitSessionCheckpoint({
      contextId: CONTEXT,
      key: KEY,
      logEndpoint: LOCAL_LOG,
      flushDeadlineMs: 500,
      retroactive: false,
    })
    expect(result.checkpoint).not.toBeNull()
    expect('retroactive' in result.checkpoint!).toBe(false)
    const lines = await readMirrorLines()
    const record = lines[lines.length - 1]!.record as AtribRecord & {
      checkpoint?: Record<string, unknown>
    }
    expect('retroactive' in record.checkpoint!).toBe(false)
  })

  it('warns (not blocks) when the interval is stale and undeclared', async () => {
    const old = Date.now() - 3 * 24 * 60 * 60 * 1000
    const r1 = await signObservation(CONTEXT, genesisChainRoot(CONTEXT), old, 'old-1')
    const r2 = await signObservation(CONTEXT, chainRoot(r1), old + 1000, 'old-2')
    await appendMirrorLine(r1)
    await appendMirrorLine(r2)

    const result = await emitSessionCheckpoint({
      contextId: CONTEXT,
      key: KEY,
      logEndpoint: LOCAL_LOG,
      flushDeadlineMs: 500,
    })
    expect(result.checkpoint).not.toBeNull()
    expect(result.warnings.some((w) => w.includes('stale-undeclared'))).toBe(true)
  })

  it('§5.8: degrades to warnings for missing context, key, or records — never throws', async () => {
    // No context resolvable.
    const noContext = await emitSessionCheckpoint({ key: KEY, logEndpoint: LOCAL_LOG })
    expect(noContext.checkpoint).toBeNull()
    expect(noContext.warnings.some((w) => w.includes('context_id'))).toBe(true)

    // No key.
    const noKey = await emitSessionCheckpoint({
      contextId: CONTEXT,
      key: null,
      logEndpoint: LOCAL_LOG,
    })
    expect(noKey.checkpoint).toBeNull()
    expect(noKey.warnings.some((w) => w.includes('no signing key'))).toBe(true)

    // Empty mirror (no records on the context): empty checkpoints prohibited.
    const empty = await emitSessionCheckpoint({
      contextId: CONTEXT,
      key: KEY,
      logEndpoint: LOCAL_LOG,
    })
    expect(empty.checkpoint).toBeNull()
    expect(empty.warnings.some((w) => w.includes('empty checkpoints are prohibited'))).toBe(true)

    // Unreadable mirror path: same shape, no throw.
    const unreadable = await emitSessionCheckpoint({
      contextId: CONTEXT,
      key: KEY,
      logEndpoint: LOCAL_LOG,
      mirrorPath: join(tmp, 'does', 'not', 'exist.jsonl'),
    })
    expect(unreadable.checkpoint).toBeNull()
    expect(unreadable.warnings.length).toBeGreaterThan(0)
  })

  it('honors ATRIB_CONTEXT_ID when contextId is omitted', async () => {
    await seedMirror()
    process.env['ATRIB_CONTEXT_ID'] = CONTEXT
    const result = await emitSessionCheckpoint({
      key: KEY,
      logEndpoint: LOCAL_LOG,
      flushDeadlineMs: 500,
    })
    expect(result.context_id).toBe(CONTEXT)
    expect(result.checkpoint).not.toBeNull()
  })

  it('stamps a custom producer label into the sidecar', async () => {
    await seedMirror()
    await emitSessionCheckpoint({
      contextId: CONTEXT,
      key: KEY,
      logEndpoint: LOCAL_LOG,
      flushDeadlineMs: 500,
      producer: 'session-checkpoint-daemon',
    })
    const lines = await readMirrorLines()
    expect(lines[lines.length - 1]!._local?.producer).toBe('session-checkpoint-daemon')
  })
})
