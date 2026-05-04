# atrib spec §6.7 conformance corpus

Test fixtures for capability declarations per spec §6.7 (D051).

The corpus is the shared contract between every implementation that consumes records signed by keys with capability envelopes published in the §6 directory. It is used by `@atrib/verify` and any third-party verifier implementation that surfaces a `capability_check` annotation.

## Cases

| File | Asserts |
|---|---|
| `cases/no-envelope-on-claim.json` | Claim has no `capabilities` field. Verifier MUST surface `envelope: null, in_envelope: true, mismatches: [], unresolvable: false`. No constraint = trivially in-envelope. |
| `cases/empty-envelope.json` | Claim has `capabilities: {}`. Per §6.7.1 this declares no scope. Behavior identical to no-envelope-on-claim. |
| `cases/event-types-hit.json` | Record `event_type` is in the envelope's `event_types` allowlist. `in_envelope: true`, full envelope preserved on the result. |
| `cases/event-types-miss.json` | Record `event_type` is NOT in the allowlist. `in_envelope: false` with a mismatch identifying the offending event_type. Per §6.7.3 the mismatch is a SIGNAL not invalidation: `valid` stays true. |
| `cases/expires-at-exceeded.json` | Record `timestamp` is past `envelope.expires_at`. `in_envelope: false` with an `envelope expired` mismatch. Same signal-not-invalidation principle. |
| `cases/tool-names-unresolvable.json` | tool_call record + `tool_names` allowlist. Per §6.7.2 step 2 the constraint requires the record's `tool_name` field, which isn't on the standard record shape (current §1.2.1 exposes only the derived `content_id`). Verifier MUST mark `unresolvable: true`. |
| `cases/transaction-amount-unresolvable.json` | transaction record + `max_amount` constraint. Per §6.7.2 the verifier MUST resolve the transaction amount from the protocol-specific payment event the record commits to. `@atrib/verify` doesn't have access to that out-of-band event, so it marks `unresolvable: true`. Same applies to `counterparties` constraints on transaction records. |

## Generator

`packages/log-dev/scripts/generate-conformance-6.7.ts`. Run with:

```sh
pnpm --filter @atrib/log-dev exec tsx scripts/generate-conformance-6.7.ts
```

Seeds and timestamps are hardcoded so successive regenerations produce byte-identical files. Regenerate when:

- §6.7.2 verifier algorithm changes
- Canonical record format (§1.2 / §1.3) changes
- A new test case is added

## Reference implementation

`packages/verify/test/conformance-6.7.test.ts` loads each case and asserts the full `capability_check` annotation matches `expected.capability_check` deep-equal. Conforming third-party implementations SHOULD load the same fixtures and assert the same invariants.

## Status

**Initial seven-case corpus shipped.** The cases collectively exercise the §6.7.2 algorithm: no envelope (cases 1-2), event_types allowlist hit/miss (cases 3-4), expires_at exceeded (case 5), and the two unresolvable categories where the constraint inputs are not accessible to the verifier (cases 6-7). Per §6.7.3 mismatches are signals, not invalidation: out-of-envelope records remain valid.
