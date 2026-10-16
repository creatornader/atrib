// SPDX-License-Identifier: Apache-2.0
import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { genesisChainRoot, signRecord } from '@atrib/mcp'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const fixturePath = join(packageRoot, '../action-gate/test/fixtures/strict-host.mjs')
const cliPath = join(packageRoot, 'dist/cli.js')

async function capture(mode = 'success') {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'atrib-cli-host-')))
  const processResult = spawnSync(process.execPath, [fixturePath, directory, mode], {
    encoding: 'utf8',
  })
  expect(processResult.error).toBeUndefined()
  expect(processResult.status, processResult.stderr).toBe(0)
  return { directory, metadata: JSON.parse(processResult.stdout) }
}

function inspect(metadata: Record<string, string | number>, extra: string[] = []) {
  return spawnSync(
    process.execPath,
    [
      cliPath,
      'inspect',
      '--mirror',
      String(metadata.mirrorPath),
      '--policy',
      String(metadata.policyPath),
      '--request',
      String(metadata.requestHash),
      '--evaluated-at',
      String(metadata.evaluatedAt),
      ...extra,
    ],
    { encoding: 'utf8' },
  )
}

describe('built CLI receives production protected host journals', () => {
  it.each(['live-clock', 'oversized'])(
    'reconstructs the %s host case under the preconfigured authority root',
    async (mode) => {
      const { metadata } = await capture(mode)
      const received = inspect(metadata)
      expect(received.status, received.stderr).toBe(0)
      const request = JSON.parse(received.stdout).inspections[0].verification.request
      expect(request.dimensions.authority.state).toBe('supported')
      expect(request.execution.deliveries[0].state).toBe('success')
      expect(request.dimensions.effect.state).not.toBe('supported')
    },
  )

  it('reconstructs a successful local callback in a fresh process without claiming remote effect', async () => {
    const { metadata } = await capture()
    const received = inspect(metadata)
    expect(received.status, received.stderr).toBe(0)
    const output = JSON.parse(received.stdout)
    expect(output.accepted).toBe(true)
    expect(output.inspections).toHaveLength(1)
    expect(output.inspections[0].verification.request.dimensions.authority.state).toBe('supported')
    expect(output.inspections[0].verification.request.execution.deliveries[0].state).toBe('success')
    expect(output.inspections[0].verification.request.dimensions.effect.state).not.toBe('supported')
    const human = inspect(metadata, ['--format', 'text'])
    expect(human.status).toBe(0)
    expect(human.stdout).toContain('Authority: supported')
    expect(human.stdout).toContain('Remote effect:')
    expect(human.stdout).toContain('Host capture and runtime coverage are host accounts.')
    expect(human.stdout).toContain('host-signed native inventory')
    expect(human.stdout).toContain(
      'Runtime vendor provenance and independent operator provenance are not established',
    )
    expect(human.stdout).toContain('Evidence acceptance does not authorize execution.')
  })

  it('preserves missing opening and artifact gaps from the actual persisted journal', async () => {
    const { metadata } = await capture()
    const rows = (await readFile(metadata.mirrorPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    const dispatch = rows.find((row) => row._local.evidence.opening.assertion.phase === 'dispatch')
    const original = dispatch._local.evidence.opening
    delete dispatch._local.evidence.opening
    await writeFile(metadata.mirrorPath, rows.map((row) => JSON.stringify(row)).join('\n') + '\n')
    const missing = inspect(metadata, ['--dispatch', metadata.dispatchHash])
    expect(missing.status, missing.stderr).toBe(1)
    const output = JSON.parse(missing.stdout)
    expect(output.gaps.some((gap: string) => gap.includes('Missing opening'))).toBe(true)
    expect(output.inspections[0].verification.request.dimensions.source.state).not.toBe('supported')

    dispatch._local.evidence.opening = original
    dispatch._local.evidence.artifacts = []
    await writeFile(metadata.mirrorPath, rows.map((row) => JSON.stringify(row)).join('\n') + '\n')
    const missingArtifact = inspect(metadata)
    expect(missingArtifact.status, missingArtifact.stderr).toBe(1)
    expect(JSON.parse(missingArtifact.stdout).accepted).toBe(false)
  })

  it('reports an unopened dispatch observation without attributing it to the selected request', async () => {
    const { metadata } = await capture()
    const rows = (await readFile(metadata.mirrorPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    for (const row of rows)
      if (row._local.evidence.opening.assertion.phase === 'dispatch')
        delete row._local.evidence.opening
    await writeFile(metadata.mirrorPath, rows.map((row) => JSON.stringify(row)).join('\n') + '\n')
    const received = inspect(metadata)
    expect(received.status, received.stderr).toBe(1)
    const output = JSON.parse(received.stdout)
    expect(output.accepted).toBe(false)
    expect(output.inspections[0].dispatch_record).toBeNull()
    expect(output.gaps.join('\n')).toContain(`Unattributed observation ${metadata.dispatchHash}`)
    const human = inspect(metadata, ['--format', 'text'])
    expect(human.stdout).toContain(
      'No dispatch opening available; dispatch ordering and historical authority unresolved.',
    )
    expect(human.stdout).not.toContain('No observed dispatch')
    expect(human.stdout).toContain(`Unattributed observation ${metadata.dispatchHash}`)
    expect(human.stdout).toContain('Execution: success.')
    expect(human.stdout).not.toContain('execution unknown')
  })

  it('preserves supported request conclusions beside an unattributed unopened observation', async () => {
    const { metadata } = await capture()
    const text = await readFile(metadata.mirrorPath, 'utf8')
    const template = text
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
      .find((row) => row._local.evidence.opening.assertion.phase === 'dispatch').record
    const context = 'b'.repeat(32)
    const unrelated = await signRecord(
      { ...template, context_id: context, chain_root: genesisChainRoot(context), signature: '' },
      new Uint8Array(32).fill(23),
    )
    const { hashCanonical } = await import('../src/index.js')
    const unrelatedHash = hashCanonical(unrelated)
    await writeFile(metadata.mirrorPath, text + JSON.stringify({ record: unrelated }) + '\n')
    const received = inspect(metadata)
    expect(received.status, received.stderr).toBe(0)
    const output = JSON.parse(received.stdout)
    expect(output.accepted).toBe(true)
    expect(output.gaps.join('\n')).toContain(`Unattributed observation ${unrelatedHash}`)
    expect(output.inspections[0].verification.request.dimensions.source.state).toBe('supported')
    expect(output.inspections[0].verification.request.dimensions.authority.state).toBe('supported')
  })

  it('rejects changed opening bytes and torn journal lines', async () => {
    const { metadata } = await capture()
    const text = await readFile(metadata.mirrorPath, 'utf8')
    const rows = text
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    rows[0]._local.evidence.opening.nonce = 'changed_nonce_'.repeat(3)
    await writeFile(metadata.mirrorPath, rows.map((row) => JSON.stringify(row)).join('\n') + '\n')
    const changed = inspect(metadata)
    expect(changed.status, changed.stderr).toBe(1)
    expect(JSON.parse(changed.stdout).accepted).toBe(false)
    await writeFile(metadata.mirrorPath, text.slice(0, -1))
    const torn = inspect(metadata)
    expect(torn.status).toBe(2)
    expect(torn.stderr).toContain('truncated')
  })

  it('evaluates every matching dispatch instead of selecting the favorable result', async () => {
    const { metadata } = await capture()
    const text = await readFile(metadata.mirrorPath, 'utf8')
    const dispatch = text
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
      .find((row) => row._local.evidence.opening.assertion.phase === 'dispatch')
    dispatch.record.signature = 'A'.repeat(86)
    await writeFile(metadata.mirrorPath, text + JSON.stringify(dispatch) + '\n')
    const received = inspect(metadata)
    expect(received.status, received.stderr).toBe(1)
    const output = JSON.parse(received.stdout)
    expect(output.inspections).toHaveLength(2)
    expect(
      output.inspections.map(
        (item: { verification: { request: { dimensions: { source: { state: string } } } } }) =>
          item.verification.request.dimensions.source.state,
      ),
    ).toContain('supported')
    expect(
      output.inspections.map(
        (item: { verification: { request: { dimensions: { source: { state: string } } } } }) =>
          item.verification.request.dimensions.source.state,
      ),
    ).toContain('rejected')
    expect(
      output.inspections.some(
        (item: { verification: { request: { dimensions: { source: { reasons: string[] } } } } }) =>
          item.verification.request.dimensions.source.reasons.includes('signature_invalid'),
      ),
    ).toBe(true)
    expect(output.accepted).toBe(false)
  })

  it('keeps unrelated missing or invalid statements from rejecting the selected request', async () => {
    const { metadata } = await capture()
    const text = await readFile(metadata.mirrorPath, 'utf8')
    const template = JSON.parse(text.split('\n')[0]).record
    const context = 'b'.repeat(32)
    const unrelated = await signRecord(
      { ...template, context_id: context, chain_root: genesisChainRoot(context), signature: '' },
      new Uint8Array(32).fill(23),
    )
    await writeFile(metadata.mirrorPath, text + JSON.stringify({ record: unrelated }) + '\n')
    const missing = inspect(metadata)
    expect(missing.status, missing.stderr).toBe(0)
    const partial = JSON.parse(missing.stdout)
    expect(partial.accepted).toBe(true)
    expect(
      partial.inspections[0].verification.statements.some(
        (statement: { dimensions: { integrity: { body: { state: string } } } }) =>
          statement.dimensions.integrity.body.state === 'unresolved',
      ),
    ).toBe(true)
    const invalid = {
      ...unrelated,
      event_type: 'urn:unrelated:extension',
      signature: 'A'.repeat(86),
    }
    await writeFile(metadata.mirrorPath, text + JSON.stringify({ record: invalid }) + '\n')
    const rejected = inspect(metadata)
    expect(rejected.status, rejected.stderr).toBe(0)
    expect(
      JSON.parse(rejected.stdout).inspections[0].verification.statements.some(
        (statement: { dimensions: { integrity: { state: string } } }) =>
          statement.dimensions.integrity.state === 'rejected',
      ),
    ).toBe(true)
  })

  it('refuses required remote effect when the host response has no bound destination evidence', async () => {
    const { metadata } = await capture()
    const policy = JSON.parse(await readFile(metadata.policyPath, 'utf8'))
    policy.required.push('effect')
    await writeFile(metadata.policyPath, JSON.stringify(policy))
    const received = inspect(metadata)
    expect(received.status, received.stderr).toBe(1)
    const request = JSON.parse(received.stdout).inspections[0].verification.request
    expect(request.reliance.deficient).toContain('effect')
    expect(request.destination_states).toEqual([])
  })

  it('rejects a response selected as a dispatch even with an empty required policy', async () => {
    const { metadata } = await capture()
    const policy = JSON.parse(await readFile(metadata.policyPath, 'utf8'))
    policy.required = []
    await writeFile(metadata.policyPath, JSON.stringify(policy))
    const rows = (await readFile(metadata.mirrorPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    const response = rows.find((row) => row._local.evidence.opening.assertion.phase === 'response')
    const { hashCanonical } = await import('../src/index.js')
    const received = inspect(metadata, ['--dispatch', hashCanonical(response.record)])
    expect(received.status, received.stderr).toBe(1)
    expect(JSON.parse(received.stdout).accepted).toBe(false)
  })

  it('keeps an ambiguous callback outcome unknown after a fresh receiver starts', async () => {
    const { metadata } = await capture('unknown')
    const received = inspect(metadata)
    expect(received.status, received.stderr).toBe(0)
    const request = JSON.parse(received.stdout).inspections[0].verification.request
    expect(request.execution.deliveries[0].state).toBe('unknown')
    expect(request.dimensions.effect.state).not.toBe('supported')
    expect(await readFile(metadata.effectPath, 'utf8')).not.toBe('')
  })

  it('shows a crash gap and prevents replay from repeating the local effect', async () => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'atrib-cli-crash-')))
    const crashed = spawnSync(process.execPath, [fixturePath, directory, 'crash'], {
      encoding: 'utf8',
    })
    expect(crashed.status, crashed.stderr).toBe(73)
    const replayed = spawnSync(process.execPath, [fixturePath, directory, 'replay'], {
      encoding: 'utf8',
    })
    expect(replayed.status, replayed.stderr).toBe(0)
    const metadata = JSON.parse(replayed.stdout)
    expect(metadata.status).toBe('unknown')
    const received = inspect(metadata)
    expect(received.status, received.stderr).toBe(1)
    const output = JSON.parse(received.stdout)
    expect(output.accepted).toBe(false)
    expect(output.gaps.join(' ')).toContain(
      'No dispatch opening available; dispatch ordering and historical authority unresolved.',
    )
    expect((await readFile(metadata.effectPath, 'utf8')).trim().split('\n')).toHaveLength(1)
  })

  it('allows one local effect when independent host processes race on one delivery', async () => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'atrib-cli-race-')))
    const run = () =>
      new Promise<number | null>((resolve, reject) => {
        const child = spawn(process.execPath, [fixturePath, directory, 'success'], {
          stdio: 'ignore',
        })
        child.once('error', reject)
        child.once('exit', resolve)
      })
    const codes = await Promise.all([run(), run()])
    expect(codes).toContain(0)
    expect((await readFile(join(directory, 'effect.txt'), 'utf8')).trim().split('\n')).toHaveLength(
      1,
    )
    const replayed = spawnSync(process.execPath, [fixturePath, directory, 'replay'], {
      encoding: 'utf8',
    })
    expect(replayed.status, replayed.stderr).toBe(0)
    const metadata = JSON.parse(replayed.stdout)
    expect(metadata.status).toBe('success')
    const received = inspect(metadata)
    expect(received.status, received.stderr).toBe(0)
  })
})
