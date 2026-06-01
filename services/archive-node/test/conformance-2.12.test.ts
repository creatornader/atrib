// SPDX-License-Identifier: Apache-2.0

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const corpusRoot = new URL('../../../spec/conformance/2.12/', import.meta.url)

describe('§2.12 archive conformance corpus', () => {
  it('keeps manifest cases aligned with on-disk case files', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('manifest.json', corpusRoot), 'utf8'),
    ) as { cases: Array<{ id: string; file: string }> }

    const declared = new Set(manifest.cases.map((c) => c.file))
    const actual = new Set(
      readdirSync(new URL('cases/', corpusRoot))
        .filter((name) => name.endsWith('.json'))
        .map((name) => `cases/${name}`),
    )

    expect(declared).toEqual(actual)
    for (const c of manifest.cases) {
      expect(c.id.length).toBeGreaterThan(0)
      expect(existsSync(new URL(c.file, corpusRoot))).toBe(true)
    }
  })
})
