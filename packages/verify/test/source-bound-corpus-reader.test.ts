// SPDX-License-Identifier: Apache-2.0
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadSourceBoundFixture } from './source-bound-corpus.js'

const corpus = join(__dirname, '../../../spec/conformance/1.12')

describe('source-bound corpus reader', () => {
  it('materializes compact references into the original case input', () => {
    const fixture = loadSourceBoundFixture(join(corpus, 'cases/C01-complete.json'))
    expect(fixture.input.records.every((record) => typeof record === 'object')).toBe(true)
    expect(
      Object.values(fixture.input.openings).every((opening) => typeof opening === 'object'),
    ).toBe(true)
    expect(
      Object.values(fixture.input.artifacts).every((artifact) => typeof artifact === 'string'),
    ).toBe(true)
  })

  it('rejects unresolved object references', () => {
    const directory = mkdtempSync(join(tmpdir(), 'atrib-1-12-reader-'))
    try {
      const root = join(directory, 'corpus')
      const cases = join(root, 'cases')
      mkdirSync(cases, { recursive: true })
      writeFileSync(
        join(cases, 'broken.json'),
        JSON.stringify({
          input: { records: ['sha256:' + '0'.repeat(64)], openings: {}, artifacts: {} },
        }),
      )
      expect(() => loadSourceBoundFixture(join(cases, 'broken.json'))).toThrow(
        /missing|unresolved/i,
      )
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rejects traversal references and content that does not match its digest', () => {
    const fixturePath = join(corpus, 'cases/C01-complete.json')
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'))
    const directory = mkdtempSync(join(tmpdir(), 'atrib-1-12-reader-'))
    try {
      const root = join(directory, 'corpus')
      const cases = join(root, 'cases')
      mkdirSync(cases, { recursive: true })
      const copy = join(cases, 'case.json')
      writeFileSync(copy, JSON.stringify(fixture))
      cpSync(join(corpus, 'objects'), join(root, 'objects'), { recursive: true })
      expect(() => loadSourceBoundFixture(copy)).not.toThrow()

      const firstReference = fixture.input.records[0]
      fixture.input.records = ['../../outside.json']
      writeFileSync(copy, JSON.stringify(fixture))
      expect(() => loadSourceBoundFixture(copy)).toThrow(/reference|hash/i)

      fixture.input.records = [firstReference]
      writeFileSync(copy, JSON.stringify(fixture))
      const jsonStorePath = join(root, 'objects', 'json-values.json')
      const jsonStoreBytes = readFileSync(jsonStorePath)
      const jsonStore = JSON.parse(jsonStoreBytes.toString('utf8'))
      jsonStore.entries[firstReference.slice(7)] = { tampered: true }
      writeFileSync(jsonStorePath, `${JSON.stringify(jsonStore, null, 2)}\n`)
      expect(() => loadSourceBoundFixture(copy)).toThrow(/digest mismatch/i)
      writeFileSync(jsonStorePath, jsonStoreBytes)

      const mapHash = fixture.input.artifacts.$ref.slice(7)
      const mapPath = join(root, 'objects', 'artifact-maps.json')
      const artifactMap = JSON.parse(readFileSync(mapPath, 'utf8'))
      const artifactReference = Object.values(artifactMap.entries[mapHash].entries)[0] as string
      const artifactsPath = join(root, 'objects', 'artifacts.json')
      const artifacts = JSON.parse(readFileSync(artifactsPath, 'utf8'))
      artifacts.entries[artifactReference.slice(7)] = 'AA=='
      writeFileSync(artifactsPath, `${JSON.stringify(artifacts, null, 2)}\n`)
      expect(() => loadSourceBoundFixture(copy)).toThrow(/artifact digest mismatch/i)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
