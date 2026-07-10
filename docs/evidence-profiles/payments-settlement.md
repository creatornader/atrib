# Evidence profile: `payments-settlement`

- **Type URI:** `https://atrib.dev/v1/evidence/payments-settlement`
- **Profile version:** `1.0.0` (semver of this document)
- **Status:** atrib-maintained, registered after the initial [D137](../../DECISIONS.md#d137-universal-evidence-envelope-as-the-single-protocol-level-attachment-model) set per [P048](../../DECISIONS.md#p048-payments-profile-spin-out-from-protocol-core). No legacy [§5.5.6](../../atrib-spec.md#556-generic-authorization-evidence-blocks) protocol string exists; the legacy set is frozen. This profile is envelope-native. Its normative owner is the [atrib Payments Profile](../payments-profile.md) ([§12](../payments-profile.md#12-evidence-profiles)).

Carries a settlement recommendation document ([payments profile §9](../payments-profile.md#9-settlement-recommendation-document)) attached as evidence, by hash or archive reference. `payload.hash` commits to the document while the body stays private by default. Evidence never alters `verifyRecord().valid`; whether a merchant acts on a recommendation is downstream policy.

## Payload media types and hash rules

| Media type         | Payload                            | Hash rule                |
| ------------------ | ---------------------------------- | ------------------------ |
| `application/json` | Settlement recommendation document | JCS over canonical bytes |

## Facts schema

| Fact               | JSON type | Provenance class  |
| ------------------ | --------- | ----------------- |
| `context_id`       | string    | producer-declared |
| `calculated_by`    | string    | producer-declared |
| `policy_record_id` | string    | producer-declared |
| `graph_tree_size`  | number    | producer-declared |

`context_id` is the 32-hex session the recommendation covers. `calculated_by` is the calculator identity from the document (`"local"` or a resolution-service URL). `policy_record_id` is the session policy record id, or `"default"` per [payments profile §7.2](../payments-profile.md#72-conflict-resolution) Rule 7. `graph_tree_size` pins the log state the calculation used ([payments profile §9.3](../payments-profile.md#93-independent-verification)). All four copy from the committed document; on a `verified` instance they are verifier-derived from the retrieved body.

## Tier semantics

- `declared` — document hash and facts asserted at attach time. Nothing checked.
- `shape` — document retrieved and schema-validated against [payments profile §9.1](../payments-profile.md#91-document-format); facts consistent with its content.
- `attested` — a caller-owned path accepted the document (for example, its Ed25519 signature checked against the `calculated_by` key) without reproducing the calculation.
- `verified` — document retrieved, `payload.hash` recomputed over its JCS bytes, its signature verified per [payments profile §9.2](../payments-profile.md#92-signing-the-recommendation), and the [payments profile §10.1](../payments-profile.md#101-verifying-a-settlement-recommendation) recalculation reproduced the `distribution` within the 1e-9 tolerance at the pinned `graph_tree_size`.

## Verifier behavior

The verifier recomputes the payload hash from the retrieved document and reports a mismatch as profile-verification failure (`result.valid: false` on the re-verified instance) while the envelope stays shape-valid and the underlying records stay untouched. Recalculation follows the pure-function discipline of [payments profile §8](../payments-profile.md#8-the-calculation-algorithm): same graph snapshot, same policy, no network beyond fetching the pinned inputs. A `verified` envelope whose document is withheld is reported claimed-but-not-reproducible.

## Sanitization contract

`payload.hash`, `context_id`, `calculated_by`, `policy_record_id`, and `graph_tree_size` MAY appear in public projections. The document body is private by default: the `distribution` map carries creator public keys and share fractions, which are settlement-relationship detail. It is disclosed only through mirror or archive retrieval under the operator's own boundary rules, never embedded in the envelope.

## Sources

- [payments profile §9](../payments-profile.md#9-settlement-recommendation-document), [§10](../payments-profile.md#10-settlement-verification), [§12](../payments-profile.md#12-evidence-profiles)
- [§5.5.7](../../atrib-spec.md#557-universal-evidence-envelope)
- [P048](../../DECISIONS.md#p048-payments-profile-spin-out-from-protocol-core), [D137](../../DECISIONS.md#d137-universal-evidence-envelope-as-the-single-protocol-level-attachment-model)
- Envelope corpus: [`spec/conformance/evidence-envelope/`](../../spec/conformance/evidence-envelope/) (`payments-settlement--*` family); calculation vectors: [`spec/conformance/4.6/`](../../spec/conformance/4.6/)
