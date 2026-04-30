// Conformance tests against spec/conformance/1.9/ — verifies that
// buildRevocationRegistry + applyRevocation produce the verification
// states the corpus declares as expected.
//
// Per spec §1.9.4, every implementation that processes key_revocation
// records MUST pass these vectors. This test is the @atrib/verify
// reference implementation's pass.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildRevocationRegistry, applyRevocation } from '../src/revocations.js'
import type { MinimalRecord } from '../src/revocations.js'
import type { VerificationState } from '../src/types.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CORPUS = resolve(HERE, '../../../spec/conformance/1.9/cases')

interface ConformanceCase {
  name: string
  spec_section: string
  description: string
  input: {
    log_entries: { log_index: number; record: MinimalRecord }[]
  }
  expected: {
    verification_states: Record<string, string>
  }
}

describe('spec §1.9 conformance corpus', () => {
  const files = readdirSync(CORPUS).filter((f) => f.endsWith('.json'))
  expect(files.length).toBeGreaterThan(0)

  for (const file of files) {
    it(`passes ${file}`, () => {
      const c = JSON.parse(readFileSync(join(CORPUS, file), 'utf-8')) as ConformanceCase
      const minimal: MinimalRecord[] = c.input.log_entries.map(({ log_index, record }) => ({
        ...record,
        log_index,
      }))
      const registry = buildRevocationRegistry(minimal)

      for (const entry of c.input.log_entries) {
        const idxStr = String(entry.log_index)
        const expected = c.expected.verification_states[idxStr]
        if (!expected) continue
        // Each entry starts as signature_valid (we assume the corpus signed
        // them validly; the conformance check is the revocation transition).
        const node = {
          creator_key: entry.record.creator_key ?? null,
          log_index: entry.log_index,
          verification_state: 'signature_valid' as VerificationState,
        }
        const actual = applyRevocation(node, registry)
        expect(actual, `case ${c.name}, log_index ${idxStr}`).toBe(expected)
      }
    })
  }
})
