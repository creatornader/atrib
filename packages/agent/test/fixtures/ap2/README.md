# AP2 test fixtures

Real captured payload shapes from Google's Agent Payments Protocol (AP2)
and the related a2a-x402 extension.

**Sources:**
- AP2 v0.1: https://github.com/google-agentic-commerce/ap2
  - Spec: `docs/specification.md`
  - A2A extension: `docs/a2a-extension.md`
  - Extension URI: `https://github.com/google-agentic-commerce/ap2/tree/v0.1`
- a2a-x402: https://github.com/google-agentic-commerce/a2a-x402
  - Spec: `spec/v0.1/spec.md`

**Verified:** 2026-04-06

## What AP2 actually is

AP2 v0.1 is a protocol built on top of A2A (Agent2Agent) that uses A2A
Messages with a specific DataPart shape to convey payment intent (`IntentMandate`),
cart commitment (`CartMandate`), and the actual payment authorization
(`PaymentMandate`). AP2 does NOT use W3C Verifiable Credentials in v0.1
despite earlier guesses to the contrary in the Atrib spec.

The detection signal for a transaction event is the presence of
`ap2.mandates.PaymentMandate` inside any of the message's `parts[].data`
objects. (`IntentMandate` and `CartMandate` represent earlier funnel
stages and are NOT transaction events.)

## What a2a-x402 is

a2a-x402 is the AP2 extension for crypto payments via x402. When the
merchant agent settles a payment on-chain, it returns an A2A task with
`status.message.metadata["x402.payment.status"] === "payment-completed"`
and a `x402.payment.receipts` array containing at least one entry with
`success: true`. Atrib reports this as `protocol: 'AP2'` since a2a-x402
IS the AP2 crypto payment path.

## Files

- `payment_mandate_message.json` — Real example AP2 PaymentMandate Message
  from `docs/a2a-extension.md`. Detection signal: `parts[].data["ap2.mandates.PaymentMandate"]` exists.
- `a2a_x402_payment_completed.json` — Real example a2a-x402 payment-completed
  task message from `spec/v0.1/spec.md`. Detection signal:
  `status.message.metadata["x402.payment.status"] === "payment-completed"`
  with at least one `success: true` receipt.

## Redactions

Wallet addresses replaced with placeholder values. Transaction hashes are
fake values. Shape is exact to the published examples.

## Note on the prior W3C VC assumption

The original Atrib spec §1.7.5 and the v1 SDK both assumed AP2 would use
W3C Verifiable Credentials with `type: "VerifiableCredential"` and
`credentialSubject.type: "PaymentMandate"`. AP2 v0.1 does not. The
detector keeps the VC string-form check as a backward-compatible fallback
for any AP2 research fork that does use VCs, but the canonical detection
path uses the real A2A DataPart shape and the a2a-x402 metadata.
