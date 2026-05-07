# atrib spec [§8.3](../../../atrib-spec.md#83-salted-commitment-posture) conformance corpus

Test fixtures for the salted-commitment posture per spec [§8.3](../../../atrib-spec.md#83-salted-commitment-posture) ([D045](../../../DECISIONS.md#d045-privacy-postures-normative-spec-section)).

The corpus is the shared contract between every implementation that produces or consumes records carrying `args_salt` / `result_salt`. It is used by `@atrib/verify`, `services/atrib-emit`, and any third-party implementation that asserts the [§8.3](../../../atrib-spec.md#83-salted-commitment-posture) detection invariants.

## Cases

| File | Asserts |
|---|---|
| `cases/default-posture.json` | A record with neither `args_salt` nor `result_salt`. Verifiers MUST surface `args_commitment_form = "plain-sha256"` and `result_commitment_form = "plain-sha256"`. The canonical signing input MUST omit both fields entirely. |
| `cases/args-salted.json` | A record with `args_salt` only. Verifiers MUST surface `args_commitment_form = "salted-sha256"` and `result_commitment_form = "plain-sha256"`. Confirms JCS sort position (`args_salt` between `annotates` and `chain_root`). |
| `cases/result-salted.json` | A record with `result_salt` only. Verifiers MUST surface `args_commitment_form = "plain-sha256"` and `result_commitment_form = "salted-sha256"`. Confirms JCS sort position (`result_salt` between `provenance_token` and `revises`). |
| `cases/both-salted.json` | A record with both salts. Verifiers MUST surface both forms as `salted-sha256`. Confirms the two fields are independent dials per [§8.3](../../../atrib-spec.md#83-salted-commitment-posture). |

The [§8.3](../../../atrib-spec.md#83-salted-commitment-posture) `hmac-sha256` variant is signaled out-of-band per spec and is NOT structurally detectable from record fields alone, so it is not represented in this corpus.

## Generator

`packages/log-dev/scripts/generate-conformance-8.3.ts`. Run with:

```sh
pnpm --filter @atrib/log-dev exec tsx scripts/generate-conformance-8.3.ts
```

Seeds, salts, and timestamps are hardcoded so successive regenerations produce byte-identical files. Regenerate when:

- [§8.3](../../../atrib-spec.md#83-salted-commitment-posture) detection invariant changes
- Canonical record format ([§1.2](../../../atrib-spec.md#12-the-attribution-record) / [§1.3](../../../atrib-spec.md#13-canonical-serialization)) changes
- A new test case is added

## Reference implementation

`packages/verify/test/conformance-8.3.test.ts` loads each case and asserts every expected field. Conforming third-party implementations SHOULD load the same fixtures and assert the same invariants.

## Status

**Initial four-case corpus shipped.** The four cases collectively cover every salt-presence combination a [§8.3](../../../atrib-spec.md#83-salted-commitment-posture) verifier will see in production records.
