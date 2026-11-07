// SPDX-License-Identifier: Apache-2.0

import { mkdir, mkdtemp, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AtribRecord } from '@atrib/mcp'
import { ArchiveStore, recordHash } from '../src/index.js'

const record = {
  spec_version: 'atrib/1.0',
  event_type: 'https://atrib.dev/v1/types/tool_call',
  timestamp: 1_790_000_000_000,
  context_id: '0'.repeat(32),
  creator_key: 'A'.repeat(43),
  chain_root: `sha256:${'1'.repeat(64)}`,
  content_id: `sha256:${'2'.repeat(64)}`,
  signature: 'sig',
} as unknown as AtribRecord

describe('archive store durability', () => {
  it('does not report a retried put as stored when the first append failed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'atrib-archive-store-'))
    const path = join(dir, 'archive.jsonl')
    // A directory where the file belongs makes the first append fail.
    await mkdir(path)
    const store = new ArchiveStore({ persistencePath: path, retentionWindowMs: 60_000 })
    await expect(store.put({ record })).rejects.toThrow()
    expect(store.get(recordHash(record)).status).toBe('missing')
    await rmdir(path)
    await store.put({ record })
    // Before the fix the retry found the entry in memory, skipped the
    // write, and a restart lost the body it had reported as archived.
    const restarted = new ArchiveStore({ persistencePath: path, retentionWindowMs: 60_000 })
    expect(await restarted.init()).toBe(1)
  })

  it('keeps every merged piece of evidence when puts overlap', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'atrib-archive-store-'))
    const path = join(dir, 'archive.jsonl')
    const store = new ArchiveStore({ persistencePath: path, retentionWindowMs: 60_000 })
    const evidence = (n: number) => [{ profile: `test-${n}` }] as never
    await Promise.all([1, 2, 3, 4, 5, 6].map((n) => store.put({ record, evidence: evidence(n) })))
    const restarted = new ArchiveStore({ persistencePath: path, retentionWindowMs: 60_000 })
    await restarted.init()
    const [hash] = [
      ...(restarted as unknown as { entries: Map<string, { evidence: unknown[] }> }).entries.keys(),
    ]
    expect(
      (restarted as unknown as { entries: Map<string, { evidence: unknown[] }> }).entries.get(
        hash!,
      )!.evidence,
    ).toHaveLength(6)
  })
})
