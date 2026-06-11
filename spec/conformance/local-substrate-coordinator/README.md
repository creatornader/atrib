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

The report reads local process rows, sanitized Codex and Claude Code MCP config summaries, launchd metadata for `com.nader.atrib-local-substrate.*` and `com.nader.atrib-drain`, coordinator health probes, and primitive-runtime HTTP health probes. It reports whether the host-owned coordinator is healthy, whether startup-spawn harnesses have collapsed onto `atrib-primitives`, whether startup-spawn configs point at a shared primitive HTTP host, and whether the watcher-WAL launch agent points at a healthy coordinator endpoint.

Fixture snapshots live in [`topology/`](topology/). They pin two states:

- `healthy-collapsed-startup-spawn.json`: coordinator services are healthy, Codex and Claude Code point at one loopback `atrib-primitives` Streamable HTTP host, and no standalone primitive bundle remains.
- `mixed-duplicated-startup-spawn.json`: a coordinator is healthy, but a startup-spawn harness still has standalone primitive processes alongside `atrib-primitives`.

`scripts/check-local-substrate-topology-report.mjs` validates those snapshots and runs through `pnpm doc-sync`. A live `mixed` report means the coordinator can be running correctly while startup-spawn process collapse or shared primitive hosting is still incomplete.
