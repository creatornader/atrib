# Mastra runtime receipt example

This example targets Mastra's MCP runtime boundary. It starts a real
`@mastra/mcp` `MCPServer` over stdio, connects through a real `MCPClient`,
executes a Mastra `createTool()` tool, then signs one hash-only atrib record for
that call.

## Run It

```bash
pnpm --filter @atrib/integration mastra-runtime-smoke
```

The smoke is local and credential-free. It does not call a hosted Mastra
Platform agent, a live model, or a database. The fake part is only the
procurement approval payload; the MCP server, stdio transport, MCP client, tool
listing, and tool execution path come from `@mastra/core@1.38.0` and
`@mastra/mcp@1.9.0`.

## What It Proves

- `@mastra/mcp` can expose a Mastra `createTool()` tool through `MCPServer`.
- `MCPClient.listTools()` returns a namespaced executable tool over stdio.
- The atrib recorder signs one `tool_call` record with `tool_name`,
  `args_hash`, and `result_hash`.
- Public records stay hash-only and do not include raw tool arguments or tool
  results.
- Local sidecars keep the inspectable Mastra server name, namespaced tool name,
  tool call id, arguments, and result.

## What It Does Not Prove Yet

This is a Mastra MCP runtime proof, not a shipped `@atrib/agent` adapter. It
also does not cover hosted Mastra Platform run imports, post-hoc event APIs,
skill loading, memory state, file-system context, or MCP auth diagnostics. Those
remain the source-reading gates before a Mastra adapter shape can be chosen.
