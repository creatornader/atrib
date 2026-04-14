// SPDX-License-Identifier: Apache-2.0

/**
 * Transaction detection conformance corpus (Gap #8).
 *
 * Tests every payment protocol detection shape defined in §5.4.5 against
 * the canonical response shapes from the protocol specs. This is the
 * equivalent of the log's §2.6.1 conformance corpus but for the agent's
 * transaction detection.
 *
 * If a protocol spec changes its response shape, these tests break first.
 */

import { describe, it, expect } from 'vitest'
import { detectTransaction } from '../src/transaction.js'

// ─────────────────────────────────────────────────────────────────────────────
// ACP — Agentic Commerce Protocol (Stripe/OpenAI)
// ─────────────────────────────────────────────────────────────────────────────

describe('ACP detection corpus', () => {
  it('detects checkout session completion', () => {
    const response = {
      id: 'cs_test_123',
      status: 'completed',
      order: { id: 'order_456', permalink_url: 'https://merchant.com/orders/456' },
    }
    const result = detectTransaction('complete_checkout', response)
    expect(result.detected).toBe(true)
    expect(result.protocol).toBe('ACP')
    expect(result.checkoutUrl).toBe('https://merchant.com/orders/456')
  })

  it('detects order_create webhook event', () => {
    const response = {
      type: 'order_create',
      data: { type: 'order', checkout_session_id: 'cs_123', permalink_url: 'https://merchant.com/o/789', status: 'open', refunds: [] },
    }
    const result = detectTransaction('webhook_handler', response)
    expect(result.detected).toBe(true)
    expect(result.protocol).toBe('ACP')
    expect(result.checkoutUrl).toBe('https://merchant.com/o/789')
  })

  it('detects order_update webhook event', () => {
    const response = {
      type: 'order_update',
      data: { type: 'order', status: 'paid' },
    }
    const result = detectTransaction('webhook_handler', response)
    expect(result.detected).toBe(true)
    expect(result.protocol).toBe('ACP')
  })

  it('does not detect incomplete checkout', () => {
    const response = { id: 'cs_test_123', status: 'pending', order: { id: 'order_456' } }
    const result = detectTransaction('get_status', response)
    expect(result.detected).toBe(false)
  })

  it('does not detect missing order object', () => {
    const response = { id: 'cs_test_123', status: 'completed' }
    const result = detectTransaction('get_status', response)
    expect(result.detected).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// UCP — Universal Commerce Protocol (Google/Shopify)
// ─────────────────────────────────────────────────────────────────────────────

describe('UCP detection corpus', () => {
  it('detects UCP completion (ACP shape + ucp envelope)', () => {
    const response = {
      id: 'cs_ucp_1',
      status: 'completed',
      order: { id: 'order_ucp_1' },
      ucp: { version: '1.0', capabilities: [] },
    }
    const result = detectTransaction('checkout', response)
    expect(result.detected).toBe(true)
    expect(result.protocol).toBe('UCP')
  })

  it('ACP shape without ucp envelope is detected as ACP not UCP', () => {
    const response = {
      id: 'cs_1',
      status: 'completed',
      order: { id: 'order_1' },
    }
    const result = detectTransaction('checkout', response)
    expect(result.detected).toBe(true)
    expect(result.protocol).toBe('ACP')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// x402 — Coinbase
// ─────────────────────────────────────────────────────────────────────────────

describe('x402 detection corpus', () => {
  it('detects v2 PAYMENT-RESPONSE header', () => {
    const headers = { 'PAYMENT-RESPONSE': 'eyJzdWNjZXNzIjp0cnVlfQ==' }
    const result = detectTransaction('fetch_data', {}, headers)
    expect(result.detected).toBe(true)
    expect(result.protocol).toBe('x402')
  })

  it('detects v1 X-PAYMENT-RESPONSE header (legacy)', () => {
    const headers = { 'X-PAYMENT-RESPONSE': 'eyJzdWNjZXNzIjp0cnVlfQ==' }
    const result = detectTransaction('fetch_data', {}, headers)
    expect(result.detected).toBe(true)
    expect(result.protocol).toBe('x402')
  })

  it('detects case-insensitive header names', () => {
    const headers = { 'payment-response': 'eyJzdWNjZXNzIjp0cnVlfQ==' }
    const result = detectTransaction('fetch_data', {}, headers)
    expect(result.detected).toBe(true)
    expect(result.protocol).toBe('x402')
  })

  it('x402 takes precedence over MPP when both headers present', () => {
    const headers = {
      'PAYMENT-RESPONSE': 'x402-receipt',
      'Payment-Receipt': 'mpp-receipt',
    }
    const result = detectTransaction('fetch_data', {}, headers)
    expect(result.detected).toBe(true)
    expect(result.protocol).toBe('x402')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// MPP — Machine Payments Protocol (IETF draft)
// ─────────────────────────────────────────────────────────────────────────────

describe('MPP detection corpus', () => {
  it('detects Payment-Receipt header', () => {
    const headers = { 'Payment-Receipt': 'eyJzdGF0dXMiOiJzdWNjZXNzIn0' }
    const result = detectTransaction('paid_api_call', {}, headers)
    expect(result.detected).toBe(true)
    expect(result.protocol).toBe('MPP')
  })

  it('detects case-insensitive Payment-Receipt', () => {
    const headers = { 'payment-receipt': 'base64url-receipt-data' }
    const result = detectTransaction('api_call', {}, headers)
    expect(result.detected).toBe(true)
    expect(result.protocol).toBe('MPP')
  })

  it('does not detect without the header', () => {
    const headers = { 'Content-Type': 'application/json' }
    const result = detectTransaction('api_call', {}, headers)
    expect(result.detected).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AP2 — Agent Payments Protocol (Google)
// ─────────────────────────────────────────────────────────────────────────────

describe('AP2 detection corpus', () => {
  it('detects PaymentMandate in A2A DataPart', () => {
    const response = {
      parts: [
        { kind: 'data', data: { 'ap2.mandates.PaymentMandate': { amount: 100, currency: 'USD' } } },
      ],
    }
    const result = detectTransaction('agent_payment', response)
    expect(result.detected).toBe(true)
    expect(result.protocol).toBe('AP2')
  })

  it('does not detect IntentMandate (upstream funnel, not transaction)', () => {
    const response = {
      parts: [
        { kind: 'data', data: { 'ap2.mandates.IntentMandate': { intent: 'purchase' } } },
      ],
    }
    const result = detectTransaction('agent_intent', response)
    expect(result.detected).toBe(false)
  })

  it('does not detect CartMandate (upstream funnel)', () => {
    const response = {
      parts: [
        { kind: 'data', data: { 'ap2.mandates.CartMandate': { items: [] } } },
      ],
    }
    const result = detectTransaction('agent_cart', response)
    expect(result.detected).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// a2a-x402 — Google AP2 crypto path
// ─────────────────────────────────────────────────────────────────────────────

describe('a2a-x402 detection corpus', () => {
  it('detects payment-completed with successful receipt', () => {
    const response = {
      kind: 'task',
      status: {
        message: {
          metadata: {
            'x402.payment.status': 'payment-completed',
            'x402.payment.receipts': [
              { success: true, transaction: '0xabc', network: 'base' },
            ],
          },
        },
      },
    }
    const result = detectTransaction('a2a_task', response)
    expect(result.detected).toBe(true)
    expect(result.protocol).toBe('AP2') // a2a-x402 is the AP2 crypto path
  })

  it('does not detect when kind !== "task"', () => {
    const response = {
      kind: 'message',
      status: {
        message: {
          metadata: {
            'x402.payment.status': 'payment-completed',
            'x402.payment.receipts': [{ success: true }],
          },
        },
      },
    }
    const result = detectTransaction('a2a_msg', response)
    expect(result.detected).toBe(false)
  })

  it('does not detect when no receipts have success: true', () => {
    const response = {
      kind: 'task',
      status: {
        message: {
          metadata: {
            'x402.payment.status': 'payment-completed',
            'x402.payment.receipts': [{ success: false }],
          },
        },
      },
    }
    const result = detectTransaction('a2a_task', response)
    expect(result.detected).toBe(false)
  })

  it('does not detect payment-required (not completed)', () => {
    const response = {
      kind: 'task',
      status: {
        message: {
          metadata: {
            'x402.payment.status': 'payment-required',
          },
        },
      },
    }
    const result = detectTransaction('a2a_task', response)
    expect(result.detected).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Heuristic detection
// ─────────────────────────────────────────────────────────────────────────────

describe('heuristic detection corpus', () => {
  const keywords = [
    'create_order',
    'complete_checkout',
    'process_payment',
    'place_order',
    'purchase',
    'checkout',
  ]

  for (const keyword of keywords) {
    it(`detects tool name containing "${keyword}"`, () => {
      const result = detectTransaction(keyword, {})
      expect(result.detected).toBe(true)
      expect(result.protocol).toBe('heuristic')
    })
  }

  it('detects case-insensitive match', () => {
    const result = detectTransaction('Process_Payment', {})
    expect(result.detected).toBe(true)
    expect(result.protocol).toBe('heuristic')
  })

  it('does not detect unrelated tool names', () => {
    const result = detectTransaction('get_weather', {})
    expect(result.detected).toBe(false)
  })

  it('does not detect partial false matches', () => {
    const result = detectTransaction('check_output', {})
    // "check" is not "checkout"
    expect(result.detected).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Cross-protocol precedence
// ─────────────────────────────────────────────────────────────────────────────

describe('detection precedence', () => {
  it('ACP body takes precedence over heuristic tool name', () => {
    const response = { status: 'completed', order: { id: 'o1' } }
    const result = detectTransaction('checkout', response)
    expect(result.protocol).toBe('ACP')
  })

  it('x402 header takes precedence over heuristic', () => {
    const headers = { 'PAYMENT-RESPONSE': 'receipt' }
    const result = detectTransaction('purchase', {}, headers)
    expect(result.protocol).toBe('x402')
  })

  it('null response and no headers falls back to heuristic', () => {
    const result = detectTransaction('create_order', null)
    expect(result.detected).toBe(true)
    expect(result.protocol).toBe('heuristic')
  })
})
