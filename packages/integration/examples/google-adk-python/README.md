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
- Python `BasePlugin.after_model_callback` can capture the model response that
  selected the tool. The proof records that selection source and keeps the
  model rationale typed as untrusted context.
- The live ADK paths cover both `user-auth` and `agent-auth` shaped authority
  records. The raw principal stays local; the signed decision carries a
  principal hash.
- The allowed path executes the tool and signs a tool outcome that cites the
  decision record.
- The refused and policy-error paths return plugin responses without executing
  the tool body, while keeping the refusal or policy-error rule in the decision
  record.
- A native ADK `FunctionTool(require_confirmation=True)` path signs
  `confirmation_required` before the tool body runs and verifies that ADK emits
  a requested tool confirmation.
- Python confirmation fixtures sign `confirmation_resolved` and
  `stale_or_mismatched` records. The binding covers tool name, canonical args
  digest, authority, policy version, and expiry, then fails closed when the
  executor sees changed args.
- The public atrib record exposes `tool_name`, `args_hash`, and `result_hash`,
  not raw tool payloads or the raw principal.
- Local sidecars keep the inspectable ADK context: app, session, user,
  invocation, function-call id, arguments, and result.

This is a local ADK Python runtime proof, not Agent Platform Runtime, Gemini
Enterprise, BigQuery Agent Analytics, Memory Bank, trajectory evaluation, or a
production Google Cloud run. The TypeScript ADK decision-ledger proof remains
useful cross-SDK evidence, but this directory is the Python-native proof for
`google/adk-python` route work.

The decision-ledger schema in this example is a local extension proof, not a
normative atrib event type and not a proposal that ADK should adopt atrib. It
shows the external signer and verifier side of the #6099 shape: if ADK emits
stable decision facts, atrib can commit to them, link them to parent evidence,
and let a later verifier ask whether the exact tool call ran from the authority
that allowed it.
