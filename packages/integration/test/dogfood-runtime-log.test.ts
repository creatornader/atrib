// SPDX-License-Identifier: Apache-2.0

import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { verifyLogWindowManifest } from '@atrib/runtime-log'
import { describe, expect, it } from 'vitest'
import {
  DOGFOOD_AGENT_BRIDGE_RECEIPT_PROTOCOL,
  DOGFOOD_JOB_STATUS_PROJECTION,
  DOGFOOD_SIGNED_REF_PROJECTION,
  buildDogfoodRuntimeLogProof,
  dogfoodFixtureToEventRefs,
  readDogfoodRuntimeLogFixture,
  type DogfoodRuntimeLogFixture,
} from '../src/dogfood-runtime-log.js'

const execFileAsync = promisify(execFile)
const workspaceRoot = join(process.cwd(), '..', '..')
const tsxBin = join(
  workspaceRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
)
const fixturePath = join(
  process.cwd(),
  'examples',
  'dogfood-runtime-log',
  'fixtures',
  'rl-007-agent-bridge-window.json',
)

describe('dogfood runtime-log proof', () => {
  it('verifies the sanitized RL-007 Agent Bridge job window', async () => {
    const proof = await buildDogfoodRuntimeLogProof(fixturePath)

    expect(proof.ok).toBe(true)
    expect(proof.fixture).toMatchObject({
      job_id: 'RL-007',
      status: 'accepted',
      bridge_entry_ids: [1846, 1851],
    })
    expect(proof.events).toHaveLength(4)
    expect(proof.projections.map((projection) => projection.name).sort()).toEqual([
      DOGFOOD_JOB_STATUS_PROJECTION,
      DOGFOOD_SIGNED_REF_PROJECTION,
    ])
    expect(proof.side_effect_receipts.map((receipt) => receipt.protocol)).toEqual([
      DOGFOOD_AGENT_BRIDGE_RECEIPT_PROTOCOL,
      DOGFOOD_AGENT_BRIDGE_RECEIPT_PROTOCOL,
    ])
    expect(proof.verification.checks).toMatchObject({
      schema: true,
      source: true,
      session_definition: true,
      event_root: true,
      window_bounds: true,
      projection_root: true,
      side_effect_receipts_root: true,
    })
  })

  it('rejects a stale result packet against the original manifest', async () => {
    const proof = await buildDogfoodRuntimeLogProof(fixturePath)
    const fixture = await readDogfoodRuntimeLogFixture(fixturePath)
    const staleFixture: DogfoodRuntimeLogFixture = {
      ...fixture,
      result_packet: {
        ...fixture.result_packet,
        result_record_hash:
          'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      },
    }
    const staleEvents = dogfoodFixtureToEventRefs(staleFixture)

    const result = verifyLogWindowManifest(proof.manifest, {
      session_definition: proof.session_definition,
      events: staleEvents,
      projections: proof.projections,
      side_effect_receipts: proof.side_effect_receipts,
    })

    expect(result.valid).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain('event_root_mismatch')
  })

  it('omits private note bodies and raw bridge content from fixture and manifest', async () => {
    const proof = await buildDogfoodRuntimeLogProof(fixturePath)
    const fixtureText = await readFile(fixturePath, 'utf8')
    const manifestText = JSON.stringify(proof.manifest)

    expect(fixtureText).toContain('"raw_bridge_content": "omitted"')
    expect(fixtureText).toContain('"private_note_bodies": "omitted"')
    expect(fixtureText).not.toContain('Public repo now has a local reference runtime-log')
    expect(fixtureText).not.toContain('The private loop plan, tracker, and roadmap')
    expect(manifestText).not.toContain('Public repo now has a local reference runtime-log')
    expect(manifestText).not.toContain('The private loop plan, tracker, and roadmap')
  })

  it('runs the smoke script and prints a bounded proof summary', async () => {
    const { stdout } = await execFileAsync(
      tsxBin,
      ['examples/dogfood-runtime-log/dogfood-runtime-log-smoke.ts'],
      {
        cwd: process.cwd(),
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      },
    )
    const result = JSON.parse(stdout.trim()) as {
      ok: boolean
      strategy: string
      job_id: string
      status: string
      bridge_entry_ids: number[]
      signed_refs: number
      event_count: number
      projection_count: number
      side_effect_receipts: number
      issue_codes: string[]
      privacy: { private_note_bodies: string }
    }

    expect(result).toMatchObject({
      ok: true,
      strategy: 'dogfood-agent-bridge-runtime-log-v0',
      job_id: 'RL-007',
      status: 'accepted',
      bridge_entry_ids: [1846, 1851],
      signed_refs: 4,
      event_count: 4,
      projection_count: 2,
      side_effect_receipts: 2,
      issue_codes: [],
      privacy: { private_note_bodies: 'omitted' },
    })
  }, 30000)
})
