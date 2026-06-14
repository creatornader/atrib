// SPDX-License-Identifier: Apache-2.0

import { execFile } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { verifyLogWindowManifest, type RuntimeLogEventRef } from '@atrib/runtime-log'
import { describe, expect, it } from 'vitest'
import {
  REFERENCE_RUNTIME_LOG_SIDE_EFFECT_PROTOCOL,
  ReferenceRuntimeLogJsonlSource,
  buildReferenceRuntimeLogProof,
  writeReferenceRuntimeLogFixture,
} from '../src/reference-runtime-log.js'

const execFileAsync = promisify(execFile)
const workspaceRoot = join(process.cwd(), '..', '..')
const tsxBin = join(
  workspaceRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
)

describe('reference runtime-log JSONL source', () => {
  it('exports deterministic manifest hashes from identical JSONL inputs', async () => {
    const first = await buildReferenceRuntimeLogProof(await tempLogPath('first'))
    const second = await buildReferenceRuntimeLogProof(await tempLogPath('second'))

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(first.manifest_hashes.main).toBe(second.manifest_hashes.main)
    expect(first.manifest_hashes.fork).toBe(second.manifest_hashes.fork)
    expect(first.manifest_hashes.compaction).toBe(second.manifest_hashes.compaction)
    expect(first.main.manifest.source).toEqual({
      id: 'reference-runtime-log.jsonl',
      kind: 'append-only-jsonl',
      version: '0.1.0',
    })
  })

  it('binds fork manifests to their parent window manifest', async () => {
    const proof = await buildReferenceRuntimeLogProof(await tempLogPath('fork'))
    const wrongParent = {
      ...proof.main.manifest,
      window: {
        ...proof.main.manifest.window,
        label: 'wrong parent',
      },
    }

    const result = verifyLogWindowManifest(proof.fork.manifest, {
      session_definition: proof.fork.session_definition,
      events: proof.fork.events,
      projections: proof.fork.projections,
      fork_parent_manifest: wrongParent,
    })

    expect(proof.fork.verification.valid).toBe(true)
    expect(proof.fork.verification.checks.fork_parent).toBe(true)
    expect(result.valid).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain('fork_parent_mismatch')
  })

  it('binds compaction manifests to source windows and compacted event refs', async () => {
    const proof = await buildReferenceRuntimeLogProof(await tempLogPath('compaction'))
    const tamperedEvents: RuntimeLogEventRef[] = [
      {
        ...proof.main.events[0]!,
        kind: 'tampered',
      },
      ...proof.main.events.slice(1),
    ]

    const result = verifyLogWindowManifest(proof.compaction.manifest, {
      session_definition: proof.compaction.session_definition,
      events: proof.compaction.events,
      projections: proof.compaction.projections,
      compaction_source_manifest: proof.main.manifest,
      compaction_events: tamperedEvents,
    })

    expect(proof.compaction.verification.valid).toBe(true)
    expect(proof.compaction.verification.checks.compaction_source).toBe(true)
    expect(proof.compaction.verification.checks.compaction_event_root).toBe(true)
    expect(result.valid).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain('compaction_event_root_mismatch')
  })

  it('keeps side-effect receipt bodies in JSONL while manifests carry refs only', async () => {
    const path = await tempLogPath('receipts')
    const source = new ReferenceRuntimeLogJsonlSource({ path })
    const fixture = await writeReferenceRuntimeLogFixture(source)
    const bundle = await source.exportWindow({
      session_id: fixture.session_id,
      start: fixture.main_window.start,
      end: fixture.main_window.end,
    })
    const rawJsonl = await readFile(path, 'utf8')
    const manifestText = JSON.stringify(bundle.manifest)

    expect(bundle.verification.valid).toBe(true)
    expect(bundle.side_effect_receipts).toHaveLength(1)
    expect(bundle.side_effect_receipts[0]!.protocol).toBe(
      REFERENCE_RUNTIME_LOG_SIDE_EFFECT_PROTOCOL,
    )
    expect(rawJsonl).toContain('idem-ref-001')
    expect(rawJsonl).toContain('draft://payment-clause-001')
    expect(manifestText).not.toContain('idem-ref-001')
    expect(manifestText).not.toContain('draft://payment-clause-001')
    expect(bundle.verification.checks.side_effect_receipts_root).toBe(true)
  })

  it('runs the smoke script and prints a bounded proof summary', async () => {
    const { stdout } = await execFileAsync(
      tsxBin,
      ['examples/reference-runtime-log/reference-runtime-log-smoke.ts'],
      {
        cwd: process.cwd(),
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      },
    )
    const result = JSON.parse(stdout.trim()) as {
      ok: boolean
      strategy: string
      event_count: number
      fork_event_count: number
      compaction_event_count: number
      side_effect_receipts: number
      issue_codes: string[]
      checks: {
        main_window_bounds: boolean
        fork_parent: boolean
        compaction_source: boolean
        compaction_event_root: boolean
      }
      privacy: {
        raw_bodies_in_jsonl: boolean
        manifests_are_hash_only: boolean
        public_log_not_required: boolean
      }
    }

    expect(result).toMatchObject({
      ok: true,
      strategy: 'reference-runtime-log-jsonl-v0',
      event_count: 6,
      fork_event_count: 2,
      compaction_event_count: 1,
      side_effect_receipts: 1,
      issue_codes: [],
      checks: {
        main_window_bounds: true,
        fork_parent: true,
        compaction_source: true,
        compaction_event_root: true,
      },
      privacy: {
        raw_bodies_in_jsonl: true,
        manifests_are_hash_only: true,
        public_log_not_required: true,
      },
    })
  }, 30000)
})

async function tempLogPath(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `atrib-reference-runtime-log-${name}-`))
  return join(dir, 'runtime-log.jsonl')
}
