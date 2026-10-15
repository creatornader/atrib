// SPDX-License-Identifier: Apache-2.0
import { expect, it } from 'vitest'
import { evidenceBodySchemas, evaluationSchema, policySchema } from './source-bound-schemas.js'

it('rejects a capture with invented target and a historical evaluation without dispatch', () => {
  const id = { namespace: 'urn:test', id: 'message' }
  const value = {
    nonce: 'AAAAAAAAAAAAAAAAAAAAAA',
    subject: id,
    assertion: { phase: 'capture', occurrence: id, artifact_hash: `sha256:${'0'.repeat(64)}` },
    source: { kind: 'boundary', identity: id, method: 'urn:test:source', observed_at: 1 },
    basis: [{ relation: 'source', kind: 'artifact', hash: `sha256:${'0'.repeat(64)}` }],
  }
  expect(evidenceBodySchemas.observation.safeParse(value).success).toBe(true)
  expect(
    evidenceBodySchemas.observation.safeParse({
      ...value,
      target: { record_hash: `sha256:${'0'.repeat(64)}` },
    }).success,
  ).toBe(false)
  expect(evaluationSchema.safeParse({ purpose: 'historical', evaluated_at: 1 }).success).toBe(false)
  expect(
    policySchema.safeParse({ id: 'empty', rules: [], required: ['source', 'source'] }).success,
  ).toBe(false)
})
