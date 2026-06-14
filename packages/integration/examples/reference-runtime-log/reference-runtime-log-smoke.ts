#!/usr/bin/env tsx
// SPDX-License-Identifier: Apache-2.0

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildReferenceRuntimeLogProof } from '../../src/reference-runtime-log.js'

const dir = await mkdtemp(join(tmpdir(), 'atrib-reference-runtime-log-'))
const path = process.argv[2] ?? join(dir, 'runtime-log.jsonl')
const proof = await buildReferenceRuntimeLogProof(path)
const issueCodes = [
  ...proof.main.verification.issues,
  ...proof.fork.verification.issues,
  ...proof.compaction.verification.issues,
].map((issue) => issue.code)

console.log(
  JSON.stringify(
    {
      ok: proof.ok,
      strategy: proof.strategy,
      log_path: proof.log_path,
      manifest_hashes: proof.manifest_hashes,
      event_count: proof.main.events.length,
      fork_event_count: proof.fork.events.length,
      compaction_event_count: proof.compaction.events.length,
      side_effect_receipts: proof.main.side_effect_receipts.length,
      checks: {
        main_window_bounds: proof.main.verification.checks.window_bounds,
        fork_parent: proof.fork.verification.checks.fork_parent,
        compaction_source: proof.compaction.verification.checks.compaction_source,
        compaction_event_root: proof.compaction.verification.checks.compaction_event_root,
      },
      issue_codes: issueCodes,
      privacy: proof.privacy,
    },
    null,
    2,
  ),
)
