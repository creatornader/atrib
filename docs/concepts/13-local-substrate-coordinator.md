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

`@atrib/emit` supports two opt-in postures for the `long-lived-agent` class. In `shadow` mode, the emit path validates and signs the record locally, strips `signature` back out to recover the exact unsigned body, and sends that body to the coordinator with a `long-lived-agent` producer envelope. `emitInProcess()` waits only for the configured shadow timeout so short-lived hook producers do not exit before telemetry lands; the emit MCP server can keep the attempt in the background. In `commit` mode, emit sends the same unsigned body as `operation: "sign_record"` and `mode: "commit"`, then skips its own log-submission queue only after the coordinator returns the expected `record_hash`. Local signing and mirror append stay in place so local recall remains available, and rejection, timeout, or hash mismatch falls back to the existing local queue path.

The watcher-WAL path uses commit mode rather than shadow mode. A watcher sends `operation: "enqueue_record_and_join_receipt"` with explicit WAL metadata: `entry_id`, `source_path`, and `receipt_join_field`. The coordinator signs the same unsigned body, returns `record_hash` plus `receipt_id`, calls its observer with the WAL metadata, and exposes WAL pending/joined/orphan counts in the health report. The public proof covers this through the in-process and HTTP host fixtures. The local knowledge-base dogfood path now maps Python WAL metadata into the `atrib-emit-cli` `local_substrate` envelope, delegates log submission to a launchd-owned coordinator when accepted, preserves the local sidecar mirror, and falls back to local signing if the coordinator rejects or times out. That proves one real watcher route can use the coordinator without mutating signed bytes. It is still not a broad default for every watcher producer.

The service-hosting slice exposes the same coordinator through `createLocalSubstrateCoordinatorHttpHandler()`. A host can attach that handler to Hono, Bun, Deno, launchd supervision, or an equivalent local runtime. `bindLocalSubstrateCoordinatorNodeServer()` is the Node HTTP binding for the same route contract. `POST /atrib/local-substrate` accepts coordinator requests. `GET` or `HEAD /atrib/local-substrate` and `/atrib/local-substrate/health` return the read-only health probe. The Node binding is loopback by default, rejects malformed or oversized JSON before the coordinator hot path, and leaves browser CORS policy to the host. This is a hosting boundary only; it does not add another MCP server, event type, or cognitive primitive.

`@atrib/emit` ships the first host-owned process for that boundary as `atrib-local-substrate`. The binary uses the same bounded `resolveKey()` path as `atrib-emit`, binds loopback HTTP at `127.0.0.1:8787` by default, supports the three fixture harness classes, prints a ready event for supervisors, and drains the submission queue on SIGTERM/SIGINT with a bounded shutdown timeout. It is opt-in. Agents still need `ATRIB_LOCAL_SUBSTRATE_ENDPOINT=http://127.0.0.1:8787/atrib/local-substrate` before their shadow probes call it.

`@atrib/primitives-runtime` is a separate process-count slice. It mounts the seven public primitive packages in process and exposes their 15 physical MCP tools through one local runtime named `atrib-primitives`. Direct stdio mode collapses one harness thread from seven primitive child processes to one. Streamable HTTP mode lets one startup-spawn agent profile share a loopback host process across that profile's threads, with one mounted primitive backend per host process, one outer MCP session transport per client, and no per-primitive OS children. Stdio-to-HTTP proxy mode is for stdio-only clients such as Claude Code and Claude Desktop: the client still speaks stdio MCP, but the proxy forwards to an agent-scoped Streamable HTTP host and does not mount the primitive backend itself. The package is private to the workspace and meant for dogfood configs where Codex, Claude Code, Claude Desktop, or another startup-spawn harness would otherwise launch seven atrib primitive child processes per thread. A host serving multiple agent profiles needs separate primitive runtime processes until the MCP client supplies a per-request profile boundary. It does not own signing policy, WAL commit, receipt join-back, queue health, or cross-harness supervision. Those stay with the local substrate coordinator track.

Agent Bridge gets the same process-count treatment as a separate host-owned HTTP route. The bridge wrapper can run once per startup-spawn agent profile, create the upstream bridge server in process, wrap it through `@atrib/mcp-wrap`, and serve MCP over Streamable HTTP. Startup-spawn configs then point `agent-bridge` at the loopback endpoint rather than spawning one stdio wrapper plus one upstream child per active bundle. This does not replace the future P002 atrib-backed bridge decision. It only removes per-thread wrapper churn while preserving the current bridge storage model and the same atrib wrapper signing path.

