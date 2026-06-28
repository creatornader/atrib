import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  encodeX401HeaderObject,
  verifyX401AuthorizationEvidence,
} from '../src/x401-evidence.js'
import manifest from '../../../spec/conformance/5.5.6/x401/manifest.json'
import type { X401AuthorizationEvidenceInput } from '../src/x401-evidence.js'

interface ManifestCase {
  name: string
  file: string
}

interface X401EvidenceCase {
  name: string
  headerObjects?: Record<string, unknown>
  input: X401AuthorizationEvidenceInput
  expected: {
    valid: boolean
    constraints: Array<{ type: string; status: string }>
    errors: string[]
  }
}

const corpusRoot = fileURLToPath(new URL('../../../spec/conformance/5.5.6/x401/', import.meta.url))

function readCase(file: string): X401EvidenceCase {
  return JSON.parse(readFileSync(resolve(corpusRoot, file), 'utf8')) as X401EvidenceCase
}

function buildInput(fixture: X401EvidenceCase): X401AuthorizationEvidenceInput {
  if (!fixture.headerObjects) return fixture.input
  return {
    ...fixture.input,
    headers: Object.fromEntries(
      Object.entries(fixture.headerObjects).map(([name, value]) => [
        name,
        encodeX401HeaderObject(value),
      ]),
    ),
  }
}

describe('x401 authorization evidence conformance corpus', () => {
  const cases = (manifest.cases as ManifestCase[]).map((entry) => ({
    manifest: entry,
    fixture: readCase(entry.file),
  }))

  for (const { manifest: manifestEntry, fixture } of cases) {
    it(manifestEntry.name, () => {
      expect(fixture.name).toBe(manifestEntry.file.replace(/^cases\//, '').replace(/\.json$/, ''))
      const result = verifyX401AuthorizationEvidence(buildInput(fixture))

      expect(result.valid).toBe(fixture.expected.valid)
      for (const expected of fixture.expected.constraints) {
        const actual = result.constraints.find((constraint) => constraint.type === expected.type)
        expect(actual, `${fixture.name}: ${expected.type}`).toBeDefined()
        expect(actual?.status).toBe(expected.status)
      }
      for (const expectedError of fixture.expected.errors) {
        expect(result.errors).toContain(expectedError)
      }
      if (fixture.expected.errors.length === 0) expect(result.errors).toEqual([])
    })
  }
})

