/**
 * Transaction detection (§5.4.5).
 *
 * Detects transaction events from response shapes for ACP, UCP, x402, MPP,
 * AP2, and heuristic tool name matching.
 *
 * Protocol shape sources (verified 2026-04-06):
 * - ACP: github.com/agentic-commerce-protocol/agentic-commerce-protocol
 *        rfcs/rfc.agentic_checkout.md
 * - UCP: github.com/universal-commerce-protocol/ucp
 *        docs/specification/checkout-rest.md (version 2026-01-11)
 * - AP2: per spec §1.7.5 (verifiable credential with PaymentMandate type)
 * - x402: per spec §1.7.3 (HTTP 200 + Payment-Receipt header)
 * - MPP: per spec §1.7.4 (HTTP 200 + Payment-Receipt header, distinguished
 *        from x402 by Authorization: Payment scheme on the request side)
 */

export type TransactionProtocol = 'ACP' | 'UCP' | 'x402' | 'MPP' | 'AP2' | 'heuristic'

export interface TransactionDetection {
  detected: boolean
  protocol: TransactionProtocol | null
  /**
   * For Path 2 content_id derivation (§5.4.5):
   * - ACP/UCP: the order permalink URL from the response (if present)
   * - x402/MPP: not available here (caller must use HTTP endpoint URL)
   * - AP2: not available here (caller uses MCP server URL)
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

  // ACP / UCP completion response shape:
  //   { id: "...", status: "completed", order: { id, permalink_url? }, ... }
  // UCP additionally has a top-level `ucp: { version, capabilities }` envelope.
  // Both shapes are produced by POST /checkout_sessions/{id}/complete (ACP)
  // or POST /checkout-sessions/{id}/complete (UCP).
  if (resp) {
    const status = resp['status'] as string | undefined
    const order = resp['order'] as Record<string, unknown> | undefined
    if (status === 'completed' && order && typeof order['id'] === 'string') {
      const ucpEnvelope = resp['ucp'] as Record<string, unknown> | undefined
      const isUcp = !!ucpEnvelope && typeof ucpEnvelope['version'] === 'string'
      const checkoutUrl =
        typeof order['permalink_url'] === 'string' ? (order['permalink_url'] as string) : null
      return { detected: true, protocol: isUcp ? 'UCP' : 'ACP', checkoutUrl }
    }

    // ACP webhook event shapes (server → merchant): order_create / order_update.
    //   { type: "order_create", data: { type: "order", checkout_session_id, permalink_url, status, refunds } }
    if (resp['type'] === 'order_create' || resp['type'] === 'order_update') {
      const data = resp['data'] as Record<string, unknown> | undefined
      const checkoutUrl =
        typeof data?.['permalink_url'] === 'string' ? (data['permalink_url'] as string) : null
      return { detected: true, protocol: 'ACP', checkoutUrl }
    }
  }

  // x402 / MPP: HTTP 200 + Payment-Receipt header (§1.7.3, §1.7.4).
  // Both protocols use the same response header for the receipt; we
  // distinguish on the request side via Authorization: Payment for MPP.
  // In the response-only detection path here, we cannot reliably tell them
  // apart, so we report whichever signal is present and let the spec sort
  // it out. We default to x402 because it's the more common deployment.
  if (headers) {
    const receipt = headers['payment-receipt'] ?? headers['Payment-Receipt']
    if (receipt) {
      // If the response carries an MPP-specific scheme marker, prefer 'MPP';
      // otherwise default to 'x402'. The spec keeps these as separate event
      // protocols (§1.7.3 vs §1.7.4) but the on-wire detection signal is the
      // same header.
      const authScheme = headers['payment-protocol'] ?? headers['Payment-Protocol']
      const isMpp = typeof authScheme === 'string' && /mpp/i.test(authScheme)
      return { detected: true, protocol: isMpp ? 'MPP' : 'x402', checkoutUrl: null }
    }
  }

  // AP2: Payment Mandate Verifiable Credential (§1.7.5).
  // Per W3C VC Data Model v2, `type` is an array containing both
  // "VerifiableCredential" and a payment-specific type.
  // We accept both array form (v2, normative) and string form (v1, lenient
  // backward-compat), see DECISIONS.md for the rationale.
  if (resp) {
    const respType = resp['type']
    const credentialSubject = resp['credentialSubject'] as Record<string, unknown> | undefined
    const subjectType = credentialSubject?.['type']

    const isVcArray =
      Array.isArray(respType) &&
      respType.includes('VerifiableCredential') &&
      respType.some(
        (t) => typeof t === 'string' && /paymentmandate/i.test(t),
      )
    const isVcStringLegacy = respType === 'VerifiableCredential'

    const subjectIsPaymentMandate =
      (typeof subjectType === 'string' && /paymentmandate/i.test(subjectType)) ||
      (Array.isArray(subjectType) &&
        subjectType.some((t) => typeof t === 'string' && /paymentmandate/i.test(t)))

    if (isVcArray || (isVcStringLegacy && subjectIsPaymentMandate)) {
      return { detected: true, protocol: 'AP2', checkoutUrl: null }
    }
  }

  // Heuristic: tool name keywords (last resort)
  const lowerName = toolName.toLowerCase()
  if (HEURISTIC_KEYWORDS.some((k) => lowerName.includes(k))) {
    return { detected: true, protocol: 'heuristic', checkoutUrl: null }
  }

  return { detected: false, protocol: null, checkoutUrl: null }
}
