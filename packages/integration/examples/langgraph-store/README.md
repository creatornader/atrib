# LangGraph Store memory attribution

This example wraps a LangGraph JS `BaseStore` style memory surface so each store operation becomes a signed atrib record while the store remains host-owned.

Run it from the repo root:

```bash
pnpm --filter @atrib/integration langgraph-store-smoke
```

What the smoke proves:

- A real `@langchain/langgraph@1.5.0` `entrypoint` can receive an attributed `InMemoryStore`.
- Workflow code still calls `getStore().put`, `getStore().get`, and `getStore().search`.
- LangGraph routes those workflow calls through `BaseStore.batch`; public records use `langgraph.store.batch`.
- The wrapped store returns the same values LangGraph expects.
- Public atrib records carry hashes, operation names, signatures, and chain roots.
- Raw memory text and the underlying put/get/search batch payloads stay in local sidecars, not public records.

What it does not prove yet:

- Python LangGraph store or checkpointer parity.
- A hosted LangGraph Platform deployment.

The integration point is intentionally narrow: wrap the store boundary, not the workflow. Existing LangGraph code keeps its storage backend and graph shape.

The [SDK compatibility test](../../test/langchain-sdk-compat.test.ts) also validates core 1.2.17, native ToolNode/checkpointer behavior, interrupt/resume, store readback, namespace isolation, record signatures, and chain continuity. The related [MCP example](../langchain-js/README.md) covers tool calls and header forks.
