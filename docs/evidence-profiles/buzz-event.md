# Evidence profile: `buzz-event`

- **Type URI:** `https://atrib.dev/v1/evidence/buzz-event`
- **Profile version:** `1.0.0`
- **Status:** atrib-maintained

Carries a Buzz Nostr event and verifies the event-carried claims that can be
checked outside the Buzz operator's environment. It composes the
[`nostr-event`](nostr-event.md) checks with Buzz NIP-OA owner attestation.

This profile separates five claims that Buzz application code often joins:

1. the agent key signed the event;
2. an owner key authorized that agent key under stated conditions;
3. a named Buzz community admitted the event;
4. a relay accepted and retained the event or added it to its audit chain;
5. a runtime, tool, or workflow action actually occurred.

The raw event can establish the first two. It cannot establish the last three.

## Payload and hash rule

The payload is the complete Buzz Nostr event object under the
`application/json` and JCS hash rule from
[`nostr-event`](nostr-event.md#payload-and-hash-rule).

An optional NIP-OA tag has this exact shape:

```json
["auth", "<owner-pubkey>", "<conditions>", "<owner-signature>"]
```

The owner signs
`SHA256("nostr:agent-auth:" || event.pubkey || ":" || conditions)`. The agent
remains the event author. The owner signature is authorization evidence, not an
identity override.

## Facts

| Fact | Type | Provenance |
| --- | --- | --- |
| `event_id` | string | verifier-derived |
| `agent_pubkey` | string | verifier-derived |
| `owner_pubkey` | string or null | verifier-derived |
| `owner_conditions` | string or null | producer-declared |
| `owner_attestation_valid` | boolean | verifier-derived |
| `community_host` | string or null | caller-attested |
| `relay_url` | string or null | caller-attested |
| `relay_acceptance` | boolean or null | caller-attested |
| `audit_inclusion` | boolean or null | caller-attested |
| `runtime_action_binding` | boolean or null | caller-attested |

## Verification boundary

`@atrib/verify` checks:

- NIP-01 event shape, event ID, and agent signature;
- zero or one NIP-OA `auth` tag;
- owner and agent keys are distinct;
- the NIP-OA condition grammar and exact signed condition string;
- every `kind` and `created_at` condition against the event;
- the owner Schnorr signature.

NIP-OA `created_at` clauses constrain a timestamp chosen by the agent. They do
not enforce wall-clock expiry. The profile reports community binding, relay
acceptance, audit inclusion, and runtime-action binding as unresolved unless
separate evidence supplies them.

Buzz's current NIP-01 `OK` response is not a portable signed receipt. Its
Postgres audit hash chain has no client inclusion proof or independently
witnessed checkpoint. A valid event or NIP-OA tag must not be promoted into
either claim.

## Tier semantics

- `declared`: event hash and Buzz facts were supplied.
- `shape`: the Nostr event and NIP-OA tag parsed.
- `attested`: a caller-owned Buzz client or relay path accepted the material.
- `verified`: the Nostr event and any required NIP-OA attestation verify.

The `verified` tier applies only to the checks named in the result. Unresolved
relay or runtime constraints remain unresolved within a verified envelope.

## Sanitization

Event IDs, agent and owner keys, event kind, condition string, verification
verdicts, and payload hash may appear publicly. Community hosts and relay URLs
may reveal workspace membership and should remain private unless the operator
explicitly marks them public. Event content follows the source event's privacy
policy.

## Implementation

`@atrib/verify` exports `verifyBuzzOwnerAttestation()` and
`verifyBuzzEvent()`. Conformance cases live in
[`spec/conformance/evidence-envelope/`](../../spec/conformance/evidence-envelope/)
under `buzz-event--*`.
