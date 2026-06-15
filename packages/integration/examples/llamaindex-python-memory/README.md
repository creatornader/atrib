# LlamaIndex Python memory attribution

This example signs memory commands from a real Python `llama_index.core.memory.Memory` instance while memory storage stays host-owned.

Run it from the repo root:

```bash
pnpm --filter @atrib/integration llamaindex-python-memory-smoke
```

What the smoke proves:

- A published `llama-index==0.14.22` package import can run in a transient `uv` environment.
- `Memory.from_defaults(...)` can use a `StaticMemoryBlock`.
- App code still calls `put`, `put_messages`, `get`, `get_all`, `set`, and `reset`.
- Public atrib records carry hashes, operation names, signatures, chain roots, and `informed_by` links.
- Raw memory text and retrieved memory context stay in local sidecars, not public records.

What it does not prove yet:

- `VectorMemoryBlock` retrieval or an external vector database. In this package version, `SimpleVectorStore` is not enough for that proof because it does not store nodes directly.
- A full LlamaIndex agent or workflow.
- LLM calls, hosted persistence, or external adoption.
- A current LlamaIndex review target.

The integration point is intentionally narrow: sign the memory commands at the host boundary, keep LlamaIndex storage and retrieval semantics intact, and keep private memory material out of public records.
