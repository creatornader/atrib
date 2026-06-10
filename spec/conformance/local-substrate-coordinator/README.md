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

## Rollout Meaning

Passing this corpus does not mean the coordinator should become default. It means the next implementation slice may build a local prototype against this boundary. The default remains direct in-process, CLI, or stdio signing until a process-health report shows the prototype handles startup-spawn harnesses, long-lived local agents, and watcher WAL paths on the same host without stale child buildup or receipt mismatch.