## Rollout Gate

The current implementation slices provide an in-process startup-spawn prototype, watcher-WAL commit mode, `@atrib/mcp-wrap` HTTP shadow probes, `@atrib/emit` long-lived-agent shadow and commit modes, shared Fetch/plain-result/Node HTTP handlers, the `atrib-local-substrate` host binary, and one live watcher-WAL dogfood route behind opt-in config. They should not become broad defaults until a process-health report shows:

- one startup-spawn harness can call the coordinator without extra stale children
- one startup-spawn harness can use `atrib-primitives` when the desired rollout gate is per-thread MCP child-process count rather than coordinator signing
- one loopback `atrib-primitives` Streamable HTTP host per startup-spawn agent profile can serve that profile's threads when the desired rollout gate is cross-thread process sharing
- stdio-only startup-spawn clients use `stdio-http-proxy` instead of a direct stdio primitive runtime when their backend is meant to be shared
- every host-owned primitive HTTP profile either exposes a valid active-session state file or requires explicit `context_id` before write primitives sign
- one loopback Agent Bridge Streamable HTTP host per startup-spawn agent profile can serve that profile's threads without spawning duplicate stdio wrapper/upstream pairs
- one long-lived local assistant or scheduled producer can call it under supervisor ownership
- the watcher WAL path continues to queue, drain, join receipts, and produce recent watcher activity without orphan or mismatch regressions under normal sync load
- coordinator unavailability leaves primary agent work unaffected

`pnpm prove:local-substrate` is the first repo-owned process-health proof. It builds `@atrib/mcp` and `@atrib/emit`, starts the real `atrib-local-substrate` host on an ephemeral loopback port, sends the three conformance fixtures through HTTP, checks watcher receipt issuance, validates final health, asserts zero stale children and zero orphan receipts, and proves the client classifies an unavailable coordinator as `unavailable` rather than blocking. The script can also target a live dogfood coordinator with `--use-existing <endpoint>` and `--health-endpoint <endpoint>`.

Passing that proof means the host binary can satisfy the local contract in isolation. Live dogfood adoption still needs a separate topology report. As of the first watcher-WAL adoption slice, the local knowledge-base drain is wired through a coordinator and a live probe reached the public log. As of the watcher activity slice, the knowledge-base receipt report carries the latest signed mirror row from known knowledge-base automation sources, so a clean receipt report no longer proves activity by itself. As of the diagnostic WAL classification slice, the receipt report separates join-required watcher or synthesis WAL from diagnostic WAL that has no markdown join target. Diagnostic WAL stays visible through `non_joinable_*` counters but does not count as active join-back backlog. As of the long-lived activity slice, Hermes and OpenClaw both have supervised routes plus recent producer evidence in a bounded activity report. Startup-spawn process-count work now has three gates: per-thread collapse onto `atrib-primitives`, agent-scoped primitive HTTP hosting for cross-thread process reuse, and agent-scoped bridge HTTP hosting for cross-thread Agent Bridge reuse.

