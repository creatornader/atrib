# x402 test fixtures

Real captured payload shapes from the x402 protocol (Coinbase).

**Sources:**

- https://github.com/coinbase/x402
- https://github.com/coinbase/x402/blob/main/docs/core-concepts/http-402.md
- https://github.com/coinbase/x402/blob/main/typescript/site/CHANGELOG-v2.md (v1 → v2 header rename)

**Protocol version:** x402 v2 (current). v1 is also supported by the detector.
**Verified:** 2026-04-06

## Headers

The on-wire signal is a response header on the 200 success path:

| Version | Request header      | Response header      |
| ------- | ------------------- | -------------------- |
| v2      | `PAYMENT-SIGNATURE` | `PAYMENT-RESPONSE`   |
| v1      | `X-PAYMENT`         | `X-PAYMENT-RESPONSE` |

The v1 `X-PAYMENT-RESPONSE` was renamed to `PAYMENT-RESPONSE` per RFC 6648
(deprecation of the `X-` prefix). The detector accepts both names so a
deployment in transition between versions still works.

The header value is base64-encoded JSON. The decoded shape is in
`payment_response_decoded.json`.

## Files

- `payment_response_decoded.json`: Decoded SettlementResponse object that
  the server includes in the `PAYMENT-RESPONSE` header. We do NOT decode
  this in detection (header presence is sufficient on-wire signal); the
  fixture is here so future tests can validate the shape if we ever need
  to extract `transaction` or `payer` for content_id derivation.

## Redactions

Wallet addresses replaced with placeholder values (`0xPAYER...`,
`0xMERCHANT...`). Transaction hash is a fake value. The shape is exact.
