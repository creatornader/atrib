# Local Substrate Coordinator

**Status**: DRAFT
**Spec anchors**: [P042](../../DECISIONS.md#p042-local-substrate-coordinator-for-long-lived-and-multi-harness-dogfood), [§5.8](../../atrib-spec.md#58-degradation-contract), [§5.9](../../atrib-spec.md#59-local-mirror-conventions), [D083](../../DECISIONS.md#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers), [D102](../../DECISIONS.md#d102-sandboxed-signer-proxy-keeps-keys-outside-sandbox)
**Builds on**: [Integration patterns](10-integration-patterns.md), [The chain](04-the-chain.md), [The six cognitive primitives](11-cognitive-primitives.md)
**Enables**: host-owned process control for startup-spawn agents, long-lived local assistants, and watcher WAL pipelines

## The Problem

atrib has several valid ways to sign records today: in-process middleware, CLI helpers, stdio MCP servers, hook scripts, and local watchers. Those paths work, but dogfood has exposed a host-level coordination problem:

- startup-spawn harnesses can multiply MCP child processes per active thread
- bridge-backed assistants and scheduled jobs may not be MCP hosts at all
- local watcher pipelines need WAL drain, receipt join-back, and orphan detection
- stale child processes and notification hooks can survive after the agent session that created them

Adding one more MCP server would only shrink one process list. The wider boundary is host ownership: one local substrate surface that can coordinate signing, mirror/WAL work, submission queues, read indexes, and health reporting for several harness styles.

## Shape

The local substrate coordinator is optional. It is one host-owned service per creator identity or trusted host boundary, supervised by the host with launchd, a container supervisor, or an equivalent runtime. Adapters call it over a Unix socket or an explicit localhost transport.

The coordinator owns shared substrate work:

- key resolution and signer-policy routing
- chain-root resolution, parent-record threading, and source-aware `informed_by` checks
- mirror append, WAL append, receipt token generation, log submission queue, archive submission, and receipt join-back
- local read-index refresh for recall, trace, and summarize
- process-health reporting: pid, socket, version, queue depth, WAL backlog, active contexts, and stale child detection

Adapters stay thin:

- Codex and Claude Code startup-spawn MCP children pass session context and record bodies to the coordinator
- OpenClaw, Hermes, and Sido-style long-lived assistants call the same local service without becoming MCP hosts
- local knowledge-base watchers enqueue records and join receipts through the same contract
- sandboxed runtimes keep the [D102](../../DECISIONS.md#d102-sandboxed-signer-proxy-keeps-keys-outside-sandbox) key boundary explicit

## Non-Negotiables

The coordinator cannot become a required daemon for first-time users. Existing direct paths stay valid.

The coordinator cannot change signed bytes. It must pass the same unsigned record body into the existing signing path that the current direct producer path would have used.

The coordinator cannot create a new event type, cognitive primitive, or graph edge. It is deployment architecture.

The coordinator cannot silently multiplex creator keys. Multiple creator identities require separate sockets or an explicit signer-selection policy.

The coordinator cannot block the primary action path. If the coordinator is missing, overloaded, or unhealthy, adapters fall back or no-op under [§5.8](../../atrib-spec.md#58-degradation-contract).

## Fixture Contract

The first executable contract lives at [`spec/conformance/local-substrate-coordinator/`](../../spec/conformance/local-substrate-coordinator/). It covers three harness classes:

| Harness class      | Fixture                                                            | Acceptance condition                                                                         |
| ------------------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `startup-spawn`    | Codex or Claude Code MCP child signs a tool call                   | coordinator request body equals direct wrapper body                                          |
| `long-lived-agent` | Sido, OpenClaw, Hermes, or scheduled producer emits an observation | coordinator request body equals direct emit body                                             |
| `watcher-wal`      | local knowledge-base watcher drains a WAL annotation               | coordinator request body equals direct watcher body and receipt join-back target is explicit |

Run the contract with:

```sh
node scripts/check-local-substrate-coordinator-fixtures.mjs
```

The validator checks body equality, pinned canonical hashes, non-blocking fallback, and the health-report fields needed before rollout.

The shared TypeScript contract lives in `@atrib/mcp` as request and response validators, canonical body hashing, fixture validation, an opt-in coordinator client shim, explicit HTTP transport helper, a matching server-side HTTP handler, an in-process coordinator prototype, middleware shadow probes, and read-only health-probe helpers. Wrappers, emit-like producers, and watcher pipelines should consume that surface rather than minting a parallel schema. The prototype and HTTP handler are still opt-in; the package defines the adapter boundary and rollout-gate probes without making a daemon required.

## Worked Example

A Codex thread starts and its MCP wrapper has a tool call to sign. In the current direct path, the wrapper builds an unsigned atrib record body, resolves `chain_root`, signs the body, appends the mirror, and queues submission.

With a coordinator, the wrapper builds the same unsigned body and sends:

```json
{
  "schema": "atrib.local-substrate-coordinator.request.v0",
  "operation": "sign_record",
  "mode": "shadow_probe",
  "producer": {
    "name": "codex-mcp-wrapper",
    "harness_class": "startup-spawn"
  },
  "record_body": {
    "spec_version": "atrib/1.0",
    "event_type": "https://atrib.dev/v1/types/tool_call",
    "context_id": "11112222333344445555666677778888"
  }
}
```

The coordinator may own the queue, mirror, and health report. It may not add fields to the record body before signing. The fixture pins that property by hashing the canonical record body and comparing it to the direct path.

Current `@atrib/mcp-wrap` wiring uses `mode: "shadow_probe"`, not coordinator-owned commit. In this mode, the wrapper still signs, mirrors, attaches outbound context, and queues submission locally. The coordinator validates and signs the same unsigned body, returns a hash, and skips queue or mirror side effects. The wrapper log records whether that hash matched the local path. This avoids duplicate commits while proving the real startup-spawn adapter can reach the coordinator with byte-identical input.

`@atrib/emit` uses the same shadow-only posture for the `long-lived-agent` class. The emit path validates and signs the record locally, strips `signature` back out to recover the exact unsigned body, and sends that body to the coordinator with a `long-lived-agent` producer envelope. `emitInProcess()` waits only for the configured shadow timeout so short-lived hook producers do not exit before telemetry lands; the emit MCP server can keep the attempt in the background. `atrib-emit-cli`, `@atrib/annotate`, and `@atrib/revise` can opt in through `ATRIB_LOCAL_SUBSTRATE_ENDPOINT` with `ATRIB_LOCAL_SUBSTRATE_MODE=shadow`, or through an explicit transport in embedded hosts. The response is telemetry only: local signing, mirror append, and queue submission remain the committed path.

The watcher-WAL prototype uses commit mode rather than shadow mode. A watcher sends `operation: "enqueue_record_and_join_receipt"` with explicit WAL metadata: `entry_id`, `source_path`, and `receipt_join_field`. The in-process coordinator signs the same unsigned body, returns `record_hash` plus `receipt_id`, calls its observer with the WAL metadata, and exposes WAL pending/joined/orphan counts in the health report. This proves the coordinator can own the receipt boundary for one watcher path without mutating signed bytes. It is not yet a launchd-owned daemon or default runtime.

The service-hosting slice exposes the same coordinator through `createLocalSubstrateCoordinatorHttpHandler()`. A host can attach that handler to Hono, Bun, Deno, launchd supervision, or an equivalent local runtime. `bindLocalSubstrateCoordinatorNodeServer()` is the Node HTTP binding for the same route contract. `POST /atrib/local-substrate` accepts coordinator requests. `GET` or `HEAD /atrib/local-substrate` and `/atrib/local-substrate/health` return the read-only health probe. The Node binding is loopback by default, rejects malformed or oversized JSON before the coordinator hot path, and leaves browser CORS policy to the host. This is a hosting boundary only; it does not add another package, MCP server, event type, or default background process.

## Rollout Gate

The current implementation slices provide an in-process startup-spawn prototype, watcher-WAL commit-mode proof, `@atrib/mcp-wrap` HTTP shadow probes, `@atrib/emit` long-lived-agent shadow probes, and shared Fetch/plain-result/Node HTTP handlers for supervised local service hosts behind opt-in config. They should not become default until a process-health report shows:

- one startup-spawn harness can call the coordinator without extra stale children
- one long-lived local assistant or scheduled producer can call it under supervisor ownership
- one watcher WAL path can queue, drain, and join receipts without orphan or mismatch regressions
- coordinator unavailability leaves primary agent work unaffected

That report should extend [D084](../../DECISIONS.md#d084-read-primitive-instrumentation-for-empirical-loop-closure-measurement) rather than create another private health surface.
