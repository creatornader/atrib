// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  base64urlEncode,
  EVENT_TYPE_OBSERVATION_URI,
  EVENT_TYPE_REVISION_URI,
  genesisChainRoot,
  getPublicKey,
  signRecord,
} from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'
import {
  aggregateRevisionsByRecord,
  computeRecordHash,
  type LoadedRecord,
} from '../src/aggregations.js'
import { projectAcceptedState } from '../src/state-projection.js'

const CONTEXT = 'a'.repeat(32)
const OTHER_CONTEXT = 'b'.repeat(32)
const KEY_A = new Uint8Array(32).fill(31)
const KEY_B = new Uint8Array(32).fill(32)

async function makeLoaded(options: {
  key?: Uint8Array
  context_id?: string
  timestamp: number
  revises?: string
  content?: unknown
}): Promise<LoadedRecord> {
  const key = options.key ?? KEY_A
  const contextId = options.context_id ?? CONTEXT
  const record = await signRecord(
    {
      spec_version: 'atrib/1.0',
      event_type: options.revises ? EVENT_TYPE_REVISION_URI : EVENT_TYPE_OBSERVATION_URI,
      context_id: contextId,
      creator_key: base64urlEncode(await getPublicKey(key)),
      chain_root: genesisChainRoot(contextId),
      content_id: `sha256:${options.timestamp.toString(16).padStart(64, '0')}`,
      timestamp: options.timestamp,
      ...(options.revises ? { revises: options.revises } : {}),
      signature: '',
    } as AtribRecord,
    key,
  )
  return {
    record,
    record_hash: computeRecordHash(record),
    ...(options.content !== undefined ? { content: options.content } : {}),
  }
}

