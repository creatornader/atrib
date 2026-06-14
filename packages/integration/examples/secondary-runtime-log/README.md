# Secondary runtime-log adapter family

This example proves the `RuntimeLogSource` boundary across two different
adapter shapes:

- LangGraph-checkpointer-shaped runtime log: owns checkpoint identity, resume
  state, and fork semantics.
- OpenInference trace projection: carries a span tree and signed-record refs,
  but does not claim runtime identity, resume, or fork ownership.

Run it:

```bash
pnpm --filter @atrib/integration secondary-runtime-log-smoke
```

The smoke prints one bounded summary with:

- a LangGraph checkpoint window manifest;
- a LangGraph fork manifest bound to the parent window;
- an OpenInference span-tree projection manifest;
- boundary checks that fail if the projection claims runtime-log completeness.

## Boundary

The LangGraph fixture is a source-owned runtime log. Its raw checkpoint bodies
stay local, but the manifest can prove which checkpoint window and fork a claim
depends on.

The OpenInference fixture is a projection over spans. It is useful for trace
inspection, correlation, and signed-record refs. It is not the source of replay
or resume truth. A verifier must go back to the parent runtime when it needs the
actual run log.
