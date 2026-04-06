import { describe, it, expect } from 'vitest'
import { detectTransaction } from '../src/transaction.js'

import acpCompletedFixture from './fixtures/acp/checkout_session_completed.json'
import acpOrderCreateFixture from './fixtures/acp/order_create_event.json'
import acpOrderUpdateFixture from './fixtures/acp/order_update_event.json'
import ucpCompletedFixture from './fixtures/ucp/checkout_session_completed.json'

describe('detectTransaction', () => {
  describe('ACP detection', () => {
    it('detects a real ACP completed checkout session response', () => {
      // Source: rfc.agentic_checkout.md (POST /checkout_sessions/{id}/complete success response)
      const result = detectTransaction('checkout', acpCompletedFixture)
      expect(result).toMatchObject({
        detected: true,
        protocol: 'ACP',
        checkoutUrl: 'https://example.com/orders/ord_abc123',
      })
    })

    it('detects a real ACP order_create webhook event', () => {
      const result = detectTransaction('webhook', acpOrderCreateFixture)
      expect(result).toMatchObject({
        detected: true,
        protocol: 'ACP',
        checkoutUrl: 'https://www.testshop.com/orders/checkout_session_123',
      })
    })

    it('detects a real ACP order_update webhook event', () => {
      const result = detectTransaction('webhook', acpOrderUpdateFixture)
      expect(result).toMatchObject({
        detected: true,
        protocol: 'ACP',
        checkoutUrl: 'https://www.testshop.com/orders/checkout_session_123',
      })
    })

    it('does not detect a checkout session that is still incomplete', () => {
      const incomplete = { id: 'checkout_session_999', status: 'incomplete', order: null }
      // Use a non-heuristic tool name so we isolate the protocol detection path
      const result = detectTransaction('get_session', incomplete)
      expect(result.detected).toBe(false)
    })

    it('does not detect a completed checkout session without an order object', () => {
      const orderless = { id: 'checkout_session_999', status: 'completed' }
      const result = detectTransaction('get_session', orderless)
      expect(result.detected).toBe(false)
    })
  })

  describe('UCP detection', () => {
    it('detects a real UCP completed checkout session response', () => {
      // Source: ucp/docs/specification/checkout-rest.md (UCP version 2026-01-11)
      const result = detectTransaction('checkout', ucpCompletedFixture)
      expect(result).toMatchObject({
        detected: true,
        protocol: 'UCP',
        checkoutUrl: 'https://merchant.com/orders/ord_99887766',
      })
    })

    it('distinguishes UCP from ACP by the top-level ucp envelope', () => {
      const noEnvelope = { id: 'chk_x', status: 'completed', order: { id: 'ord_x' } }
      const withEnvelope = {
        ucp: { version: '2026-01-11', capabilities: [] },
        id: 'chk_x',
        status: 'completed',
        order: { id: 'ord_x' },
      }
      expect(detectTransaction('checkout', noEnvelope).protocol).toBe('ACP')
      expect(detectTransaction('checkout', withEnvelope).protocol).toBe('UCP')
    })
  })

  describe('x402 / MPP detection', () => {
    it('detects Payment-Receipt header (lowercase) as x402 by default', () => {
      const result = detectTransaction('api_call', {}, { 'payment-receipt': 'receipt123' })
      expect(result).toMatchObject({ detected: true, protocol: 'x402' })
    })

    it('detects Payment-Receipt header (mixed case) as x402 by default', () => {
      const result = detectTransaction('api_call', {}, { 'Payment-Receipt': 'receipt123' })
      expect(result).toMatchObject({ detected: true, protocol: 'x402' })
    })

    it('reports MPP when a Payment-Protocol marker is present', () => {
      const result = detectTransaction(
        'api_call',
        {},
        { 'payment-receipt': 'r', 'payment-protocol': 'mpp' },
      )
      expect(result.protocol).toBe('MPP')
    })
  })

  describe('AP2 detection', () => {
    it('detects W3C VC v2 array-form Payment Mandate credential', () => {
      // Per spec §1.7.5, `type` is an array
      const response = {
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        type: ['VerifiableCredential', 'PaymentMandateCredential'],
        credentialSubject: { 'io.atrib/context_id': 'abc' },
      }
      const result = detectTransaction('credential_tool', response)
      expect(result).toMatchObject({ detected: true, protocol: 'AP2' })
    })

    it('detects v1-style string type with PaymentMandate credentialSubject (legacy)', () => {
      const response = {
        type: 'VerifiableCredential',
        credentialSubject: { type: 'PaymentMandate' },
      }
      const result = detectTransaction('credential_tool', response)
      expect(result).toMatchObject({ detected: true, protocol: 'AP2' })
    })

    it('does not detect a non-PaymentMandate VC', () => {
      const response = {
        type: ['VerifiableCredential', 'IdentityCredential'],
        credentialSubject: { id: 'did:example:123' },
      }
      const result = detectTransaction('credential_tool', response)
      expect(result.detected).toBe(false)
    })
  })

  describe('heuristic detection', () => {
    it.each([
      'create_order',
      'complete_checkout',
      'process_payment',
      'place_order',
      'purchase_item',
      'checkout',
    ])('detects heuristic keyword: %s', (toolName) => {
      const result = detectTransaction(toolName, {})
      expect(result).toMatchObject({ detected: true, protocol: 'heuristic' })
    })

    it('is case-insensitive', () => {
      const result = detectTransaction('Complete_Checkout', {})
      expect(result).toMatchObject({ detected: true, protocol: 'heuristic' })
    })

    it('does not match non-transaction tools', () => {
      const result = detectTransaction('search_web', {})
      expect(result).toMatchObject({ detected: false, protocol: null })
    })
  })

  describe('priority', () => {
    it('protocol detection takes priority over heuristic', () => {
      // Tool name matches heuristic, but ACP completion shape is present
      const result = detectTransaction('checkout', acpCompletedFixture)
      expect(result.protocol).toBe('ACP')
    })
  })

  it('returns not detected for ordinary response', () => {
    const result = detectTransaction('search_web', { results: [] })
    expect(result).toMatchObject({ detected: false, protocol: null })
  })

  it('handles null/undefined response gracefully', () => {
    expect(detectTransaction('tool', null)).toMatchObject({ detected: false, protocol: null })
    expect(detectTransaction('tool', undefined)).toMatchObject({ detected: false, protocol: null })
  })
})
