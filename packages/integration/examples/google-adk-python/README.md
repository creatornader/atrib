# Google ADK Python decision ledger and plugin examples

This example targets Google ADK Python's plugin lifecycle. The primary proof
runs a real `google-adk==2.3.0` `InMemoryRunner`, registers a Python
`BasePlugin`, signs an authority decision from `before_tool_callback`, and then
signs the allowed `FunctionTool` outcome from `after_tool_callback` with the
decision record in `informed_by`.

Run the decision-ledger proof:

```bash
pnpm --filter @atrib/integration google-adk-python-decision-ledger-proof
```

Run the smaller after-callback smoke:

```bash
pnpm --filter @atrib/integration google-adk-python-plugin-smoke
```

Both commands use `uv` to install `google-adk==2.3.0` transiently. Neither uses
a live model connection.

What the decision-ledger proof shows:

- Python `BasePlugin.before_tool_callback` can sign `allowed`, `refused`, and
  `policy_error` authority decisions before a real ADK `FunctionTool` body
  executes.
- The allowed path executes the tool and signs a tool outcome that cites the
  decision record.
- The refused and policy-error paths return plugin responses without executing
  the tool body.
- Python confirmation fixtures sign `confirmation_required`,
  `confirmation_resolved`, and `stale_or_mismatched` records. The binding covers
  tool name, canonical args digest, authority, policy version, and expiry.
- The public atrib record exposes `tool_name`, `args_hash`, and `result_hash`,
  not raw tool payloads or the raw principal.
- Local sidecars keep the inspectable ADK context: app, session, user,
  invocation, function-call id, arguments, and result.

This is a local ADK Python runtime proof, not Agent Platform Runtime, Gemini
Enterprise, BigQuery Agent Analytics, Memory Bank, trajectory evaluation, or a
production Google Cloud run. The TypeScript ADK decision-ledger proof remains
useful cross-SDK evidence, but this directory is the Python-native proof for
`google/adk-python` route work.
