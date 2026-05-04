// SPDX-License-Identifier: Apache-2.0

/**
 * Reference test for the spec §6.7 conformance corpus
 * (`spec/conformance/6.7/cases/`).
 *
 * Loads each case fixture, runs `verifyRecord` against the embedded record
 * with the embedded identity claim, and asserts the expected
 * `capability_check` annotation per spec §6.7.2 / §6.7.3. Conforming
 * third-party verifier implementations SHOULD load the same fixtures and
 * assert the same invariants.
 *
 * Generator: `packages/log-dev/scripts/generate-conformance-6.7.ts`.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AtribRecord } from '@atrib/mcp'
import {
  verifyRecord,
  type CapabilityCheckAnnotation,
  type ResolvedIdentityClaim,
} from '../src/verify-record.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CORPUS_ROOT = resolve(HERE, '../../../spec/conformance/6.7')

interface ConformanceCase {
  name: string
  spec_section: '6.7'
  description: string
  input: {
    record: AtribRecord
    identity_claim: ResolvedIdentityClaim
    signer_seed_hex: string
  }
  expected: {
    record_hash_hex: string
    capability_check: CapabilityCheckAnnotation
    verifier_signature_ok: boolean
    validator_should_accept: boolean
    valid_after_mismatch?: boolean
  }
}

function loadCase(name: string): ConformanceCase {
  const path = join(CORPUS_ROOT, 'cases', `${name}.json`)
  return JSON.parse(readFileSync(path, 'utf-8'))
}

async function runCase(name: string): Promise<void> {
  const fixture = loadCase(name)
  const result = await verifyRecord(fixture.input.record, {
    identityClaim: fixture.input.identity_claim,
  })

  expect(result.signatureOk).toBe(fixture.expected.verifier_signature_ok)
  expect(result.capability_check).toEqual(fixture.expected.capability_check)

  if (fixture.expected.valid_after_mismatch) {
    // §6.7.3: out-of-envelope is signal, not invalidation. valid stays true.
    expect(result.valid).toBe(true)
    expect(result.warnings).toEqual([])
  }
}

describe('spec §6.7 conformance corpus', () => {
  it('no-envelope-on-claim: claim has no capabilities → trivially in_envelope', async () => {
    await runCase('no-envelope-on-claim')
  })

  it('empty-envelope: capabilities: {} → trivially in_envelope per §6.7.1', async () => {
    await runCase('empty-envelope')
  })

  it('event-types-hit: record event_type in allowlist → in_envelope', async () => {
    await runCase('event-types-hit')
  })

  it('event-types-miss: record event_type not in allowlist → mismatch, but valid stays true (§6.7.3)', async () => {
    await runCase('event-types-miss')
  })

  it('expires-at-exceeded: record after envelope expiry → mismatch, but valid stays true', async () => {
    await runCase('expires-at-exceeded')
  })

  it('tool-names-unresolvable: tool_call + tool_names allowlist → unresolvable per §6.7.2 step 2', async () => {
    await runCase('tool-names-unresolvable')
  })

  it('transaction-amount-unresolvable: transaction + max_amount → unresolvable (no protocol-event access)', async () => {
    await runCase('transaction-amount-unresolvable')
  })
})
