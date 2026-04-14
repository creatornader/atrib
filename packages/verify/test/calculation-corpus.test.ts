// SPDX-License-Identifier: Apache-2.0

/**
 * Conformance test against the §4.6 calculation test vectors corpus.
 *
 * Consumes spec/conformance/4.6/calculation-vectors.json and verifies
 * that this implementation produces matching distributions.
 */

import { describe, it, expect } from 'vitest'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { calculate } from '../src/calculate.js'
import type { GraphResponse, PolicyDocument } from '../src/types.js'

interface CalcVector {
  name: string
  input: {
    graph: GraphResponse
    policy: PolicyDocument
  }
  expected: {
    distribution?: Record<string, number>
    sum?: number
    keys_sorted?: boolean
    distribution_properties?: Record<string, unknown>
  }
}

describe('§4.6 calculation conformance corpus', async () => {
  const corpusPath = join(
    fileURLToPath(import.meta.url),
    '../../../../spec/conformance/4.6/calculation-vectors.json',
  )
  const corpus = JSON.parse(await readFile(corpusPath, 'utf-8'))

  for (const vector of corpus.vectors as CalcVector[]) {
    describe(vector.name, () => {
      it('produces correct distribution', () => {
        const result = calculate(vector.input.graph, vector.input.policy)

        if (vector.expected.distribution !== undefined) {
          expect(result).toEqual(vector.expected.distribution)
        }

        if (vector.expected.sum !== undefined) {
          const sum = Object.values(result).reduce((a, b) => a + b, 0)
          expect(sum).toBeCloseTo(vector.expected.sum, 9)
        }

        if (vector.expected.keys_sorted) {
          const keys = Object.keys(result)
          expect(keys).toEqual([...keys].sort())
        }

        if (vector.expected.distribution_properties) {
          const props = vector.expected.distribution_properties
          for (const [key, value] of Object.entries(props)) {
            if (key.endsWith('_gte')) {
              const creatorKey = key.replace('_share_gte', '')
              expect(result[creatorKey]).toBeGreaterThanOrEqual(value as number)
            }
            if (key === 'sum_approx_1') {
              const sum = Object.values(result).reduce((a, b) => a + b, 0)
              expect(sum).toBeCloseTo(1.0, 9)
            }
          }
        }
      })
    })
  }
})
