// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { detectTransaction } from '../src/payments.js'
import type { TransactionDetector } from '../src/payments.js'

describe('@atrib/agent/payments', () => {
  it('exports the profile detector and its composable detector type', () => {
    const detector: TransactionDetector = detectTransaction
    expect(detector('checkout', { status: 'completed', order: { id: 'order-1' } })).toMatchObject({
      detected: true,
      protocol: 'ACP',
    })
  })
})
