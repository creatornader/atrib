// SPDX-License-Identifier: Apache-2.0
import { expect, it } from 'vitest'
import {
  DECLARED_METHOD,
  evidenceBodySchemas,
  evaluationSchema,
  isEvidenceLocator,
  policySchema,
} from './source-bound-schemas.js'

it.each([
  'Bearer fixture',
  'bearer%20fixture',
  'BEARER%09fixture',
  '%42earer%20fixture',
  'https://example.test/items/bearer%20fixture',
  'bearer%20fixture%zz',
  '%42earer%20fixture%FF',
])('rejects a recognizable bearer locator %s', (value) => {
  expect(isEvidenceLocator(value)).toBe(false)
})

it.each([
  'artifacts/receipt%20one.json',
  'https://example.test/items/receipt%20one',
  'artifacts/100%complete.json',
  'artifacts/receipt%2.json',
])('accepts an encoded or literal percent retrieval hint %s', (value) => {
  expect(isEvidenceLocator(value)).toBe(true)
})

it('rejects observed_at on a declared source', () => {
  const id = { namespace: 'urn:test', id: 'request' }
  const body = {
    nonce: 'AAAAAAAAAAAAAAAAAAAAAA',
    subject: id,
    target: { record_hash: `sha256:${'0'.repeat(64)}` },
    assertion: { status: 'success', text: 'Reported success' },
    source: { kind: 'declared', identity: id, method: DECLARED_METHOD },
    basis: [],
  }
  expect(evidenceBodySchemas.report.safeParse(body).success).toBe(true)
  expect(
    evidenceBodySchemas.report.safeParse({
      ...body,
      source: { ...body.source, observed_at: 1 },
    }).success,
  ).toBe(false)
})

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
