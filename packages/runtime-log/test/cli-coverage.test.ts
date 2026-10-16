// SPDX-License-Identifier: Apache-2.0
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
describe('fresh CLI receives bounded native host coverage', () => {
  it('joins the actual protected MCP dispatch and loses completeness when expected bytes are withheld', async () => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'atrib-cli-coverage-')))
    const captured = spawnSync(
      process.execPath,
      [join(packageRoot, '../action-gate/test/fixtures/strict-host.mjs'), directory, 'coverage'],
      { encoding: 'utf8' },
    )
    expect(captured.status, captured.stderr).toBe(0)
    const metadata = JSON.parse(captured.stdout)
    const inspect = () =>
      spawnSync(
        process.execPath,
        [
          join(packageRoot, 'dist/cli.js'),
          'inspect',
          '--mirror',
          metadata.mirrorPath,
          '--policy',
          metadata.policyPath,
          '--request',
          metadata.requestHash,
          '--dispatch',
          metadata.dispatchHash,
          '--evaluated-at',
          String(metadata.evaluatedAt),
        ],
        { encoding: 'utf8' },
      )
    const received = inspect()
    expect(received.status, received.stderr).toBe(0)
    const output = JSON.parse(received.stdout)
    expect(output.accepted).toBe(true)
    expect(output.inspections[0].verification.request.dimensions.coverage.state).toBe('supported')

    const rows = (await readFile(metadata.mirrorPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    const coverage = rows.find((row) => row.record.event_type.endsWith('/coverage'))
    const expectedHash = coverage._local.evidence.opening.basis.find(
      (ref: { relation: string }) => ref.relation === 'expected',
    ).hash
    coverage._local.evidence.artifacts = coverage._local.evidence.artifacts.filter(
      (artifact: { hash: string }) => artifact.hash !== expectedHash,
    )
    await writeFile(metadata.mirrorPath, rows.map((row) => JSON.stringify(row)).join('\n') + '\n')
    const withheld = inspect()
    expect(withheld.status, withheld.stderr).toBe(1)
    const incomplete = JSON.parse(withheld.stdout)
    expect(incomplete.accepted).toBe(false)
    expect(incomplete.inspections[0].verification.request.dimensions.coverage.state).toBe(
      'unresolved',
    )
  })
})
