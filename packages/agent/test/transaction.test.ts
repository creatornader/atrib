import { describe, it, expect } from 'vitest'
import { detectTransaction } from '../src/transaction.js'

describe('detectTransaction', () => {
  describe('ACP/UCP detection', () => {
    it('detects checkout_session in response', () => {
      const response = { data: { object: { object: 'checkout_session' } } }
      const result = detectTransaction('process_tool', response)
      expect(result).toMatchObject({ detected: true, protocol: 'ACP/UCP' })
    })

    it('detects order.created type', () => {
      const response = { type: 'order.created' }
      const result = detectTransaction('webhook', response)
      expect(result).toMatchObject({ detected: true, protocol: 'ACP/UCP' })
    })

    it('detects ORDER_CREATED event_type', () => {
      const response = { event_type: 'ORDER_CREATED' }
      const result = detectTransaction('webhook', response)
      expect(result).toMatchObject({ detected: true, protocol: 'ACP/UCP' })
    })
  })

  describe('x402/MPP detection', () => {
    it('detects Payment-Receipt header (lowercase)', () => {
      const result = detectTransaction('api_call', {}, { 'payment-receipt': 'receipt123' })
      expect(result).toMatchObject({ detected: true, protocol: 'x402/MPP' })
    })

    it('detects Payment-Receipt header (mixed case)', () => {
      const result = detectTransaction('api_call', {}, { 'Payment-Receipt': 'receipt123' })
      expect(result).toMatchObject({ detected: true, protocol: 'x402/MPP' })
    })
  })

  describe('AP2 detection', () => {
    it('detects PaymentMandate VDC', () => {
      const response = {
        type: 'VerifiableCredential',
        credentialSubject: { type: 'PaymentMandate' },
      }
      const result = detectTransaction('credential_tool', response)
      expect(result).toMatchObject({ detected: true, protocol: 'AP2' })
    })

    it('does not detect non-PaymentMandate VDC', () => {
      const response = {
        type: 'VerifiableCredential',
        credentialSubject: { type: 'IdentityCredential' },
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
      // Tool name matches heuristic, but ACP/UCP signal is present
      const response = { data: { object: { object: 'checkout_session' } } }
      const result = detectTransaction('checkout', response)
      expect(result.protocol).toBe('ACP/UCP')
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
