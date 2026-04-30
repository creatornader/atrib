// Conformance tests against spec/conformance/6/ — verifies that
// resolveIdentity produces the verifier_output the corpus declares
// as expected.
//
// Per spec §6.5, every implementation that consumes the directory MUST
// pass these vectors. This test is the @atrib/verify reference
// implementation's pass.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveIdentity } from '../src/resolve-identity.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CORPUS = resolve(HERE, '../../../spec/conformance/6/cases')

interface ConformanceCase {
  name: string
  spec_section: string
  description: string
  input: {
    lookup_for_key: string
    published_claim?: unknown
  }
  expected: {
    directory_response: { status: number; body: unknown }
    verifier_output: {
      identity_resolved: unknown
      identity_resolution_method: string
      capability_envelope: unknown
      key_revocation_status: unknown
    }
  }
}

describe('spec §6 conformance corpus', () => {
  const files = readdirSync(CORPUS).filter((f) => f.endsWith('.json'))
  expect(files.length).toBeGreaterThan(0)

  for (const file of files) {
    it(`passes ${file}`, async () => {
      const c = JSON.parse(readFileSync(join(CORPUS, file), 'utf-8')) as ConformanceCase
      // Mock the fetch implementation to return exactly what the directory
      // would return per the case's directory_response. This isolates the
      // verifier output contract from network/AKD-bridge concerns.
      const fetchImpl = (async () => {
        return new Response(JSON.stringify(c.expected.directory_response.body), {
          status: c.expected.directory_response.status,
          headers: { 'content-type': 'application/json' },
        })
      }) as typeof fetch

      const result = await resolveIdentity(c.input.lookup_for_key, { fetchImpl })

      expect(result.identity_resolution_method, `case ${c.name}: method`)
        .toBe(c.expected.verifier_output.identity_resolution_method)
      expect(result.identity_resolved, `case ${c.name}: identity_resolved`)
        .toEqual(c.expected.verifier_output.identity_resolved)
      expect(result.capability_envelope, `case ${c.name}: capability_envelope`)
        .toEqual(c.expected.verifier_output.capability_envelope)
      expect(result.key_revocation_status, `case ${c.name}: key_revocation_status`)
        .toEqual(c.expected.verifier_output.key_revocation_status)
    })
  }
})
