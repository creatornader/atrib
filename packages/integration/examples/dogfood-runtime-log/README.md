# Dogfood runtime-log window

This example verifies a real atrib workstream job window using sanitized Agent
Bridge evidence.

The fixture captures the `RL-007` runtime-log proof-kit job after it was marked
accepted. It links the job packet, bridge status updates, result packet refs,
and signed atrib record refs into one `log_window_manifest`.

## Run it

```bash
pnpm --filter @atrib/integration dogfood-runtime-log-smoke
```

The smoke reads
`fixtures/rl-007-agent-bridge-window.json`, builds a manifest, verifies local
evidence, and prints bridge entry ids, signed ref counts, verifier checks, and
the privacy posture.

## What it proves

- A real local job surface can emit a runtime-log manifest.
- The manifest binds the job id, status transition, result packet refs, bridge
  entry ids, and signed atrib refs.
- Agent Bridge posts are treated as side-effect receipts with bridge entry ids
  and wrapper receipt ids.
- A stale result packet or mismatched job window changes event roots and fails
  verification.
- Private note bodies and raw bridge content are omitted from the fixture and
  from the manifest.

## Boundary

This is a dogfood adapter proof, not a public Agent Bridge API contract. The
source is the local control-plane surface we already use for workstream status.
A future second-brain job-packet schema can replace this fixture shape while
keeping the same `log_window_manifest` verifier boundary.
