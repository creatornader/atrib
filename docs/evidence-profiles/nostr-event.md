# Evidence profile: `nostr-event`

- **Type URI:** `https://atrib.dev/v1/evidence/nostr-event`
- **Profile version:** `1.0.0`
- **Status:** atrib-maintained

Carries a signed Nostr event as external evidence. The profile verifies the
NIP-01 event ID and the BIP-340 Schnorr signature. It preserves the event's
author, kind, tags, content commitment, and timestamp claim without treating a
relay as an atrib log or treating a valid signature as proof of the event's
real-world meaning.

## Payload and hash rule

The payload is the complete Nostr event object:

```json
{
  "id": "<64 lowercase hex>",
  "pubkey": "<64 lowercase hex>",
  "created_at": 1713956400,
  "kind": 1,
  "tags": [],
  "content": "signed event",
  "sig": "<128 lowercase hex>"
}
```

The media type is `application/json`. `payload.hash` is SHA-256 over the JCS
form of the complete object. NIP-01 event ID verification separately computes
SHA-256 over the exact JSON serialization
`[0, pubkey, created_at, kind, tags, content]`.

## Facts

| Fact | Type | Provenance |
| --- | --- | --- |
| `event_id` | string | verifier-derived |
| `author_pubkey` | string | verifier-derived |
| `created_at` | integer | producer-declared |
| `kind` | integer | verifier-derived |
| `event_id_valid` | boolean | verifier-derived |
| `signature_valid` | boolean | verifier-derived |

## Tier semantics

- `declared`: the event and payload hash were supplied.
- `shape`: the event has the required NIP-01 field types and bounds.
- `attested`: a caller-owned Nostr client or relay path accepted the event.
- `verified`: the event ID and Schnorr signature verify from the supplied
  bytes.

The `verified` tier does not establish relay acceptance, persistence,
membership, authorization, delivery, uniqueness, or real-world truth. Those
claims require separate evidence and policy.

## Sanitization

Event IDs, author keys, kinds, timestamps, tag names, signature verdicts, and
payload hashes may appear in public projections. Event content and tag values
follow the source application's privacy policy. Encrypted content remains
ciphertext; verification does not imply decryption.

## Implementation

`@atrib/verify` exports `deriveNostrEventId()` and `verifyNostrEvent()`.
Conformance cases live in
[`spec/conformance/evidence-envelope/`](../../spec/conformance/evidence-envelope/)
under `nostr-event--*`.
