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

Adding one combined MCP runtime can shrink one process list. It does not solve signer ownership, watcher WAL join-back, or health reporting by itself. The wider boundary is host ownership: one local substrate surface that can coordinate signing, mirror/WAL work, submission queues, read indexes, and health reporting for several harness styles.

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

The watcher-WAL path uses commit mode rather than shadow mode. A watcher sends `operation: "enqueue_record_and_join_receipt"` with explicit WAL metadata: `entry_id`, `source_path`, and `receipt_join_field`. The coordinator signs the same unsigned body, returns `record_hash` plus `receipt_id`, calls its observer with the WAL metadata, and exposes WAL pending/joined/orphan counts in the health report. The public proof covers this through the in-process and HTTP host fixtures. The local knowledge-base dogfood path now maps Python WAL metadata into the `atrib-emit-cli` `local_substrate` envelope, delegates log submission to a launchd-owned coordinator when accepted, preserves the local sidecar mirror, and falls back to local signing if the coordinator rejects or times out. That proves one real watcher route can use the coordinator without mutating signed bytes. It is still not a broad default for every watcher producer.

The service-hosting slice exposes the same coordinator through `createLocalSubstrateCoordinatorHttpHandler()`. A host can attach that handler to Hono, Bun, Deno, launchd supervision, or an equivalent local runtime. `bindLocalSubstrateCoordinatorNodeServer()` is the Node HTTP binding for the same route contract. `POST /atrib/local-substrate` accepts coordinator requests. `GET` or `HEAD /atrib/local-substrate` and `/atrib/local-substrate/health` return the read-only health probe. The Node binding is loopback by default, rejects malformed or oversized JSON before the coordinator hot path, and leaves browser CORS policy to the host. This is a hosting boundary only; it does not add another MCP server, event type, or cognitive primitive.

`@atrib/emit` ships the first host-owned process for that boundary as `atrib-local-substrate`. The binary uses the same bounded `resolveKey()` path as `atrib-emit`, binds loopback HTTP at `127.0.0.1:8787` by default, supports the three fixture harness classes, prints a ready event for supervisors, and drains the submission queue on SIGTERM/SIGINT with a bounded shutdown timeout. It is opt-in. Agents still need `ATRIB_LOCAL_SUBSTRATE_ENDPOINT=http://127.0.0.1:8787/atrib/local-substrate` before their shadow probes call it.

`@atrib/primitives-runtime` is a separate process-count slice. It mounts the seven public primitive packages in process and exposes their 15 physical MCP tools through one MCP server named `atrib-primitives`. Stdio mode collapses one harness thread from seven primitive child processes to one. Streamable HTTP mode lets startup-spawn harnesses share one loopback host process across threads, with one in-process runtime per MCP session and no per-primitive OS children. The package is private to the workspace and meant for dogfood configs where Codex, Claude Code, or another startup-spawn harness would otherwise launch seven atrib primitive child processes per thread. It does not own signing policy, WAL commit, receipt join-back, queue health, or cross-harness supervision; those stay with the local substrate coordinator track.

## Rollout Gate

The current implementation slices provide an in-process startup-spawn prototype, watcher-WAL commit mode, `@atrib/mcp-wrap` HTTP shadow probes, `@atrib/emit` long-lived-agent shadow probes, shared Fetch/plain-result/Node HTTP handlers, the `atrib-local-substrate` host binary, and one live watcher-WAL dogfood route behind opt-in config. They should not become broad defaults until a process-health report shows:

- one startup-spawn harness can call the coordinator without extra stale children
- one startup-spawn harness can use `atrib-primitives` when the desired rollout gate is per-thread MCP child-process count rather than coordinator signing
- one loopback `atrib-primitives` Streamable HTTP host can serve startup-spawn harness configs when the desired rollout gate is cross-thread process sharing
- one long-lived local assistant or scheduled producer can call it under supervisor ownership
- the watcher WAL path continues to queue, drain, and join receipts without orphan or mismatch regressions under normal sync load
- coordinator unavailability leaves primary agent work unaffected

`pnpm prove:local-substrate` is the first repo-owned process-health proof. It builds `@atrib/mcp` and `@atrib/emit`, starts the real `atrib-local-substrate` host on an ephemeral loopback port, sends the three conformance fixtures through HTTP, checks watcher receipt issuance, validates final health, asserts zero stale children and zero orphan receipts, and proves the client classifies an unavailable coordinator as `unavailable` rather than blocking. The script can also target a live dogfood coordinator with `--use-existing <endpoint>` and `--health-endpoint <endpoint>`.

Passing that proof means the host binary can satisfy the local contract in isolation. Live dogfood adoption still needs a separate topology report. As of the first watcher-WAL adoption slice, the local knowledge-base drain is wired through a coordinator and a live probe reached the public log. Startup-spawn process-count work now has two gates: per-thread collapse onto `atrib-primitives`, and shared loopback HTTP hosting for cross-thread process reuse.

That report now lives at [`scripts/report-local-substrate-topology.mjs`](../../scripts/report-local-substrate-topology.mjs). It reads process rows, sanitized Codex and Claude Code MCP config summaries, launchd service metadata, coordinator health probes, and primitive-runtime HTTP health probes. It separates five gates: coordinator health, startup-spawn MCP process collapse, startup-spawn config, host-owned primitive HTTP hosting, and watcher-WAL routing. The fixture-backed checker runs in `pnpm doc-sync`, so a healthy isolated host proof cannot hide a mixed live topology with duplicated primitive bundles or missing shared primitive hosting.

Use it before any wider default rollout:

```sh
pnpm report:local-substrate
```

A `ready_for_default_trial` status means the topology evidence supports a controlled default trial. A `mixed` status means at least one route is still partly migrated. A `blocked` status means no healthy coordinator endpoint answered. Future versions should extend [D084](../../DECISIONS.md#d084-read-primitive-instrumentation-for-empirical-loop-closure-measurement) rather than create another private health surface.
