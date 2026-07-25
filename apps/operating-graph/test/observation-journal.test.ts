// SPDX-License-Identifier: Apache-2.0

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  base64urlEncode,
  computeContentId,
  createJsonCommitment,
  genesisChainRoot,
  getPublicKey,
  signRecord,
  type AtribRecord,
} from '@atrib/mcp'
import { createRuntimeObservationBatch } from '@atrib/runtime-log/observation'
import {
  commitObservationBatch,
  readObservationJournal,
  verifyObservationJournalState,
} from '../src/observation-journal.js'
import { buildRuntimeObservation, type PortableObservationBatch } from '../src/observations.js'
import type { OperatingEnvelope } from '../src/model.js'
import { loadRuntimeObservationEntries } from '../src/store.js'

const tempDirectories: string[] = []
const initialCursor = { byte_offset: 0 }
const sourceRef = `sha256:${'1'.repeat(64)}`
const generationRef = `sha256:${'2'.repeat(64)}`

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

function observationBatch(
  expectedCursor = initialCursor,
  proposedCursor = { byte_offset: 128 },
): PortableObservationBatch {
  return createRuntimeObservationBatch({
    adapter: { id: 'codex-rollout-jsonl', version: '1' },
    source: {
      source_ref: sourceRef,
      generation_ref: generationRef,
      runtime: { name: 'Codex', version: 'host-observed', environment: 'local' },
      session_id: 'codex-thread-1',
    },
    status: 'ok',
    expected_cursor: expectedCursor,
    proposed_cursor: proposedCursor,
    observations: [
      {
        schema: 'atrib.runtime-observation.codex-rollout.v1',
        observation_id: `sha256:${'3'.repeat(64)}`,
        kind: 'response_item',
        observer_ref: 'host:runtime-observer',
        subject_ref: 'runtime:codex',
        subject_runtime_session_id: 'codex-thread-1',
        observed_at: '2026-07-25T12:00:01.000Z',
        source_occurred_at: '2026-07-25T12:00:00.000Z',
        source_frame: {
          source_ref: sourceRef,
          generation_ref: generationRef,
          sequence: 1,
          event_hash: `sha256:${'4'.repeat(64)}`,
          framed_event_hash: `sha256:${'5'.repeat(64)}`,
        },
        capture_mode: 'attach-native',
        evidence_grade: 'runtime-captured',
        execution_evidence: false,
        semantic_state: 'not-inferred',
      },
    ],
    coverage: {
      history_completeness: 'bounded-backfill',
      parsing_status: 'ok',
      complete_event_count: 1,
      complete_window_eligible: true,
    },
    gaps: [],
    observed_at: '2026-07-25T12:00:01.000Z',
    profile_data: { compaction_count: 0 },
  })
}

async function signedEnvelope(
  batch: PortableObservationBatch,
  seedByte = 7,
): Promise<OperatingEnvelope> {
  const seed = new Uint8Array(32).fill(seedByte)
  const content = buildRuntimeObservation(batch, batch.expected_cursor, {
    workspace: { id: 'workspace-1', name: 'Apollo' },
    task: { id: 'task-1', name: 'Review capture' },
    mapped_agent: { id: 'codex-agent', name: 'Codex', role: 'builder' },
  })
  const commitment = createJsonCommitment(content, 'plain-sha256')
  const record = await signRecord(
    {
      spec_version: 'atrib/1.0',
      content_id: computeContentId('mcp://operating-journal-test', 'runtime_observation'),
      creator_key: base64urlEncode(await getPublicKey(seed)),
      chain_root: genesisChainRoot(seedByte.toString(16).padStart(32, '0')),
      event_type: 'https://atrib.dev/v1/types/observation',
      context_id: seedByte.toString(16).padStart(32, '0'),
      timestamp: 1_753_444_000,
      args_hash: commitment.hash,
      signature: '',
    } as AtribRecord,
    seed,
  )
  return { record, proof: null, _local: { content, producer: 'journal-test' } }
}

