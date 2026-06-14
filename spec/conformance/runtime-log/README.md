# Runtime-log proof manifest conformance

This corpus pins the v0 `log_window_manifest` contract accepted in
[D121](../../../DECISIONS.md#d121-runtime-log-proof-manifests-verify-host-owned-run-windows).

The cases are for adapter authors who export host-owned runtime-log windows and
want a fixed verifier target. They cover:

- valid session-definition, event-root, projection-root, receipt-root, and
  hash-only redaction posture;
- ordered event refs;
- event-root mismatch;
- event-count mismatch;
- declared window bounds mismatch;
- session-definition digest mismatch;
- projection-root mismatch;
- required receipt omission;
- side-effect receipt root mismatch;
- fork parent mismatch;
- compaction source mismatch;
- compaction event-root mismatch;
- manifest fields that violate `redaction.fields`.

The reference consumer lives at
[`packages/runtime-log/test/conformance-runtime-log.test.ts`](../../../packages/runtime-log/test/conformance-runtime-log.test.ts).

## Corpus Shape

Each case has this shape:

```json
{
  "id": "event-root-mismatch",
  "manifest": {},
  "evidence": {},
  "expected": {
    "valid": false,
    "issue_codes": ["event_root_mismatch"]
  }
}
```

`manifest` is the `log_window_manifest` under test. `evidence` contains the
local verifier material the host chooses to disclose: event refs,
session-definition object, projection refs, side-effect receipt refs, fork
parent manifest, compaction source manifest, or compacted event refs.

The manifest stores refs and hashes. It does not store raw runtime event bodies.
The `withheld-field-present` case deliberately embeds a placeholder
`raw_prompt` field to prove that verifiers reject fields named by
`redaction.fields`.

## Privacy Boundary

This corpus checks manifest shape and disclosed evidence. It cannot prove that a
host did not keep private raw bodies in its own runtime store. That proof would
come from the host's own controls, a private evidence bundle, or an optional
Record Body Archive Layer submission.

For public fixtures, adapter authors should keep raw prompts, tool arguments,
model outputs, screenshots, database rows, and other private bodies outside the
manifest. Put only event refs, projection refs, receipt refs, manifest hashes,
archive refs, or local evidence paths in public cases.
