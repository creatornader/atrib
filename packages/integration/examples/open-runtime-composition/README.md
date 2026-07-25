# Open runtime composition

This local fixture composes the public application and evidence surfaces that
sit around one host-selected Codex rollout file:

1. `@atrib/runtime-log/codex-rollout` returns a [D183](../../../DECISIONS.md#d183-runtime-observation-adapters-separate-reading-from-durable-acceptance) observation batch without
   launching or resuming Codex.
2. `@atrib/operating-graph/observation-journal` atomically commits the complete
   batch, signed observation record, and authoritative cursor.
3. A different signer creates the explicit task-level semantic mapping and a
   bounded view receipt.
4. `@atrib/sdk` signs a linked action request and outcome.
5. A signed [D168](../../../DECISIONS.md#d168-coverage-manifests-make-capture-scope-verifiable) coverage attestation binds the runtime window and exact
   observation, request, and outcome records.
6. An independent receiver verifies the records, bodies, relationships,
   coverage membership, and selected-action binding before one protected
   effect.

Run it from the repository root:

```sh
pnpm --filter @atrib/integration open-runtime-composition
```

The hostile tests omit the outcome from [D168](../../../DECISIONS.md#d168-coverage-manifests-make-capture-scope-verifiable) membership or map the signed
observation into the wrong task. Both cases produce a signed blocked receiver
result and execute no effect.

This is a deterministic local fixture. It does not attach to the operator's
current session, claim complete capture, prove runtime-vendor provenance, turn
telemetry into execution evidence, establish arbitrary result truth, or prove a
deployed product.
