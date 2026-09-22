# Payments profile detection conformance corpus

Per-rail positive and negative transaction detection vectors for the
[atrib Payments Profile](../../../../docs/payments-profile.md)
([§2](../../../../docs/payments-profile.md#2-transaction-detection-hooks)
detection hooks and
[§3](../../../../docs/payments-profile.md#3-sdk-transaction-detection)
SDK detection contract), landed with the
[D147](../../../../DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core)
spin-out. Rail detection is SDK behavior, not an evidence-envelope
profile; this directory does not claim envelope registration. The
envelope-level payments families live in
[`spec/conformance/evidence-envelope/`](../../evidence-envelope/).

The vectors are hand-pinned from the profile
[§2](../../../../docs/payments-profile.md#2-transaction-detection-hooks)
examples and the published rail specs; there is no generator. Each case is a plain
`detectTransaction(tool_name, response, headers)` input with the
expected detection outcome. Two implementations given the same case
MUST produce the same `detected` and `protocol` result.

## What the cases pin

| Rail          | Cases pin                                                                                                                                                                                |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `acp--*`      | Completion with an embedded order, completion without an order (negative), non-terminal webhook lifecycle events (negative), and a terminal webhook with a stable Order id.              |
| `ucp--*`      | The `ucp.version` envelope discrimination: the same completion body detects as UCP with the envelope and as ACP without it.                                                              |
| `x402--*`     | The v2 `PAYMENT-RESPONSE` header, the legacy v1 `X-PAYMENT-RESPONSE` name, RFC 7230 case-insensitivity, a no-header negative, and x402 precedence when both x402 and MPP headers appear. |
| `mpp--*`      | The `Payment-Receipt` header, case-insensitivity, x402 precedence, and the MCP `org.paymentauth/receipt` result metadata path.                                                           |
| `ap2--*`      | The v0.2 decoded PaymentReceipt hook, the receipt-JWT result envelope, failed-receipt negatives, and mandate-only negatives including v0.1 `PaymentMandate`.                             |
| `a2a-x402--*` | The dual condition: `payment-completed` status AND at least one `success: true` receipt; only-failed-receipts is a negative. Emitted as protocol `a2a-x402`.                             |
| `none`        | Tool names and ordinary responses without published completion evidence remain negative cases.                                                                                           |

## Reference consumer

`packages/agent/test/conformance-payments-profile-detection.test.ts`
loads each committed case through `manifest.json` and drives the real
`detectTransaction()` from `@atrib/agent`. Conforming third-party
detectors SHOULD load the same fixtures and assert the same outcomes.

## Regenerating

Do not regenerate mechanically. A vector changes only when a rail
changes its published wire shape; that change lands as a payments
profile version bump ([§1](../../../../docs/payments-profile.md#1-scope-and-position-in-the-protocol)
versioning rules) with the corpus edit in the same commit.
