#!/usr/bin/env tsx
// SPDX-License-Identifier: Apache-2.0

import { join } from 'node:path'
import { buildSecondaryAdapterFamilyProof } from '../../src/secondary-runtime-log.js'

const baseDir = join(process.cwd(), 'examples', 'secondary-runtime-log', 'fixtures')
const langGraphFixturePath = process.argv[2] ?? join(baseDir, 'langgraph-checkpoints.json')
const openInferenceFixturePath =
  process.argv[3] ?? join(baseDir, 'openinference-trace-projection.json')

const proof = await buildSecondaryAdapterFamilyProof({
  langGraphFixturePath,
  openInferenceFixturePath,
})

console.log(
  JSON.stringify(
    {
      ok: proof.ok,
      strategy: proof.strategy,
      runtime_adapter: {
        strategy: proof.runtime_adapter.strategy,
        main_manifest_hash: proof.runtime_adapter.manifest_hashes.main,
        fork_manifest_hash: proof.runtime_adapter.manifest_hashes.fork,
        main_event_count: proof.runtime_adapter.main.events.length,
        fork_event_count: proof.runtime_adapter.fork.events.length,
        fork_parent_bound: proof.runtime_adapter.fork.verification.checks.fork_parent === true,
        runtime_log_identity:
          proof.runtime_adapter.main.session_definition.boundary.runtime_log_identity,
      },
      trace_projection_adapter: {
        manifest_hash: proof.trace_projection_manifest_hash,
        event_count: proof.trace_projection_adapter.events.length,
        projection_count: proof.trace_projection_adapter.projections.length,
        projection_only: proof.trace_projection_adapter.session_definition.boundary.projection_only,
        runtime_log_identity:
          proof.trace_projection_adapter.session_definition.boundary.runtime_log_identity,
      },
      boundary_checks: proof.boundary_verification.checks,
      issue_codes: proof.boundary_verification.issues.map((issue) => issue.code),
      distinction: proof.distinction,
    },
    null,
    2,
  ),
)
