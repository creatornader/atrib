#!/usr/bin/env tsx
// SPDX-License-Identifier: Apache-2.0

import { join } from 'node:path'
import { buildDogfoodRuntimeLogProof } from '../../src/dogfood-runtime-log.js'

const fixturePath =
  process.argv[2] ??
  join(
    process.cwd(),
    'examples',
    'dogfood-runtime-log',
    'fixtures',
    'rl-007-agent-bridge-window.json',
  )
const proof = await buildDogfoodRuntimeLogProof(fixturePath)

console.log(
  JSON.stringify(
    {
      ok: proof.ok,
      strategy: proof.strategy,
      manifest_hash: proof.manifest_hash,
      job_id: proof.fixture.job_id,
      status: proof.fixture.status,
      bridge_entry_ids: proof.fixture.bridge_entry_ids,
      signed_refs: proof.fixture.signed_refs.length,
      event_count: proof.events.length,
      projection_count: proof.projections.length,
      side_effect_receipts: proof.side_effect_receipts.length,
      checks: proof.verification.checks,
      issue_codes: proof.verification.issues.map((issue) => issue.code),
      privacy: proof.privacy,
    },
    null,
    2,
  ),
)
