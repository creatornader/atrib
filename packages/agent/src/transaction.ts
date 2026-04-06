/**
 * Transaction detection (§5.4.5).
 *
 * Detects transaction events from response shapes for ACP/UCP, x402/MPP,
 * AP2, and heuristic tool name matching.
 */

export interface TransactionDetection {
  detected: boolean
  protocol: 'ACP/UCP' | 'x402/MPP' | 'AP2' | 'heuristic' | null
  /**
   * For Path 2 content_id derivation (§5.4.5):
   * - ACP/UCP: the checkout session URL from the response
   * - x402/MPP: not available here (caller must use HTTP endpoint URL)
   * - Heuristic: not available here (caller uses MCP server URL)
   */
  checkoutUrl: string | null
}

const HEURISTIC_KEYWORDS = [
  'create_order',
  'complete_checkout',
  'process_payment',
  'place_order',
  'purchase',
  'checkout',
]

/**
 * Detect whether a tool call response contains a transaction signal (§5.4.5).
 */
export function detectTransaction(
  toolName: string,
  response: unknown,
  headers?: Record<string, string | undefined>,
): TransactionDetection {
  const resp = response as Record<string, unknown> | null | undefined

  // ACP / UCP: checkout_session or order.created
  if (resp) {
    const data = resp.data as Record<string, unknown> | undefined
    const dataObj = data?.object as Record<string, unknown> | undefined
    if (dataObj?.object === 'checkout_session') {
      // Extract checkout URL from response for content_id derivation
      const checkoutUrl = (typeof data?.url === 'string' ? data.url : null) as string | null
      return { detected: true, protocol: 'ACP/UCP', checkoutUrl }
    }
    if (resp.type === 'order.created' || resp.event_type === 'ORDER_CREATED') {
      return { detected: true, protocol: 'ACP/UCP', checkoutUrl: null }
    }
  }

  // x402 / MPP: Payment-Receipt header
  if (headers) {
    if (headers['payment-receipt'] || headers['Payment-Receipt']) {
      return { detected: true, protocol: 'x402/MPP', checkoutUrl: null }
    }
  }

  // AP2: Payment Mandate VDC
  if (resp) {
    if (
      resp.type === 'VerifiableCredential' &&
      (resp.credentialSubject as Record<string, unknown> | undefined)?.type === 'PaymentMandate'
    ) {
      return { detected: true, protocol: 'AP2', checkoutUrl: null }
    }
  }

  // Heuristic: tool name keywords (last resort)
  const lowerName = toolName.toLowerCase()
  if (HEURISTIC_KEYWORDS.some(k => lowerName.includes(k))) {
    return { detected: true, protocol: 'heuristic', checkoutUrl: null }
  }

  return { detected: false, protocol: null, checkoutUrl: null }
}
