# Local substrate coordinator contract corpus

This corpus is the first [P042](../../../DECISIONS.md#p042-local-substrate-coordinator-for-long-lived-and-multi-harness-dogfood) design gate. It is informative until P042 becomes an ADR, but it is still executable: `scripts/check-local-substrate-coordinator-fixtures.mjs` must pass before any default config moves to a host-owned coordinator.

The corpus tests one rule: a coordinator can own process, queue, WAL, and health work, but it must pass the exact same unsigned record body into the existing signing path that the direct producer path would have used. The coordinator is deployment architecture. It does not add a record field, event type, cognitive primitive, or graph edge.

## Cases

| File                                          | Harness class      | What it pins                                                                                                                               |
| --------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `cases/startup-spawn-codex-tool-call.json`    | `startup-spawn`    | A Codex or Claude Code startup-spawn MCP child routes a tool call through the coordinator without changing the wrapper-signed record body. |
| `cases/long-lived-assistant-observation.json` | `long-lived-agent` | A long-lived assistant or scheduled producer emits an observation through the same boundary without becoming an MCP host.                  |
| `cases/watcher-wal-annotation.json`           | `watcher-wal`      | A local watcher drains a WAL entry, preserves the annotation body, and keeps receipt join-back explicit.                                   |

## Contract

Each fixture has the same shape:

- `input.coordinator_request`: the request an adapter sends to the local coordinator.
- `input.direct_record_body`: the record body the current direct path would sign.
- `input.health_report`: the minimum process-health shape that gates rollout.
- `expected.canonical_record_body_sha256`: `sha256` over the canonical JSON form of `coordinator_request.record_body`.

The validator checks:

- all three harness classes are present
- the coordinator request and direct path bodies are byte-equivalent after canonical JSON sorting
- fallback behavior is explicit and non-blocking
- health reports include pid, version, transport, queue depth, WAL backlog, active contexts, and stale-child detection
- each pinned record-body hash matches the fixture

## Process-Health Proof

The fixture validator proves the schema and byte-equivalence contract. The host process proof runs the same fixtures through a real loopback coordinator:

```sh
pnpm prove:local-substrate
```

That command builds `@atrib/mcp` and `@atrib/emit`, starts `atrib-local-substrate` on an ephemeral loopback port, sends all three fixture requests over HTTP, checks watcher receipt issuance, validates the final health report, asserts zero stale children and zero orphan receipts, and proves unavailable coordinators classify as `unavailable` for fallback handling. For a live coordinator already running under a supervisor, use:

```sh
node scripts/prove-local-substrate-process-health.mjs \
  --use-existing http://127.0.0.1:8787/atrib/local-substrate
```

## Rollout Meaning

Passing this corpus does not mean the coordinator should become default. It means the next implementation slice may build a local prototype against this boundary. Passing `pnpm prove:local-substrate` means the host binary satisfies the corpus over HTTP in isolation. The default remains direct in-process, CLI, or stdio signing until dogfood config proves the same behavior across real startup-spawn harnesses, long-lived local agents, and watcher WAL paths without stale child buildup or receipt mismatch.

## Topology Report

The host proof does not inspect the real dogfood process tree. The topology report fills that gap:

```sh
pnpm report:local-substrate
```

The report reads local process rows, sanitized Codex, Claude Code, and Claude Desktop MCP config summaries, launchd metadata for `com.nader.atrib-local-substrate.*`, `com.nader.atrib-drain`, launchd agents that self-declare safe `ATRIB_LOCAL_SUBSTRATE_ENDPOINT` and `ATRIB_AGENT` values, an optional supervised-route registry at `~/.atrib/local-substrate/routes.json`, coordinator health probes, primitive-runtime HTTP health probes, bridge-runtime HTTP health probes, the bounded knowledge-base receipt join-back report, the bounded long-lived producer activity report, and bridge wrapper/upstream process groups. The registry can also carry sanitized `startup-spawn-config` entries for future harnesses, with only profile name, loopback endpoints, and declared atrib server names. Parse errors, unknown registry schemas, and registry objects without route arrays fail the route-registry gate instead of being treated as an absent registry. The report shows whether the host-owned coordinator is healthy, whether startup-spawn harnesses have collapsed onto `atrib-primitives`, whether stdio-only clients use the `stdio-http-proxy` adapter instead of a direct stdio runtime, whether startup-spawn configs point at healthy agent-scoped primitive and bridge HTTP hosts, whether primitive HTTP hosts expose the shared backend contract, whether primitive HTTP profiles have context routing coverage through active-session state or explicit-context enforcement, whether bridge wrappers are multiplying under one startup-spawn parent, whether the watcher-WAL launch agent points at a healthy coordinator endpoint, whether the knowledge-base receipt report is fresh and has no pending join-backs, whether every known supervised long-lived producer points at a healthy coordinator endpoint, and whether every known supervised long-lived producer has recent activity evidence. When obsolete child processes remain after config has moved to host-owned routes, `restart_targets[]` names the startup-spawn parent process that still owns them and lists the child PIDs as evidence.

Long-lived route counters distinguish route entries from shared coordinator endpoints. `long_lived_agent_routes` counts known producer routes, while `long_lived_agent_route_endpoints` counts distinct endpoint URLs. Two agents may correctly share one knowledge-base coordinator endpoint without collapsing into one route.

Fixture snapshots live in [`topology/`](topology/). They pin these states:

- `healthy-collapsed-startup-spawn.json`: coordinator services are healthy, Codex, Claude Code, and Claude Desktop each point at loopback `atrib-primitives` and Agent Bridge Streamable HTTP hosts for their agent profile, Desktop proves explicit-context enforcement instead of active-session state, supervised long-lived routes have recent activity evidence, and no standalone primitive bundle remains.
- The checker mutates the healthy fixture to pin the knowledge-base receipt join-back failure mode where pending joins keep the broad-default gate closed.
- The checker mutates the healthy fixture to pin the long-lived activity failure mode where routes are healthy but producer evidence is missing.
- The checker mutates the healthy fixture to pin the stdio-only client migration boundary: a direct stdio `atrib-primitives` runtime keeps broad readiness closed, while a `stdio-http-proxy` process is treated as a thin adapter to the shared HTTP backend.
- The checker mutates the missing-active-session fixture to pin the Desktop-style context boundary: a primitive HTTP profile missing active-session state can pass only when the health report proves explicit `context_id` is required before write primitives sign.
- `missing-long-lived-agent-route.json`: startup-spawn, primitive HTTP, and watcher-WAL routing are healthy, but no supervised long-lived route exists, so the broad-default gate stays closed.
- `missing-host-owned-bridge-http.json`: startup-spawn primitive HTTP and coordinator routing are healthy, but no agent-scoped bridge HTTP route exists, so the broad-default gate stays closed.
- `mismatched-primitive-http-profile.json`: Codex and Claude Code both point at one primitive HTTP host whose health report belongs to one agent profile, so the broad-default gate stays closed.
- `mixed-duplicated-startup-spawn.json`: a coordinator is healthy, but a startup-spawn harness still has standalone primitive processes alongside `atrib-primitives`.
- `mixed-obsolete-standalone-generations.json`: current config has moved to `atrib-primitives`, but a still-running startup-spawn host owns obsolete standalone primitive children.
- `partial-long-lived-agent-route.json`: one supervised long-lived route is healthy and another known route is missing its endpoint, so the broad-default gate stays closed.
- `registered-future-long-lived-agent-route.json`: a future supervised agent is known through the route registry rather than a hard-coded launchd label, and the long-lived gate can still pass.
- `registered-future-startup-spawn-config.json`: a future startup-spawn harness is known through the route registry rather than a hard-coded config parser, and the startup-spawn HTTP gates still require matching primitive and bridge runtime profiles.
- `restart-required-obsolete-agent-bridge-generations.json`: startup-spawn primitive, bridge HTTP, session-state, watcher-WAL, and long-lived routes pass, but a still-running app-server owns only obsolete bridge wrapper generations.
- `restart-required-obsolete-agent-bridge-wrappers.json`: startup-spawn primitive, bridge HTTP, session-state, watcher-WAL, and long-lived routes pass, but still-running startup-spawn hosts own obsolete bridge wrapper/upstream pairs.

`scripts/check-local-substrate-topology-report.mjs` validates those snapshots and runs through `pnpm doc-sync`. A live `restart_required` report means host-owned routing, runtime, context-routing, watcher-WAL, and long-lived-agent gates pass, but still-running startup-spawn hosts own only obsolete child processes from pre-migration config. Restart the parents listed in `restart_targets[]` before treating the broad-default gate as ready. A live `mixed` report means at least one routing, runtime, context-routing, watcher-WAL, long-lived-agent route, long-lived-agent activity, or non-obsolete process-footprint gate remains incomplete.

## Default-Trial Measurement

The topology report is diagnostic. The default-trial measurement is the post-restart gate:

```sh
pnpm measure:local-substrate
```

The measurement reuses the topology collector, then fails closed unless the topology is `ready_for_default_trial`, no stale startup-spawn primitive or bridge wrapper processes remain, every configured startup-spawn profile uses shared primitive HTTP plus healthy bridge HTTP, all known coordinators have empty queues and no stale children or orphan receipts, the watcher receipt join-back report is clean, every known long-lived route points at a healthy coordinator endpoint, and every known long-lived route has recent producer activity. Use `--report <path>` to write a JSON baseline for rollout notes. `scripts/check-local-substrate-default-trial-measurement.mjs` pins the ready case plus restart-residue, receipt-backlog, missing-long-lived-route, and missing-long-lived-activity failures, and it runs through `pnpm doc-sync`.
