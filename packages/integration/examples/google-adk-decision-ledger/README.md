# Google ADK decision-ledger proof

This example targets the ADK authority boundary. It runs a real `@google/adk`
`InMemoryRunner`, `BasePlugin`, and `FunctionTool`, signs an atrib decision
record from `beforeToolCallback`, then signs the tool outcome from
`afterToolCallback` with the decision record in `informed_by`.

Run:

```bash
pnpm --filter @atrib/integration google-adk-decision-ledger-proof
```

## What It Proves

- `AtribAdkDecisionLedgerPlugin` composes with ADK's public `BasePlugin`
  surface before a tool body runs.
- An allowed decision produces a hash-only atrib decision record, executes the
  real ADK `FunctionTool`, then signs a hash-only tool outcome that cites the
  decision record.
- A refused decision returns a plugin response and the tool body does not
  execute.
- A `policy_error` decision also returns a plugin response and the tool body
  does not execute. The proof treats policy failures as fail-closed authority
  decisions, not as missing telemetry.
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

## Contract field matrix

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

This is a local ADK runtime proof. It does not claim upstream Google adoption,
Agent Platform Runtime, Gemini Enterprise, Memory Bank, BigQuery Agent
Analytics export, or a production Google Cloud deployment.

The confirmation binding helper is also local. Current ADK `ToolConfirmation`
objects do not expose a native binding tag over tool, args, authority, policy,
and expiry, so the fixture proves the atrib-side contract and the fail-closed
mismatch behavior until a native ADK hook exists.

## Files To Inspect

- [`google-adk-decision-ledger-proof.ts`](google-adk-decision-ledger-proof.ts),
  runnable proof over the real ADK runner and tool lifecycle.
- [`../../src/google-adk-decision-ledger.ts`](../../src/google-adk-decision-ledger.ts),
  plugin, decision builder, signer, verifier, and confirmation binding helpers.
- [`decision-ledger-entry.schema.json`](decision-ledger-entry.schema.json),
  JSON schema for the local decision sidecar entry.
- [`fixtures/decision-ledger-fixtures.json`](fixtures/decision-ledger-fixtures.json),
  pinned entries for allowed, refused, policy error, confirmation, resolved,
  and mismatch states.
- [`../../test/google-adk-decision-ledger.test.ts`](../../test/google-adk-decision-ledger.test.ts),
  focused contract tests.
