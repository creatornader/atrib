// SPDX-License-Identifier: Apache-2.0

import { createHash } from 'node:crypto'
import { appendFile, mkdtemp, readFile, rename, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  bindCodexRolloutObservationSource,
  CODEX_ROLLOUT_EVENT_HARD_CEILING_BYTES,
  type CodexRolloutObservationSourceOptions,
} from '../src/codex-rollout.js'
import { verifyRuntimeObservationBatchTransition } from '../src/observation.js'

const SESSION = '019f9b4b-1234-7123-8123-123456789abc'
const NOW = '2026-07-25T12:00:00.000Z'

function line(value: unknown, delimiter = '\n'): string {
  return `${JSON.stringify(value)}${delimiter}`
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'atrib-codex-rollout-'))
  const path = join(root, `rollout-2026-07-25T12-00-00-${SESSION}.jsonl`)
  const meta = line({ type: 'session_meta', payload: { id: SESSION } })
  await writeFile(path, meta)
  const options: CodexRolloutObservationSourceOptions = {
    path,
    source_handle: 'current-codex-session',
    session_id: SESSION,
    runtime_id: 'runtime:codex',
    observer_ref: 'host:runtime-observer',
    subject_ref: 'runtime:codex',
    now: () => NOW,
  }
  return { root, path, meta, options }
}

