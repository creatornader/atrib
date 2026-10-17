# Mastra runtime receipt example

This example targets two Mastra runtime boundaries:

- MCP tool execution through a real `@mastra/mcp` `MCPServer` and `MCPClient`
  over stdio.
- Workflow suspend/resume through real `@mastra/core` `createWorkflow()`,
  `createStep()`, `Run.start()`, `Run.resume()`, and `InMemoryStore`
  snapshots.

## Run It

```bash
pnpm --filter @atrib/integration mastra-runtime-smoke
```

```bash
pnpm --filter @atrib/integration mastra-workflow-suspend-resume-smoke
```

Both smokes are local and credential-free. They do not call a hosted Mastra
Platform agent, a live model, or a database. The fake part is the procurement
approval payload; the MCP server, stdio transport, MCP client, tool listing,
tool execution path, workflow engine, suspend point, resume call, and snapshot
store come from `@mastra/core@1.78.0` and `@mastra/mcp@2.4.1`.

## What It Proves

- `@mastra/mcp` can expose a Mastra `createTool()` tool through `MCPServer`.
- `MCPClient.listTools()` returns a namespaced executable tool over stdio.
- The atrib recorder signs one `tool_call` record with `tool_name`,
  `args_hash`, and `result_hash`.
- A Mastra workflow can suspend at an approval step, persist enough state in
  `InMemoryStore`, resume through `Run.resume()`, and finish with a real
  workflow result.
- The workflow smoke signs four hash-only atrib records: workflow start, step
  suspended, workflow resume, and workflow result.
- The workflow records link through `informed_by`, so the resume cannot be read
  as an isolated event.
- Public records stay hash-only and do not include raw tool arguments or tool
  results.
- Local sidecars keep the inspectable Mastra server name, namespaced tool name,
  tool call id, workflow run id, suspend payload, resume payload, arguments, and
  results.

## What It Does Not Prove Yet

This is a Mastra runtime proof, not a shipped `@atrib/agent` adapter. It also
does not cover hosted Mastra Platform run imports, post-hoc event APIs, skill
loading, memory state, file-system context, tracing export, eval replay, or MCP
auth diagnostics. Those remain source-reading gates before a Mastra adapter
shape can be chosen.

## MCP 2 compatibility checks

The [upstream migration guide](https://mastra.ai/reference/migrations/mcp-v2)
requires a compatible Mastra core alongside MCP 2. Servers serve the 2026-07-28
protocol. Tools that need input use suspend/resume with a per-server client
`inputRequests` handler. Direct `executeTool()` calls return a completed or
suspended status explicitly.

`mastra-compat-server.ts` is a local test fixture. Its counters prove that invalid
arguments never reach the handler and that rejected resume answers never complete
the fixture action. It uses a public fixture continuation key and no real
credentials or external effects. The [native tests](../../test/mastra-mcp2-compat.test.ts)
cover schema rejection, backend errors, same-client recovery, signed error
receipts, and accepted, declined, malformed, and absent answers. The original
workflow smoke still verifies persisted suspend/resume and signed causal links.

```bash
pnpm --filter @atrib/integration exec vitest run test/mastra-runtime-receipt.test.ts test/mastra-mcp2-compat.test.ts
pnpm --filter @atrib/integration typecheck:mastra-examples
pnpm --filter @atrib/integration test:mastra-packed
```

The [packed check](../../scripts/check-mastra-packed.mjs) installs the local MCP
archive and these exact Mastra versions in a fresh pnpm consumer. It runs both
test files and strict typechecking outside the workspace. Production atrib
endpoints stay blocked by the copied test guard. No model calls run.

The old provider-utils v5 alias, its two overrides, and its compatibility patch
are retired. Core 1.78 no longer depends on that alias; it uses the v6 and v7
provider-utils lines. Other SDK versions remain unchanged.
