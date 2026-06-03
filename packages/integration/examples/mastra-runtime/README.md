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
store come from `@mastra/core@1.38.0` and `@mastra/mcp@1.9.0`.

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
