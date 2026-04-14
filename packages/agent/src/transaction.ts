// SPDX-License-Identifier: Apache-2.0

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
 * - AP2: github.com/google-agentic-commerce/ap2 (v0.1) — A2A Message with a
 *        DataPart containing the key `ap2.mandates.PaymentMandate`. AP2 does
 *        NOT currently use W3C Verifiable Credentials despite earlier drafts
 *        of this code and the Atrib spec assuming it would.
 * - a2a-x402: github.com/google-agentic-commerce/a2a-x402 — extension that
 *        layers x402 crypto payments over A2A. Detection signal is
 *        `status.message.metadata["x402.payment.status"] === "payment-completed"`
 *        with at least one `success: true` entry in
 *        `status.message.metadata["x402.payment.receipts"]`. Both shapes are
 *        reported as `protocol: 'AP2'` since a2a-x402 IS the AP2 crypto path.
 * - x402: github.com/coinbase/x402 — response header `PAYMENT-RESPONSE` (v2)
 *        or `X-PAYMENT-RESPONSE` (v1 legacy). Value is base64-encoded JSON
 *        with shape { success: bool, transaction, network, payer, requirements }.
 * - MPP: IETF draft-ryan-httpauth-payment-01 ("The 'Payment' HTTP Authentication
 *        Scheme"), per Section 5.3. Response header is `Payment-Receipt` on a
 *        200 success after the client retries with Authorization: Payment.
 *        Value is base64url-nopad JSON with required field { status: "success",
 *        method, timestamp, reference }.
 *
 * x402 and MPP are DIFFERENT protocols that use DIFFERENT headers. Earlier
 * versions of this code conflated them on a fictitious shared `Payment-Receipt`
 * header — see DECISIONS.md D016 for the verification trail.
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

  // x402 and MPP: distinct protocols, distinct response headers.
  //
  //   x402 v2  →  PAYMENT-RESPONSE       (renamed from v1 X-PAYMENT-RESPONSE)
  //   MPP      →  Payment-Receipt        (per draft-ryan-httpauth-payment-01 §5.3)
  //
  // HTTP header names are case-insensitive per RFC 7230, so we accept any
  // letter casing. JS object keys are not case-insensitive, so we lower-case
  // the lookup table once and probe by lowercase key.
  if (headers) {
    const lower: Record<string, string | undefined> = {}
    for (const [k, v] of Object.entries(headers)) {
      if (typeof v === 'string') lower[k.toLowerCase()] = v
    }
    // x402 — accept v2 and v1 names
    if (lower['payment-response'] || lower['x-payment-response']) {
      return { detected: true, protocol: 'x402', checkoutUrl: null }
    }
    // MPP — IETF draft Payment-Receipt header
    if (lower['payment-receipt']) {
      return { detected: true, protocol: 'MPP', checkoutUrl: null }
    }
  }

  // AP2 v0.1 — PaymentMandate Message inside an A2A DataPart.
  // Source: github.com/google-agentic-commerce/ap2 docs/specification.md
  // Shape: { ..., parts: [{ kind: "data", data: { "ap2.mandates.PaymentMandate": {...} } }, ...] }
  if (resp) {
    const parts = resp['parts']
    if (Array.isArray(parts)) {
      for (const part of parts) {
        if (part && typeof part === 'object') {
          const data = (part as Record<string, unknown>)['data']
          if (
            data &&
            typeof data === 'object' &&
            'ap2.mandates.PaymentMandate' in (data as Record<string, unknown>)
          ) {
            return { detected: true, protocol: 'AP2', checkoutUrl: null }
          }
        }
      }
    }

    // a2a-x402 extension — payment-completed via A2A task status metadata.
    // Source: github.com/google-agentic-commerce/a2a-x402 spec/v0.1/spec.md
    // Shape: { kind: "task", status: { message: { metadata: { "x402.payment.status": "payment-completed", "x402.payment.receipts": [{success, transaction, ...}] } } } }
    const status = resp['status'] as Record<string, unknown> | undefined
    const statusMessage = status?.['message'] as Record<string, unknown> | undefined
    const metadata = statusMessage?.['metadata'] as Record<string, unknown> | undefined
    if (metadata && metadata['x402.payment.status'] === 'payment-completed') {
      const receipts = metadata['x402.payment.receipts']
      if (
        Array.isArray(receipts) &&
        receipts.some(
          (r) =>
            r !== null &&
            typeof r === 'object' &&
            (r as Record<string, unknown>)['success'] === true,
        )
      ) {
        return { detected: true, protocol: 'AP2', checkoutUrl: null }
      }
    }

    // Legacy: W3C Verifiable Credential PaymentMandate. AP2 v0.1 does NOT use
    // VCs, but research forks and earlier drafts may. Kept as a backward-
    // compatible fallback. Accepts both VC v2 array form and v1 string form.
    const respType = resp['type']
    const credentialSubject = resp['credentialSubject'] as Record<string, unknown> | undefined
    const subjectType = credentialSubject?.['type']

    const isVcArray =
      Array.isArray(respType) &&
      respType.includes('VerifiableCredential') &&
      respType.some((t) => typeof t === 'string' && /paymentmandate/i.test(t))
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
