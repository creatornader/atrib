# MPP test fixtures

Real captured payload shapes from the Machine Payments Protocol (MPP).

**Sources:**

- https://github.com/tempoxyz/mpp-specs
- https://datatracker.ietf.org/doc/draft-ryan-httpauth-payment/ (`draft-ryan-httpauth-payment-01`, "The 'Payment' HTTP Authentication Scheme", co-authored by engineers from Tempo Labs and Stripe)
- https://mpp.dev/overview
- https://stripe.com/blog/machine-payments-protocol (March 2026 launch)

**Protocol version:** `draft-ryan-httpauth-payment-01`
**Verified:** 2026-04-06

## Protocol shape

MPP is an HTTP authentication scheme. The flow:

1. Client requests a paid resource: `GET /resource`
2. Server returns `402 Payment Required` with `WWW-Authenticate: Payment ...` describing what payment is needed
3. Client fulfills payment off-band (any supported method: stablecoin, card, Bitcoin Lightning, etc.)
4. Client retries: `GET /resource` with `Authorization: Payment <credential>`
5. Server validates the credential, settles, and returns `200 OK` with `Payment-Receipt: <base64url-nopad JSON>` in the response

The detector triggers on step 5, presence of the `Payment-Receipt` header on a successful response.

## Required fields in the decoded receipt

Per draft §5.3:

| Field       | Type   | Value                                                       |
| ----------- | ------ | ----------------------------------------------------------- |
| `status`    | string | `"success"` (the only canonical value for the success path) |
| `method`    | string | Payment method identifier                                   |
| `timestamp` | string | RFC 3339 settlement timestamp                               |
| `reference` | string | Method-specific reference / receipt ID                      |

The spec says: _"Servers MUST NOT return a Payment-Receipt header on error responses."_ So header presence is a reliable detection signal.

## Files

- `payment_receipt_decoded.json`, Example decoded `Payment-Receipt` payload. We do NOT decode this in detection (header presence is the on-wire signal); fixture is here for future shape validation.

## How MPP differs from x402

Both protocols build on HTTP 402 but use different on-wire mechanisms:

- **x402** uses custom request/response headers: `PAYMENT-SIGNATURE` (request) and `PAYMENT-RESPONSE` (response, base64-encoded JSON SettlementResponse)
- **MPP** uses HTTP standard authentication headers: `WWW-Authenticate: Payment` (challenge) and `Authorization: Payment` (credential), with `Payment-Receipt` as the success signal

They are not mutually exclusive, a single endpoint could in principle support both, and the detector treats them as distinct protocols.

## Redactions

Stripe charge ID replaced with a fake `ch_3OqXYZ...` value. Timestamp uses a fake date. Shape is exact.
