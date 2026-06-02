# Google ADK plugin attribution example

This example targets Google ADK's plugin lifecycle. It registers an atrib
`BasePlugin` on a real ADK `InMemoryRunner`, lets a scripted ADK model call a
real ADK `FunctionTool`, then verifies the signed atrib record for that tool
call.

## Run It

```bash
pnpm --filter @atrib/integration google-adk-plugin-smoke
```

The smoke is local and credential-free. It does not call Gemini, Google Cloud,
BigQuery, or a database. The fake part is only the scripted model response; the
runner, plugin manager, function-tool path, and callback lifecycle come from
`@google/adk@1.1.0`.

## What It Proves

- `AtribAdkPlugin` composes with ADK's public `BasePlugin` surface.
- ADK `FunctionTool` execution keeps returning normal ADK-shaped values.
- The plugin signs one atrib `tool_call` record with `tool_name`, `args_hash`,
  and `result_hash`.
- Public records stay hash-only and do not include raw tool arguments or tool
  results.
- Local sidecars keep the inspectable ADK context: app, agent, session,
  invocation, function-call id, arguments, and result.

## What It Does Not Prove Yet

This is a local ADK runtime proof, not a Gemini production run, BigQuery Agent
Analytics export, Vertex AI deployment, or Google Cloud trace. The intended
next step is to pair the same plugin boundary with an ADK run that also emits
Google's analytics or trace identifiers, so atrib record hashes can be linked to
ADK's existing observability stream.
