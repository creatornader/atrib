# Google ADK TypeScript decision ledger and plugin examples

This example targets the TypeScript `@google/adk` plugin lifecycle. The primary
proof runs a real `@google/adk@1.2.0` `InMemoryRunner`, registers a
`BasePlugin`, signs an authority decision from `beforeToolCallback`, and then
signs the allowed `FunctionTool` outcome from `afterToolCallback` with the
decision record in `informed_by`.

Run the decision-ledger proof:

```bash
pnpm --filter @atrib/integration google-adk-typescript-decision-ledger-proof
```

Run the smaller after-callback smoke:

```bash
pnpm --filter @atrib/integration google-adk-typescript-plugin-smoke
```

Both commands are local and credential-free. They do not call Gemini, Google
Cloud, BigQuery, or a database. The fake part is only the scripted model
response; the runner, plugin manager, function-tool path, and callback
lifecycle come from `@google/adk@1.2.0`.

## What The Decision-Ledger Proof Shows

- TypeScript `BasePlugin.beforeToolCallback` can sign `allowed`, `refused`, and
  `policy_error` authority decisions before a real ADK `FunctionTool` body
  executes.
- The allowed path executes the tool and signs a tool outcome that cites the
  decision record.
- The refused and policy-error paths return plugin responses without executing
  the tool body.
- Confirmation fixtures pin the local `confirmation_required`,
  `confirmation_resolved`, and `stale_or_mismatched` contract, including a
  binding hash over tool name, canonical args digest, authority, policy version,
  and expiry.
- Public records omit raw tool arguments, raw tool results, private principal
  material, and model rationale text. Local sidecars keep those values
  inspectable for the host.

The decision record uses the extension event type
`https://google-adk-decision-ledger.example/v1`. It is proof material for this
ADK boundary, not a new atrib protocol event type.

## What The Callback Smoke Shows

- `AtribAdkPlugin` composes with ADK's public `BasePlugin` surface.
- ADK `FunctionTool` execution keeps returning normal ADK-shaped values.
- The plugin signs one atrib `tool_call` record with `tool_name`, `args_hash`,
  and `result_hash`.
- Public records stay hash-only and do not include raw tool arguments or tool
  results.
- Local sidecars keep the inspectable ADK context: app, agent, session,
  invocation, function-call id, arguments, and result.

## Contract Field Matrix

| Field | Source | Public record treatment |
| --- | --- | --- |
| `invocation_id`, `session_id`, `tool_call_id`, `tool_name` | ADK callback context | Committed through the signed decision record. |
| `authority.mode`, `authority.principal_hash` | Local policy result | Committed as structured decision facts. Raw principal stays in the local sidecar. |
| `policy.source`, `policy.version`, `policy.outcome`, `policy.reason` | Local policy result | Committed as the authority decision. |
| `decision_state` | Plugin decision layer | Committed as `allowed`, `refused`, `policy_error`, `confirmation_required`, `confirmation_resolved`, or `stale_or_mismatched`. |
| `canonical_args_digest` | Derived from canonical tool args | Committed as a digest. Raw args stay in the local sidecar. |
| `result_digest` | Derived from canonical tool result or error | Committed only for signed outcomes. Raw result or error stays in the local sidecar. |
| `confirmation.binding_hash` | Derived from tool, args digest, authority, policy version, and expiry | Committed for confirmation states so stale or mismatched execution fails closed. |
| `model_rationale.text` | Model output | Treated as untrusted sidecar text, not an authority source. |

## What It Does Not Prove Yet

This is a local ADK TypeScript runtime proof. It does not claim upstream Google
adoption, Agent Platform Runtime, Gemini Enterprise, Memory Bank, BigQuery Agent
Analytics export, or a production Google Cloud deployment.

The confirmation binding helper is also local. Current ADK `ToolConfirmation`
objects do not expose a native binding tag over tool, args, authority, policy,
and expiry, so the fixture proves the atrib-side contract and fail-closed
mismatch behavior until a native ADK hook exists.

## Files To Inspect

- [`google-adk-typescript-decision-ledger-proof.ts`](google-adk-typescript-decision-ledger-proof.ts),
  runnable decision-ledger proof over the real ADK runner and tool lifecycle.
- [`google-adk-typescript-plugin-smoke.ts`](google-adk-typescript-plugin-smoke.ts),
  smaller callback-boundary smoke.
- [`../../src/google-adk-typescript-decision-ledger.ts`](../../src/google-adk-typescript-decision-ledger.ts),
  decision plugin, builder, signer, verifier, and confirmation binding helpers.
- [`../../src/google-adk-typescript-attribution.ts`](../../src/google-adk-typescript-attribution.ts),
  callback plugin for hash-only tool outcome signing.
- [`decision-ledger-entry.schema.json`](decision-ledger-entry.schema.json),
  JSON schema for the local decision sidecar entry.
- [`fixtures/decision-ledger-fixtures.json`](fixtures/decision-ledger-fixtures.json),
  pinned entries for allowed, refused, policy error, confirmation, resolved,
  and mismatch states.
- [`../../test/google-adk-typescript-decision-ledger.test.ts`](../../test/google-adk-typescript-decision-ledger.test.ts),
  focused decision-ledger contract tests.
- [`../../test/google-adk-typescript-attribution.test.ts`](../../test/google-adk-typescript-attribution.test.ts),
  focused callback smoke test.
