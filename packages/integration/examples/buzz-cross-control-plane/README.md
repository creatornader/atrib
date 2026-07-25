# Buzz cross-control-plane fixture

This private, hermetic fixture composes existing atrib surfaces across a
Buzz-shaped producer and a non-Buzz receiver. It is fixture-level evidence.
Current Buzz exposes an in-process observer bus, not a capture endpoint that
can supervise ACP traffic from outside the process.

## Run it

```bash
pnpm --filter @atrib/integration buzz-cross-control-plane-fixture
```

The run is deterministic, credential-free, local-only, and uses an in-memory
development log. It does not submit to public atrib services.

## What the fixture checks

The producer creates real signed NIP-AO kind 24200 frames with ACP-shaped
request and result telemetry. `@atrib/runtime-log/buzz` loads them through
`load_events`, verifies each Nostr signature before calling the host decrypt
callback, and requires a contiguous process window.

The host signs a dedicated observer-capture record that commits the runtime
window hash and the observer-action hash. The coverage manifest points to that
record instead of borrowing an unrelated action record as capture evidence.
The host also signs the standard
[D168 coverage-attestation content](../../../../DECISIONS.md#d168-coverage-manifests-make-capture-scope-verifiable).
The receiver requires its `args_hash` before it accepts the manifest.

The application effect runs inside `@atrib/sdk` `action()`. The SDK signs the
request before execution and signs a linked terminal outcome afterward. A
[D168 coverage manifest](../../../../DECISIONS.md#d168-coverage-manifests-make-capture-scope-verifiable)
accounts for the observer/source round trip and both signed action records.

The fixture host explicitly maps the accepted state, workspace, task, team,
agents, and handoff into signed `atrib.operating-event.v1` content. Observer
telemetry does not supply or infer those claims. The operating content commits
the runtime-window, coverage, observer-action, request-record, and
outcome-record hashes.

The receiver verifies every packet record with `verifyHandoffClaims`, verifies
the runtime window and coverage manifest separately, checks the outcome body
against its signed commitment, and recomputes a bounded operating view from the
verified immutable records. Its own policy then signs a decision and outcome.
An allowed decision issues a one-time permit to `createProtectedMcpExecutor`;
the non-Buzz effect executes once, and replay is rejected.

The hostile arm changes the supplied result body while leaving the original
signed record untouched. `evaluateResultClaim` reports
`evidence_inconsistent`, packet verification rejects the changed body, the
receiver signs a block, and its effect count stays zero. A separate arm removes
one observer frame and proves the runtime source rejects the sequence gap.

## Boundary

This fixture makes no claim of:

- live Buzz-supervised ACP execution;
- relay admission or persistence;
- Buzz audit inclusion;
- complete capture outside the supplied process window;
- arbitrary result truth.

The current handoff packet cannot type-bind the Buzz runtime window,
[D168 coverage manifest](../../../../DECISIONS.md#d168-coverage-manifests-make-capture-scope-verifiable),
or paired action legs. The receiver therefore verifies each leg explicitly and
commits their hashes in its signed decision. This fixture does not add a
protocol field, evidence profile, or SDK primitive for that composition.
