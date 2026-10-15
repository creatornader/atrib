// SPDX-License-Identifier: Apache-2.0
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { digest, evaluateEvidenceFixture } from './source-bound-reference.js'
import { exerciseRetentionFixture } from './source-bound-executor-reference.js'

const root = join(__dirname, '../../../spec/conformance/1.12')
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))

describe('source-bound evidence offline contract corpus', () => {
  it('loads every declared case and rejects an orphan fixture', () => {
    expect(manifest.cases.map((item: { file: string }) => item.file).sort()).toEqual(
      readdirSync(join(root, 'cases'))
        .filter((name) => name.endsWith('.json'))
        .map((name) => `cases/${name}`)
        .sort(),
    )
  })

  for (const item of manifest.cases) {
    const fixture = JSON.parse(readFileSync(join(root, item.file), 'utf8'))
    it(`${fixture.name}: ${fixture.protects}`, async () => {
      if (fixture.input.mode === 'executor') {
        expect(
          await exerciseRetentionFixture(fixture.input.protected, fixture.input.fail_retention),
        ).toEqual(fixture.expected)
        return
      }
      const result = await evaluateEvidenceFixture(fixture.input)
      if (fixture.expected.invalid_kind) {
        const hashes = fixture.input.records
          .filter(
            (record: Record<string, unknown>) =>
              record.event_type ===
              `https://atrib.dev/evidence/v1/${fixture.expected.invalid_kind}`,
          )
          .map(digest)
        const affected = result.statements.filter((statement) =>
          hashes.includes(statement.record_hash),
        )
        expect(affected.length).toBeGreaterThan(0)
        expect(
          affected.every((statement) => statement.dimensions.integrity.body.state === 'rejected'),
        ).toBe(true)
        expect(
          result.statements
            .filter((statement) => !hashes.includes(statement.record_hash))
            .every((statement) => statement.dimensions.integrity.body.state === 'supported'),
        ).toBe(true)
      } else expect(result).toMatchObject(fixture.expected)
    })
  }

  it('keeps the conformance projection unchanged when input record order changes', async () => {
    for (const name of ['C01-complete', 'C10-untrusted-injection', 'F06-destination-progression']) {
      const fixture = JSON.parse(readFileSync(join(root, `cases/${name}.json`), 'utf8'))
      const forward = await evaluateEvidenceFixture(fixture.input)
      fixture.input.records.reverse()
      expect(await evaluateEvidenceFixture(fixture.input)).toEqual(forward)
    }
  })

  it('does not mutate the supplied source accounts or application state', async () => {
    const fixture = JSON.parse(readFileSync(join(root, 'cases/C01-complete.json'), 'utf8'))
    const before = JSON.stringify(fixture.input)
    await evaluateEvidenceFixture(fixture.input)
    expect(JSON.stringify(fixture.input)).toBe(before)
  })

  it('replays the disclosed fixture in a fresh process without the source database', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'atrib-evidence-replay-'))
    try {
      const fixture = JSON.parse(readFileSync(join(root, 'cases/C01-complete.json'), 'utf8'))
      const path = join(directory, 'bundle.json')
      writeFileSync(path, JSON.stringify(fixture))
      const cli = createRequire(import.meta.url).resolve('tsx/cli')
      const actual = execFileSync(
        process.execPath,
        [cli, join(__dirname, 'run-source-bound-fixture.ts'), path],
        { cwd: directory, encoding: 'utf8' },
      )
      expect(JSON.parse(actual)).toEqual(await evaluateEvidenceFixture(fixture.input))
    } finally {
      rmSync(directory, { recursive: true })
    }
  }, 30_000)
})
