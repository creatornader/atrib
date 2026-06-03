# OpenAI Agents runtime receipt example

This example targets the JavaScript `@openai/agents` local function-tool and
handoff lifecycle boundaries. It creates real `Agent` instances, runs them
through the SDK's `run()` loop, uses a real `tool()` definition, invokes a real
`handoff()`, and signs hash-only atrib records from the SDK's `agent_tool_end`
and `agent_handoff` lifecycle events.

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
- A real SDK `handoff()` transfers control from the source agent to the receiver
  agent.
- The SDK exposes the transfer through `agent_handoff` after the handoff target
  is resolved.
- The atrib recorder signs one `tool_call` record and one
  `https://atrib.dev/v1/types/handoff` extension record with `tool_name`,
  `args_hash`, and `result_hash`.
- Public records stay hash-only and do not include raw tool arguments or tool
  results.
- Local sidecars keep the inspectable agent name, tool name, tool call id,
  arguments, result, handoff source, and handoff target.

## What It Does Not Prove Yet

This is not a Python Agents SDK proof. It also does not call a hosted OpenAI
model, the Responses API, computer-use tools, MCP transports, sessions, or
OpenAI tracing export. The handoff receipt follows
[D073](../../../../DECISIONS.md#d073-handoff-event_type-byte-placeholder-adr)'s
extension-URI path; it is not a promoted handoff event byte and not a Pattern 3
verifier-gated handoff packet. Those need their own proof packets before
outreach can claim them.
