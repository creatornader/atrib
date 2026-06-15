# Letta memory attribution example

This example imports `letta==0.16.8`, runs Letta's real
`LettaCoreToolExecutor.execute` dispatch for core and archival memory tools,
then signs hash-only atrib records from the host. It also runs Letta's
`ExternalMCPToolExecutor.execute` tag parsing against a fake MCP manager, so the
packet covers the Letta-shaped external tool boundary without starting a server.

The storage side effects are fake managers on purpose. They let the proof run
without a hosted Letta account, Postgres, a vector database, an LLM key, or a
live MCP server while still using Letta's published Python package and schemas.

## Run it

```bash
pnpm --filter @atrib/integration letta-memory-smoke
```

The smoke runs Python through `uv` with:

```bash
uv run --quiet --with letta==0.16.8 --with asyncpg python letta-memory-proof.py
```

`asyncpg` is listed because importing Letta's core executor reaches Letta's ORM
path on `0.16.8`. A plain transient install with only `letta==0.16.8` fails at
import time with `ModuleNotFoundError: No module named 'asyncpg'`.

To include the smoke in the integration test runner, opt in explicitly:

```bash
ATRIB_RUN_LETTA_MEMORY_SMOKE=1 pnpm --filter @atrib/integration test \
  test/letta-memory.test.ts
```

## What it proves

- The proof imports the real `letta` package and real Letta schema objects.
- `LettaCoreToolExecutor.execute` dispatches `core_memory_append`,
  `core_memory_replace`, `memory_apply_patch`, `archival_memory_insert`, and
  `archival_memory_search`.
- `ExternalMCPToolExecutor.execute` resolves a `mcp:<server>` tag and calls a
  fake MCP manager with Letta's normal function name and args.
- Each Letta operation becomes one signed atrib `tool_call` record with
  `tool_name`, `args_hash`, and `result_hash`.
- The signed records verify and chain in one context.
- Public records stay hash-only. Raw memory text, archival query text, and MCP
  payloads stay in local sidecars.

## What it does not prove yet

This is not a hosted Letta API proof, a Letta plugin, a Letta server run, a real
Postgres/vector-store run, or a real external MCP server execution. The manager
classes are fakes, so the proof covers Letta's memory dispatch boundary and
privacy posture, not Letta's production storage behavior.

A future Letta-facing review should start from a same-day proof refresh.
The first issue should ask whether this is the right boundary for a guide,
extension hook, or fixture. It should not claim adoption, hosted Letta
coverage, or external adoption.
