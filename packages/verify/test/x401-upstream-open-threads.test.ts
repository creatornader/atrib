// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const fixturePath = fileURLToPath(
  new URL('../../../spec/conformance/5.5.6/x401/upstream-open-threads.json', import.meta.url),
)

describe('x401 upstream-open thread boundaries', () => {
  it('keeps unresolved Proof semantics documented as caller-owned boundaries', () => {
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
      checked_on: string
      threads: Array<{
        id: string
        status: string
        atrib_boundary: string
        local_fixture: string
      }>
    }

    expect(fixture.checked_on).toBe('2026-07-02')
    expect(fixture.threads.map((thread) => thread.id).sort()).toEqual([
      'proof/x401#17',
      'proof/x401#19',
      'proof/x401#22',
      'proof/x401#29',
      'proof/x401#32',
    ])
    for (const thread of fixture.threads) {
      expect(thread.status).toBe('open')
      expect(thread.atrib_boundary.length).toBeGreaterThan(80)
      expect(thread.local_fixture).toMatch(/^(packages|spec)\//)
    }
  })
})
