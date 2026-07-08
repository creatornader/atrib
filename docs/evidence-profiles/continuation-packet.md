# Evidence profile: `continuation-packet`

- **Type URI:** `https://atrib.dev/v1/evidence/continuation-packet`
- **Profile version:** `1.0.0` (semver of this document)
- **Status:** atrib-maintained, registered after the initial [D137](../../DECISIONS.md#d137-universal-evidence-envelope-as-the-single-protocol-level-attachment-model) set per [D142](../../DECISIONS.md#d142-orchestration-topology-baton-pass-and-join-records-as-attest-conventions). No legacy [§5.5.6](../../atrib-spec.md#556-generic-authorization-evidence-blocks) protocol string exists; the legacy set is frozen. This profile is envelope-native.

Carries the continuation packet a baton-pass record hands to a successor agent, per the [D142](../../DECISIONS.md#d142-orchestration-topology-baton-pass-and-join-records-as-attest-conventions) orchestration-topology conventions (the packet shape itself is [P036](../../DECISIONS.md#p036-cross-harness-continuation-packet-for-supportrca-investigations)'s concern). The typical payload is the packet document; `payload.hash` commits to its bytes while the body stays private. When the carried material is itself a signed atrib record (a baton-pass observation), the `ref.record_hash` sibling rule of [§5.5.7](../../atrib-spec.md#557-universal-evidence-envelope) applies. Evidence never alters `verifyRecord().valid`.

## Payload media types and hash rules

| Media type         | Payload                                   | Hash rule                             |
| ------------------ | ----------------------------------------- | ------------------------------------- |
| `text/markdown`    | Continuation packet document              | Raw UTF-8 bytes                       |
| `application/json` | Structured packet, or a signed atrib record | JCS over canonical bytes            |

When the payload is a signed record, `payload.hash` MUST equal `ref.record_hash` and `ref.kind` is `mirror`, `archive`, or `withheld`, never `inline`.

## Facts schema

| Fact                  | JSON type | Provenance class   |
| --------------------- | --------- | ------------------ |
| `target_harness_role` | string    | producer-declared  |
| `target_principal`    | string    | producer-declared  |
| `reason`              | string    | producer-declared  |
| `baton_record_hash`   | string    | caller-attested    |

`target_harness_role` names the receiving side in role terms (e.g. `successor-session`, `relay-executor`, `loop-layer`), never local tool or product names. `target_principal` is the base64url Ed25519 principal key of the intended successor, when known. `reason` states why the baton passed, in one line. `baton_record_hash` is the signed baton-pass observation this packet accompanies. `target_principal` and `baton_record_hash` are OPTIONAL.

## Tier semantics

- `declared` — packet hash and routing facts asserted at handoff (the typical emission tier).
- `shape` — packet retrieved and structurally parsed; facts consistent with its content.
- `attested` — a caller-owned path observed the successor's receipt record (an observation whose `informed_by` names `baton_record_hash`).
- `verified` — packet bytes retrieved and `payload.hash` recomputed; the baton record's Ed25519 signature verified; and, when the successor presents a [§1.11](../../atrib-spec.md#111-delegation-certificates) delegation certificate, the [§1.11.4](../../atrib-spec.md#1114-verifier-walk) walk passes with its principal matching `target_principal`.

## Verifier behavior

The verifier recomputes the payload hash from retrieved packet bytes under the declared media type's hash rule, verifies the baton record named by `baton_record_hash` when supplied, and reports a hash mismatch as profile-verification failure (`result.valid: false` on the re-verified instance) while the envelope stays shape-valid and the underlying records stay untouched. A `verified` envelope whose packet is withheld is reported claimed-but-not-reproducible.

## Sanitization contract

`payload.hash`, `target_harness_role`, `target_principal`, `reason`, and `baton_record_hash` MAY appear in public projections. The packet body itself is private by default — continuation packets routinely carry context specific to the operating environment — and is disclosed only through mirror/archive retrieval under the operator's own boundary rules, never embedded in the envelope.

## Sources

- [§5.5.7](../../atrib-spec.md#557-universal-evidence-envelope)
- [D142](../../DECISIONS.md#d142-orchestration-topology-baton-pass-and-join-records-as-attest-conventions), [D137](../../DECISIONS.md#d137-universal-evidence-envelope-as-the-single-protocol-level-attachment-model), [D140](../../DECISIONS.md#d140-delegation-certificates-principal-keys-certify-ephemeral-run-keys)
- Envelope corpus: [`spec/conformance/evidence-envelope/`](../../spec/conformance/evidence-envelope/) (`continuation-packet--*` family)
