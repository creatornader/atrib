# LlamaIndex memory attribution

This example wraps a real LlamaIndex.TS `Memory` object so each memory operation becomes a signed atrib record while memory storage remains host-owned.

Run it from the repo root:

```bash
pnpm --filter @atrib/integration llamaindex-memory-smoke
```

What the smoke proves:

- A real `llamaindex@0.12.1` `createMemory()` instance can be wrapped.
- App code still calls `memory.add()`, `memory.get()`, `memory.getLLM()`, and `memory.snapshot()`.
- LlamaIndex returns the same messages and snapshots it returns without atrib.
- Public atrib records carry hashes, operation names, signatures, and chain roots.
- Raw memory text, Vercel-format messages, LLM context, and snapshots stay in local sidecars, not public records.

What it does not prove yet:

- The Python package path. Use [`../llamaindex-python-memory/`](../llamaindex-python-memory/) for `llama_index.core.memory.Memory`.
- Vector-store memory blocks with an external database.
- A current LlamaIndex review target.

The integration point is intentionally narrow: wrap the memory object, not the agent or workflow. Existing LlamaIndex code keeps its memory backend and retrieval shape.
