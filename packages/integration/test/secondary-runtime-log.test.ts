// SPDX-License-Identifier: Apache-2.0

import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { hashSessionDefinition, verifyLogWindowManifest } from '@atrib/runtime-log'
import { describe, expect, it } from 'vitest'
import {
  OPENINFERENCE_SPAN_TREE_PROJECTION,
  buildSecondaryAdapterFamilyProof,
  verifyOpenInferenceTraceProjectionBoundary,
  type OpenInferenceTraceProjectionSessionDefinition,
} from '../src/secondary-runtime-log.js'

const execFileAsync = promisify(execFile)
const workspaceRoot = join(process.cwd(), '..', '..')
const tsxBin = join(
  workspaceRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
)
const fixtureDir = join(process.cwd(), 'examples', 'secondary-runtime-log', 'fixtures')
const langGraphFixturePath = join(fixtureDir, 'langgraph-checkpoints.json')
const openInferenceFixturePath = join(fixtureDir, 'openinference-trace-projection.json')

describe('secondary runtime-log adapter family', () => {
  it('proves a runtime source and trace projection without merging their claims', async () => {
    const proof = await buildSecondaryAdapterFamilyProof({
      langGraphFixturePath,
      openInferenceFixturePath,
    })

    expect(proof.ok).toBe(true)
    expect(proof.runtime_adapter.main.verification.valid).toBe(true)
    expect(proof.runtime_adapter.fork.verification.valid).toBe(true)
    expect(proof.runtime_adapter.fork.manifest.fork).toBeDefined()
    expect(proof.runtime_adapter.main.session_definition.boundary.runtime_log_identity).toBe(true)
    expect(proof.runtime_adapter.main.session_definition.boundary.fork_supported).toBe(true)

    expect(proof.trace_projection_adapter.verification.valid).toBe(true)
    expect(proof.trace_projection_adapter.manifest.source.kind).toBe(
      'openinference-trace-projection',
    )
    expect(proof.trace_projection_adapter.session_definition.boundary.projection_only).toBe(true)
    expect(proof.trace_projection_adapter.session_definition.boundary.runtime_log_identity).toBe(
      false,
    )
    expect(
      proof.trace_projection_adapter.manifest.verifier_policy.require_projection_roots,
    ).toEqual([OPENINFERENCE_SPAN_TREE_PROJECTION])
    expect(proof.boundary_verification.checks).toMatchObject({
      runtime_manifest: true,
      runtime_fork: true,
      runtime_identity: true,
      trace_projection_manifest: true,
      trace_projection_label: true,
      trace_projection_only: true,
      trace_projection_no_fork_or_resume: true,
      trace_projection_root: true,
    })
  })

  it('rejects a LangGraph fork manifest bound to the wrong parent', async () => {
    const proof = await buildSecondaryAdapterFamilyProof({
      langGraphFixturePath,
      openInferenceFixturePath,
    })
    const wrongParent = {
      ...proof.runtime_adapter.main.manifest,
      window: {
        ...proof.runtime_adapter.main.manifest.window,
        label: 'wrong parent',
      },
    }

    const result = verifyLogWindowManifest(proof.runtime_adapter.fork.manifest, {
      session_definition: proof.runtime_adapter.fork.session_definition,
      events: proof.runtime_adapter.fork.events,
      projections: proof.runtime_adapter.fork.projections,
      fork_parent_manifest: wrongParent,
    })

    expect(result.valid).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain('fork_parent_mismatch')
  })

  it('rejects an OpenInference projection that claims runtime completeness', async () => {
    const proof = await buildSecondaryAdapterFamilyProof({
      langGraphFixturePath,
      openInferenceFixturePath,
    })
    const tamperedSession: OpenInferenceTraceProjectionSessionDefinition = {
      ...proof.trace_projection_adapter.session_definition,
      boundary: {
        ...proof.trace_projection_adapter.session_definition.boundary,
        projection_only: false,
        runtime_log_identity: true,
        resume_supported: true,
      },
    }
    const tamperedManifest = {
      ...proof.trace_projection_adapter.manifest,
      session: {
        ...proof.trace_projection_adapter.manifest.session,
        digest: hashSessionDefinition(tamperedSession),
      },
    }

    const result = verifyOpenInferenceTraceProjectionBoundary(tamperedManifest, tamperedSession)

    expect(result.valid).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toEqual([
      'projection_claims_runtime_identity',
      'projection_claims_fork_or_resume',
    ])
  })

  it('keeps raw checkpoint and span bodies out of the manifests', async () => {
    const proof = await buildSecondaryAdapterFamilyProof({
      langGraphFixturePath,
      openInferenceFixturePath,
    })
    const manifestText = JSON.stringify({
      runtime: proof.runtime_adapter.main.manifest,
      fork: proof.runtime_adapter.fork.manifest,
      projection: proof.trace_projection_adapter.manifest,
    })

    expect(manifestText).not.toContain('local://langgraph')
    expect(manifestText).not.toContain('qwen3.5-397b')
    expect(manifestText).not.toContain('search_docs')
    expect(proof.runtime_adapter.main.manifest.redaction.fields).toContain('checkpoint_body')
    expect(proof.trace_projection_adapter.manifest.redaction.fields).toContain('prompt')
  })

  it('runs the smoke script and prints a bounded proof summary', async () => {
    const { stdout } = await execFileAsync(
      tsxBin,
      ['examples/secondary-runtime-log/secondary-runtime-log-smoke.ts'],
      {
        cwd: process.cwd(),
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      },
    )
    const result = JSON.parse(stdout.trim()) as {
      ok: boolean
      strategy: string
      runtime_adapter: {
        main_event_count: number
        fork_event_count: number
        fork_parent_bound: boolean
        runtime_log_identity: boolean
      }
      trace_projection_adapter: {
        event_count: number
        projection_only: boolean
        runtime_log_identity: boolean
      }
      issue_codes: string[]
    }

    expect(result).toMatchObject({
      ok: true,
      strategy: 'runtime-log-second-adapter-family-v0',
      runtime_adapter: {
        main_event_count: 3,
        fork_event_count: 2,
        fork_parent_bound: true,
        runtime_log_identity: true,
      },
      trace_projection_adapter: {
        event_count: 2,
        projection_only: true,
        runtime_log_identity: false,
      },
      issue_codes: [],
    })
  }, 30000)
})
