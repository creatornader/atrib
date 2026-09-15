// SPDX-License-Identifier: Apache-2.0

/**
 * Transaction detection (§5.4.5).
 *
 * Detects transaction events from response shapes for ACP, UCP, x402, MPP,
 * AP2, and the a2a-x402 extension. A caller may still provide a custom
 * heuristic detector, but the default detector requires published completion
 * evidence.
 *
 * Protocol shape sources (verified 2026-09-02 against current upstream sources):
 * - ACP: github.com/agentic-commerce-protocol/agentic-commerce-protocol
 *        rfcs/rfc.agentic_checkout.md
 * - UCP: github.com/Universal-Commerce-Protocol/ucp
 *        v2026-08-25 checkout response and schema
 * - AP2: github.com/google-agentic-commerce/AP2 (v0.2). Current AP2 uses
 *        SD-JWT Mandates for authorization and signed CheckoutReceipt /
 *        PaymentReceipt JWTs for acceptance. Detection fires on successful
 *        receipt shapes, not mandate-only payloads. Mandates, including the
 *        legacy v0.1 A2A DataPart form, are authorization inputs and never
 *        completion signals.
 * - a2a-x402: github.com/google-agentic-commerce/a2a-x402. extension that
 *        layers x402 crypto payments over A2A. Detection signal is
 *        `status.message.metadata["x402.payment.status"] === "payment-completed"`
 *        with at least one `success: true` entry in
 *        `status.message.metadata["x402.payment.receipts"]`. Both shapes are
 *        reported as `protocol: 'a2a-x402'` so the extension identity is
 *        preserved in emitted observations.
 * - x402: github.com/x402-foundation/x402. response header `PAYMENT-RESPONSE` (v2)
 *        or `X-PAYMENT-RESPONSE` (v1 legacy). Value is base64-encoded JSON
 *        with shape { success: bool, transaction, network, payer, requirements }.
 * - MPP: IETF draft-ryan-httpauth-payment-01 ("The 'Payment' HTTP Authentication
 *        Scheme"), per Section 5.3. Response header is `Payment-Receipt` on a
 *        200 success after the client retries with Authorization: Payment.
 *        MCP carries the native receipt object at result._meta under
 *        `org.paymentauth/receipt`.
 *
 * x402 and MPP are different protocols that use different headers. Earlier
 * versions of this code conflated them on a fictitious shared `Payment-Receipt`
 * header. see DECISIONS.md D016 for the verification trail.
 */

import canonicalize from 'canonicalize'
import { hexEncode, sha256 } from '@atrib/mcp'

export type TransactionProtocol = 'ACP' | 'UCP' | 'x402' | 'MPP' | 'AP2' | 'a2a-x402' | 'heuristic'

export interface TransactionDetection {
  detected: boolean
  protocol: TransactionProtocol | null
  /**
   * For Path 2 content_id derivation (§5.4.5):
   * - ACP/UCP: the order permalink URL from the response (if present)
   * - x402/MPP: not available here (caller must use HTTP endpoint URL)
   * - AP2/a2a-x402: usually null because receipt identity is carried in
   *   `contentId`
   * - Heuristic: not available here (caller uses MCP server URL)
   */
  checkoutUrl: string | null
  /**
   * Optional protocol-specific content_id. AP2, a2a-x402, and MPP MCP can
   * expose stable receipt identifiers directly in the response; the detector
   * hashes the identity and returns the final content_id here. Null means the
   * caller should keep the generic §5.4.5 fallback.
   */
  contentId: string | null
}

/** One caller-composable payment detector from the payments profile. */
export type TransactionDetector = (
  toolName: string,
  response: unknown,
  headers?: Record<string, string | undefined>,
) => TransactionDetection

const AP2_PAYMENT_RECEIPT_KEYS = ['ap2.PaymentReceipt', 'payment_receipt'] as const
const AP2_CHECKOUT_RECEIPT_KEYS = ['ap2.CheckoutReceipt', 'checkout_receipt'] as const
const AP2_RECEIPT_SCAN_LIMIT = 80
const textEncoder = new TextEncoder()

