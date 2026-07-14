// SPDX-License-Identifier: Apache-2.0

import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canonicalRecord, hexEncode, sha256, verifyRecord } from '@atrib/mcp'
import { verifyLogWindowManifest } from '@atrib/runtime-log'
import { describe, expect, it } from 'vitest'
import {
  SESSION_TRANSCRIPT_RECEIPT_PROTOCOL,
  SessionTranscriptRuntimeLogJsonlSource,
  buildSessionTranscriptProof,
  writeSessionTranscriptFixture,
} from '../src/session-transcript-runtime-log.js'

describe('session transcript runtime-log source', () => {
  it('builds three valid transcript window proofs with signed atrib receipts', async () => {
    const proof = await buildSessionTranscriptProof(await tempDir('proof'))

    expect(proof.ok).toBe(true)
    expect(proof.main.verification.valid).toBe(true)
    expect(proof.fork.verification.valid).toBe(true)
    expect(proof.continuation.verification.valid).toBe(true)
    expect(proof.main.verification.checks).toMatchObject({
      event_root: true,
      session_definition: true,
      projection_root: true,
      side_effect_receipts_root: true,
    })
    expect(proof.fork.verification.checks.fork_parent).toBe(true)
    expect(proof.continuation.verification.checks).toMatchObject({
      compaction_source: true,
      compaction_event_root: true,
    })
  })

  it('produces byte-stable manifests and record hashes across rebuilds', async () => {
    const first = await buildSessionTranscriptProof(await tempDir('first'))
    const second = await buildSessionTranscriptProof(await tempDir('second'))

    expect(first.main.manifest.event_root).toBe(second.main.manifest.event_root)
    expect(first.main.manifest.session.digest).toBe(second.main.manifest.session.digest)
    expect(first.main.projections[0]!.root_hash).toBe(second.main.projections[0]!.root_hash)
    expect(first.manifest_hashes).toEqual(second.manifest_hashes)
    expect(first.signed_records.map((signed) => signed.record_hash)).toEqual(
      second.signed_records.map((signed) => signed.record_hash),
    )
    expect(first.fork.manifest.fork!.parent_window_manifest_hash).toBe(
      first.manifest_hashes.main,
    )
    expect(first.continuation.manifest.compaction!.source_window_manifest_hash).toBe(
      first.manifest_hashes.main,
    )
  })

  it('rejects a window whose JSONL event body changes', async () => {
    const dir = await tempDir('event-tamper')
    const written = await writeSessionTranscriptFixture(dir)
    const source = new SessionTranscriptRuntimeLogJsonlSource({
      path: written.paths.main,
      session_id: written.fixture.session_id,
      runtime: { name: 'Claude Code', version: 'fixture-v1' },
    })
    const original = await source.exportWindow(written.fixture.main_window)
    const lines = (await readFile(written.paths.main, 'utf8')).trimEnd().split('\n')
    const changed = JSON.parse(lines[0]!) as { message: { content: string } }
    changed.message.content = 'Tampered prompt'
    lines[0] = JSON.stringify(changed)
    await writeFile(written.paths.main, `${lines.join('\n')}\n`)
    const tampered = await source.exportWindow(written.fixture.main_window)
    const result = verifyLogWindowManifest(original.manifest, {
      session_definition: original.session_definition,
      events: tampered.events,
      projections: original.projections,
      side_effect_receipts: original.side_effect_receipts,
    })

    expect(result.issues.map((issue) => issue.code)).toContain('event_root_mismatch')
  })

  it('rejects wrong session-definition evidence', async () => {
    const proof = await buildSessionTranscriptProof(await tempDir('session-definition'))
    const result = verifyLogWindowManifest(proof.main.manifest, {
      session_definition: { ...proof.main.session_definition, format: 'wrong-format' },
      events: proof.main.events,
      projections: proof.main.projections,
      side_effect_receipts: proof.main.side_effect_receipts,
    })

    expect(result.issues.map((issue) => issue.code)).toContain('session_definition_digest_mismatch')
  })

  it('rejects a manifest that omits required receipt refs', async () => {
    const proof = await buildSessionTranscriptProof(await tempDir('missing-receipts'))
    const { side_effect_receipts: _, side_effect_receipts_root: __, ...manifest } = proof.main.manifest
    const result = verifyLogWindowManifest(manifest, {
      session_definition: proof.main.session_definition,
      events: proof.main.events,
      projections: proof.main.projections,
    })

    expect(proof.main.manifest.verifier_policy.require_receipt_protocols).toEqual([
      SESSION_TRANSCRIPT_RECEIPT_PROTOCOL,
    ])
    expect(result.issues.map((issue) => issue.code)).toContain('required_receipt_missing')
  })

  it('rejects a fork linked to the wrong main manifest', async () => {
    const proof = await buildSessionTranscriptProof(await tempDir('fork-mismatch'))
    const result = verifyLogWindowManifest(proof.fork.manifest, {
      session_definition: proof.fork.session_definition,
      events: proof.fork.events,
      fork_parent_manifest: {
        ...proof.main.manifest,
        window: { ...proof.main.manifest.window, label: 'wrong parent' },
      },
    })

    expect(result.issues.map((issue) => issue.code)).toContain('fork_parent_mismatch')
  })

  it('rejects a manifest that leaks a withheld message field', async () => {
    const proof = await buildSessionTranscriptProof(await tempDir('withheld-field'))
    const leakedManifest = {
      ...proof.main.manifest,
      message: 'leaked transcript body',
    } as typeof proof.main.manifest & { message: string }
    const result = verifyLogWindowManifest(
      leakedManifest,
      {
        session_definition: proof.main.session_definition,
        events: proof.main.events,
        projections: proof.main.projections,
        side_effect_receipts: proof.main.side_effect_receipts,
      },
    )

    expect(result.issues.map((issue) => issue.code)).toContain('withheld_field_present')
  })

  it('verifies each signed receipt record and its record hash', async () => {
    const proof = await buildSessionTranscriptProof(await tempDir('records'))

    for (const signed of proof.signed_records) {
      expect(await verifyRecord(signed.record)).toBe(true)
      expect(`sha256:${hexEncode(sha256(canonicalRecord(signed.record)))}`).toBe(signed.record_hash)
      expect(proof.main.side_effect_receipts.map((receipt) => receipt.record_hash)).toContain(
        signed.record_hash,
      )
    }
  })
})

async function tempDir(name: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `atrib-session-transcript-runtime-log-${name}-`))
}