describe('Codex rollout observation adapter', () => {
  it('tails complete exact-byte frames without copying local paths or transcript bodies', async () => {
    const f = await fixture()
    const bound = await bindCodexRolloutObservationSource(f.options)
    const first = line(
      {
        timestamp: '2026-07-25T11:59:59.000Z',
        type: 'response_item',
        payload: { type: 'agent_message', role: 'assistant', id: 'private-item', text: 'secret' },
      },
      '\r\n',
    )
    await appendFile(f.path, first)

    const batch = await bound.adapter.readBatch(bound.cursor)
    expect(verifyRuntimeObservationBatchTransition(batch, bound.cursor)).toEqual({
      valid: true,
      issues: [],
    })
    expect(batch.observations).toHaveLength(1)
    expect(batch.observations[0]).toMatchObject({
      event_type: 'response_item',
      payload_type: 'agent_message',
      role: 'assistant',
      observed_at: NOW,
      source_occurred_at: '2026-07-25T11:59:59.000Z',
      execution_evidence: false,
      semantic_state: 'not-inferred',
    })
    expect(batch.coverage).toMatchObject({
      history_completeness: 'tail-only',
      complete_event_count: 1,
      partial_tail_bytes: 0,
      hard_ceiling_bytes: CODEX_ROLLOUT_EVENT_HARD_CEILING_BYTES,
    })
    expect(JSON.stringify(batch)).not.toContain(f.root)
    expect(JSON.stringify(batch)).not.toContain('secret')
    expect(JSON.stringify(batch)).not.toContain('private-item')
    expect(batch.observations[0]?.source_frame.framed_event_hash).not.toBe(
      batch.observations[0]?.source_frame.event_hash,
    )
    expect(batch.observations[0]?.source_frame.event_hash).toBe(
      `sha256:${createHash('sha256').update(first.slice(0, -2)).digest('hex')}`,
    )
    expect(batch.observations[0]?.source_frame.framed_event_hash).toBe(
      `sha256:${createHash('sha256').update(first).digest('hex')}`,
    )
    expect(batch.observations[0]?.observation_id).not.toBe(
      batch.observations[0]?.source_frame.event_hash,
    )
  })

  it('withholds a partial tail and advances only across complete frames', async () => {
    const f = await fixture()
    const bound = await bindCodexRolloutObservationSource(f.options)
    const complete = line({ type: 'event_msg', payload: { type: 'task_started' } })
    const partial = '{"type":"response_item"'
    await appendFile(f.path, complete + partial)

    const batch = await bound.adapter.readBatch(bound.cursor)
    expect(batch.status).toBe('ok')
    expect(batch.observations).toHaveLength(1)
    expect(batch.gaps).toEqual([
      {
        kind: 'partial-tail',
        position: bound.cursor.next_byte + Buffer.byteLength(complete),
        event_bytes: Buffer.byteLength(partial),
      },
    ])
    expect(batch.proposed_cursor.next_byte).toBe(
      bound.cursor.next_byte + Buffer.byteLength(complete),
    )
    expect(batch.coverage.complete_window_eligible).toBe(false)
  })

  it('reports truncation without moving the proposed cursor', async () => {
    const f = await fixture()
    const bound = await bindCodexRolloutObservationSource(f.options)
    await truncate(f.path, 0)

    const batch = await bound.adapter.readBatch(bound.cursor)
    expect(batch.status).toBe('gap')
    expect(batch.gaps).toEqual([{ kind: 'source-truncated', position: bound.cursor.next_byte }])
    expect(batch.proposed_cursor).toEqual(bound.cursor)
    expect(batch.coverage.parsing_status).toBe('blocked')
  })

  it('reports missing and replaced sources without moving the cursor', async () => {
    const missingFixture = await fixture()
    const missing = await bindCodexRolloutObservationSource(missingFixture.options)
    await rename(missingFixture.path, `${missingFixture.path}.moved`)
    const missingBatch = await missing.adapter.readBatch(missing.cursor)
    expect(missingBatch.gaps).toEqual([
      { kind: 'source-missing', position: missing.cursor.next_byte },
    ])
    expect(missingBatch.proposed_cursor).toEqual(missing.cursor)

    const replacedFixture = await fixture()
    const replaced = await bindCodexRolloutObservationSource(replacedFixture.options)
    const replacementPath = `${replacedFixture.path}.replacement`
    await writeFile(replacementPath, replacedFixture.meta)
    await rename(replacementPath, replacedFixture.path)
    const replacedBatch = await replaced.adapter.readBatch(replaced.cursor)
    expect(replacedBatch.gaps).toEqual([
      { kind: 'source-replaced', position: replaced.cursor.next_byte },
    ])
    expect(replacedBatch.proposed_cursor).toEqual(replaced.cursor)
  })

  it('reports malformed complete frames without acknowledging them', async () => {
    const f = await fixture()
    const bound = await bindCodexRolloutObservationSource(f.options)
    await appendFile(f.path, '{bad json}\n')

    const batch = await bound.adapter.readBatch(bound.cursor)
    expect(batch.status).toBe('gap')
    expect(batch.gaps[0]).toMatchObject({
      kind: 'malformed-event',
      position: bound.cursor.next_byte,
    })
    expect(batch.coverage.malformed_event_count).toBe(1)
    expect(batch.proposed_cursor).toEqual(bound.cursor)
  })

  it('reports an oversized complete frame without acknowledging it', async () => {
    const f = await fixture()
    const options = { ...f.options, max_event_bytes: 256, max_poll_bytes: 1024 }
    const bound = await bindCodexRolloutObservationSource(options)
    await appendFile(f.path, line({ type: 'event_msg', payload: { text: 'x'.repeat(512) } }))

    const batch = await bound.adapter.readBatch(bound.cursor)
    expect(batch.status).toBe('gap')
    expect(batch.gaps[0]).toMatchObject({
      kind: 'oversized-event',
      position: bound.cursor.next_byte,
      limit_bytes: 256,
    })
    expect(batch.coverage.oversized_event_count).toBe(1)
    expect(batch.proposed_cursor).toEqual(bound.cursor)
  })

  it('accepts an exact-limit event with a CRLF delimiter', async () => {
    const f = await fixture()
    const prefix = '{"type":"event_msg","payload":{"text":"'
    const suffix = '"}}'
    const event = `${prefix}${'x'.repeat(256 - prefix.length - suffix.length)}${suffix}`
    expect(Buffer.byteLength(event)).toBe(256)
    const options = { ...f.options, max_event_bytes: 256, max_poll_bytes: 258 }
    const bound = await bindCodexRolloutObservationSource(options)
    await appendFile(f.path, `${event}\r\n`)

    const batch = await bound.adapter.readBatch(bound.cursor)
    expect(batch.status).toBe('ok')
    expect(batch.observations).toHaveLength(1)
    expect(batch.coverage.complete_bytes).toBe(258)
  })

  it('reports an anchor mismatch without moving the cursor', async () => {
    const f = await fixture()
    const bound = await bindCodexRolloutObservationSource(f.options)
    const contents = await readFile(f.path, 'utf8')
    await writeFile(f.path, contents.replace('"session_meta"', '"session_metz"'))

    const batch = await bound.adapter.readBatch(bound.cursor)
    expect(batch.status).toBe('gap')
    expect(batch.gaps).toEqual([
      { kind: 'source-anchor-mismatch', position: bound.cursor.next_byte },
    ])
    expect(batch.proposed_cursor).toEqual(bound.cursor)
  })

  it('keeps a full existing-file read classified as bounded backfill', async () => {
    const f = await fixture()
    const bound = await bindCodexRolloutObservationSource({
      ...f.options,
      initial_backfill_bytes: Buffer.byteLength(f.meta) * 2,
    })

    expect(bound.cursor.next_byte).toBe(0)
    expect(bound.cursor.history_completeness).toBe('bounded-backfill')
    const batch = await bound.adapter.readBatch(bound.cursor)
    expect(batch.coverage.history_completeness).toBe('bounded-backfill')
  })

  it('rejects unsupported continuity claims and non-portable initial identities', async () => {
    const f = await fixture()
    await expect(
      bindCodexRolloutObservationSource({
        ...f.options,
        observer_ref: '/private/runtime-observer',
      }),
    ).rejects.toThrow('absolute path')

    const bound = await bindCodexRolloutObservationSource(f.options)
    await expect(
      bound.adapter.readBatch({
        ...bound.cursor,
        history_completeness: 'continuous',
      }),
    ).rejects.toThrow('invalid Codex rollout cursor')
  })

  it('rejects poll windows too small to finish an allowed event', async () => {
    const f = await fixture()
    await expect(
      bindCodexRolloutObservationSource({
        ...f.options,
        max_event_bytes: 1024,
        max_poll_bytes: 1024,
      }),
    ).rejects.toThrow('must cover one allowed event')
  })

  it('keeps compaction as source evidence without inferring accepted state', async () => {
    const f = await fixture()
    const bound = await bindCodexRolloutObservationSource(f.options)
    await appendFile(
      f.path,
      [
        line({ type: 'response_item', payload: { type: 'agent_message' } }),
        line({ type: 'event_msg', payload: { type: 'context_compacted' } }),
        line({ type: 'turn_context', payload: {} }),
      ].join(''),
    )

    const batch = await bound.adapter.readBatch(bound.cursor)
    expect(batch.profile_data?.compaction_refs).toHaveLength(1)
    expect(batch.profile_data?.compaction_refs[0]).toMatchObject({
      kind: 'codex-context-compaction',
      accepted_state_inferred: false,
      marker_sequence: 2,
    })
    expect(batch.profile_data?.compaction_refs[0]?.pre_window).toBeDefined()
    expect(batch.profile_data?.compaction_refs[0]?.post_continuation).toBeDefined()
  })

  it('carries an unresolved compaction marker into the next batch', async () => {
    const f = await fixture()
    const bound = await bindCodexRolloutObservationSource(f.options)
    await appendFile(
      f.path,
      [
        line({ type: 'response_item', payload: { type: 'agent_message' } }),
        line({ type: 'event_msg', payload: { type: 'context_compacted' } }),
      ].join(''),
    )

    const first = await bound.adapter.readBatch(bound.cursor)
    expect(first.proposed_cursor.pending_compaction).toBeDefined()
    expect(first.profile_data?.compaction_refs[0]?.post_continuation).toBeUndefined()

    await appendFile(f.path, line({ type: 'turn_context', payload: {} }))
    const second = await bound.adapter.readBatch(first.proposed_cursor)
    expect(second.profile_data?.compaction_refs[0]?.post_continuation).toBeDefined()
    expect(second.proposed_cursor.pending_compaction).toBeUndefined()
    expect(second.profile_data?.compaction_refs[0]?.marker_event_hash).toBe(
      first.observations[1]?.source_frame.event_hash,
    )
  })

  it('rejects a pending compaction cursor from another source generation', async () => {
    const f = await fixture()
    const bound = await bindCodexRolloutObservationSource(f.options)
    await appendFile(f.path, line({ type: 'event_msg', payload: { type: 'context_compacted' } }))
    const first = await bound.adapter.readBatch(bound.cursor)
    const pending = first.proposed_cursor.pending_compaction
    expect(pending).toBeDefined()

    await expect(
      bound.adapter.readBatch({
        ...first.proposed_cursor,
        pending_compaction: {
          ...pending!,
          marker_frame: {
            ...pending!.marker_frame,
            generation_ref: `codex-generation:sha256:${'0'.repeat(64)}`,
          },
        },
      }),
    ).rejects.toThrow('invalid Codex rollout cursor')
  })

  it('fails closed when the filename and header identify different sessions', async () => {
    const f = await fixture()
    await writeFile(
      f.path,
      line({
        type: 'session_meta',
        payload: { id: '019f9b4b-9999-7999-8999-999999999999' },
      }),
    )

    await expect(bindCodexRolloutObservationSource(f.options)).rejects.toThrow(
      'conflicts with header id',
    )
    expect(await readFile(f.path, 'utf8')).toContain('999999999999')
  })
})
