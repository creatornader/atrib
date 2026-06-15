# Graphiti MCP boundary attribution example

This example targets Graphiti's MCP server shape. It wraps a Graphiti-shaped MCP
server through `@atrib/mcp-wrap`, calls `add_memory`, `search_memory_facts`, and
`get_episodes`, then verifies signed atrib records for each call.

## Run it

```bash
pnpm --filter @atrib/integration graphiti-mcp-smoke
```

The smoke uses a local Graphiti MCP-shaped fixture instead of a real graph
database, LLM provider, or Zep managed service. The fixture keeps the current
Graphiti MCP tool names and argument shapes, then stores episodes in memory so
the smoke can run without Docker, Neo4j, FalkorDB, or API keys.

## Optional Real Core Proof

If you have Docker, Ollama, and `uv`, you can also run a real Graphiti core proof
against FalkorDB and local Ollama:

```bash
ollama serve
ollama pull qwen2.5:7b-instruct
ollama pull nomic-embed-text
docker run --rm -p 6379:6379 falkordb/falkordb:latest
pnpm --filter @atrib/integration graphiti-core-ollama-smoke
```

Set `FALKORDB_URI` if your graph database is on another port:

```bash
FALKORDB_URI=redis://127.0.0.1:6380 \
  pnpm --filter @atrib/integration graphiti-core-ollama-smoke
```

That smoke runs `graphiti-core[falkordb]==0.29.1` through `uv`, calls the real
Python `Graphiti.add_episode(...)`, retrieves the episode, searches for the
derived facts, then signs three host-side atrib records:

- `graphiti.core.add_episode`
- `graphiti.core.retrieve_episodes`
- `graphiti.core.search`

The signed records disclose `args_hash` and `result_hash` only. The local
sidecar material remains inspectable in-process, and the public records do not
include the raw episode text or proof phrase.

## What it proves

- `@atrib/mcp-wrap` can sit in front of a Graphiti MCP-shaped server.
- Calls to `add_memory`, `search_memory_facts`, and `get_episodes` return normal
  Graphiti-shaped MCP results.
- Each call emits a signed atrib `tool_call` record with `tool_name`,
  `args_hash`, and `result_hash`.
- Public records stay hash-only and do not include the raw episode body.
- The same wrapper shape can point at Graphiti's real stdio MCP server once the
  operator has the Graphiti prerequisites running.
- The optional core smoke proves a real `Graphiti.add_episode(...)` run can
  compose with host-side atrib signing when FalkorDB and Ollama are available.

## What it does not prove yet

The default smoke is an MCP-boundary proof, not a full Python Graphiti core
integration, a live Zep managed-platform proof, or a real graph database run.
The optional core smoke covers the Python `Graphiti.add_episode(...)` path, but
it is still not a Zep managed-platform proof or a real Graphiti MCP server run.

## Source-read notes

The source read on 2026-06-02 used `getzep/graphiti` commit
`34f56e65e0fe2096132c8d16f3a1a4ac9300a5f6`. At that commit, Graphiti core
exposes `Graphiti.add_episode(...)`, while the MCP server registers the
ingestion tool as `add_memory` and fact search as `search_memory_facts`. This
example targets the MCP server code path because that is where MCP-facing signed
episode provenance can be evaluated.
