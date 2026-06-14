#!/usr/bin/env tsx
// SPDX-License-Identifier: Apache-2.0

import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { buildActiveGraphRuntimeLogProof } from '../../src/activegraph-runtime-log.js'

const execFileAsync = promisify(execFile)
const tracePath =
  process.argv[2] ??
  join(
    process.cwd(),
    'examples',
    'activegraph-runtime-log',
    'fixtures',
    'activegraph-v1.1.0-diligence-approval-window.jsonl',
  )

const proof = await buildActiveGraphRuntimeLogProof({ tracePath })
const cliResult = await verifyWithRuntimeLogCli(proof)

console.log(
  JSON.stringify(
    {
      ok: proof.ok,
      strategy: proof.strategy,
      manifest_hash: proof.manifest_hash,
      event_count: proof.manifest.event_count,
      approval_gate_receipts: proof.approval_gate_receipts.length,
      source: proof.source,
      privacy: proof.privacy,
      checks: proof.verification.checks,
      issue_codes: proof.verification.issues.map((issue) => issue.code),
      cli: cliResult,
    },
    null,
    2,
  ),
)

async function verifyWithRuntimeLogCli(
  proof: Awaited<ReturnType<typeof buildActiveGraphRuntimeLogProof>>,
) {
  const dir = await mkdtemp(join(tmpdir(), 'atrib-activegraph-runtime-log-cli-'))
  const eventsPath = join(dir, 'events.jsonl')
  const sessionPath = join(dir, 'session-definition.json')
  const baseManifestPath = join(dir, 'base-manifest.json')
  const manifestPath = join(dir, 'approval-manifest.json')
  const projectionsPath = join(dir, 'projections.json')
  const receiptsPath = join(dir, 'side-effect-receipts.json')
  const cliPath = join(process.cwd(), '..', 'runtime-log', 'dist', 'cli.js')

  await writeFile(eventsPath, proof.events.map((event) => JSON.stringify(event)).join('\n') + '\n')
  await writeFile(sessionPath, `${JSON.stringify(proof.session_definition, null, 2)}\n`)
  await writeFile(manifestPath, `${JSON.stringify(proof.manifest, null, 2)}\n`)
  await writeFile(projectionsPath, `${JSON.stringify(proof.projections, null, 2)}\n`)
  await writeFile(receiptsPath, `${JSON.stringify(proof.side_effect_receipts, null, 2)}\n`)

  await execFileAsync(process.execPath, [
    cliPath,
    'attest',
    '--events',
    eventsPath,
    '--session-definition',
    sessionPath,
    '--out',
    baseManifestPath,
    '--source-id',
    'activegraph.v1.1.0.diligence',
    '--source-kind',
    'activegraph-export-trace-jsonl',
    '--source-version',
    '1.1.0',
    '--runtime-name',
    'activegraph',
    '--runtime-version',
    '1.1.0',
    '--session-id',
    proof.session_definition.run.id,
  ])

  const { stdout } = await execFileAsync(process.execPath, [
    cliPath,
    'verify',
    '--manifest',
    manifestPath,
    '--events',
    eventsPath,
    '--session-definition',
    sessionPath,
    '--projections',
    projectionsPath,
    '--side-effect-receipts',
    receiptsPath,
  ])
  const verify = JSON.parse(stdout) as { valid: boolean; issues: Array<{ code: string }> }

  return {
    attest_command: 'atrib-runtime-log attest',
    verify_command: 'atrib-runtime-log verify',
    verify_valid: verify.valid,
    verify_issue_codes: verify.issues.map((issue) => issue.code),
  }
}
