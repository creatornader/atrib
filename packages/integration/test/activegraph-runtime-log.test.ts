// SPDX-License-Identifier: Apache-2.0

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { verifyLogWindowManifest } from '@atrib/runtime-log'
import { describe, expect, it } from 'vitest'
import {
  ACTIVEGRAPH_APPROVAL_GATE_PROTOCOL,
  buildActiveGraphRuntimeLogProof,
  readActiveGraphTraceJsonl,
  activeGraphEventsToRuntimeLogRefs,
} from '../src/activegraph-runtime-log.js'

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
  'activegraph-runtime-log',
  'fixtures',
  'activegraph-v1.1.0-diligence-approval-window.jsonl',
)

describe('ActiveGraph runtime-log proof', () => {
  it('verifies the current ActiveGraph approval-gate fixture', async () => {
    const proof = await buildActiveGraphRuntimeLogProof({ tracePath: fixturePath })

    expect(proof.ok).toBe(true)
    expect(proof.strategy).toBe('activegraph-runtime-log-v0')
    expect(proof.source).toMatchObject({
      runtime: 'activegraph',
      version: '1.1.0',
      source_commit: '27c2901b86119b676f1da985100d2d2c397b6969',
      raw_event_rows: 6,
    })
    expect(proof.manifest.event_count).toBe(6)
    expect(proof.approval_gate_receipts).toHaveLength(2)
    expect(proof.side_effect_receipts.map((receipt) => receipt.protocol)).toEqual([
      ACTIVEGRAPH_APPROVAL_GATE_PROTOCOL,
      ACTIVEGRAPH_APPROVAL_GATE_PROTOCOL,
    ])
    expect(proof.verification.checks).toMatchObject({
      schema: true,
      source: true,
      session_definition: true,
      event_root: true,
      projection_root: true,
      side_effect_receipts_root: true,
    })
    expect(proof.privacy).toEqual({
      activegraph_owns_runtime_log: true,
      public_manifest_hash_only: true,
      raw_trace_body_outside_manifest: true,
    })
  })

  it('rejects tampered event evidence against the original manifest', async () => {
    const proof = await buildActiveGraphRuntimeLogProof({ tracePath: fixturePath })
    const tamperedPath = await writeTempTrace(
      (await readFile(fixturePath, 'utf8')).replace('demo-user', 'other-reviewer'),
    )
    const tamperedEvents = activeGraphEventsToRuntimeLogRefs(
      await readActiveGraphTraceJsonl(tamperedPath),
    )

    const result = verifyLogWindowManifest(proof.manifest, {
      session_definition: proof.session_definition,
      events: tamperedEvents,
      projections: proof.projections,
      side_effect_receipts: proof.side_effect_receipts,
    })

    expect(result.valid).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain('event_root_mismatch')
  })

  it('rejects mismatched session-definition evidence', async () => {
    const proof = await buildActiveGraphRuntimeLogProof({ tracePath: fixturePath })
    const result = verifyLogWindowManifest(proof.manifest, {
      session_definition: {
        ...proof.session_definition,
        runtime: {
          ...proof.session_definition.runtime,
          version: '1.0.5.post2',
        },
      },
      events: proof.events,
      projections: proof.projections,
      side_effect_receipts: proof.side_effect_receipts,
    })

    expect(result.valid).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain('session_definition_digest_mismatch')
  })

  it('rejects missing approval events when approval proof is requested', async () => {
    const rows = (await readFile(fixturePath, 'utf8'))
      .trim()
      .split('\n')
      .filter((line) => !line.includes('"id":"evt_234"'))
    const omittedPath = await writeTempTrace(`${rows.join('\n')}\n`)

    await expect(buildActiveGraphRuntimeLogProof({ tracePath: omittedPath })).rejects.toThrow(
      'approval_002 is missing approval.granted',
    )
  })

  it('runs the smoke script and prints a bounded proof summary', async () => {
    const { stdout } = await execFileAsync(
      tsxBin,
      ['examples/activegraph-runtime-log/activegraph-runtime-log-smoke.ts'],
      {
        cwd: process.cwd(),
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      },
    )
    const result = JSON.parse(stdout.trim()) as {
      ok: boolean
      strategy: string
      approval_gate_receipts: number
      event_count: number
      issue_codes: string[]
      cli: {
        verify_valid: boolean
        verify_issue_codes: string[]
      }
      privacy: { activegraph_owns_runtime_log: boolean }
    }

    expect(result).toMatchObject({
      ok: true,
      strategy: 'activegraph-runtime-log-v0',
      approval_gate_receipts: 2,
      event_count: 6,
      issue_codes: [],
      cli: {
        verify_valid: true,
        verify_issue_codes: [],
      },
      privacy: { activegraph_owns_runtime_log: true },
    })
  }, 30000)
})

async function writeTempTrace(text: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'atrib-activegraph-runtime-log-'))
  const path = join(dir, 'trace.jsonl')
  await writeFile(path, text)
  return path
}