That report now lives at [`scripts/report-local-substrate-topology.mjs`](../../scripts/report-local-substrate-topology.mjs). It reads process rows, sanitized Codex, Claude Code, and Claude Desktop MCP config summaries, launchd service metadata, an optional supervised route registry at `~/.atrib/local-substrate/routes.json`, coordinator health probes, primitive-runtime HTTP health probes, bridge-runtime HTTP health probes, the bounded knowledge-base receipt join-back and watcher activity report, the bounded long-lived producer activity report at `~/.atrib/state/local-substrate/long-lived-activity-latest.json`, legacy bridge wrapper/upstream groups, and Agent Bridge HTTP runtime/proxy processes. It evaluates thirteen rollout gates before broad-default readiness: route-registry diagnostics, coordinator health, startup-spawn MCP process collapse, startup-spawn config, agent-scoped primitive HTTP hosting, context routing coverage, agent-scoped bridge HTTP hosting, bridge wrapper footprint, watcher-WAL routing, knowledge-base receipt join-back, knowledge-base watcher activity, long-lived-agent routing, and long-lived-agent activity. The context-routing gate accepts a primitive HTTP profile only when it has a valid `active-session-id-<profile>` file or its health report proves `ATRIB_REQUIRE_EXPLICIT_CONTEXT_ID` is enforced. The host-owned primitive HTTP gate requires each configured endpoint to expose the shared backend health contract (`backend: "shared"`, `session_model: "per-session-transport-shared-backend"`, and `mounted_primitive_count: 7`), so an older per-session host cannot pass broad readiness after a code update. The startup-spawn config report keeps raw config-declared `local_substrate_endpoints` separate from `effective_local_substrate_endpoints`, which may also be proven by a healthy primitive runtime profile. This keeps URL-only clients such as Codex truthful while still surfacing the coordinator route they use through the host-owned primitive backend. The startup-spawn process gate treats `stdio-http-proxy` as a thin adapter and treats a direct stdio `atrib-primitives` runtime as incomplete shared-host migration. The bridge footprint gate treats Agent Bridge `--transport stdio-http-proxy` processes as healthy adapters while keeping legacy wrapper/upstream children as stale residue. The knowledge-base receipt gate reads counts, age, status, and `receipt_integrity` totals from `~/.atrib/state/knowledge-base-reports/receipt-join-latest.json`; stale, malformed, absent, active joinable `receipted/`, orphan, mismatch, invalid, or pending join-back state keeps `ready_for_default_trial` closed. Non-joinable diagnostic WAL remains visible through `non_joinable_queued`, `non_joinable_receipted`, and `non_joinable_receipt_files`, but it does not create a markdown join-back requirement. The knowledge-base watcher activity gate reads only known knowledge-base automation sources, status, last activity time, recomputed age, event type, context id, topics, and producer from that same report. It treats the larger of the persisted `age_ms` and current age from `last_activity_at` as the effective age, so stale activity cannot stay green because an older report cached a small age. A clean receipt report without recent watcher activity now keeps broad readiness closed. The long-lived activity gate reads only route labels, agent labels, loopback endpoints, record hashes, last activity times, and status. A healthy route without recent producer activity now keeps broad readiness closed. The process inventory groups standalone primitive children into launch generations and marks them as obsolete config drift when the current startup-spawn config already declares `atrib-primitives` and no longer declares the standalone primitives. Obsolete primitive or bridge children are also grouped into `restart_targets[]`, which points at the startup-spawn parent process that must restart and lists the stale child PIDs. The long-lived route gate requires every known long-lived agent route in the report to point at a healthy coordinator endpoint, and the activity gate requires every known route to have recent clean activity evidence. Known Hermes and OpenClaw launchd labels remain compatibility shortcuts, but future long-lived harnesses should self-declare safe `ATRIB_LOCAL_SUBSTRATE_ENDPOINT` and `ATRIB_AGENT` values or add a registry entry with `kind: "long-lived-agent"`. Future startup-spawn harnesses that do not have a built-in parser can add a sanitized registry entry with `kind: "startup-spawn-config"`, a profile name, loopback primitive and bridge HTTP endpoints, local-substrate endpoint evidence, and declared atrib server names. Invalid registry JSON, unknown registry schemas, or registry objects without route arrays fail the route-registry gate so future harness coverage cannot disappear silently. The fixture-backed checker runs in `pnpm doc-sync`, so a healthy isolated host proof cannot hide a mixed live topology with direct stdio primitive runtimes, duplicated primitive bundles, duplicated bridge wrappers, obsolete children held by a still-running app server, an old primitive HTTP backend model, a broken future-harness registry, missing agent-scoped primitive or bridge hosting, missing context routing coverage, stale or pending knowledge-base receipt join-back, missing watcher activity, active joinable or mismatched WAL receipts, partial long-lived agent routing, missing long-lived producer activity, or invisible future startup-spawn config surfaces.

Use the topology report before any wider default rollout:

```sh
pnpm report:local-substrate
```

A `ready_for_default_trial` status means the topology evidence supports a controlled default trial. A `restart_required` status means all route and runtime gates pass, but still-running startup-spawn parents own only obsolete child processes from older config. Restart the parents listed in `restart_targets[]`, then rerun the report. A `mixed` status means at least one route is still partly migrated. A `blocked` status means no healthy coordinator endpoint answered.

After a restart or route config change, use the default-trial measurement as the rollout gate:

```sh
pnpm measure:local-substrate
```

The measurement reuses the same collector but fails closed unless process footprint, shared HTTP surfaces, coordinator queue/orphan state, watcher receipt join-back, watcher activity, long-lived route health, and long-lived producer activity all pass together. It can write a JSON baseline with `--report <path>`, and its fixture checker runs in `pnpm doc-sync` so `ready_for_default_trial` cannot drift into a prose-only claim. Future versions should extend [D084](../../DECISIONS.md#d084-read-primitive-instrumentation-for-empirical-loop-closure-measurement) rather than create another private health surface.
