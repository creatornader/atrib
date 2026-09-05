// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  calculate,
  inspectMppHttpReceiptHeader,
  inspectMppMcpResult,
  verifyAp2ViEvidence,
  verifySettlementRecommendation,
} from '../src/payments.js'

describe('@atrib/verify/payments', () => {
  it('exports settlement, AP2/VI, and MPP evidence helpers', () => {
    expect(verifySettlementRecommendation).toBeTypeOf('function')
    expect(calculate).toBeTypeOf('function')
    expect(verifyAp2ViEvidence).toBeTypeOf('function')
    expect(inspectMppHttpReceiptHeader).toBeTypeOf('function')
    expect(inspectMppMcpResult).toBeTypeOf('function')
  })
})
