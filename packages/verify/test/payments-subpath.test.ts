// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  calculate,
  verifyAp2ViEvidence,
  verifySettlementRecommendation,
} from '../src/payments.js'

describe('@atrib/verify/payments', () => {
  it('exports settlement verification, calculation, and AP2/VI checks', () => {
    expect(verifySettlementRecommendation).toBeTypeOf('function')
    expect(calculate).toBeTypeOf('function')
    expect(verifyAp2ViEvidence).toBeTypeOf('function')
  })
})
