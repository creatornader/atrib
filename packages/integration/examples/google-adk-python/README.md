# Google ADK Python plugin attribution example

This example targets Google ADK Python's plugin lifecycle. It runs a real
`google-adk==2.1.0` `InMemoryRunner`, registers a Python `BasePlugin`, lets a
scripted ADK model call a real `FunctionTool`, captures the tool callback, and
then signs one hash-only atrib record for that Python tool outcome.

Run:

```bash
pnpm --filter @atrib/integration google-adk-python-plugin-smoke
```

The smoke uses `uv` to install `google-adk==2.1.0` transiently. It does not use a
live model connection.

What this proves:

- Python `BasePlugin.after_tool_callback` can observe a real ADK `FunctionTool`
  result inside `InMemoryRunner`.
- The public atrib record exposes `tool_name`, `args_hash`, and `result_hash`,
  not raw tool payloads.
- Local sidecars keep the inspectable ADK context: app, session, user,
  invocation, function-call id, arguments, and result.

This is a local ADK Python runtime proof, not Agent Platform Runtime, Gemini
Enterprise, BigQuery Agent Analytics, Memory Bank, trajectory evaluation, or a
production Google Cloud run. The next stronger proof is to pair the same callback
boundary with ADK's managed telemetry or deployment identifiers.
