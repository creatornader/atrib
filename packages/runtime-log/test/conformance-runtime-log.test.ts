// SPDX-License-Identifier: Apache-2.0

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  verifyLogWindowManifest,
  type LogWindowManifest,
  type LogWindowManifestEvidence,
  type ManifestVerificationIssueCode,
  type ManifestVerificationResult,
} from '../src/index.js'

const CORPUS_ROOT = fileURLToPath(
  new URL('../../../spec/conformance/runtime-log/', import.meta.url),
)

interface RuntimeLogConformanceManifest {
  readonly cases: readonly {
    readonly id: string
    readonly file: string
    readonly expected_valid: boolean
  }[]
}

interface RuntimeLogConformanceCase {
  readonly id: string
  readonly manifest: LogWindowManifest
  readonly evidence?: LogWindowManifestEvidence
  readonly expected: {
    readonly valid: boolean
    readonly issue_codes: readonly ManifestVerificationIssueCode[]
    readonly checks?: Partial<ManifestVerificationResult['checks']>
  }
  readonly privacy_expectation?: {
    readonly manifest_embeds_raw_runtime_bodies?: boolean
    readonly withheld_manifest_fields?: readonly string[]
  }
}

const corpusManifest = await readJson<RuntimeLogConformanceManifest>(
  join(CORPUS_ROOT, 'manifest.json'),
)
const cases = await Promise.all(
  corpusManifest.cases.map((entry) =>
    readJson<RuntimeLogConformanceCase>(join(CORPUS_ROOT, entry.file)),
  ),
)

describe('runtime-log conformance corpus', () => {
  it('lists each case once in the manifest', () => {
    const listed = corpusManifest.cases.map((entry) => entry.id)
    const loaded = cases.map((entry) => entry.id)

    expect(new Set(listed).size).toBe(listed.length)
    expect(loaded).toEqual(listed)
  })

  for (const corpusCase of cases) {
    it(`${corpusCase.id} matches expected verifier result`, () => {
      const result = verifyLogWindowManifest(corpusCase.manifest, corpusCase.evidence ?? {})
      const issueCodes = result.issues.map((entry) => entry.code)

      expect(result.valid).toBe(corpusCase.expected.valid)
      for (const expectedCode of corpusCase.expected.issue_codes) {
        expect(issueCodes).toContain(expectedCode)
      }
      if (corpusCase.expected.valid) {
        expect(issueCodes).toEqual([])
      }
      for (const [checkName, expectedValue] of Object.entries(corpusCase.expected.checks ?? {})) {
        expect(result.checks[checkName as keyof ManifestVerificationResult['checks']]).toBe(
          expectedValue,
        )
      }
    })

    it(`${corpusCase.id} follows the fixture raw-body posture`, () => {
      const expectedFields = new Set(corpusCase.privacy_expectation?.withheld_manifest_fields ?? [])
      const fieldPaths = findFieldPaths(corpusCase.manifest, expectedFields)
      const deliberateWithheldFieldCase =
        corpusCase.expected.issue_codes.includes('withheld_field_present')

      if (deliberateWithheldFieldCase) {
        expect(fieldPaths.length).toBeGreaterThan(0)
      } else if (corpusCase.privacy_expectation?.manifest_embeds_raw_runtime_bodies === false) {
        expect(fieldPaths).toEqual([])
      }
    })
  }
})

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

function findFieldPaths(
  value: unknown,
  fieldNames: ReadonlySet<string>,
  path: readonly string[] = [],
): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      findFieldPaths(entry, fieldNames, [...path, String(index)]),
    )
  }
  if (!value || typeof value !== 'object') {
    return []
  }

  return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => {
    if (path[0] === 'redaction') {
      return []
    }
    const currentPath = [...path, key]
    const self = fieldNames.has(key) ? [currentPath.join('.')] : []
    return [...self, ...findFieldPaths(entry, fieldNames, currentPath)]
  })
}
