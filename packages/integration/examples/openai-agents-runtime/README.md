# OpenAI Agents runtime receipt example

This example targets the JavaScript `@openai/agents` local function-tool
boundary. It creates a real `Agent`, runs it through the SDK's `run()` loop,
uses a real `tool()` definition, and signs one hash-only atrib record from the
SDK's `agent_tool_end` lifecycle event.

## Run It

```bash
pnpm --filter @atrib/integration openai-agents-runtime-smoke
```

The smoke is local, deterministic, and credential-free. It uses a scripted model
that implements the SDK's `Model` interface so it can exercise real agent and
tool execution without `OPENAI_API_KEY`.

## What It Proves

- `@openai/agents` can run an `Agent` through the public `run()` API.
- A local `tool()` function executes through the SDK's normal function-tool
  loop.
- The SDK exposes the successful tool execution through `agent_tool_end` with
  the tool call id, function name, arguments, and result.
- The atrib recorder signs one `tool_call` record with `tool_name`,
  `args_hash`, and `result_hash`.
- Public records stay hash-only and do not include raw tool arguments or tool
  results.
- Local sidecars keep the inspectable agent name, tool name, tool call id,
  arguments, and result.

## What It Does Not Prove Yet

This is not a Python Agents SDK proof. It also does not call a hosted OpenAI
model, the Responses API, computer-use tools, MCP transports, sessions,
handoffs, or OpenAI tracing export. Those need their own proof packets before
outreach can claim them.
