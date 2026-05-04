// SPDX-License-Identifier: Apache-2.0

/**
 * Reference test for the spec §8.2 conformance corpus
 * (`spec/conformance/8.2/cases/`).
 *
 * Loads each case fixture, runs `verifyRecord` against the embedded record,
 * and asserts the expected `tool_name_form` per spec §8.2 / D061.
 * Conforming third-party verifier implementations SHOULD load the same
 * fixtures and assert the same invariants.
 *
 * Generator: `packages/log-dev/scripts/generate-conformance-8.2.ts`.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AtribRecord } from '@atrib/mcp'
import { canonicalSigningInput } from '@atrib/mcp'
import { verifyRecord } from '../src/verify-record.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CORPUS_ROOT = resolve(HERE, '../../../spec/conformance/8.2')

interface ConformanceCase {
  name: string
  spec_section: '8.2'
  description: string
  input: { record: AtribRecord; signer_seed_hex: string }
  expected: {
    canonical_signing_input_utf8: string
    tool_name_in_canonical_form: boolean
    record_hash_hex: string
    verifier_signature_ok: boolean
    validator_should_accept: boolean
    tool_name_form: 'hashed' | 'plain' | null
  }
}

function loadCase(name: string): ConformanceCase {
  const path = join(CORPUS_ROOT, 'cases', `${name}.json`)
  return JSON.parse(readFileSync(path, 'utf-8'))
}

async function runCase(name: string): Promise<void> {
  const fixture = loadCase(name)
  const result = await verifyRecord(fixture.input.record)

  expect(result.signatureOk).toBe(fixture.expected.verifier_signature_ok)
  expect(result.posture.tool_name_form).toBe(fixture.expected.tool_name_form)

  const signingInput = new TextDecoder().decode(canonicalSigningInput(fixture.input.record))
  expect(signingInput).toBe(fixture.expected.canonical_signing_input_utf8)
  expect(signingInput.includes('"tool_name"')).toBe(fixture.expected.tool_name_in_canonical_form)
}

describe('spec §8.2 conformance corpus', () => {
  it('tool-name-omitted: field absent → tool_name_form: null', async () => {
    await runCase('tool-name-omitted')
  })

  it('tool-name-verbatim: book_flight → tool_name_form: "plain"', async () => {
    await runCase('tool-name-verbatim')
  })

  it('tool-name-opaque: tool_a7f3 → tool_name_form: "plain" (same surface as verbatim per D061)', async () => {
    await runCase('tool-name-opaque')
  })

  it('tool-name-hashed: sha256:<hex> → tool_name_form: "hashed"', async () => {
    await runCase('tool-name-hashed')
  })
})
