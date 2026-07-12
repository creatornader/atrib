# Evidence profile: `human-approval`

- **Type URI:** `https://atrib.dev/v1/evidence/human-approval`
- **Profile version:** `1.0.0` (semver of this document)
- **Status:** atrib-maintained. No legacy [§5.5.6](../../atrib-spec.md#556-generic-authorization-evidence-blocks) protocol string exists for human approval; the legacy set is frozen. This profile is envelope-native.

Carries a human-in-the-loop approval for a high-impact agent action. The payload is the human-signed approval record itself: `ref.record_hash` names it, `ref.kind` states where its body is retrievable, and `payload.hash` commits to its canonical bytes. Human approval is separate signed evidence over the [§3.2.4](../../atrib-spec.md#324-edge-derivation-rules) graph, per [D118](../../DECISIONS.md#d118-primary-trace-path-is-a-presentation-rule-over-trace-and-chain). It never alters `verifyRecord().valid` ([§5.5.7](../../atrib-spec.md#557-universal-evidence-envelope)).

## Payload media type and hash rule

| Media type         | Payload                              | Hash rule                                   |
| ------------------ | ------------------------------------ | ------------------------------------------- |
| `application/json` | Signed atrib approval record         | JCS over the record's canonical bytes       |

`payload.hash` = `"sha256:" + hex(SHA-256(canonicalRecord(record)))` and MUST equal `ref.record_hash`. Because the payload is a record, `ref.record_hash` is set and `ref.kind` is `mirror`, `archive`, or `withheld`, never `inline` (a record body is not an inline evidence blob).

## Facts schema

| Fact             | JSON type | Provenance class  |
| ---------------- | --------- | ----------------- |
| `approver_key`   | string    | caller-attested   |
| `approval_scope` | string    | caller-attested   |
| `decision`       | string    | caller-attested   |

`approver_key` is the base64url Ed25519 key that signed the approval record; `decision` is typically `allow` or `deny`; `approval_scope` names what was approved (e.g. `deploy-production`).

## Tier semantics

- `declared`: approval hash and facts asserted.
- `shape`: approval record parsed and structurally validated.
- `attested`: the approval record's signature accepted by a caller-owned path (typical carriage tier).
- `verified`: the approval record's Ed25519 signature verified against `approver_key`, reproducible from the retrieved record body.

## Verifier behavior

The verifier retrieves the record named by `ref.record_hash` (mirror or archive), recomputes `sha256(JCS(record))`, checks it against `payload.hash`, and verifies the Ed25519 signature against `approver_key`. A `verified` envelope whose record is withheld is reported claimed-but-not-reproducible. The approval is a policy signal for consumers; it does not make the approved action's record valid or invalid.

## Sanitization contract

`approver_key`, `approval_scope`, `decision`, `payload.hash`, and `ref.record_hash` MAY appear in public projections (all are public-key / scope / decision facts). The approval record body itself is disclosed only through mirror/archive retrieval, not embedded in the envelope.

## Sources

- [§5.5.7](../../atrib-spec.md#557-universal-evidence-envelope)
- [D118](../../DECISIONS.md#d118-primary-trace-path-is-a-presentation-rule-over-trace-and-chain), [D137](../../DECISIONS.md#d137-universal-evidence-envelope-as-the-single-protocol-level-attachment-model)
- Envelope corpus: [`spec/conformance/evidence-envelope/`](../../spec/conformance/evidence-envelope/) (`shape/record-hash-sibling` exercises this profile)
