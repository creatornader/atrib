# OpenAI Responses tool-call receipt example

This example targets the OpenAI Node SDK's `responses.create` custom tool-call
path. It runs two real SDK calls against a local HTTP fixture: the first returns
a `function_call` item and the second sends a `function_call_output` item with
`previous_response_id`. atrib signs one hash-only record for the tool-call
boundary while local sidecars keep the inspectable arguments and result.

## Run It

```bash
pnpm --filter @atrib/integration openai-responses-tool-call-smoke
```

The smoke is local, deterministic, and credential-free. It uses the real
`openai` SDK client, but the `baseURL` points at a local fixture instead of the
hosted OpenAI API.

## What It Proves

- The `openai` SDK can call `client.responses.create(...)` against an
  OpenAI-shaped local endpoint.
- The first SDK call can return a Responses `function_call` output item.
- The second SDK call can send a `function_call_output` input item linked by
  `previous_response_id`.
- atrib can mirror the successful tool-call boundary as one signed `tool_call`
  record with `tool_name`, `args_hash`, and `result_hash`.
- Public records stay hash-only and do not include raw tool arguments or tool
  results.
- Local sidecars keep the response id, function name, call id, arguments, and
  result for audit and demo walkthroughs.

## What It Does Not Prove Yet

This is not a hosted OpenAI model proof. It also does not prove Responses
computer use, streaming, MCP tools, OpenAI conversations or sessions, tracing
export, the Python SDK, maintainer interest, or upstream acceptance. Those need
their own proof packets before outreach can claim them.
