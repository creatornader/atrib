# atrib Payments Profile

**payments-profile v1.0.0**

Editor: Nader Helmy

This profile defines the payment-rail layer of the atrib protocol: per-rail transaction detection hooks, the SDK detection contract, the attribution policy format, the calculation algorithm, the settlement recommendation document, settlement verification, and the AP2 / Verifiable Intent evidence-check catalog. The material relocated here from the core specification under [D147](../DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core); every vacated core section keeps a stable tombstone anchor that points at its new home.

The core protocol accommodates payments through exactly three retained elements:

- **The `transaction` event type.** The URI and the 0x02 log-entry byte are core normative vocabulary ([§1.2.4](../atrib-spec.md#124-event_type-values), [§2.3.1](../atrib-spec.md#231-entry-serialization)). Any rail, present or future, produces the same core record shape.
- **Cross-attestation.** Transaction records require at least two distinct verified signer keys over the same canonical bytes ([§1.7.6](../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records), [D052](../DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records), [D107](../DECISIONS.md#d107-ap2-counterparty-attestation-signs-atrib-transaction-bytes)). The rule is rail-agnostic trust semantics and stays core.
- **The universal evidence envelope.** Receipts, mandates, JWTs, and verifier facts for any rail travel as envelope profiles ([§5.5.7](../atrib-spec.md#557-universal-evidence-envelope), [D137](../DECISIONS.md#d137-universal-evidence-envelope-as-the-single-protocol-level-attachment-model)).

A payments-capable deployment is core plus this profile. Rail churn (header renames, hook changes, envelope discrimination fixes) lands in this document's version history, not the core spec's.

## Table of Contents

- [§1 Scope and Position in the Protocol](#1-scope-and-position-in-the-protocol)
- [§2 Transaction Detection Hooks](#2-transaction-detection-hooks)
- [§3 SDK Transaction Detection](#3-sdk-transaction-detection)
- [§4 Policy Document Format](#4-policy-document-format)
- [§5 The Default Policy](#5-the-default-policy)
- [§6 Publication and Discovery](#6-publication-and-discovery)
- [§7 Session Negotiation](#7-session-negotiation)
- [§8 The Calculation Algorithm](#8-the-calculation-algorithm)
- [§9 Settlement Recommendation Document](#9-settlement-recommendation-document)
- [§10 Settlement Verification](#10-settlement-verification)
- [§11 AP2 / Verifiable Intent Evidence Checks](#11-ap2--verifiable-intent-evidence-checks)
- [§12 Evidence Profiles](#12-evidence-profiles)
- [§13 Scope Boundaries](#13-scope-boundaries)
- [§14 Conformance](#14-conformance)

---

## §1 Scope and Position in the Protocol

Requirements language follows core [§1.1](../atrib-spec.md#11-normative-requirements-language) (RFC 2119). Normative statements in this profile bind implementations that claim payments-profile conformance. Core conformance does not require this profile: a core-only SDK never classifies a response as a transaction and never blocks, per the degradation contract ([§5.8](../atrib-spec.md#58-degradation-contract)).

**Supported rails.** This profile detects six payment protocols: ACP, UCP, x402, MPP, AP2, and a2a-x402. This enumeration is the canonical source for the "six payment protocols" count used across repository documentation. atrib reports a2a-x402 detections as `protocol: 'AP2'` because a2a-x402 is the AP2 crypto path ([§2.5](#25-ap2-and-a2a-x402)); the enumeration counts it separately because it has its own detection rule.

**Section map.** Except for [§1](#1-scope-and-position-in-the-protocol), [§12](#12-evidence-profiles), [§14](#14-conformance), and parts of [§13](#13-scope-boundaries), every section of this profile relocated verbatim from the core spec:

| Profile section | Core spec origin (tombstoned anchor) |
| --- | --- |
| [§2.1](#21-acp-agentic-commerce-protocol)–[§2.5](#25-ap2-and-a2a-x402) | [§1.7.1](../atrib-spec.md#171-acp-agentic-commerce-protocol)–[§1.7.5](../atrib-spec.md#175-ap2-and-a2a-x402) |
| [§3](#3-sdk-transaction-detection) | [§5.4.5](../atrib-spec.md#545-transaction-detection) |
| [§4](#4-policy-document-format) | [§4.2](../atrib-spec.md#42-policy-document-format) |
| [§5](#5-the-default-policy) | [§4.3](../atrib-spec.md#43-the-default-policy) |
| [§6](#6-publication-and-discovery) | [§4.4](../atrib-spec.md#44-publication-and-discovery) |
| [§7.1](#71-negotiation-protocol)–[§7.3](#73-session-policy-record) | [§4.5.1](../atrib-spec.md#451-negotiation-protocol)–[§4.5.3](../atrib-spec.md#453-session-policy-record) |
| [§7.4](#74-session-policy-record-creation-sdk) | [§5.4.6](../atrib-spec.md#546-session-policy-record-creation) |
| [§8](#8-the-calculation-algorithm) | [§4.6](../atrib-spec.md#46-the-calculation-algorithm) |
| [§9](#9-settlement-recommendation-document) | [§4.7](../atrib-spec.md#47-settlement-recommendation-document) |
| [§10.1](#101-verifying-a-settlement-recommendation) | [§5.5.2](../atrib-spec.md#552-verifying-a-settlement-recommendation) |
| [§10.2](#102-post-hoc-calculation-no-agent-sdk) | [§5.5.3](../atrib-spec.md#553-post-hoc-calculation-no-agent-sdk) |
| [§11](#11-ap2--verifiable-intent-evidence-checks) | [§5.5.4](../atrib-spec.md#554-ap2--verifiable-intent-evidence-checks) |
| [§13](#13-scope-boundaries) (in part) | [§1.8](../atrib-spec.md#18-scope-boundaries) settlement- and policy-specific paragraphs |

**Binding invariants that travel with this profile.** Two invariants from the core design move here verbatim and remain binding:

1. **The calculation algorithm is a pure function.** Graph + policy = distribution. No network calls during calculation. No timestamps beyond those in the records. No randomness. Any party with the same inputs must get the same result ([§8](#8-the-calculation-algorithm)).
2. **The protocol has no thumb on the scale.** atrib does not decide what contributions are worth. Merchants and creators publish machine-readable policy documents. Agents negotiate them. The protocol provides the schema; the parties provide the values ([§4](#4-policy-document-format)).

The core fact/policy separation ([§3.6](../atrib-spec.md#36-implementation-notes)) is what makes this profile detachable. The [§3](../atrib-spec.md#3-graph-query-interface) graph is a pure fact layer that never returns weighted data; this profile's policy and calculation layer is a consumer of that graph, never a producer of facts. Re-attaching or re-merging the profile later requires zero change to any signed record, log entry, edge derivation rule, or deployed service.

**Versioning.** This document versions as `payments-profile vMAJOR.MINOR.PATCH`, independent of the core spec. Adding or changing a rail's detection hook is a MINOR change. Removing a rail or changing calculation semantics is a MAJOR change. Editorial fixes are PATCH.

**Packaging.** Detection currently ships inside `@atrib/agent` and the settlement verifier surface inside `@atrib/verify`. The subpath split (`@atrib/agent/payments` and `@atrib/verify/payments` with root re-exports) and any later standalone package follow the schedule in [D147](../DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core). This document is the normative home for the contracts regardless of packaging.

---

## §2 Transaction Detection Hooks

The attribution chain is complete when a transaction event closes the loop, connecting the tool calls that contributed to the commerce session to the actual moment of purchase. This section defines how atrib attaches to each supported commerce protocol.

In every case, the linking mechanism is the same: the `context_id` of the agent session must be embedded in the transaction metadata when the checkout is initiated, so that the transaction event webhook can be matched back to the attribution chain.

When a hook fires, the emitted record is a core `transaction` record. Its format, signing, cross-attestation, and log submission are core-normative ([§1.2](../atrib-spec.md#12-the-attribution-record), [§1.7.6](../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records), [§5.3.5](../atrib-spec.md#535-log-submission)); this profile defines only what counts as a detection signal per rail.

### 2.1 ACP (Agentic Commerce Protocol)

ACP is the open standard published at `github.com/agentic-commerce-protocol/agentic-commerce-protocol`. The transaction event hook is the success response from `POST /checkout_sessions/{id}/complete`. A successful completion is signaled by `status === "completed"` together with an embedded `order` object whose `id` is a string. The `order.permalink_url` (when present) is the canonical post-purchase URL atrib uses to derive the transaction record's `content_id`.

Because ACP `POST /checkout_sessions/...` requests do not currently expose a free-form metadata field for arbitrary extension data, the `context_id` MUST travel via the same channels used for HTTP transports (per [§1.5.2](../atrib-spec.md#152-http-transport-tracestate), [§1.5.3](../atrib-spec.md#153-http-fallback-x-atrib-chain), and [§1.5.3.1](../atrib-spec.md#1531-context-id-header-x-atrib-context)): the `X-atrib-Context` HTTP header on the outbound request, and `params._meta.atrib` for MCP-transport ACP integrations.

```jsonc
// POST /checkout_sessions/{id}/complete success response
{
  "id": "checkout_session_123",
  "status": "completed", // detection signal
  "currency": "usd",
  "buyer": { "...": "..." },
  "line_items": ["..."],
  "totals": ["..."],
  "order": {
    // embedded order proves the completion
    "id": "ord_abc123",
    "checkout_session_id": "checkout_session_123",
    "permalink_url": "https://example.com/orders/ord_abc123",
  },
}
```

The server-to-merchant order webhook events use snake_case event types, NOT dot-notation:

```jsonc
// order_create event (NOT "order.created" or "ORDER_CREATED")
{
  "type": "order_create",
  "data": {
    "type": "order",
    "checkout_session_id": "checkout_session_123",
    "permalink_url": "https://www.testshop.com/orders/checkout_session_123",
    "status": "created",
    "refunds": []
  }
}

// order_update event (state changes after creation: shipped, refunded, etc.)
{
  "type": "order_update",
  "data": {
    "type": "order",
    "checkout_session_id": "checkout_session_123",
    "permalink_url": "https://www.testshop.com/orders/checkout_session_123",
    "status": "shipped",
    "refunds": [ { "type": "original_payment", "amount": 100 } ]
  }
}
```

Detection MUST match all three shapes (completion response, `order_create`, `order_update`).

### 2.2 UCP (Universal Commerce Protocol)

UCP is the open standard published at `github.com/universal-commerce-protocol/ucp`. As of UCP version `2026-01-11`, the on-wire shape of a UCP checkout completion response is identical to ACP's, with one structural addition: a top-level `ucp` envelope carrying the protocol version and capability list. Detection MUST therefore use the presence of `ucp.version` to distinguish UCP from ACP when both produce a `status: "completed"` payload.

```jsonc
// POST /checkout-sessions/{id}/complete success response (UCP)
{
  "ucp": {
    // distinguishes UCP from ACP
    "version": "2026-01-11",
    "capabilities": [{ "name": "dev.ucp.shopping.checkout", "version": "2026-01-11" }],
  },
  "id": "chk_123456789",
  "status": "completed", // detection signal (same as ACP)
  "currency": "USD",
  "order": {
    "id": "ord_99887766",
    "permalink_url": "https://merchant.com/orders/ord_99887766",
  },
  "buyer": { "...": "..." },
  "line_items": ["..."],
  "totals": ["..."],
}
```

UCP does not yet expose a documented free-form metadata field for arbitrary agent context. The `context_id` MUST travel via the `X-atrib-Context` HTTP header on UCP checkout requests, and via `params._meta.atrib` for any MCP-transport UCP integrations.

### 2.3 x402

x402 is the Coinbase open payment protocol published at `github.com/coinbase/x402`. It uses HTTP 402 / 200 request-response cycles. The transaction event is the HTTP 200 response containing a **`PAYMENT-RESPONSE`** header (x402 v2), or the legacy **`X-PAYMENT-RESPONSE`** header (x402 v1, deprecated per RFC 6648 but still in deployment). Detection MUST accept both names case-insensitively.

The header value is base64-encoded JSON containing a `SettlementResponse` object: `{ success, transaction, network, payer, requirements }`. atrib treats header presence as the on-wire detection signal; the body is not decoded for detection purposes (decoding is appropriate when extracting `transaction` or `payer` for content_id derivation in higher-fidelity downstream tooling).

The agent MUST include the context_id as a custom header on the outbound payment request:

```
// Outbound x402 v2 payment request:
GET /paid-resource HTTP/1.1
PAYMENT-SIGNATURE: <base64 JSON>     // v2 (v1 used X-PAYMENT)
X-atrib-Context: 4bf92f3577b34da6a3ce929d0e0e4736

// 200 success response with the transaction signal:
HTTP/1.1 200 OK
PAYMENT-RESPONSE: <base64 JSON>      // v2 detection header
Content-Type: application/json

// The receiving server reads X-atrib-Context and includes it in the
// transaction record it writes to the atrib log. If the server does
// not have atrib installed, the context is present in the request
// for future retrieval from proxy logs.
```

### 2.4 MPP (Machine Payments Protocol)

MPP is a separate protocol from x402, also built on HTTP 402, formally specified in IETF `draft-ryan-httpauth-payment-01` ("The 'Payment' HTTP Authentication Scheme") authored by engineers from Tempo Labs and Stripe and launched in March 2026. MPP uses the standard HTTP authentication scheme with `WWW-Authenticate: Payment` challenges and `Authorization: Payment` credentials.

The transaction event is the HTTP 200 response containing a **`Payment-Receipt`** header (per section 5.3 of the draft). The header value is base64url-nopad JSON with the required fields `{ status: "success", method, timestamp, reference }`. The draft specifies: _"Servers MUST NOT return a Payment-Receipt header on error responses,"_ so header presence is a reliable detection signal.

**`PAYMENT-RESPONSE` (x402) and `Payment-Receipt` (MPP) are different headers for different protocols.** Earlier drafts of this specification incorrectly attributed `Payment-Receipt` to both protocols; this has been corrected after verification against the published x402 docs and the IETF MPP draft.

The `context_id` MUST travel in the same `X-atrib-Context` custom header used for x402:

```
// MPP payment retry request (after fulfilling the WWW-Authenticate: Payment challenge):
GET /paid-resource HTTP/1.1
Authorization: Payment <credential>
X-atrib-Context: 4bf92f3577b34da6a3ce929d0e0e4736

// 200 success response with the MPP transaction signal:
HTTP/1.1 200 OK
Payment-Receipt: <base64url-nopad JSON>     // MPP detection header
Cache-Control: private                      // required by draft §5.3
Content-Type: application/json

// For MCP transport (draft-payment-transport-mcp-00):
// The context_id travels in params._meta as defined in §1.5.4
// The MPP payment-completed message carries it in the task metadata.
```

### 2.5 AP2 and a2a-x402

AP2 (Agentic Payment Protocol) is Google's open protocol at `github.com/google-agentic-commerce/AP2`, version v0.2. Current AP2 uses Checkout Mandates and Payment Mandates for authorization, then returns signed Checkout Receipts and Payment Receipts when a verifier accepts or rejects the mandate. The transaction event hook is the successful receipt, not the mandate itself.

Detection MUST fire on either of these AP2 v0.2 success signals:

1. A Payment Receipt with `status: "Success"` and the AP2 payment receipt fields (`iss`, `iat`, `reference`, `payment_id`, `psp_confirmation_id`, `network_confirmation_id`).
2. A Checkout Receipt with `status: "Success"` and the AP2 checkout receipt fields (`iss`, `iat`, `reference`, `order_id`).

When the signed receipt is returned as a compact JWT rather than a decoded object, implementations MAY detect the AP2 sample result envelope: `status: "success"` plus a `payment_receipt` or `checkout_receipt` compact JWT field. Detection does not need to decode the JWT. Verification and content extraction belong to a verifier-side evidence stage, not the detector.

For Path 2 agent-side transaction records, AP2 implementations SHOULD derive `content_id` from a stable receipt identity when one is visible on the response. The derivation is `"sha256:" + hex(SHA-256(UTF-8(JCS(identity))))`, where `identity` is one of:

1. decoded PaymentReceipt: `{ "protocol": "AP2", "version": 1, "source": "payment_receipt", "fields": { "iss", "reference", "payment_id", "psp_confirmation_id", "network_confirmation_id" } }`;
2. compact payment receipt JWT: `{ "protocol": "AP2", "version": 1, "source": "payment_receipt_jwt", "fields": { "jwt_hash": "sha256:<compact-jwt-sha256>" } }`;
3. decoded CheckoutReceipt: `{ "protocol": "AP2", "version": 1, "source": "checkout_receipt", "fields": { "iss", "reference", "order_id" } }`;
4. compact checkout receipt JWT: `{ "protocol": "AP2", "version": 1, "source": "checkout_receipt_jwt", "fields": { "jwt_hash": "sha256:<compact-jwt-sha256>" } }`;
5. AP2 v0.1 or legacy VC PaymentMandate fallback: `{ "protocol": "AP2", "version": 1, "source": "legacy_payment_mandate", "fields": { "mandate_hash": "sha256:<jcs-mandate-sha256>" } }`.

PaymentReceipt forms take precedence over CheckoutReceipt forms when both are present. Decoded receipt fields take precedence over compact JWT fields. If no stable AP2 identity is present, Path 2 falls back to the generic AP2 rule in [§3](#3-sdk-transaction-detection): use the MCP server URL and `"checkout"`. See [D095](../DECISIONS.md#d095-ap2-path-2-content_id-uses-a-stable-receipt-identity-ladder).

Implementations MUST NOT detect AP2 mandate-only payloads as transaction events. This includes closed mandate `vct` values such as `mandate.payment.1` and `mandate.checkout.1`, and open mandate values such as `mandate.payment.open.1` and `mandate.checkout.open.1`. Mandates authorize a future action. Receipts prove the verifier's result.

Verifier-side AP2 / Verifiable Intent evidence checks SHOULD run off the middleware critical path. A verifier that receives AP2 and VI evidence SHOULD check:

1. receipt success, compact receipt JWT signature when present, and `reference` binding to the closed mandate serialization or an explicit closed-mandate hash;
2. VI L1 / L2 / L3 SD-JWT signatures, using trusted issuer keys for L1, the L1 `cnf.jwk` for L2, and delegated L2 agent keys for L3;
3. `sd_hash` links across the delegation chain;
4. SD-JWT disclosure digest links through `_sd` or `delegate_payload`;
5. autonomous-mode consistency: the open checkout and open payment mandates bind the same `cnf.jwk`;
6. final checkout/payment binding: `checkout_hash` matches `checkout_jwt`, and PaymentMandate `transaction_id` matches the checkout hash.

Failure in this evidence stage MUST NOT undo or block the transaction detector. It is a verifier signal for settlement, audit, and dispute workflows. The reference TypeScript surfaces are `@atrib/verify` `verifyAp2ViEvidence()` for decoded evidence and `verifyAp2ViEvidenceAsync()` for compact signed receipt JWTs plus async SD-JWT / VC conformance; both include typed AP2 mandate constraint evaluation when open constraints are disclosed. `verifyRecord()` and `AtribVerifier.verify()` can also attach caller-supplied evidence as tiered `ap2_vi_evidence`. The opt-in AP2 live interop harness in `@atrib/integration` consumes AP2 reference-run artifacts through the same detector and verifier surfaces, not through a special AP2 runtime path. AP2 receipt JWT signatures MUST NOT be counted as [§1.7.6](../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records) `signers[]` unless the AP2 participant also signs the atrib transaction record's cross-attestation canonical bytes. See [§11](#11-ap2--verifiable-intent-evidence-checks), [D089](../DECISIONS.md#d089-ap2--verifiable-intent-evidence-checks-live-in-atribverify), [D090](../DECISIONS.md#d090-ap2-receipt-jwt-verification-uses-jose-in-atribverify), [D091](../DECISIONS.md#d091-ap2--vi-sd-jwt-conformance-uses-openwallet-sd-jwt-js), [D092](../DECISIONS.md#d092-ap2--vi-mandate-constraints-are-typed-verifier-evidence), [D094](../DECISIONS.md#d094-ap2--vi-evidence-attaches-to-verifier-results-as-a-tiered-block), [D096](../DECISIONS.md#d096-ap2--vi-crypto-conformance-uses-a-pinned-offline-corpus), [D097](../DECISIONS.md#d097-ap2-live-interop-uses-an-opt-in-reference-artifact-harness), [D098](../DECISIONS.md#d098-ap2-receipts-stay-external-evidence-for-cross-attestation), and [D107](../DECISIONS.md#d107-ap2-counterparty-attestation-signs-atrib-transaction-bytes).

Implementations SHOULD embed the `context_id` in the agent protocol envelope where the host supports metadata. Until AP2 standardizes an atrib-specific metadata field, the `context_id` MUST also travel via `params._meta.atrib` per [§1.5.2](../atrib-spec.md#152-http-transport-tracestate), [§1.5.3](../atrib-spec.md#153-http-fallback-x-atrib-chain), and [§1.5.3.1](../atrib-spec.md#1531-context-id-header-x-atrib-context).

```jsonc
// AP2 v0.2 PaymentReceipt artifact
// Source: google-agentic-commerce/AP2 code/sdk/schemas/ap2/payment_receipt.json
{
  "kind": "task",
  "artifacts": [
    {
      "parts": [
        {
          "kind": "data",
          "data": {
            "ap2.PaymentReceipt": {
              "status": "Success", // detection signal
              "iss": "example-pisp.com",
              "iat": 1772020800,
              "reference": "closed-payment-mandate-hash",
              "payment_id": "pay_123",
              "psp_confirmation_id": "psp_123",
              "network_confirmation_id": "net_123"
            }
          }
        }
      ]
    }
  ]
}

// AP2 v0.2 sample result envelope with a signed receipt JWT
{
  "status": "success", // first detection signal
  "order_id": "order_123",
  "checkout_receipt": "<compact signed receipt JWT>" // second detection signal
}
```

Older AP2 v0.1 deployments used an A2A (Agent2Agent) Message with a DataPart whose `data` object contains the key `ap2.mandates.PaymentMandate`. Implementations MAY keep this compatibility fallback. If they do, they MUST NOT detect `IntentMandate` or `CartMandate`.

```jsonc
// AP2 v0.1 compatibility fallback
{
  "messageId": "b5951b1a-8d5b-4ad3-a06f-92bf74e76589",
  "contextId": "sample-payment-context",
  "taskId": "sample-payment-task",
  "role": "user",
  "parts": [
    {
      "kind": "data",
      "data": {
        "ap2.mandates.PaymentMandate": {
          // detection signal
          "payment_details": {
            "cart_mandate": "<user-signed hash>",
            "payment_request_id": "order_shoes_123",
            "merchant_agent_card": { "name": "MerchantAgent" },
            "payment_method": { "supported_methods": "CARD", "data": { "token": "xyz789" } },
            "amount": { "currency": "USD", "value": 120.0 },
            "risk_info": { "device_imei": "abc123" },
            "display_info": "<image bytes>",
          },
          "creation_time": "2025-08-26T19:36:36.377022Z",
        },
      },
    },
  ],
}
```

**a2a-x402** (`github.com/google-agentic-commerce/a2a-x402`) is the AP2 extension for crypto payments via x402. When the merchant agent settles a payment on-chain it returns an A2A task whose `status.message.metadata` carries `x402.payment.status: "payment-completed"` and a `x402.payment.receipts` array with at least one entry where `success: true`. atrib reports this as `protocol: 'AP2'` because a2a-x402 is the AP2 crypto path; it is not a separate protocol.

```jsonc
// a2a-x402 payment-completed task message
// Source: github.com/google-agentic-commerce/a2a-x402 spec/v0.1/spec.md
{
  "kind": "task",
  "id": "task-123",
  "status": {
    "state": "working",
    "message": {
      "kind": "message",
      "role": "agent",
      "parts": [{ "kind": "text", "text": "Payment successful." }],
      "metadata": {
        "x402.payment.status": "payment-completed", // first detection signal
        "x402.payment.receipts": [
          {
            "success": true, // second detection signal
            "transaction": "0xabc123def456",
            "network": "base",
            "payer": "0xPAYER...",
          },
        ],
      },
    },
    "artifacts": [],
  },
}
```

Detection MUST require BOTH the `payment-completed` status AND at least one receipt with `success: true`. A task that says "payment-completed" but contains only `success: false` receipts represents a failed settlement and is NOT a transaction event.

For Path 2 `content_id`, an a2a-x402 success receipt MAY use the same [D095](../DECISIONS.md#d095-ap2-path-2-content_id-uses-a-stable-receipt-identity-ladder) AP2 identity envelope with `source: "a2a_x402_receipt"` and fields `{ transaction, network?, payer? }` when the receipt exposes a transaction id. If no transaction id is present, use the generic AP2 fallback in [§3](#3-sdk-transaction-detection).

For backward compatibility with research forks of AP2 that may have implemented Payment Mandates as W3C Verifiable Credentials (matching the obsolete spec language), atrib's detector also accepts the legacy VC envelope shape:

```jsonc
// Legacy / non-canonical: VC-wrapped PaymentMandate (research forks only)
{
  "@context": ["https://www.w3.org/ns/credentials/v2"],
  "type": ["VerifiableCredential", "PaymentMandateCredential"],   // v2 array form
  "credentialSubject": { "io.atrib/context_id": "..." }
}

// Or v1 string form:
{
  "type": "VerifiableCredential",
  "credentialSubject": { "type": "PaymentMandate" }
}
```

Implementations MAY skip the v0.1 and legacy VC fallbacks if they target only AP2 v0.2 deployments.

---

## §3 SDK Transaction Detection

The middleware detects transaction events automatically from the response shapes defined in [§2](#2-transaction-detection-hooks). No developer input is required. The detection logic checks each successful tool call response for the presence of transaction signals:

```
function detectTransaction(toolName, response, headers):
  // ACP / UCP: completion response with embedded order, OR ACP webhook event.
  // Per [§2.1](#21-acp-agentic-commerce-protocol) and [§2.2](#22-ucp-universal-commerce-protocol), both protocols converged on the same shape; UCP
  // is distinguished by the top-level `ucp.version` envelope.
  if (response?.status === 'completed' && typeof response?.order?.id === 'string'):
    const isUcp = typeof response?.ucp?.version === 'string'
    return {
      detected: true,
      protocol: isUcp ? 'UCP' : 'ACP',
      checkoutUrl: response.order.permalink_url ?? null,
    }
  if (response?.type === 'order_create' || response?.type === 'order_update'):
    return {
      detected: true,
      protocol: 'ACP',
      checkoutUrl: response.data?.permalink_url ?? null,
    }

  // x402 and MPP: distinct protocols, distinct headers (case-insensitive
  // per RFC 7230). x402 takes precedence if both are present.
  //   x402 v2 → PAYMENT-RESPONSE      (renamed from v1 X-PAYMENT-RESPONSE)
  //   MPP     → Payment-Receipt       (per draft-ryan-httpauth-payment-01 §5.3)
  const lower = lowercaseKeys(headers)
  if (lower['payment-response'] || lower['x-payment-response']):
    return { detected: true, protocol: 'x402' }
  if (lower['payment-receipt']):
    return { detected: true, protocol: 'MPP' }

  // AP2 v0.2: successful CheckoutReceipt or PaymentReceipt.
  // Source: google-agentic-commerce/AP2 receipt schemas and sample agents.
  // Mandate-only payloads are not transaction events.
  if (containsSuccessfulAp2PaymentReceipt(response)
      || containsSuccessfulAp2CheckoutReceipt(response)
      || hasAp2SuccessEnvelopeWithReceiptJwt(response)):
    return { detected: true, protocol: 'AP2' }

  // AP2 v0.1 compatibility: PaymentMandate Message inside an A2A DataPart.
  // Source: github.com/google-agentic-commerce/ap2 docs/specification.md v0.1
  if (Array.isArray(response?.parts)):
    for (part in response.parts):
      if (typeof part?.data === 'object'
          && 'ap2.mandates.PaymentMandate' in part.data):
        return { detected: true, protocol: 'AP2' }

  // a2a-x402 extension: payment-completed via A2A task status metadata.
  // Source: github.com/google-agentic-commerce/a2a-x402 spec/v0.1/spec.md
  // Requires BOTH the payment-completed status AND a successful receipt.
  const meta = response?.status?.message?.metadata
  if (meta?.['x402.payment.status'] === 'payment-completed'
      && Array.isArray(meta?.['x402.payment.receipts'])
      && meta['x402.payment.receipts'].some(r => r?.success === true)):
    return { detected: true, protocol: 'AP2' }

  // Legacy / non-canonical: W3C VC envelope around a PaymentMandate
  // (research forks only; AP2 v0.1 itself does NOT use W3C VCs).
  // Accepts both v2 array form and v1 string form.
  if (Array.isArray(response?.type)
      && response.type.includes('VerifiableCredential')
      && response.type.some(t => /paymentmandate/i.test(t))):
    return { detected: true, protocol: 'AP2' }
  if (response?.type === 'VerifiableCredential'
      && /paymentmandate/i.test(response?.credentialSubject?.type ?? '')):
    return { detected: true, protocol: 'AP2' }

  // Tool name heuristic, last resort only, lower reliability
  // Note: this local list is NOT the transactionTools init option from @atrib/mcp.
  // transactionTools is merchant-configured; this list is agent-side pattern matching.
  const heuristicKeywords = ['create_order', 'complete_checkout', 'process_payment',
                              'place_order', 'purchase', 'checkout']
  if (heuristicKeywords.some(k => toolName.toLowerCase().includes(k))):
    return { detected: true, protocol: 'heuristic' }

  return { detected: false }
```

When a transaction is detected, the middleware emits a `transaction` attribution record ([§1.2.4](../atrib-spec.md#124-event_type-values)). The `content_id` is derived from the merchant's checkout endpoint URL per [§1.2.2](../atrib-spec.md#122-content_id-derivation), making the transaction identifiable regardless of who signed it. The `creator_key` depends on which emission path is in use:

**Path 1:** Merchant-side emission (preferred).\*\* The merchant configures `@atrib/mcp` with `transactionTools: ['checkout', 'complete_order']` (or equivalent tool names). When a call to one of these tools succeeds, `@atrib/mcp` emits a `transaction` record signed with the merchant's `ATRIB_PRIVATE_KEY` and writes an attribution context token to the response. This is the cleanest model: the merchant's key is on the transaction record, and the agent detects Path 1 by seeing the token in the response.

**Path 2:** Agent-side detection (fallback).\*\* When the merchant has no atrib integration, the agent detects the transaction and emits the record itself. The record carries an agent `signers[]` entry over the [§1.7.6](../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records) canonical transaction bytes. Until a counterparty signs the same bytes, verifiers still report `cross_attestation.missing: true`. The `content_id` is derived as follows by protocol:

- **ACP / UCP:** use `order.permalink_url` from the completion response as the server_url, with tool_name `"checkout"`. If the response is an `order_create` / `order_update` webhook event, use `data.permalink_url`. If neither is available (e.g., the merchant returned a minimal completion without an order URL), fall back to the MCP server URL of the tool that was called.

- **x402:** use the HTTP endpoint URL that returned the `PAYMENT-RESPONSE` header as the server_url, with tool_name `"checkout"`.

- **MPP:** use the HTTP endpoint URL that returned the `Payment-Receipt` header as the server_url, with tool_name `"checkout"`.

- **AP2 / a2a-x402:** if the detector returns a protocol-specific `content_id` from the AP2 receipt identity ladder in [§2.5](#25-ap2-and-a2a-x402), use it as-is. Otherwise use the MCP server URL of the tool that returned the successful AP2 receipt as the server_url, with tool_name `"checkout"`.

- **Heuristic:** use the MCP server URL of the tool that was called as the server_url, with the actual tool_name. This is the weakest case; the content_id identifies the tool, not the checkout endpoint specifically.

The session policy record MUST include a warning: `"transaction_emitted_by_agent"` when this path is taken.

AP2 receipt JWT signatures and Verifiable Intent credentials are not Path 2 counterparty signers. They remain verifier evidence unless the AP2 participant also returns a signature over the atrib transaction record bytes. See [D098](../DECISIONS.md#d098-ap2-receipts-stay-external-evidence-for-cross-attestation).

**Path selection rule:** preventing double-emission.\*\* The agent middleware MUST NOT emit a transaction record (Path 2) when the checkout tool response contains an attribution context token (i.e., `params._meta.atrib`, `tracestate: atrib=...`, or `X-atrib-Chain` is present in the response). The presence of an attribution token in the checkout response indicates that `@atrib/mcp` is installed on the merchant's server and has already emitted the transaction record (Path 1). Emitting a second record would create two transaction nodes for the same economic event, violating the single-transaction-per-session assumption in [§8.1](#81-inputs-and-preconditions). When Path 1 is detected, the agent updates its session state with the inbound context token as normal, but skips transaction record emission.

In both paths, when Path 2 is taken, the record MUST be submitted to the log immediately, because the transaction event is the closing anchor of the attribution graph.

**Note (Heuristic detection is a fallback):** The tool name heuristic fires only when no protocol-level transaction signal is present. It is less reliable; a tool named `checkout` might be a UI component, not a payment completion. When heuristic detection fires, the transaction record's `event_type` is still `https://atrib.dev/v1/types/transaction` but the session policy record includes a warning: `"transaction_detected_by_heuristic"`. Merchants may choose to require protocol-level detection for settlement purposes by filtering on this warning in their verification workflow.

---

## §4 Policy Document Format

A policy document is a JSON object. It MUST be UTF-8 encoded and served with `Content-Type: application/json`. It MUST be valid JSON conforming to the schema defined in this section. Unknown fields MUST be ignored by implementations to allow forward compatibility.

### 4.1 Top-Level Fields

```
{
  "spec_version":  "atrib/1.0",          // REQUIRED. Must be "atrib/1.0" for policies conforming to this specification.
  "policy_id":     "https://example.com/.well-known/atrib-policy.json",
                                           // REQUIRED. Stable URL where this policy is published.
                                           // Used as the canonical identifier in session policy records.
  "role":          "creator",            // REQUIRED. "creator", "merchant", or "default".
  "edge_weights":  { /* [§4.2](#42-edge-weights) */ },     // REQUIRED.
  "modifiers":     [ /* [§4.3](#43-modifiers) */ ],     // OPTIONAL. Default: no modifiers.
  "distribution":  "proportional",      // REQUIRED. See [§4.4](#44-distribution-method).
  "constraints":   { /* [§4.5](#45-constraints) */ }      // OPTIONAL. Default: no constraints.
}
```

### 4.2 Edge Weights

Edge weights define the base score assigned to a node based on its structural relationship to the transaction. The key is an edge type from [§3.2.3](../atrib-spec.md#323-edge-types). The value is a non-negative decimal. Nodes may have multiple edges; if a node has edges of multiple types, its base score is the _maximum_ of the applicable edge weights, not their sum.

```
"edge_weights": {
  "CHAIN_PRECEDES":   1.0,  // node is structurally upstream in the attribution chain
  "SESSION_PRECEDES":  0.5,  // node preceded the transaction temporally, no chain link
  "SESSION_PARALLEL":  0.3,  // node co-occurred with no temporal ordering
  "CONVERGES_ON":      0.3,  // all non-transaction nodes have this; lowest-weight baseline
  "CROSS_SESSION":     0.7,  // node contributed from a different session via linking token
  "unsigned":          0.0   // gap nodes: no creator signature, no weight by default
}

// The numeric values above are illustrative only; they show the schema structure.
// They are not defaults. Only the default policy ([§5](#5-the-default-policy)) specifies default weights.
// A creator or merchant policy must specify its own values for any edge types it cares about.
// All edge type keys are optional. Missing keys default to 0.0.
// "unsigned" is a pseudo-key for gap nodes; it is not an edge type but follows the same schema.
// Weights may be any non-negative decimal. They are relative, not absolute.
// a policy with all weights doubled is equivalent to one with all weights halved.
```

**Note (Why maximum, not sum):** A node in a CHAIN_PRECEDES relationship with a transaction also has a CONVERGES_ON edge (since every non-transaction node in a session gets CONVERGES_ON). If weights were summed, every node would receive a CONVERGES_ON bonus on top of its primary edge weight, inflating scores for all structural contributors equally and making the CONVERGES_ON weight meaningless as a differentiator. Taking the maximum means the primary relationship dominates, which is the intuitive behavior: a node that is structurally upstream is scored as a chain contributor, not as a chain contributor plus a co-occurrence contributor.

### 4.3 Modifiers

Modifiers adjust a node's raw score after the base edge weight is assigned. They are applied multiplicatively, in order. A final score of zero means the node receives no distribution share. All modifiers are optional; a policy with no modifiers array applies only the base edge weights.

```
"modifiers": [
  {
    "type": "temporal_decay",
    "half_life_ms": 30000
    // Multiplies the base score by: 2^(-(delta_ms / half_life_ms))
    // where delta_ms = transaction.timestamp - node.timestamp.
    // A node 30 seconds before the transaction is halved.
    // A node 60 seconds before is quartered.
    // Nodes after the transaction timestamp are scored as 0.
  },
  {
    "type": "chain_depth_penalty",
    "penalty_per_level": 0.1
    // Multiplies the base score by: max(0, 1.0 - (chain_depth * penalty_per_level))
    // where chain_depth is the number of CHAIN_PRECEDES hops from this node to the
    // nearest transaction node (via any path). Genesis nodes have chain_depth = 0.
    // A penalty_per_level of 0.1 reduces a depth-3 node to 70% of base.
    // Nodes deeper than 1/penalty_per_level receive score 0.
  },
  {
    "type": "call_count_boost",
    "multiplier_per_call": 0.2,
    "cap": 2.0
    // For nodes whose content_id appears more than once in the session,
    // multiplies score by: min(cap, 1.0 + (call_count - 1) * multiplier_per_call)
    // A tool called 3 times gets: min(2.0, 1.0 + 2 * 0.2) = 1.4×
    // Useful for policies that weight repeated use as stronger contribution.
  }
]

// Only these three modifier types are defined by this specification.
// Unknown modifier types MUST be ignored with a warning in the session policy record.
```

### 4.4 Distribution Method

The distribution method determines how final scores are converted into share fractions. One method is defined by this specification:

| Value        | Behavior                                                                                                                                                                                                                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| proportional | Each contributor's share is their final score divided by the sum of all final scores. If all final scores are zero (which can occur if all nodes are gap nodes under a policy that weights unsigned nodes at 0.0) the calculation produces an empty distribution with a warning, not an error. |

Additional distribution methods (`equal`, `last_touch`, `first_touch`) are reserved identifiers. Their semantics are not defined by this specification. Implementations MUST reject policies with unknown distribution values rather than silently falling back to proportional.

### 4.5 Constraints

Constraints impose floors and caps on individual contributor shares. They MUST be applied after raw scores are computed and an initial proportional normalization is performed, but before the final normalization ([§8.5](#85-step-4-normalize-to-a-distribution)) and before aggregation by creator ([§8.6](#86-step-5-aggregate-by-creator)). The sequence is: raw scores → initial proportional pass → apply constraints → final renormalization → aggregate by creator → apply creator floors ([§8.7](#87-step-6-apply-creator-floors)) → final renormalization.

Two constraint fields involve floors but serve different purposes and are applied differently. **`minimum_share`** is a merchant-level constraint: when present in the merchant policy, it sets a floor for _every_ contributing node, so no contributor receives less than this fraction. It prevents any one creator from being allocated a trivially small share that is economically meaningless. **`minimum_own_share`** is a creator-level constraint: when present in a creator policy, it expresses the minimum fraction of the total distribution that creator requires for their own nodes. It is the creator's asking price. These two fields are distinct, exist on different policy roles, and are applied at different points in negotiation ([§7.2](#72-conflict-resolution)) and calculation ([§8.4](#84-step-3-apply-constraints)).

```
"constraints": {
  "minimum_share": 0.05,
  // MERCHANT POLICY ONLY. Floor applied to every contributing node after normalization.
  // Any node with a share below this threshold is boosted to this value;
  // other shares are scaled down proportionally.

  "minimum_own_share": 0.15,
  // CREATOR POLICY ONLY. Minimum fraction of total distribution the creator
  // requires for their own nodes, summed across all their tool calls in the session.
  // Read during negotiation ([§7.2](#72-conflict-resolution)), not applied by the calculation algorithm directly.
  // the session policy record captures the agreed floor per creator,
  // and the calculation algorithm applies it as a per-creator post-aggregation adjustment.

  "maximum_share": 0.80,
  // Any contributing node whose post-normalization share exceeds this
  // threshold is capped at this value. Excess is redistributed
  // proportionally to other nodes.

  "maximum_total_share": 0.15
  // MERCHANT POLICY ONLY. The maximum fraction of transaction value distributed
  // to ALL contributors combined. The remainder stays with the merchant.
  // This constraint does not affect the distribution fractions (which sum to 1.0);
  // it is applied at payout time to the currency amount.
  // If both merchant and creator policies specify maximum_total_share,
  // the merchant's value takes precedence ([§7.2](#72-conflict-resolution)).
}
```

**Note (Share fractions vs. currency amounts):** Policy documents, settlement recommendations, and the calculation algorithm work entirely in share fractions: dimensionless rationals summing to 1.0. The conversion from share fraction to currency amount requires a transaction value, which the policy document does not contain and should not contain. Currency conversion is performed by the merchant at payout time using the transaction value from the commerce protocol's transaction event. This separation keeps the policy independent of transaction size and currency.

---

## §5 The Default Policy

The default policy applies when: no merchant policy is present, policies cannot be negotiated to a compatible agreement ([§7.2](#72-conflict-resolution)), or the agreed policy fails schema validation at calculation time. It is designed to be conservative, uncontroversial, and auditable, correct enough to be used as a baseline without anyone having designed it for the specific situation.

When the default policy applies because no merchant policy is present, creator `minimum_own_share` floors from individual creator policies are still honored. The default policy has no `maximum_total_share` constraint, so there is no cap to conflict with. Creator floors are applied as post-aggregation adjustments per [§8](#8-the-calculation-algorithm) even when the default governs the edge weights and distribution method. This ensures creators who have published policies are not disadvantaged by a merchant who has not.

```
{
  "spec_version": "atrib/1.0",
  "policy_id":    "https://atrib.dev/policies/default/v1",
  "role":         "default",
  "edge_weights": {
    "CHAIN_PRECEDES":  1.0,
    "SESSION_PRECEDES": 1.0,
    "SESSION_PARALLEL": 1.0,
    "CONVERGES_ON":     1.0,
    "CROSS_SESSION":    1.0,
    "unsigned":         0.0
  },
  "modifiers":    [],
  "distribution": "proportional",
  "constraints":  {}
}
```

The default policy assigns equal weight to every signed node regardless of its edge type, and zero weight to unsigned gap nodes.

**Note (Why unsigned nodes receive zero weight):** Gap nodes represent unsigned hops with no verifiable claim to honor (see section 1.6). A merchant may choose to honor unsigned contributions through a custom policy, but doing so is an explicit opt-in, not the default.

---

## §6 Publication and Discovery

Policy documents are published at a well-known URL and fetched by agents at session initialization. This follows the same convention used by UCP merchant profiles (published at `/.well-known/ucp`) and MCP server cards (at `/.well-known/mcp.json`).

**Creator policies**

An MCP server operator SHOULD publish their attribution policy at:

```
GET https:///.well-known/atrib-policy.json
```

The `mcp-server-host` is the hostname of the server URL used to compute `content_id` values ([§1.2.2](../atrib-spec.md#122-content_id-derivation)). An agent that knows the server URL of a tool it is about to call can derive the policy URL directly without any additional lookup.

**Merchant policies**

A merchant SHOULD publish their attribution policy at:

```
GET https:///.well-known/atrib-policy.json
```

The `merchant-domain` is the domain used as the server URL for the merchant's transaction records ([§2](#2-transaction-detection-hooks), the checkout endpoint URL). An agent preparing to initiate a checkout can derive the merchant's policy URL from the checkout endpoint.

**Response requirements**

Servers hosting policy documents MUST respond with HTTP 200 and a valid policy document, or HTTP 404 if no policy is published. A 404 response means the default policy applies. Any other response code SHOULD be treated as a transient error; agents SHOULD retry once with a 2-second delay and fall back to the default policy if the retry also fails.

Policy documents SHOULD be cacheable for at least 5 minutes. Agents SHOULD not re-fetch policies within a running session even if the cache TTL expires. The policy in effect at session initialization is the policy that applies to that session.

---

## §7 Session Negotiation

Negotiation is the process by which an agent, at session initialization, reads available policies from the tools it expects to call and from the merchant it expects to transact with, and establishes the agreed policy that will govern the eventual calculation.

### 7.1 Negotiation Protocol

At session initialization, the agent SHOULD:

Step 1: Fetch the merchant's policy from `/.well-known/atrib-policy.json`. If the merchant has no policy, use the default.

Step 2: For each MCP server the agent intends to call, fetch the creator's policy from `/.well-known/atrib-policy.json`. If a creator has no policy (404 response, schema validation failure, or fetch error after retry) they have no stated preferences: no `minimum_own_share` floor, no edge weight preferences. Their contribution is calculated entirely under the merchant's policy (or the default if the merchant has none). This is not a conflict; it is the absence of a stated position.

Step 3: Check compatibility between the merchant's policy and each creator's policy ([§7.2](#72-conflict-resolution)). If all are compatible, the merchant's policy governs the calculation; creator policies constrain what the merchant's policy can do but do not override its structure.

Step 4: Record the agreed policy in the session policy record ([§7.3](#73-session-policy-record)) and embed the policy record ID in the session's W3C Baggage as `atrib-policy=`.

**Note (Negotiation is best-effort):** Session initialization may be fast-path and policy fetching may add latency. Agents MAY skip negotiation and proceed under the default policy when latency constraints require it. When this happens, the session policy record MUST indicate that the default policy was used due to a negotiation skip. Merchants and creators who require specific policies SHOULD ensure their policies are available with low latency and published at stable, well-cached URLs.

### 7.2 Conflict Resolution

Two policies conflict when they specify requirements that cannot be simultaneously satisfied. The resolution rules are:

**Rule 1:** Merchant controls total payout cap.\*\* If the merchant policy specifies `maximum_total_share`, that value governs regardless of what creator policies specify. A creator policy that implicitly requires a higher total payout (because its `minimum_own_share` constraint, combined with the number of contributing creators, would sum to more than the merchant's cap) is in conflict with the merchant policy.

**Rule 2:** Creator minimum floors are honored within the cap.\*\* If a creator policy specifies `minimum_own_share`, that floor MUST be honored in the calculation for that creator's contribution, subject to the merchant's `maximum_total_share`. If honoring all creator minimums would require exceeding the merchant's total cap, creator minimums are scaled down proportionally until the total cap is satisfied.

**Rule 3:** Irreconcilable conflicts fall back to default.\*\* If after applying Rules 1 and 2 the policies remain irreconcilable (for example, a single creator's minimum floor alone exceeds the merchant's total cap) the session proceeds under the default policy for all contributors, and the conflict is logged in the session policy record with the incompatible policies identified.

**Rule 4:** Edge weight disagreements do not block negotiation.\*\* When creator and merchant policies specify different edge weights, the merchant's edge weights govern the calculation. The creator's edge weights are advisory (they express what the creator believes their contributions are worth) but the merchant's policy is the operative one. A creator who is unwilling to operate under a merchant's policy can choose not to serve that merchant's agents; this is a business decision, not a protocol enforcement point.

**Rule 5:** Creator floors summing to more than 1.0 are irreconcilable.\*\* If the sum of all `minimum_own_share` values across all creators in the session exceeds 1.0, the floors are mathematically impossible to honor simultaneously regardless of any merchant cap. This condition MUST be detected at negotiation time and triggers Rule 3 (fall back to default). The session policy record MUST identify all creators whose floors contributed to the irreconcilable sum.

**Rule 6:** Contradictory constraints within a single policy are invalid.\*\* A policy document where `minimum_share` is greater than `maximum_share`, or where any constraint value is negative, MUST be rejected at parse time as if it were a 404 response. The agent MUST log a warning identifying the contradictory fields. A policy that is invalid for the purposes of negotiation is treated as absent; the creator or merchant has no stated policy.

**Rule 7:** No agent SDK means no session policy record; calculation defaults.\*\* When no agent-side atrib SDK was present during the session, no session policy record exists. The merchant discovering the session post-transaction may still run the calculation using the default policy and the graph as constructed from log data. In this case, `calculated_by` in the settlement recommendation is set to `"local"`, the merchant signs with their own key, and `policy_record_id` is set to `"default"` to indicate the default policy was applied without a negotiated record.

### 7.3 Session Policy Record

The session policy record is a lightweight document created at negotiation time and stored by the agent. It records the policies that were considered and the resulting agreed policy, providing an audit trail that both creator and merchant can inspect after the fact.

```
{
  "spec_version":    "atrib/1.0",
  "record_id":       "sha256:",
  // The record_id is computed as SHA-256(JCS(record_without_record_id)),
  // where record_without_record_id is the session policy record with the
  // record_id field omitted (not set to empty string). The JCS serialization
  // follows RFC 8785. Used as a stable reference.
  "context_id":      "4bf92f3577b34da6a3ce929d0e0e4736",
  "created_at":      1743850000000,
  "merchant_policy": "https://merchant.example.com/.well-known/atrib-policy.json",
  // URL of the merchant policy fetched, or "default" if none was published.
  "creator_policies": [
    {
      "server_url": "https://tools.example.com",
      "policy_url": "https://tools.example.com/.well-known/atrib-policy.json",
      "status":     "compatible"
      // "compatible" | "floor_scaled" | "conflict_defaulted" | "not_found"
    }
  ],
  "agreed_policy":   "https://merchant.example.com/.well-known/atrib-policy.json",
  // The operative policy URL, or "default" if the default was used.
  "applied_constraints": {
    "minimum_floors": {
      "https://tools.example.com": 0.10
      // Creator minimum floors that were honored in this session.
    }
  },
  "warnings": []
  // Array of strings describing any non-fatal issues encountered during
  // negotiation (unknown modifier types, missing policies, etc.)
}
```

The session policy record is not submitted to the Merkle log; it is not an attribution record. It is stored locally by the agent and SHOULD be made available to the merchant on request. It serves as evidence of the policy terms in effect during the session if a dispute arises.

### 7.4 Session Policy Record Creation (SDK)

The session policy record ([§7.3](#73-session-policy-record)) is created at session initialization ([§5.4.2](../atrib-spec.md#542-session-initialization)) and updated as the session progresses. The middleware MUST populate it as follows:

- `context_id`: set at session init from the OTel trace ID.

- `merchant_policy`: URL fetched at init, or `"default"` if none was found.

- `creator_policies`: populated as creator policies are fetched during init. Each entry's `status` field reflects the negotiation outcome per [§7.2](#72-conflict-resolution).

- `agreed_policy`: set after negotiation completes.

- `applied_constraints.minimum_floors`: populated with all `minimum_own_share` values from creator policies that survived negotiation (Rules 1–5 of [§7.2](#72-conflict-resolution)).

- `warnings`: appended throughout the session, on policy fetch failures, heuristic transaction detection, agent-side transaction emission (path 2 of [§3](#3-sdk-transaction-detection)), unknown modifier types, negotiation skips, and policy negotiation timeouts.

The session policy record is stored in memory and SHOULD be persisted to disk or a database at session end. It is made available to the merchant via a call to `interceptor.getSessionPolicyRecord(context_id)` on the object returned by `atrib()` ([§5.4.1](../atrib-spec.md#541-init-interface)).

---

## §8 The Calculation Algorithm

The calculation algorithm is a pure function: given the attribution graph for a session ([§3](../atrib-spec.md#3-graph-query-interface)) and the agreed policy document ([§7](#7-session-negotiation)), it produces a distribution: a mapping from creator public keys to share fractions summing to 1.0. No other inputs are required. No network calls are made. No timestamps beyond those in the records are used.

Any party (creator, merchant, auditor, regulator) with access to the graph data and the policy document MUST be able to run this algorithm locally and arrive at the same result as any other party running the same inputs. The atrib resolution API (at `https://resolve.atrib.dev/v1/calculate`) is a convenience implementation of this algorithm, not an authority. Its output is no more or less trustworthy than a local implementation producing the same output from the same inputs.

All arithmetic in the calculation algorithm uses IEEE 754 double-precision floating-point. Intermediate rounding is acceptable. The 1e-9 tolerance in `distributionsMatch()` ([§9.3](#93-independent-verification)) accounts for accumulated floating-point error across implementations.

### 8.1 Inputs and Preconditions

Inputs:

- `G`: the attribution graph for the session, as returned by the graph query API ([§3.4.1](../atrib-spec.md#341-get-v1graphcontext_id)) with `include_gap_nodes=true` and `include_cross_session=true`.

- `P`: the agreed policy document for the session ([§7.3](#73-session-policy-record)).

Preconditions that MUST hold before the algorithm runs:

- `G` contains at least one transaction node. If no transaction node is present, the session is not closed and calculation MUST NOT proceed.

- `P` is a valid policy document per the schema in [§4](#4-policy-document-format). If validation fails, use the default policy.

- All nodes in `G` whose `verification_state` is `signature_valid` or higher are eligible for distribution. Nodes with `verification_state: unsigned` are eligible only if `P.edge_weights.unsigned > 0`.

### 8.2 Step 1: Identify Contributing Nodes

A node `N` is a contributing node if all of the following hold:

- `N.event_type` is `tool_call` or `gap_node` (not `transaction`).

  **Note (event_type matching).** Throughout [§8](#8-the-calculation-algorithm), the short labels `tool_call`, `transaction`, and `gap_node` refer to the corresponding atrib normative URIs (`https://atrib.dev/v1/types/tool_call`, `https://atrib.dev/v1/types/transaction`) plus the synthetic graph-layer type `gap_node`. The other normative URI `https://atrib.dev/v1/types/observation` ([D042](../DECISIONS.md#d042-lift-observation-graph-participation-restriction)) and any extension URI ([D043](../DECISIONS.md#d043-extension-uri-participation-in-graph-derivation)) are NOT contributing nodes. observations are witnesses (the agent did not invoke a tool to produce them) and are skipped from contribution selection. Extension URIs are consumer-namespace and atrib does not bless their attribution claims by default; consumers wanting their extension URIs to count for attribution express it in their own [§4](#4-policy-document-format) policy document, not via [§8](#8-the-calculation-algorithm) default. Promotion of an extension URI to atrib's normative contributing set requires [D036](../DECISIONS.md#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary)'s bar.

  **Note (transaction record cross-attestation per [§1.7.6](../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records)).** For a transaction node `T` to serve as the [§8](#8-the-calculation-algorithm) receiver, `T`'s `signers` array MUST contain at least 2 distinct verified signer keys (cross-attestation requirement). Verification of each signature follows [§1.4](../atrib-spec.md#14-signing-and-verification). If `T` carries fewer than 2 distinct verified signer keys (or only the legacy top-level `signature` field with no `signers` array), the verifier MUST set `T.cross_attestation_missing = true` on the verification output. Strict consumer policies MAY reject [§8](#8-the-calculation-algorithm) calculation entirely when `cross_attestation_missing: true`; the default behavior is to compute the calculation, return it, and surface the flag. The receiver-vs-contributor distinction does NOT relax cross-attestation: the substrate's strongest robustness commitment lives at the transaction layer, and the calculation algorithm is one of the consumers that benefits from it.

- `N` has at least one edge to a transaction node in `G`, either a CONVERGES_ON edge (same session) or a CROSS_SESSION edge (linked session). This is always true for all non-transaction nodes when the graph is queried for a closed session, but is stated explicitly to prevent implementation errors.

Let `C` be the set of all contributing nodes.

### 8.3 Step 2: Compute Raw Scores

For each node `n` in `C`, compute its raw score `raw(n)`:

```
function raw_score(n, G, P):
  // Step 2a: determine base weight from edge type
  if n.event_type == "gap_node":
    base = P.edge_weights["unsigned"] ?? 0.0
  else:
    // collect all edge types connecting n to any transaction node
    edge_types = {e.type for e in G.edges where e.source == n.id
                  and G.nodes[e.target].event_type == "https://atrib.dev/v1/types/transaction"}
    // also include CHAIN_PRECEDES and SESSION_* edges between non-transaction nodes
    // that form a path leading to a transaction node
    edge_types |= {e.type for e in all_edges_on_paths_to_transaction(n, G)}
    // all_edges_on_paths_to_transaction(n, G) returns the set of edges on any
    // path from n to a transaction node. The algorithm: (1) build both directed
    // (CHAIN_PRECEDES, SESSION_PRECEDES, CONVERGES_ON, CROSS_SESSION) and
    // undirected (SESSION_PARALLEL) adjacency from G; (2) reverse BFS from all
    // transaction nodes to find the set of nodes that can reach a transaction;
    // (3) forward BFS from n, collecting edge types for edges whose target is
    // in the reachable set. This ensures that intermediate structural edges
    // (e.g., CHAIN_PRECEDES between non-transaction nodes on a path to a
    // transaction) contribute their weight to n's base score.
    //
    // When traversing an undirected SESSION_PARALLEL edge from node A to node B,
    // the traversal proceeds in both directions. If B can reach a transaction
    // node, SESSION_PARALLEL is added to A's collected edge types. The collected
    // edge types for a node are the union of all edge types on any path (directed
    // or undirected) from that node to any transaction node.
    weights = [P.edge_weights[t] ?? 0.0 for t in edge_types]
    base = max(weights) if weights else 0.0

  // Step 2b: apply modifiers in order
  score = base
  for modifier in P.modifiers:
    score = apply_modifier(modifier, score, n, G)

  return max(0.0, score)  // scores cannot be negative

function apply_modifier(modifier, score, n, G):
  if modifier.type == "temporal_decay":
    T = transaction_node(G).timestamp
    delta_ms = T - n.timestamp
    if delta_ms < 0: return 0.0  // node is after transaction
    return score * pow(2.0, -(delta_ms / modifier.half_life_ms))

  if modifier.type == "chain_depth_penalty":
    depth = shortest_chain_path_length(n, G)  // hops to nearest transaction via CHAIN_PRECEDES
    // The shortest chain path length from node N to any transaction node is the
    // minimum number of CHAIN_PRECEDES edges on any directed path from N to a
    // transaction node. If no directed CHAIN_PRECEDES path exists from N to any
    // transaction node, the depth is set to the ceiling of
    // `1.0 / penalty_per_level`, which is the smallest integer that drives
    // `max(0.0, 1.0 - depth * penalty_per_level)` to zero. The resulting
    // factor is 0.0.
    factor = max(0.0, 1.0 - depth * modifier.penalty_per_level)
    return score * factor

  if modifier.type == "call_count_boost":
    // Nodes with `content_id: null` (gap nodes) do not match any other node's
    // content_id. Their call count is always 1.
    count = count_nodes_with_same_content_id(n.content_id, G)
    factor = min(modifier.cap, 1.0 + (count - 1) * modifier.multiplier_per_call)
    return score * factor

  return score  // unknown modifier types are ignored
```

### 8.4 Step 3: Apply Constraints

Constraints are applied after an initial proportional pass on the raw scores and before the final normalization step. The pseudocode below incorporates the initial proportional pass internally.

```
function apply_constraints(raw_scores, constraints):
  // Filter to nodes with non-zero scores (only contributors receive shares)
  contributors = {n: s for n, s in raw_scores.items() if s > 0.0}

  if not contributors:
    return {}  // empty distribution; all nodes were gap nodes under zero-weight policy

  total = sum(contributors.values())
  normalized = {n: s/total for n, s in contributors.items()}

  // Apply minimum_share floor
  if constraints.minimum_share:
    normalized = apply_minimum_floor(normalized, constraints.minimum_share)

  // Apply maximum_share cap
  if constraints.maximum_share:
    normalized = apply_maximum_cap(normalized, constraints.maximum_share)

  // Note: maximum_total_share is NOT applied here.
  // It affects the currency conversion at payout, not the distribution fractions.
  // The distribution fractions always sum to 1.0 among contributing nodes.
  // The merchant retains (1.0 - maximum_total_share) of transaction value
  // by applying the total share cap to the dollar amount, not the fractions.

  return normalized

function apply_minimum_floor(normalized, floor):
  // Boost any node below floor to floor, scale others down proportionally.
  below = {n: s for n, s in normalized.items() if s < floor}
  above = {n: s for n, s in normalized.items() if s >= floor}
  boost_needed = sum(floor - s for s in below.values())
  above_total = sum(above.values())
  if above_total <= boost_needed:
    return {n: 1.0/len(normalized) for n in normalized}  // equal distribution fallback
    // The equal distribution fallback MAY produce node shares below
    // `minimum_share`. This is acceptable because the constraint cannot be
    // honored: the sum of all minimum floors exceeds 1.0. The fallback
    // preserves the sum-to-1.0 invariant at the cost of the floor invariant.
  scale = (above_total - boost_needed) / above_total
  result = {n: floor for n in below}
  result |= {n: s * scale for n, s in above.items()}
  return result

function apply_maximum_cap(normalized, cap):
  // Cap any node above cap, redistribute excess proportionally to others.
  above = {n: s for n, s in normalized.items() if s > cap}
  below = {n: s for n, s in normalized.items() if s <= cap}
  excess = sum(s - cap for s in above.values())
  below_total = sum(below.values())
  result = {n: cap for n in above}
  if below_total > 0:
    scale = (below_total + excess) / below_total
    result |= {n: s * scale for n, s in below.items()}
  else:
    result |= below
  return result
```

This order is normative. Implementations MUST apply minimum_share before maximum_share.

### 8.5 Step 4: Normalize to a Distribution

After applying constraints, re-normalize so shares sum to exactly 1.0, correcting for any floating-point accumulation during constraint application:

```
function final_normalize(shares):
  total = sum(shares.values())
  if total == 0.0: return {}
  return {n: s/total for n, s in shares.items()}
```

### 8.6 Step 5: Aggregate by Creator

The per-node distribution is aggregated by `creator_key`, summing all shares belonging to the same creator. A creator who appears multiple times in a session (via multiple tool calls or multiple tools) receives the sum of all their node shares.

```
function aggregate_by_creator(normalized_shares, G):
  by_creator = {}
  for node_id, share in normalized_shares.items():
    node = G.nodes[node_id]
    key = node.creator_key ?? "__unsigned__"  // gap nodes aggregate under a sentinel key
    by_creator[key] = by_creator.get(key, 0.0) + share
  return by_creator
```

The `__unsigned__` sentinel key is present in the output only if gap nodes received non-zero weight under the policy. Its presence signals to the merchant that some share of value is attributed to unsigned contributions, and it is the merchant's responsibility to decide how to handle.

### 8.7 Step 6: Apply Creator Floors

After aggregation by creator, apply any `minimum_own_share` floors from the session policy record's `applied_constraints.minimum_floors` map. These floors were established during negotiation ([§7.2](#72-conflict-resolution)) and represent the agreed minimum share for each creator who published one. This step adjusts the aggregated distribution to honor those floors, scaling down other creators' shares proportionally.

```
function apply_creator_floors(by_creator, creator_floors):
  // creator_floors: { creator_key → minimum_own_share } from session policy record
  // Only contains entries for creators whose floors survived negotiation (Rules 1-5).
  // If no floors, return by_creator unchanged.
  if not creator_floors: return by_creator

  result = dict(by_creator)
  floored_keys = set()

  // Identify creators below their floor
  for key, floor in creator_floors.items():
    if key not in result: continue  // creator didn't contribute; floor doesn't apply
    if result[key] < floor:
      floored_keys.add(key)

  if not floored_keys: return result  // all creators already meet their floors

  // Boost floored creators, scale others down proportionally
  boost_needed = sum(creator_floors[k] - result[k] for k in floored_keys)
  non_floored = {k: v for k, v in result.items() if k not in floored_keys}
  non_floored_total = sum(non_floored.values())

  if non_floored_total <= boost_needed:
    // Cannot honor all floors without taking from other floored creators.
    // This should have been caught by Rule 5 at negotiation time.
    // If reached, return current result unchanged and log a warning.
    return result

  scale = (non_floored_total - boost_needed) / non_floored_total
  for k in floored_keys:
    result[k] = creator_floors[k]
  for k in non_floored:
    result[k] = non_floored[k] * scale

  return result
```

After this step, re-normalize with `final_normalize` ([§8.5](#85-step-4-normalize-to-a-distribution)) to correct for floating-point accumulation. The complete call sequence for the full algorithm is:

```
function calculate(G, P, session_policy_record):
  C                = identify_contributing_nodes(G)
  raw_scores       = {n: raw_score(n, G, P) for n in C}
  constrained      = apply_constraints(raw_scores, P.constraints)
  normalized       = final_normalize(constrained)
  by_creator       = aggregate_by_creator(normalized, G)
  creator_floors   = session_policy_record.applied_constraints.minimum_floors ?? {}
  floored          = apply_creator_floors(by_creator, creator_floors)
  return final_normalize(floored)  // final renorm after floor application
```

---

## §9 Settlement Recommendation Document

The settlement recommendation document is the output of the calculation algorithm. It is a structured, signed record of the recommended distribution for a specific session. It is not a payment instruction; the merchant decides whether and how to act on it. But it is sufficiently precise and self-contained that any party can verify it was correctly calculated.

### 9.1 Document Format

```
{
  "spec_version":    "atrib/1.0",
  "document_type":   "settlement_recommendation",
  "context_id":      "4bf92f3577b34da6a3ce929d0e0e4736",
  "transaction_id":  "sha256:8b2f1c...",     // record_hash of the transaction node
  "policy_record_id":"sha256:3f8a2b...",    // record_id of the session policy record ([§7.3](#73-session-policy-record))
  "graph_checkpoint":"log.atrib.dev/v1",   // log origin used for graph data
  "graph_tree_size": 4821937,              // log tree size at calculation time
  "calculated_at":   1743860000000,
  "calculated_by":   "https://resolve.atrib.dev/v1",
  // URL of the service that ran the calculation, or "local" if self-calculated.

  "distribution": {
    "ABC...creatorkey1": 0.4500,    // base64url Ed25519 public key → share fraction
    "DEF...creatorkey2": 0.3500,
    "GHI...creatorkey3": 0.2000
  },
  // Share fractions sum to 1.0 (within floating-point tolerance of 1e-9).
  // __unsigned__ may appear if policy weights unsigned > 0.

  "maximum_total_share": 0.15,
  // From merchant policy constraints.maximum_total_share, or null if unconstrained.
  // The currency amount distributed to each creator is:
  // creator_amount = transaction_value * maximum_total_share * distribution[creator_key]
  // If null, the merchant determines the total share independently.

  "warnings": [],
  // Non-fatal issues encountered during calculation. Empty if clean.

  "signature": "base64url..."
  // Ed25519 signature by calculated_by over the JCS-canonical record minus this field.
  // If calculated_by = "local", the merchant signs with their own key.
}
```

### 9.2 Signing the Recommendation

The settlement recommendation MUST be signed by whoever produced it, using their Ed25519 private key and the same JCS canonicalization procedure defined in [§1.4.2](../atrib-spec.md#142-signing-procedure). This signature proves that the stated party produced this exact recommendation at the stated time. It does not prove the recommendation is correct; correctness is established by independent verification.

When the atrib resolution API produces the recommendation, it signs with atrib's key (published at `https://resolve.atrib.dev/v1/pubkey`). When a merchant or third party runs the calculation locally, they sign with their own key. Any verifier who checks the signature must use the appropriate public key based on `calculated_by`.

### 9.3 Independent Verification

Any party with access to the graph data and the session policy record can independently verify a settlement recommendation by:

Step 1: Verify the recommendation's signature using the public key of `calculated_by`.

Step 2: Fetch the graph for `context_id` from `graph_checkpoint` (the log identified by `graph_checkpoint` at tree size `graph_tree_size`).

Step 3: Fetch the session policy record identified by `policy_record_id`. Retrieve the agreed policy from `agreed_policy`.

Step 4: Run the calculation algorithm ([§8](#8-the-calculation-algorithm)) with those inputs.

Step 5: Compare the output with the `distribution` field. Shares MUST match within a floating-point tolerance of `1e-9`. Any discrepancy beyond this tolerance indicates either a bug, a different policy was applied, or the recommendation was tampered with.

**Important:** Verification requires the same graph snapshot\*\* The graph for a session can grow after a transaction closes: late attribution records may arrive, gap nodes may be resolved by creators who submit delayed records, CROSS_SESSION edges may be added as session_token links are discovered. The `graph_tree_size` field pins the graph to a specific log state. Independent verifiers MUST use the same tree size to reconstruct the same graph. Using the current graph state may produce a different result if the graph has grown since calculation time. This is not an error; it is expected behavior. If a merchant wishes to recalculate with a more complete graph, they may do so and produce a new recommendation.

---

## §10 Settlement Verification

The merchant verification library (`@atrib/verify`, core [§5.5](../atrib-spec.md#55-atribverify-merchant-verification-library)) exposes the settlement verification surface this section defines. Base record verification, handoff claim verification, authorization evidence, and the universal evidence envelope stay core ([§5.5.5](../atrib-spec.md#555-handoff-claim-verification), [§5.5.6](../atrib-spec.md#556-generic-authorization-evidence-blocks), [§5.5.7](../atrib-spec.md#557-universal-evidence-envelope)).

### 10.1 Verifying a Settlement Recommendation

Given a settlement recommendation document ([§9](#9-settlement-recommendation-document)), the verifier independently reproduces the calculation and compares results.

```
const result = await verifier.verify(recommendationDoc)

// result shape:
{
  valid:        true,          // signature verifies AND calculation matches
  signatureOk:  true,          // Ed25519 sig over document verified
  calcMatch:    true,          // local recalculation matches distribution within 1e-9
  distribution: { ... },       // local recalculation output (matches doc if calcMatch)
  warnings:     [],            // any non-fatal issues encountered
  graph_node_count: 4         // number of nodes used in calculation
}
```

The verifier fetches the graph at the tree size specified in `graph_tree_size`, fetches the session policy record identified by `policy_record_id`, fetches the agreed policy document, and runs the calculation algorithm ([§8](#8-the-calculation-algorithm)) locally. It does not call the resolution API.

### 10.2 Post-Hoc Calculation (No Agent SDK)

When no agent SDK was present during the session, no session policy record exists. The merchant can still calculate using the default policy:

```
const recommendation = await verifier.calculate({
  context_id:   '4bf92f3577b34da6a3ce929d0e0e4736',
  policy:       'default',                  // or a policy document object
  signWith:     'merchant',                 // signs with merchantKey from init
})

// recommendation is a signed settlement recommendation document ([§9](#9-settlement-recommendation-document))
// with policy_record_id: "default" and calculated_by: "local"
```

The verifier fetches the graph for the given `context_id`, applies the specified policy, runs the algorithm, and returns a signed recommendation. This path corresponds directly to Rule 7 of [§7.2](#72-conflict-resolution).

---

## §11 AP2 / Verifiable Intent Evidence Checks

`@atrib/verify` also exposes a local AP2 / Verifiable Intent evidence checker. This is not part of the [§8](#8-the-calculation-algorithm) settlement calculation and does not change graph derivation. It is a verifier-side signal for merchants, auditors, and dispute tooling that want to inspect AP2 authorization evidence after a transaction has been detected.

Callers MAY pass the same evidence bundle into `verifyRecord(record, { ap2ViEvidence, ap2ViEvidenceOptions })` for transaction records or into `AtribVerifier.verify(recommendation, { ap2ViEvidence, ap2ViEvidenceOptions })`. The result is attached as `ap2_vi_evidence`. This block does not alter the base `valid`, `signatureOk`, `cross_attestation`, or `calcMatch` checks; `ap2_vi_evidence.valid` carries the AP2 / VI authorization result. The verifier does not fetch AP2 / VI bodies from receipts or hashes. The caller supplies the evidence material. AP2 receipt signatures do not count toward `cross_attestation.signers_valid` unless they are accompanied by an atrib-record signature over the [§1.7.6](../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records) canonical bytes. See [D094](../DECISIONS.md#d094-ap2--vi-evidence-attaches-to-verifier-results-as-a-tiered-block) and [D098](../DECISIONS.md#d098-ap2-receipts-stay-external-evidence-for-cross-attestation).

```
import { verifyAp2ViEvidence, verifyAp2ViEvidenceAsync } from '@atrib/verify'

const result = verifyAp2ViEvidence({
  trustedIssuerKeys: [issuerJwk],
  ap2: {
    paymentReceipt,
    checkoutReceipt,
    closedPaymentMandate,
    closedCheckoutMandate,
  },
  vi: {
    credentials: [
      { layer: 'L1', sdJwt: issuerCredential },
      { layer: 'L2', sdJwt: userMandate },
      { layer: 'L3_PAYMENT', sdJwt: agentPaymentMandate, parentPresentation },
      { layer: 'L3_CHECKOUT', sdJwt: agentCheckoutMandate, parentPresentation },
    ],
  },
})

const jwtResult = await verifyAp2ViEvidenceAsync(
  {
    receiptJwtIssuers: [
      {
        issuer: 'https://verifier.example',
        audience: 'merchant:checkout',
        metadataUrl: 'https://verifier.example/.well-known/ap2',
      },
    ],
    ap2: {
      paymentReceiptJwt,
      closedPaymentMandate,
    },
  },
  { receiptJwtPolicy: 'require' },
)
```

The result shape is:

```
{
  valid: true,
  transactionAccepted: true,
  ap2: {
    paymentReceipt: {
      success: true,
      referenceOk: true,
      missingFields: [],
      jwt: {
        verified: true,
        issuer: 'https://verifier.example',
        kid: 'receipt-key-1',
        alg: 'ES256',
        jwksSource: 'metadata',
      },
    },
    checkoutReceipt: { success: true, referenceOk: true, missingFields: [] },
  },
  vi: {
    mode: 'immediate' | 'autonomous' | 'unknown',
    credentials: [
      {
        layer: 'L1',
        signature: { status: 'verified' },
        sdJwtConformance: { status: 'verified', profile: 'sd-jwt-vc' },
        sdHashOk: true,
      },
      {
        layer: 'L2',
        signature: { status: 'verified' },
        sdJwtConformance: { status: 'verified', profile: 'sd-jwt-vc' },
        disclosuresOk: true,
      },
    ],
    delegationOk: true,
    checkoutPaymentBindingOk: true,
    constraints: {
      status: 'passed' | 'failed' | 'unresolved' | 'not_applicable' | 'not_checked',
      checks: [
        { type: 'payment.amount_range', domain: 'payment', status: 'passed' },
      ],
    },
  },
  errors: [],
  warnings: [],
}
```

The default signature policy is `require`: missing keys or invalid signatures make `valid` false while still returning a structured result. Callers that only need structural triage MAY pass `signaturePolicy: "best-effort"`, in which case missing-key checks become warnings.

For compact AP2 receipt JWTs, callers MUST provide a trust root through `receiptJwtIssuers`. Each issuer entry MAY provide local `jwks`, a `jwksUrl`, or a `metadataUrl` whose JSON contains inline `jwks` or `jwks_uri`. The async verifier enforces ES256, configured issuer, optional audience, registered JWT expiry and not-before claims when present, AP2 receipt fields, and mandate `reference` binding. The default `receiptJwtPolicy` is `require`; `receiptJwtPolicy: "best-effort"` turns JWT verification failures into warnings when decoded receipt objects are already available.

Receipt JWT headers are verifier-policy input, not passive metadata. Verifiers MUST reject unsupported `alg` values, `alg: "none"`, unexpected `crit`, missing `kid`, malformed compact JWTs, empty JWKS documents, duplicate `kid` entries in one JWKS, non-EC or non-P-256 keys, non-ES256 `alg` metadata, `use` values other than `"sig"`, and `key_ops` that do not allow verification. Verifiers SHOULD report these as named evidence findings rather than collapsing them into a generic invalid result.

When verifier metadata supplies both inline `jwks` and `jwks_uri`, inline `jwks` takes precedence. A verifier MUST isolate key selection by issuer before matching `kid`, so two trusted issuers may safely reuse the same `kid` without sharing key material. Static-JWKS verification MUST NOT perform network access. Metadata-based verification MAY fetch only the configured metadata or JWKS URLs.

Receipt JWT clock checks MUST honor the configured skew for `nbf` and `exp`. Verifiers MUST also reject `iat` values later than `now + skew`; this prevents a receipt from being accepted before its claimed issuance time.

The async verifier also runs SD-JWT / SD-JWT VC conformance for VI credentials when present. The default `sdJwtConformancePolicy` is `require`; `sdJwtConformancePolicy: "best-effort"` turns conformance failures into warnings, and `"off"` skips the async conformance layer. The default profile is `sd-jwt-vc`; callers MAY pass `sdJwtConformanceProfile: "sd-jwt"` for the core SD-JWT profile.

VI SD-JWT verification MUST reject duplicate disclosures, duplicate `_sd` digest references, duplicate `delegate_payload` digest references, unsupported `_sd_alg` values, unused disclosures, and `nbf` values later than `now + skew`. These structural checks are AP2 / VI evidence policy checks that run alongside the SD-JWT library conformance layer.

VC type metadata and status-list checks are opt-in. Callers that set `sdJwtVc.loadTypeMetadata` or submit credentials with VC status references SHOULD provide `sdJwtVc.vctFetcher` and `sdJwtVc.statusListFetcher`. The verifier does not perform implicit network fetches for these checks.

When open AP2 mandates disclose constraints, the verifier evaluates the typed subset codified in [D092](../DECISIONS.md#d092-ap2--vi-mandate-constraints-are-typed-verifier-evidence): `checkout.allowed_merchants`, `checkout.line_items`, `payment.amount_range`, `payment.allowed_payees`, `payment.allowed_payment_instruments`, `payment.allowed_pisps`, `payment.execution_date`, and `payment.reference`. The default `constraintPolicy` is `require`; failed, unresolved, or unsupported disclosed constraints make `valid` false. `constraintPolicy: "best-effort"` turns those findings into warnings, and `"off"` returns `vi.constraints.status: "not_checked"`.

Payment amount bounds are evaluated against AP2 integer minor-unit amounts. Checkout line items use deterministic max-flow matching so overlapping acceptable-item sets produce stable results. Verifiers SHOULD accept both `line_items[]` payloads and AP2 / VI checkout JWT payloads that carry purchased products under `cart.items[]`, with product identity taken from `product.id`, `product.sku`, `id`, or `sku`. `payment.reference` is evaluated against the open checkout mandate disclosure digest and the same final checkout-payment binding used for `checkoutPaymentBindingOk`. Missing checkout payloads, missing closed payment mandates, undisclosed allowed-list entries, and unsupported constraint types are explicit unresolved evidence, not silent passes.

The AP2 / VI crypto conformance corpus lives at `spec/conformance/ap2-vi-crypto/` and is enforced by `@atrib/verify` tests. It is offline by default. Static-JWKS cases fail on unexpected network access, and metadata cases allow only the URLs named by the case. See [D096](../DECISIONS.md#d096-ap2--vi-crypto-conformance-uses-a-pinned-offline-corpus).

The AP2 live interop harness lives in `@atrib/integration` and is opt-in. It accepts AP2 result artifacts plus AP2 / VI evidence JSON produced by a reference AP2 run, then requires `detectTransaction()` and `verifyAp2ViEvidenceAsync()` to agree. When supplied with an atrib transaction-record artifact, it also runs `verifyRecord()`, checks that the record `content_id` matches the AP2 receipt identity, and requires `cross_attestation.missing: false`. The default test suite exercises the artifact contract with local fixtures, including compact receipt JWTs generated by the official AP2 Python SDK and a combined AP2 / VI fixture generated from the official AP2 SDK plus the public Verifiable Intent Python reference implementation. It does not start live AP2 services. See [D097](../DECISIONS.md#d097-ap2-live-interop-uses-an-opt-in-reference-artifact-harness) and [D107](../DECISIONS.md#d107-ap2-counterparty-attestation-signs-atrib-transaction-bytes).

Path 2 producers SHOULD use `signTransactionRecord()` from `@atrib/mcp` when emitting transaction records. The helper signs the [§1.7.6](../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records) canonical bytes with the producer key and preserves any caller-supplied counterparty signers that already signed the same bytes. AP2 counterparties SHOULD use `signTransactionAttestation()` to produce their signer entry over the finalized transaction record bytes. See [D098](../DECISIONS.md#d098-ap2-receipts-stay-external-evidence-for-cross-attestation) and [D107](../DECISIONS.md#d107-ap2-counterparty-attestation-signs-atrib-transaction-bytes).

---

## §12 Evidence Profiles

This profile registers two evidence-envelope profiles under the core registration rule ([§5.5.7](../atrib-spec.md#557-universal-evidence-envelope), [D137](../DECISIONS.md#d137-universal-evidence-envelope-as-the-single-protocol-level-attachment-model)), unamended:

- `https://atrib.dev/v1/evidence/payments-detection` carries detection facts for a transaction record: which rail, which hook matched, and the receipt identity source (the [D095](../DECISIONS.md#d095-ap2-path-2-content_id-uses-a-stable-receipt-identity-ladder) ladder outputs). Profile document: [`docs/evidence-profiles/payments-detection.md`](evidence-profiles/payments-detection.md).
- `https://atrib.dev/v1/evidence/payments-settlement` carries a [§9](#9-settlement-recommendation-document) settlement recommendation document attached as evidence, by hash or archive reference. Profile document: [`docs/evidence-profiles/payments-settlement.md`](evidence-profiles/payments-settlement.md).

Example detection-facts envelope on a transaction record (the envelope schema and tier enum are core-normative per [§5.5.7](../atrib-spec.md#557-universal-evidence-envelope); only the two payments profile URIs are new):

```json
{
  "envelope": 1,
  "profile": "https://atrib.dev/v1/evidence/payments-detection",
  "profile_version": "1.0.0",
  "tier": "verified",
  "facts": {
    "protocol": "AP2",
    "hook": "checkout_receipt",
    "receipt_identity_source": "ap2_receipt"
  },
  "payload": {
    "hash": "sha256:9f2c...",
    "ref": { "kind": "archive", "uri": "https://archive.atrib.dev/v1/evidence/9f2c..." }
  }
}
```

**Tier assignment (exact).** A producer attaching detection facts writes `tier: "declared"`. A verifier that shape-validates the block against the registered profile schema may raise it to `shape`. Only a verifier with the payments-detection profile loaded, re-running the hook match against retrievable payload material, reports `verified`. Note the distinction from core [§8.7](../atrib-spec.md#87-adversarial-threat-model): "external evidence" there names a trust-stack layer, not a tier value; envelope blocks always carry one of the four enum tiers.

**Verifier precedence rule (exact).** For any record, the core verifier runs, in order: (1) signature verification; (2) chain and context checks; (3) for `event_type = transaction`, the distinct-verified-signer count with `cross_attestation_missing` flagging per [§1.7.6](../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records); (4) per evidence block, if the block's `profile` URI is registered by a loaded profile module, run that profile's checks and emit typed facts with the tier it earns; otherwise report the block with `profile_unrecognized: true`, cap its tier at `declared` (the producer's claim, nothing more), and continue. An unrecognized profile MUST NOT invalidate the record or lower the signature or cross-attestation verdicts. Signal, not block, exactly the [D051](../DECISIONS.md#d051-capability-scoped-records-via-directory-published-envelopes) posture.

**AP2 / VI profile ownership.** The `ap2-vi` evidence profile keeps its URI (`https://atrib.dev/v1/evidence/ap2-vi`), its profile document path, and its corpus path unchanged; its normative owner is this profile document through [§11](#11-ap2--verifiable-intent-evidence-checks). The OAuth/MCP, AAuth, and x401 profiles are authorization evidence per [D109](../DECISIONS.md#d109-mcpoauth-authorization-evidence-uses-generic-tiered-evidence-blocks) / [D119](../DECISIONS.md#d119-aauth-evidence-stays-verifier-side) / [D132](../DECISIONS.md#d132-x401-proof-evidence-stays-verifier-side-authorization-evidence): they gate whether an action was authorized, not whether a payment completed, and they stay core-registered.

---

## §13 Scope Boundaries

_This section is informative._

The following topics are outside the scope of this profile. The first five paragraphs relocated from core [§1.8](../atrib-spec.md#18-scope-boundaries); they affect real-world settlement deployments and inform this profile's design.

**Policy versioning.** Policies are identified by URL with no formal versioning. The session policy record ([§7.3](#73-session-policy-record)) captures agreed terms at session time, which partially mitigates this. Policy evaluation uses the current active policy.

**Dispute mechanism.** There is no protocol-defined dispute process. Creators contest recommendations by contacting merchants directly, using the session policy record as evidence.

**Settlement webhook format.** Settlement recommendations are produced on demand only. This specification does not define a push-based delivery mechanism.

**Multi-transaction sessions.** The calculation algorithm ([§8](#8-the-calculation-algorithm)) assumes one transaction node per session. Multiple transactions in a single session require separate calculation runs.

**Agent-published policies.** Agents consume policies but do not publish their own, though the policy format can express learned weights. This specification does not define agent-side policy discovery or publication.

**Step-two packaging.** A standalone `@atrib/payments` package (root re-exports removed, `@atrib/agent` taking the detector set as an optional peer dependency) is separately gated and not part of this profile version. It follows [`docs/publishing-new-npm-package.md`](publishing-new-npm-package.md) and its own decision entry.

---

## §14 Conformance

Corpus paths are stable identifiers; relocating this profile moved no corpus.

- [`spec/conformance/4.6/`](../spec/conformance/4.6/) stays at its historical path. Its vectors are unchanged; the normative owner is now [§8](#8-the-calculation-algorithm). The determinism requirement continues to hold: two runs on identical input MUST produce identical output.
- [`spec/conformance/ap2-vi-crypto/`](../spec/conformance/ap2-vi-crypto/) ([D096](../DECISIONS.md#d096-ap2--vi-crypto-conformance-uses-a-pinned-offline-corpus)) is referenced by [§11](#11-ap2--verifiable-intent-evidence-checks), not moved.
- [`spec/conformance/payments-profile/detection/`](../spec/conformance/payments-profile/detection/) pins per-rail positive and negative detection vectors for [§2](#2-transaction-detection-hooks) and [§3](#3-sdk-transaction-detection): ACP completion with and without an embedded order, UCP `ucp.version` discrimination against an ACP-identical body, x402 v2 and legacy v1 headers with case-insensitivity, MPP `Payment-Receipt` with an x402/MPP cross-contamination negative, AP2 v0.2 receipts with the v0.1 mandate fallback, and the a2a-x402 dual condition.
- The evidence-envelope corpus at [`spec/conformance/evidence-envelope/`](../spec/conformance/evidence-envelope/) carries the `payments-detection--*` and `payments-settlement--*` case families for [§12](#12-evidence-profiles), including the degradation family: records verified with no payments profile loaded keep valid signatures and unchanged cross-attestation semantics while each payments block reports `profile_unrecognized: true` at tier `declared`.