async function journalPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'atrib-observation-journal-'))
  tempDirectories.push(directory)
  return join(directory, 'journal.json')
}

describe('observation journal', () => {
  it('atomically commits a signed batch and advances the authoritative cursor', async () => {
    const path = await journalPath()
    const batch = observationBatch()
    const state = await commitObservationBatch({
      path,
      operation_id: 'poll-1',
      initial_cursor: initialCursor,
      batch,
      envelope: await signedEnvelope(batch),
    })

    expect(state.authoritative_cursor).toEqual(batch.proposed_cursor)
    expect(state.commits).toHaveLength(1)
    expect(state.commits[0]?.batch).toEqual(batch)
    await expect(
      readObservationJournal(path, {
        source_ref: sourceRef,
        generation_ref: generationRef,
        initial_cursor: initialCursor,
      }),
    ).resolves.toEqual(state)
  })

  it('exposes only verified committed envelopes through the mirror reader', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'atrib-observation-reader-'))
    tempDirectories.push(directory)
    const path = join(directory, 'codex.observation-journal.json')
    const batch = observationBatch()
    await commitObservationBatch({
      path,
      operation_id: 'poll-1',
      initial_cursor: initialCursor,
      batch,
      envelope: await signedEnvelope(batch),
    })

    const entries = await loadRuntimeObservationEntries(directory)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      signature_verified: true,
      observation: {
        source: { source_ref: sourceRef, generation_ref: generationRef },
        batch: { batch_id: batch.batch_id },
        execution_evidence: false,
      },
    })
  })

  it('returns the existing commit for an idempotent retry', async () => {
    const path = await journalPath()
    const batch = observationBatch()
    const input = {
      path,
      operation_id: 'poll-1',
      initial_cursor: initialCursor,
      batch,
      envelope: await signedEnvelope(batch),
    }
    await commitObservationBatch(input)
    const retried = await commitObservationBatch(input)

    expect(retried.commits).toHaveLength(1)
  })

  it('rejects an idempotent retry with a different signed placement', async () => {
    const path = await journalPath()
    const batch = observationBatch()
    await commitObservationBatch({
      path,
      operation_id: 'poll-1',
      initial_cursor: initialCursor,
      batch,
      envelope: await signedEnvelope(batch, 7),
    })
    await expect(
      commitObservationBatch({
        path,
        operation_id: 'poll-1',
        initial_cursor: initialCursor,
        batch,
        envelope: await signedEnvelope(batch, 8),
      }),
    ).rejects.toThrow('different signed envelope')
  })

  it('rejects operation reuse, stale cursors, and source rebinding', async () => {
    const path = await journalPath()
    const first = observationBatch()
    await commitObservationBatch({
      path,
      operation_id: 'poll-1',
      initial_cursor: initialCursor,
      batch: first,
      envelope: await signedEnvelope(first),
    })
    const stale = observationBatch(initialCursor, { byte_offset: 256 })
    await expect(
      commitObservationBatch({
        path,
        operation_id: 'poll-2',
        initial_cursor: initialCursor,
        batch: stale,
        envelope: await signedEnvelope(stale),
      }),
    ).rejects.toThrow('authoritative_cursor_mismatch')
    await expect(
      commitObservationBatch({
        path,
        operation_id: 'poll-1',
        initial_cursor: initialCursor,
        batch: stale,
        envelope: await signedEnvelope(stale),
      }),
    ).rejects.toThrow('different batch')
    await expect(
      readObservationJournal(path, {
        source_ref: `sha256:${'9'.repeat(64)}`,
        generation_ref: generationRef,
        initial_cursor: initialCursor,
      }),
    ).rejects.toThrow('source binding changed')
  })

  it('rejects invalid signatures and mismatched signed bodies without advancing', async () => {
    const path = await journalPath()
    const batch = observationBatch()
    const invalidSignature = await signedEnvelope(batch)
    invalidSignature.record.signature = base64urlEncode(new Uint8Array(64))
    await expect(
      commitObservationBatch({
        path,
        operation_id: 'poll-invalid-signature',
        initial_cursor: initialCursor,
        batch,
        envelope: invalidSignature,
      }),
    ).rejects.toThrow('signature is invalid')

    const mismatchedBody = await signedEnvelope(batch)
    mismatchedBody._local!.content = {
      ...mismatchedBody._local!.content,
      raw_observations: 'changed-after-signing',
    }
    await expect(
      commitObservationBatch({
        path,
        operation_id: 'poll-invalid-body',
        initial_cursor: initialCursor,
        batch,
        envelope: mismatchedBody,
      }),
    ).rejects.toThrow('body is invalid')
    await expect(readFile(path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('detects persisted cursor and batch tampering', async () => {
    const path = await journalPath()
    const batch = observationBatch()
    const state = await commitObservationBatch({
      path,
      operation_id: 'poll-1',
      initial_cursor: initialCursor,
      batch,
      envelope: await signedEnvelope(batch),
    })
    const tamperedCursor = { ...state, authoritative_cursor: { byte_offset: 999 } }
    await expect(verifyObservationJournalState(tamperedCursor)).rejects.toThrow(
      'authoritative cursor',
    )
    const tamperedBatch = {
      ...state,
      commits: [
        {
          ...state.commits[0]!,
          batch: { ...state.commits[0]!.batch, proposed_cursor: { byte_offset: 999 } },
        },
      ],
    }
    await expect(verifyObservationJournalState(tamperedBatch)).rejects.toThrow(
      'batch transition is invalid',
    )
  })

  it('fails closed when another writer holds the journal lock', async () => {
    const path = await journalPath()
    await mkdir(`${path}.lock`, { mode: 0o700 })
    const batch = observationBatch()
    await expect(
      commitObservationBatch({
        path,
        operation_id: 'poll-1',
        initial_cursor: initialCursor,
        batch,
        envelope: await signedEnvelope(batch),
      }),
    ).rejects.toMatchObject({ code: 'EEXIST' })
  })

  it('reclaims a lock owned by a crashed writer', async () => {
    const path = await journalPath()
    await mkdir(`${path}.lock`, { mode: 0o700 })
    await writeFile(
      `${path}.lock/owner.json`,
      `${JSON.stringify({
        pid: 2_147_483_647,
        token: 'crashed-writer',
        acquired_at: Date.now(),
      })}\n`,
      'utf8',
    )
    const batch = observationBatch()
    await expect(
      commitObservationBatch({
        path,
        operation_id: 'poll-1',
        initial_cursor: initialCursor,
        batch,
        envelope: await signedEnvelope(batch),
      }),
    ).resolves.toMatchObject({ authoritative_cursor: batch.proposed_cursor })
  })

  it('creates missing parent directories before acquiring the lock', async () => {
    const root = await mkdtemp(join(tmpdir(), 'atrib-observation-parent-'))
    tempDirectories.push(root)
    const path = join(root, 'nested', 'codex.observation-journal.json')
    const batch = observationBatch()
    await expect(
      commitObservationBatch({
        path,
        operation_id: 'poll-1',
        initial_cursor: initialCursor,
        batch,
        envelope: await signedEnvelope(batch),
      }),
    ).resolves.toMatchObject({ authoritative_cursor: batch.proposed_cursor })
  })

  it('rejects a tampered journal when reopening it', async () => {
    const path = await journalPath()
    const batch = observationBatch()
    const state = await commitObservationBatch({
      path,
      operation_id: 'poll-1',
      initial_cursor: initialCursor,
      batch,
      envelope: await signedEnvelope(batch),
    })
    await writeFile(
      path,
      `${JSON.stringify({ ...state, authoritative_cursor: { byte_offset: 999 } })}\n`,
      'utf8',
    )
    await expect(
      readObservationJournal(path, {
        source_ref: sourceRef,
        generation_ref: generationRef,
        initial_cursor: initialCursor,
      }),
    ).rejects.toThrow('authoritative cursor')
  })
})
