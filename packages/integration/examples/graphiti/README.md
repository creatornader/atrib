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

## What it proves

- `@atrib/mcp-wrap` can sit in front of a Graphiti MCP-shaped server.
- Calls to `add_memory`, `search_memory_facts`, and `get_episodes` return normal
  Graphiti-shaped MCP results.
- Each call emits a signed atrib `tool_call` record with `tool_name`,
  `args_hash`, and `result_hash`.
- Public records stay hash-only and do not include the raw episode body.
- The same wrapper shape can point at Graphiti's real stdio MCP server once the
  operator has the Graphiti prerequisites running.

## What it does not prove yet

This is an MCP-boundary proof, not a full Python Graphiti core integration, a
live Zep managed-platform proof, or a real graph database run. A send-ready
Graphiti RFC should still include either a real Graphiti MCP server run or a
Python `Graphiti.add_episode(...)` signer proof before asking maintainers to
review it as an integration.

## Source-read notes

The source read on 2026-06-02 used `getzep/graphiti` commit
`34f56e65e0fe2096132c8d16f3a1a4ac9300a5f6`. At that commit, Graphiti core
exposes `Graphiti.add_episode(...)`, while the MCP server registers the
ingestion tool as `add_memory` and fact search as `search_memory_facts`. This
example targets the MCP server code path because the first outreach route is an
RFC issue about MCP-facing signed episode provenance.
