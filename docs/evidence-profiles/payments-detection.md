# Evidence profile: `payments-detection`

- **Type URI:** `https://atrib.dev/v1/evidence/payments-detection`
- **Profile version:** `1.0.0` (semver of this document)
- **Status:** atrib-maintained, registered after the initial [D137](../../DECISIONS.md#d137-universal-evidence-envelope-as-the-single-protocol-level-attachment-model) set per [P048](../../DECISIONS.md#p048-payments-profile-spin-out-from-protocol-core). No legacy [§5.5.6](../../atrib-spec.md#556-generic-authorization-evidence-blocks) protocol string exists; the legacy set is frozen. This profile is envelope-native. Its normative owner is the [atrib Payments Profile](../payments-profile.md) ([§12](../payments-profile.md#12-evidence-profiles)).

Carries detection facts for a `transaction` record: which rail fired, which hook matched, and the receipt identity source from the [D095](../../DECISIONS.md#d095-ap2-path-2-content_id-uses-a-stable-receipt-identity-ladder) ladder. The typical payload is the detection material (the completion response, receipt artifact, or header set the hook matched against); `payload.hash` commits to it while the body stays private. Evidence never alters `verifyRecord().valid`, and a detection envelope never substitutes for a counterparty signature: the [§1.7.6](../../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records) cross-attestation minimum is satisfied only by `signers[]` entries over canonical transaction bytes ([D052](../../DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records)).

## Payload media types and hash rules

| Media type         | Payload                                             | Hash rule                |
| ------------------ | --------------------------------------------------- | ------------------------ |
| `application/json` | Detection material (completion response, receipt)   | JCS over canonical bytes |
| `text/plain`       | Raw header block for header-signal rails            | Raw UTF-8 bytes          |

## Facts schema

| Fact                      | JSON type | Provenance class  |
| ------------------------- | --------- | ----------------- |
| `protocol`                | string    | producer-declared |
| `hook`                    | string    | producer-declared |
| `receipt_identity_source` | string    | producer-declared |

`protocol` names the detected rail: `ACP`, `UCP`, `x402`, `MPP`, `AP2`, or `heuristic`. a2a-x402 detections report `AP2` per [payments profile §2.5](../payments-profile.md#25-ap2-and-a2a-x402). `hook` names the matched detection rule from [payments profile §2](../payments-profile.md#2-transaction-detection-hooks); recommended values are `completion_response`, `order_webhook`, `payment_response_header`, `payment_receipt_header`, `payment_receipt`, `checkout_receipt`, `receipt_jwt_envelope`, `payment_mandate_v01`, `a2a_x402_receipt`, `legacy_vc_mandate`, and `tool_name_heuristic`. `receipt_identity_source` is the [D095](../../DECISIONS.md#d095-ap2-path-2-content_id-uses-a-stable-receipt-identity-ladder) ladder rung that produced the record's `content_id` (`payment_receipt`, `payment_receipt_jwt`, `checkout_receipt`, `checkout_receipt_jwt`, `legacy_payment_mandate`, `a2a_x402_receipt`, or `generic`); it is OPTIONAL for rails without a receipt identity ladder.

## Tier semantics

- `declared` — detection facts and payload hash asserted by the producer at emission (the typical tier for Path 2 agent-side detection).
- `shape` — the block shape-validated against this profile's facts vocabulary; no payload retrieval.
- `attested` — a caller-owned path corroborated the detection (for example, a Path 1 merchant record or an upstream webhook receipt observed for the same economic event) without re-running the hook match.
- `verified` — payload material retrieved, `payload.hash` recomputed under the declared hash rule, and the [payments profile §2](../payments-profile.md#2-transaction-detection-hooks) hook named in `facts.hook` re-run against the retrieved material with a matching result.

## Verifier behavior

A verifier with this profile loaded recomputes the payload hash from retrieved detection material and re-runs the named hook, reporting a hash mismatch or hook mismatch as profile-verification failure (`result.valid: false` on the re-verified instance) while the envelope stays shape-valid and the record's signature and cross-attestation verdicts stay untouched. A verifier without this profile loaded reports the block with `profile_unrecognized: true`, caps its tier at `declared`, and continues; an unrecognized profile MUST NOT invalidate the record ([D051](../../DECISIONS.md#d051-capability-scoped-records-via-directory-published-envelopes) posture). Duplicate `signers[]` entries never inflate the distinct-verified-signer count, with or without this envelope attached.

## Sanitization contract

`payload.hash`, `protocol`, `hook`, and `receipt_identity_source` MAY appear in public projections. The detection material itself is private by default: completion responses and receipts routinely carry buyer, order, and account detail. It is disclosed only through mirror or archive retrieval under the operator's own boundary rules, never embedded in the envelope.

## Sources

- [payments profile §2](../payments-profile.md#2-transaction-detection-hooks), [§3](../payments-profile.md#3-sdk-transaction-detection), [§12](../payments-profile.md#12-evidence-profiles)
- [§5.5.7](../../atrib-spec.md#557-universal-evidence-envelope), [§1.7.6](../../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records)
- [P048](../../DECISIONS.md#p048-payments-profile-spin-out-from-protocol-core), [D137](../../DECISIONS.md#d137-universal-evidence-envelope-as-the-single-protocol-level-attachment-model), [D052](../../DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records), [D095](../../DECISIONS.md#d095-ap2-path-2-content_id-uses-a-stable-receipt-identity-ladder)
- Envelope corpus: [`spec/conformance/evidence-envelope/`](../../spec/conformance/evidence-envelope/) (`payments-detection--*` family); hook semantics: [`spec/conformance/payments-profile/detection/`](../../spec/conformance/payments-profile/detection/)
