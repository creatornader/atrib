# atrib spec §2.6.1 conformance corpus

A canonical set of test fixtures for the atrib log submission API. This corpus is the **shared contract** between every atrib log implementation:

- [`@atrib/log-dev`](../../../packages/log-dev/) — the in-memory TypeScript dev stub
- [`services/log/`](../../../services/log/) — the future Tessera-backed Go service (not yet built)
- any third party that wants to run a conformant atrib log

If your log implementation passes this corpus, it agrees with `@atrib/mcp`'s submission queue on the wire format defined in [`atrib-spec.md` §2.6.1](../../../atrib-spec.md). If it doesn't, the spec is the arbiter.

## What's in the corpus

```
spec/conformance/2.6.1/
  README.md           # this file
  manifest.json       # corpus metadata + index of all cases and sequences
  cases/              # single-request test cases
    accept-tool-call.json
    accept-transaction.json
    reject-bad-signature.json           # §2.6.1 Step 1
    reject-wrong-spec-version.json      # §2.6.1 Step 2
    reject-unknown-event-type.json      # §2.6.1 Step 3
    reject-future-timestamp.json        # §2.6.1 Step 4
    reject-malformed-context-id.json    # §2.6.1 Step 5
    reject-non-json-body.json           # pre-Step-1 sanity
  sequences/          # multi-request test cases
    idempotent-resubmission.json        # §2.6.1 Step 6
```

Each case file has the same shape:

```jsonc
{
  "name": "accept-tool-call",
  "spec_section": "2.6.1",
  "validation_step": null, // null for accept cases, 0-6 for reject cases
  "description": "...",
  "request": {
    "method": "POST",
    "path": "/v1/entries",
    "headers": { "Content-Type": "application/json" },
    "body": {
      /* the bare signed AtribRecord, ready to JSON.stringify */
    },
    "body_is_raw_string": false, // optional — true for non-JSON-body cases
  },
  "expected": {
    "status": 200,
    "error_contains": "...", // optional substring in body.error for reject cases
    "response_shape": {
      // optional shape check for accept cases
      "log_index": "number",
      "checkpoint": "string",
      "inclusion_proof": "array",
      "leaf_hash": "string",
    },
  },
  "notes": "...", // optional implementation guidance
}
```

Sequences are similar but contain a `steps` array, each step having its own request and expected outcome. Sequences also include a `post` block describing log invariants that must hold after all steps complete (e.g., `log_size: 1` for the idempotency case).

## How to consume the corpus

1. Read `manifest.json` to discover the case and sequence file lists, the `reference_time_ms` (see "Time handling" below), and the deterministic signing inputs.
2. For each case in `cases/`, send the described HTTP request to your log and assert the response matches `expected`.
3. For each sequence in `sequences/`, run the steps in order, capturing values where requested (e.g., `capture_log_index_as`) and asserting later steps match (`log_index_matches`).
4. After each test, reset the log to a clean state (the dev log uses one fresh `startDevLog()` per test).
5. If your implementation cannot honor a particular case (e.g., it intentionally skips a validation step), maintain a per-implementation skip list with a justification — never silently disable a case. The TS reference consumer at [`packages/log-dev/test/conformance.test.ts`](../../../packages/log-dev/test/conformance.test.ts) does this for `reject-bad-signature` because the dev log skips Step 1.

## Time handling

The corpus stores **fully-signed records with frozen timestamps**. This makes the corpus byte-deterministic across runs but means the `reject-future-timestamp` case (§2.6.1 Step 4) only behaves correctly if the log thinks "now" matches `manifest.reference_time_ms`.

Test consumers MUST mock the system clock to `reference_time_ms` before sending cases. In the TypeScript reference consumer, this is done with `vi.useFakeTimers()` + `vi.setSystemTime()`. In Go you would inject a `clock.Clock` into the validator under test.

`reference_time_ms` is set to `2026-01-01T00:00:00Z` and is committed in `manifest.json`. Regenerate the corpus only when you intend to invalidate the existing fixtures.

## Signing keys

The corpus uses a hardcoded Ed25519 seed (`0x07` repeated 32 times — see `manifest.json`'s `signing.seed_b64url`). **This seed must NEVER be used in production.** It exists solely so the corpus is byte-deterministic across regenerations and so any implementation can independently re-derive `creator_key` from the seed if it wants to verify the test signatures itself.

The `creator_key` and `context_id` are also pinned in the manifest so consumers don't need to re-derive them at test time.

## Regenerating the corpus

```bash
pnpm --filter @atrib/log-dev corpus
```

This runs [`packages/log-dev/scripts/generate-conformance-corpus.ts`](../../../packages/log-dev/scripts/generate-conformance-corpus.ts), which uses `signRecord` from `@atrib/mcp` (the canonical signer) to produce all fixtures. Successive runs are byte-identical unless you change the inputs at the top of the generator (`SEED`, `REFERENCE_TIME_MS`, `CONTEXT_ID`, `CONTENT_ID`).

Regenerate when:

- A spec §2.6.1 validation rule changes
- The canonical record format (§1.2) or JCS encoding changes
- A new test case is needed (e.g., spec §2.6.1 grows a Step 7)

After regenerating, review the diff carefully — the whole point of byte-determinism is that diffs in PR review are trivial to read.

## Why this lives at `spec/conformance/` rather than inside a package

The corpus is shared infrastructure between TypeScript and Go (and possibly other) implementations. If it lived inside `packages/log-dev/test/fixtures/`, the future Go service would have to either copy it or reach across language boundaries to consume it. Sitting at `spec/conformance/` next to `atrib-spec.md` makes it discoverable from the spec itself and accessible from any subtree of the repo.

The generator and the TypeScript test consumer live in `@atrib/log-dev` because that's where the canonical signer (`@atrib/mcp`'s `signRecord`) is reachable as a workspace dep — but the corpus output is implementation-neutral.

## See also

- [`atrib-spec.md` §2.6.1](../../../atrib-spec.md) — the normative spec text the corpus tests
- [`packages/log-dev/scripts/generate-conformance-corpus.ts`](../../../packages/log-dev/scripts/generate-conformance-corpus.ts) — the corpus generator
- [`packages/log-dev/test/conformance.test.ts`](../../../packages/log-dev/test/conformance.test.ts) — the TypeScript reference consumer
- [`services/log/README.md`](../../../services/log/README.md) — the future Go log service that will also consume this corpus
