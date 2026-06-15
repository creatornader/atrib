# LangGraph Python checkpointer attribution

This example runs a real Python `langgraph==1.2.4` `StateGraph` compiled with
`InMemorySaver`, then signs each checkpointer event as a hash-only atrib record.

Run it from the repo root:

```bash
pnpm --filter @atrib/integration langgraph-python-checkpointer-smoke
```

What the smoke proves:

- A real Python `StateGraph` can run with `compile(checkpointer=InMemorySaver())`.
- The checkpointer emits real `get_tuple`, `put`, and `put_writes` calls during
  one thread execution.
- The smoke signs one atrib record for each checkpointer event.
- The signed records chain through `chain_root` and `informed_by`.
- Public records carry only hashes, operation names, signatures, and chain data.
- Raw checkpoint state, writes, task ids, and the private note stay in local
  sidecars.

What it does not prove yet:

- LangGraph Platform deployment behavior.
- Postgres, Redis, or other production checkpointer backends.
- LangChain model calls, external tools, or hosted persistence.
- A current LangChain or LangGraph review target.

The integration point is intentionally narrow: sign the checkpointer boundary so
a stateful agent can prove which checkpoint transitions happened without
publishing the private state.