describe('projectAcceptedState', () => {
  it('projects a linear revision lineage to one active head', async () => {
    const root = await makeLoaded({ timestamp: 1, content: { what: 'queued' } })
    const revision = await makeLoaded({
      timestamp: 2,
      revises: root.record_hash,
      content: { new_position: 'running' },
    })

    const result = await projectAcceptedState([root, revision], {
      trusted_creator_keys: [root.record.creator_key],
    })

    expect(result.total_cells).toBe(1)
    expect(result.conflict_count).toBe(0)
    expect(result.cells[0]).toMatchObject({
      status: 'resolved',
      revision_count: 1,
      root: { record_hash: root.record_hash, content: { what: 'queued' } },
      active_heads: [{ record_hash: revision.record_hash, content: { new_position: 'running' } }],
    })
  })

  it('keeps every active head when trusted signers fork a lineage', async () => {
    const root = await makeLoaded({ timestamp: 1 })
    const left = await makeLoaded({
      timestamp: 2,
      revises: root.record_hash,
      content: { new_position: 'left' },
    })
    const right = await makeLoaded({
      key: KEY_B,
      timestamp: 3,
      revises: root.record_hash,
      content: { new_position: 'right' },
    })

    const result = await projectAcceptedState([root, left, right], {
      trusted_creator_keys: [root.record.creator_key, right.record.creator_key],
    })

    expect(result.conflict_count).toBe(1)
    expect(result.cells[0]?.status).toBe('conflict')
    expect(result.cells[0]?.active_heads.map((head) => head.record_hash)).toEqual([
      left.record_hash,
      right.record_hash,
    ])
  })

  it('excludes an untrusted branch instead of treating it as accepted state', async () => {
    const root = await makeLoaded({ timestamp: 1 })
    const trusted = await makeLoaded({ timestamp: 2, revises: root.record_hash })
    const untrusted = await makeLoaded({
      key: KEY_B,
      timestamp: 3,
      revises: root.record_hash,
    })

    const result = await projectAcceptedState([root, trusted, untrusted], {
      trusted_creator_keys: [root.record.creator_key],
    })

    expect(result.cells[0]?.status).toBe('resolved')
    expect(result.cells[0]?.active_heads[0]?.record_hash).toBe(trusted.record_hash)
    expect(result.cells[0]?.excluded_revision_count).toBe(1)
    expect(result.excluded_revisions).toContainEqual({
      record_hash: untrusted.record_hash,
      target_record_hash: root.record_hash,
      reason: 'creator_not_trusted',
    })
  })

  it('applies a context allowlist to every accepted revision', async () => {
    const root = await makeLoaded({ timestamp: 1 })
    const outside = await makeLoaded({
      context_id: OTHER_CONTEXT,
      timestamp: 2,
      revises: root.record_hash,
    })

    const result = await projectAcceptedState([root, outside], {
      trusted_creator_keys: [root.record.creator_key],
      allowed_context_ids: [CONTEXT],
      root_record_hashes: [root.record_hash],
    })

    expect(result.cells[0]?.active_heads[0]?.record_hash).toBe(root.record_hash)
    expect(result.excluded_revisions[0]?.reason).toBe('context_not_allowed')
  })

  it('rejects a tampered revision and reports the signature failure', async () => {
    const root = await makeLoaded({ timestamp: 1 })
    const revision = await makeLoaded({ timestamp: 2, revises: root.record_hash })
    const tampered: LoadedRecord = {
      ...revision,
      record: { ...revision.record, timestamp: 3 },
    }

    const result = await projectAcceptedState([root, tampered], {
      trusted_creator_keys: [root.record.creator_key],
      root_record_hashes: [root.record_hash],
    })

    expect(result.cells[0]?.active_heads[0]?.record_hash).toBe(root.record_hash)
    expect(result.excluded_revisions[0]?.reason).toBe('signature_invalid')
  })

  it('projects an explicitly requested singleton without revisions', async () => {
    const root = await makeLoaded({ timestamp: 1, content: { what: 'accepted' } })
    const result = await projectAcceptedState([root], {
      root_record_hashes: [root.record_hash],
      trusted_creator_keys: [root.record.creator_key],
      include_content: false,
    })

    expect(result.cells[0]?.active_heads).toEqual([
      expect.objectContaining({
        record_hash: root.record_hash,
        content_available: true,
      }),
    ])
    expect(result.cells[0]?.active_heads[0]).not.toHaveProperty('content')
  })

  it('uses canonical hash ordering for equal-timestamp sibling revisions', async () => {
    const root = await makeLoaded({ timestamp: 1 })
    const first = await makeLoaded({ timestamp: 2, revises: root.record_hash })
    const second = await makeLoaded({ key: KEY_B, timestamp: 2, revises: root.record_hash })

    const forward = aggregateRevisionsByRecord([root, first, second])
    const reverse = aggregateRevisionsByRecord([root, second, first])
    const expected = [first.record_hash, second.record_hash].sort()

    expect(forward.get(root.record_hash)).toEqual(expected)
    expect(reverse.get(root.record_hash)).toEqual(expected)
  })

  it('bounds fork heads and reports the complete conflict cardinality', async () => {
    const root = await makeLoaded({ timestamp: 1 })
    const heads = await Promise.all(
      [2, 3, 4].map((timestamp) =>
        makeLoaded({
          timestamp,
          revises: root.record_hash,
        }),
      ),
    )

    const result = await projectAcceptedState([root, ...heads], {
      trusted_creator_keys: [root.record.creator_key],
      head_limit: 2,
    })

    expect(result.cells[0]).toMatchObject({
      status: 'conflict',
      total_active_heads: 3,
      active_heads_truncated: true,
    })
    expect(result.cells[0]?.active_heads).toHaveLength(2)
  })

  it('deduplicates repeated mirror records before projecting exclusions', async () => {
    const root = await makeLoaded({ timestamp: 1 })
    const untrusted = await makeLoaded({
      key: KEY_B,
      timestamp: 2,
      revises: root.record_hash,
    })

    const result = await projectAcceptedState([root, untrusted, untrusted], {
      trusted_creator_keys: [root.record.creator_key],
      root_record_hashes: [root.record_hash],
    })

    expect(result.total_excluded_revisions).toBe(1)
    expect(result.excluded_revisions).toHaveLength(1)
  })
})
