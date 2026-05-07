# atrib spec [§8.2](../../../atrib-spec.md#82-opaque-name-posture) conformance corpus

Test fixtures for the opaque-name posture per spec [§8.2](../../../atrib-spec.md#82-opaque-name-posture) ([D061](../../../DECISIONS.md#d061-add-tool_name-args_hash-result_hash-fields-to-§121)).

The corpus is the shared contract between every implementation that produces or consumes records carrying `tool_name`. It is used by `@atrib/verify` and any third-party verifier implementation that surfaces a `tool_name_form` posture annotation.

## Cases

| File | Asserts |
|---|---|
| `cases/tool-name-omitted.json` | `tool_name` absent. Verifiers MUST surface `tool_name_form: null` per the [§8.1](../../../atrib-spec.md#81-default-posture) default posture. The canonical signing input MUST omit the field entirely. |
| `cases/tool-name-verbatim.json` | `tool_name: "book_flight"`. Verifiers MUST surface `tool_name_form: "plain"`. |
| `cases/tool-name-opaque.json` | `tool_name: "tool_a7f3"`. Verifiers MUST surface `tool_name_form: "plain"`, identical to the verbatim case — per [D061](../../../DECISIONS.md#d061-add-tool_name-args_hash-result_hash-fields-to-121) the verbatim-vs-opaque distinction is NOT structurally detectable (both match the [§8.2](../../../atrib-spec.md#82-opaque-name-posture) opaque regex `[a-z0-9_-]{1,64}`). |
| `cases/tool-name-hashed.json` | `tool_name: "sha256:<64 hex>"`. Verifiers MUST surface `tool_name_form: "hashed"`. The regex `^sha256:[0-9a-f]{64}$` is unambiguous. |

The corpus does NOT include a `tool_name_form: "verbatim"` or `"opaque"` case because those are not part of the verifier-detectable surface — that distinction lives in producer-side intent and out-of-band metadata (e.g., a name registry).

## Generator

`packages/log-dev/scripts/generate-conformance-8.2.ts`. Run with:

```sh
pnpm --filter @atrib/log-dev exec tsx scripts/generate-conformance-8.2.ts
```

Seeds and timestamps are hardcoded so successive regenerations produce byte-identical files. Regenerate when:

- [§8.2](../../../atrib-spec.md#82-opaque-name-posture) form-detection invariant changes
- Canonical record format ([§1.2](../../../atrib-spec.md#12-the-attribution-record) / [§1.3](../../../atrib-spec.md#13-canonical-serialization)) changes
- A new test case is added

## Reference implementation

`packages/verify/test/conformance-8.2.test.ts` loads each case and asserts `tool_name_form` matches expected. Conforming third-party implementations SHOULD load the same fixtures and assert the same invariants.

## Status

**Initial four-case corpus shipped.** Cases cover every detection branch: omitted (null), verbatim (plain), opaque (plain), hashed.