interface Ap2ContentIdCandidate {
  contentId: string
  priority: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function detection(
  protocol: TransactionProtocol,
  checkoutUrl: string | null = null,
  contentId: string | null = null,
): TransactionDetection {
  return { detected: true, protocol, checkoutUrl, contentId }
}

function noDetection(): TransactionDetection {
  return { detected: false, protocol: null, checkoutUrl: null, contentId: null }
}

function sha256Utf8(value: string): string {
  return `sha256:${hexEncode(sha256(textEncoder.encode(value)))}`
}

function ap2ContentId(source: string, fields: Record<string, string>): string | null {
  const canonical = canonicalize({
    protocol: 'AP2',
    version: 1,
    source,
    fields,
  })
  if (!canonical) return null
  return sha256Utf8(canonical)
}

function hasAp2SuccessStatus(record: Record<string, unknown>): boolean {
  return record['status'] === 'Success' || record['status'] === 'success'
}

function looksLikeCompactJwt(value: unknown): value is string {
  return isNonEmptyString(value) && value.split('.').length === 3
}

function isAp2PaymentReceiptObject(value: unknown): boolean {
  if (!isRecord(value)) return false
  return (
    value['status'] === 'Success' &&
    isString(value['iss']) &&
    typeof value['iat'] === 'number' &&
    isNonEmptyString(value['reference']) &&
    isNonEmptyString(value['payment_id']) &&
    isNonEmptyString(value['psp_confirmation_id']) &&
    isNonEmptyString(value['network_confirmation_id'])
  )
}

function isAp2CheckoutReceiptObject(value: unknown): boolean {
  if (!isRecord(value)) return false
  return (
    value['status'] === 'Success' &&
    isString(value['iss']) &&
    typeof value['iat'] === 'number' &&
    isNonEmptyString(value['reference']) &&
    isNonEmptyString(value['order_id'])
  )
}

function ap2PaymentReceiptCandidate(value: unknown): Ap2ContentIdCandidate | null {
  if (!isAp2PaymentReceiptObject(value) || !isRecord(value)) return null
  const contentId = ap2ContentId('payment_receipt', {
    iss: value['iss'] as string,
    reference: value['reference'] as string,
    payment_id: value['payment_id'] as string,
    psp_confirmation_id: value['psp_confirmation_id'] as string,
    network_confirmation_id: value['network_confirmation_id'] as string,
  })
  return contentId ? { contentId, priority: 10 } : null
}

function ap2CheckoutReceiptCandidate(value: unknown): Ap2ContentIdCandidate | null {
  if (!isAp2CheckoutReceiptObject(value) || !isRecord(value)) return null
  const contentId = ap2ContentId('checkout_receipt', {
    iss: value['iss'] as string,
    reference: value['reference'] as string,
    order_id: value['order_id'] as string,
  })
  return contentId ? { contentId, priority: 30 } : null
}

function ap2ReceiptJwtCandidate(
  value: unknown,
  source: 'payment_receipt_jwt' | 'checkout_receipt_jwt',
): Ap2ContentIdCandidate | null {
  if (!looksLikeCompactJwt(value)) return null
  const contentId = ap2ContentId(source, { jwt_hash: sha256Utf8(value) })
  if (!contentId) return null
  return { contentId, priority: source === 'payment_receipt_jwt' ? 20 : 40 }
}

function ap2ReceiptFieldCandidate(
  record: Record<string, unknown>,
  keys: readonly string[],
  objectCandidate: (value: unknown) => Ap2ContentIdCandidate | null,
  jwtSource: 'payment_receipt_jwt' | 'checkout_receipt_jwt',
): Ap2ContentIdCandidate | null {
  for (const key of keys) {
    const value = record[key]
    const object = objectCandidate(value)
    if (object) return object
    if (hasAp2SuccessStatus(record)) {
      const jwt = ap2ReceiptJwtCandidate(value, jwtSource)
      if (jwt) return jwt
    }
  }
  return null
}

function chooseBetterAp2Candidate(
  current: Ap2ContentIdCandidate | null,
  candidate: Ap2ContentIdCandidate | null,
): Ap2ContentIdCandidate | null {
  if (!candidate) return current
  if (!current || candidate.priority < current.priority) return candidate
  return current
}

function findAp2V02ReceiptContentId(value: unknown): string | null {
  const queue: unknown[] = [value]
  const seen = new Set<object>()
  let scanned = 0
  let best: Ap2ContentIdCandidate | null = null

  while (queue.length > 0 && scanned < AP2_RECEIPT_SCAN_LIMIT) {
    const current = queue.shift()
    scanned += 1

    if (Array.isArray(current)) {
      for (const item of current) queue.push(item)
      continue
    }
    if (!isRecord(current)) continue
    if (seen.has(current)) continue
    seen.add(current)

    best = chooseBetterAp2Candidate(best, ap2PaymentReceiptCandidate(current))
    best = chooseBetterAp2Candidate(best, ap2CheckoutReceiptCandidate(current))
    best = chooseBetterAp2Candidate(
      best,
      ap2ReceiptFieldCandidate(
        current,
        AP2_PAYMENT_RECEIPT_KEYS,
        ap2PaymentReceiptCandidate,
        'payment_receipt_jwt',
      ),
    )
    best = chooseBetterAp2Candidate(
      best,
      ap2ReceiptFieldCandidate(
        current,
        AP2_CHECKOUT_RECEIPT_KEYS,
        ap2CheckoutReceiptCandidate,
        'checkout_receipt_jwt',
      ),
    )

    for (const nested of Object.values(current)) {
      if (isRecord(nested) || Array.isArray(nested)) queue.push(nested)
    }
  }

  return best?.contentId ?? null
}

function a2aX402ContentId(receipts: unknown): string | null {
  if (!Array.isArray(receipts)) return null
  for (const receipt of receipts) {
    if (!isRecord(receipt) || receipt['success'] !== true) continue
    const transaction = receipt['transaction']
    if (!isNonEmptyString(transaction)) continue
    const fields: Record<string, string> = { transaction }
    if (isNonEmptyString(receipt['network'])) fields['network'] = receipt['network']
    if (isNonEmptyString(receipt['payer'])) fields['payer'] = receipt['payer']
    const canonical = canonicalize({
      protocol: 'a2a-x402',
      version: 1,
      source: 'x402_receipt',
      fields,
    })
    return canonical ? sha256Utf8(canonical) : null
  }
  return null
}

interface MppMcpReceipt {
  method: string
  timestamp: string
  challengeId: string
  reference?: string
}

const RFC3339_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

function isMppMcpReceipt(value: unknown): value is MppMcpReceipt {
  if (!isRecord(value)) return false
  if (value['status'] !== 'success') return false
  if (!isNonEmptyString(value['method']) || !isNonEmptyString(value['challengeId'])) return false
  if (
    !isNonEmptyString(value['timestamp']) ||
    !RFC3339_TIMESTAMP.test(value['timestamp']) ||
    Number.isNaN(Date.parse(value['timestamp']))
  ) {
    return false
  }
  return value['reference'] === undefined || isNonEmptyString(value['reference'])
}

function mppMcpContentId(receipt: MppMcpReceipt): string | null {
  const fields: Record<string, string> = {
    method: receipt.method,
    challenge_id: receipt.challengeId,
    timestamp: receipt.timestamp,
  }
  if (receipt.reference !== undefined) fields['reference'] = receipt.reference
  const canonical = canonicalize({
    protocol: 'MPP',
    version: 1,
    source: 'mcp_receipt',
    fields,
  })
  return canonical ? sha256Utf8(canonical) : null
}

function findMppMcpReceipt(response: Record<string, unknown>): MppMcpReceipt | null {
  const metadataCandidates: Record<string, unknown>[] = []
  if (isRecord(response['_meta'])) metadataCandidates.push(response['_meta'])
  const nestedResult = response['result']
  if (isRecord(nestedResult) && isRecord(nestedResult['_meta'])) {
    metadataCandidates.push(nestedResult['_meta'])
  }
  for (const metadata of metadataCandidates) {
    const receipt = metadata['org.paymentauth/receipt']
    if (isMppMcpReceipt(receipt)) return receipt
  }
  return null
}

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
  // UCP also has a top-level `ucp` envelope with a versioned metadata
  // object, including capability and payment-handler maps in v2026-08-25.
  // Both shapes are produced by POST /checkout_sessions/{id}/complete (ACP)
  // or POST /checkout-sessions/{id}/complete (UCP).
  if (resp) {
    const status = resp['status'] as string | undefined
    const order = resp['order'] as Record<string, unknown> | undefined
    const ucpEnvelope = resp['ucp'] as Record<string, unknown> | undefined
    const isUcp = !!ucpEnvelope && typeof ucpEnvelope['version'] === 'string'
    if (status === 'completed' && order && isNonEmptyString(order['id'])) {
      const checkoutUrl =
        typeof order['permalink_url'] === 'string' ? (order['permalink_url'] as string) : null
      return detection(isUcp ? 'UCP' : 'ACP', checkoutUrl)
    }

    // A recognized UCP response owns the checkout classification decision.
    // In particular, v2026-08-25 uses `complete_in_progress` for asynchronous
    // completion before an order exists. Do not let a generic tool-name
    // heuristic turn that nonterminal response into a transaction.
    if (isUcp) return noDetection()

    // ACP webhook events are lifecycle notifications. Only a terminal Order
    // with a stable id closes a transaction. Current ACP schemas use
    // `status: "completed"` for that terminal state.
    if (resp['type'] === 'order_create' || resp['type'] === 'order_update') {
      const data = resp['data'] as Record<string, unknown> | undefined
      if (
        data?.['type'] === 'order' &&
        data['status'] === 'completed' &&
        isNonEmptyString(data['id'])
      ) {
        const checkoutUrl = isNonEmptyString(data['permalink_url']) ? data['permalink_url'] : null
        return detection('ACP', checkoutUrl)
      }
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
    // x402. accept v2 and v1 names
    if (lower['payment-response'] || lower['x-payment-response']) {
      return detection('x402')
    }
    // MPP. IETF draft Payment-Receipt header
    if (lower['payment-receipt']) {
      return detection('MPP')
    }
  }

  // AP2 v0.2. Successful CheckoutReceipt / PaymentReceipt is the close signal.
  // Mandates authorize the action and are kept out of transaction detection.
  // Sources:
  // - docs/ap2/specification.md: Checkout/Payment Receipt returned on completion
  // - code/sdk/schemas/ap2/payment_receipt.json
  // - code/sdk/schemas/ap2/checkout_receipt.json
  // Shapes:
  // - { status: "success", payment_receipt: "<signed JWT>" }
  // - { status: "success", checkout_receipt: "<signed JWT>" }
  // - { parts: [{ kind: "data", data: { "ap2.PaymentReceipt": { status: "Success", ... } } }] }
  if (resp) {
    const mppReceipt = findMppMcpReceipt(resp)
    if (isMppMcpReceipt(mppReceipt)) {
      return detection('MPP', null, mppMcpContentId(mppReceipt))
    }
  }

  if (resp) {
    const ap2Content = findAp2V02ReceiptContentId(resp)
    if (ap2Content) {
      return detection('AP2', null, ap2Content)
    }
  }

  // AP2 mandates in every version are authorization inputs, never completion
  // signals. Do not add mandate-only compatibility fallbacks here.
  if (resp) {
    // a2a-x402 extension. payment-completed via A2A task status metadata.
    // Source: github.com/google-agentic-commerce/a2a-x402 spec/v0.1/spec.md
    // Shape: { kind: "task", status: { message: { metadata: { "x402.payment.status": "payment-completed", "x402.payment.receipts": [{success, transaction, ...}] } } } }
    // Guard on kind === "task" to prevent false positives from responses
    // that incidentally contain matching metadata keys.
    if (resp['kind'] === 'task') {
      const status = resp['status'] as Record<string, unknown> | undefined
      const statusMessage = status?.['message'] as Record<string, unknown> | undefined
      const metadata = statusMessage?.['metadata'] as Record<string, unknown> | undefined
      if (metadata && metadata['x402.payment.status'] === 'payment-completed') {
        const receipts = metadata['x402.payment.receipts']
        if (Array.isArray(receipts)) {
          const accepted = receipts.some(
            (r) => isRecord(r) && (r as Record<string, unknown>)['success'] === true,
          )
          if (accepted) {
            return detection('a2a-x402', null, a2aX402ContentId(receipts))
          }
        }
      }
    }
  }

  // Tool names are not completion evidence. Caller-provided detectors can
  // still return `heuristic`, but the default detector never does so.
  void toolName

  return noDetection()
}
