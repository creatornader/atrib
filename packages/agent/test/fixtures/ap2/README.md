# AP2 test fixtures

Payload shapes from Google's Agentic Payment Protocol (AP2) and the related
a2a-x402 extension.

**Sources:**

- AP2 v0.2: https://github.com/google-agentic-commerce/AP2
  - Spec: `docs/ap2/specification.md`
  - Payment receipt schema: `code/sdk/schemas/ap2/payment_receipt.json`
  - Checkout receipt schema: `code/sdk/schemas/ap2/checkout_receipt.json`
- Verifiable Intent: https://verifiableintent.dev/spec/
  - Credential format: `credential-format/`
  - Delegation chain and security model: `security-model/`
- AP2 v0.1 compatibility path: https://github.com/google-agentic-commerce/ap2
  - A2A DataPart shape: `docs/a2a-extension.md`
- a2a-x402: https://github.com/google-agentic-commerce/a2a-x402
  - Spec: `spec/v0.1/spec.md`

**Verified:** 2026-05-27

## What AP2 actually is

AP2 v0.2 uses SD-JWT Checkout and Payment Mandates for authorization. The
transaction close signal is the verifier's successful Checkout Receipt or
Payment Receipt, not the mandate itself.

The detector accepts:

- decoded AP2 receipt objects with `status: "Success"` and the required
  receipt fields;
- signed receipt JWT fields in the AP2 sample result envelopes, such as
  `payment_receipt` or `checkout_receipt`, when the envelope has
  `status: "success"`;
- the older v0.1 `ap2.mandates.PaymentMandate` DataPart shape as a
  compatibility fallback.

The detector rejects AP2 mandate-only payloads, including `vct: "mandate.payment.1"`
and `vct: "mandate.checkout.1"`. Those payloads
authorize a future action; they do not prove the verifier accepted it.

## What Verifiable Intent adds

Verifiable Intent models the authorization side as an SD-JWT delegation
chain. The fixtures cover the two AP2-relevant shapes:

- immediate mode: an L1 issuer credential plus an L2 user mandate that
  discloses closed checkout and payment mandates;
- autonomous mode: an L2 user mandate that discloses open checkout and
  payment mandates delegated to an agent key. The split-agent fixture
  intentionally binds checkout and payment to different agent keys so
  `@atrib/verify` can reject it.

The VI fixtures use static test keys and compact SD-JWT strings. The AP2
receipt `reference` values bind to the disclosed closed-mandate serializations
by `base64url(sha256(ascii(serialized_mandate)))`.

## What a2a-x402 is

a2a-x402 is the AP2 extension for crypto payments via x402. When the
merchant agent settles a payment on-chain, it returns an A2A task with
`status.message.metadata["x402.payment.status"] === "payment-completed"`
and a `x402.payment.receipts` array containing at least one entry with
`success: true`. atrib reports this as `protocol: 'AP2'` since a2a-x402
is the AP2 crypto payment path.

## Files

- `payment_receipt_artifact.json`: AP2 v0.2 A2A artifact carrying an
  `ap2.PaymentReceipt` object. Detection signal: receipt status is
  `Success` and the required payment receipt fields are present.
- `payment_receipt_result.json`: AP2 v0.2 sample result envelope carrying
  a signed `payment_receipt` JWT with `status: "success"`.
- `checkout_receipt_result.json`: AP2 v0.2 sample result envelope carrying
  a signed `checkout_receipt` JWT with `status: "success"`.
- `vi_immediate_evidence.json`: signed VI immediate-mode evidence plus AP2
  checkout and payment receipts whose references match the disclosed closed
  mandates.
- `vi_autonomous_split_agent_evidence.json`: signed VI autonomous-mode
  evidence where open checkout and payment mandates delegate to different
  agent keys. Expected verifier outcome: invalid evidence with
  `vi_l2_cnf_mismatch`.
- `vi_autonomous_constraints_decoded.json`: synthetic decoded open-mandate
  constraint case for `@atrib/verify`'s typed constraint evaluator. It is
  not a signed VI credential fixture. It covers merchant allowlists, checkout
  line items, payment amount ranges, payees, payment instruments, PISPs, and
  execution windows.
- `payment_mandate_message.json`: Real example AP2 PaymentMandate Message
  from the v0.1 `docs/a2a-extension.md` compatibility path. Detection
  signal: `parts[].data["ap2.mandates.PaymentMandate"]` exists.
- `a2a_x402_payment_completed.json`: Real example a2a-x402 payment-completed
  task message from `spec/v0.1/spec.md`. Detection signal:
  `status.message.metadata["x402.payment.status"] === "payment-completed"`
  with at least one `success: true` receipt.

## Redactions

Wallet addresses replaced with placeholder values. Transaction hashes are
fake values. Shape is exact to the published examples.

## Note on the prior W3C VC assumption

The original atrib spec [§1.7.5](../../../../../atrib-spec.md#175-ap2-and-a2a-x402) and the v1 SDK both assumed AP2 would use
W3C Verifiable Credentials with `type: "VerifiableCredential"` and
`credentialSubject.type: "PaymentMandate"`. AP2 v0.2 uses SD-JWT Mandates,
but the current transaction detector still does not treat mandate payloads
as receipts. The VC string-form check remains as a backward-compatible
fallback for older research forks only.
