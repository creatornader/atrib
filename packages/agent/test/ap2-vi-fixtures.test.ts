// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { detectTransaction } from '../src/transaction.js'

import autonomousAp2ViFixture from './fixtures/ap2/vi_autonomous_success_evidence.json'

describe('AP2 / VI fixture corpus', () => {
  it('detects the autonomous AP2 fixture by successful receipt only', () => {
    const result = detectTransaction('agent_payment', {
      'ap2.PaymentReceipt': autonomousAp2ViFixture.ap2.paymentReceipt,
    })

    expect(result.detected).toBe(true)
    expect(result.protocol).toBe('AP2')
  })
})
