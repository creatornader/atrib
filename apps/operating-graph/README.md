# atrib operating graph

This is the complete open-source reference client for live, bounded atrib
operating views. It reads signed records from a local mirror, verifies their
signatures, and projects application state for a selected workspace, task,
team, or agent.

The client demonstrates one application profile. It does not add fields,
event types, or graph edges to the atrib protocol.

## What it proves

- Named workspace, task, team, and agent views over verified records.
- Body-aware search over private mirror content.
- Live accepted-state, decision, outcome, handoff, and resolution updates.
- Conflicts that stay visible while more than one active head exists.
- Application resolution that names every active head, cites every head
  through `informed_by`, and selects one accepted head in the private body.
- Incoming handoffs that make a task visible in the receiving agent's view.
- Explicit proof posture. A verified signature and a supplied log proof are
  rendered as separate facts.

This client does not prove that every action was captured or that a signed
claim is true. Coverage manifests, protected executors, counterparty evidence,
and witness evidence address different parts of that problem.

## Run the demo

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @atrib/operating-graph build
pnpm --filter @atrib/operating-graph demo
```

Open `http://127.0.0.1:8797`. The demo creates a temporary signed mirror with
two named agents, a visible conflict, a resolution, an outcome, and a handoff.
It does not submit records to a public log.

## Run against a local mirror

```sh
ATRIB_OPERATING_MIRROR="$HOME/.atrib/records" \
pnpm --filter @atrib/operating-graph start
```

The default address is `http://127.0.0.1:8797`. Reads are always available.
Writes require both `ATRIB_OPERATING_WRITES=enabled` and a nonempty
`ATRIB_OPERATING_WRITE_TOKEN`. The process refuses to start in write mode
without the token.

| Variable                           | Default            | Purpose                                        |
| ---------------------------------- | ------------------ | ---------------------------------------------- |
| `ATRIB_OPERATING_MIRROR`           | `~/.atrib/records` | JSONL mirror file or directory                 |
| `ATRIB_OPERATING_HOST`             | `127.0.0.1`        | HTTP bind address                              |
| `ATRIB_OPERATING_PORT`             | `8797`             | HTTP port                                      |
| `ATRIB_OPERATING_POLL_MS`          | `1000`             | Mirror polling interval                        |
| `ATRIB_OPERATING_TRUSTED_CREATORS` | unset              | Comma-separated creator-key allowlist          |
| `ATRIB_OPERATING_WRITES`           | disabled           | Set to `enabled` to expose signed write routes |
| `ATRIB_OPERATING_WRITE_TOKEN`      | unset              | Bearer secret required by both POST routes     |
| `ATRIB_OPERATING_CORS`             | `*`                | CORS origin for API clients                    |

An omitted creator allowlist accepts every locally verified signer. That is
convenient for a personal mirror, but it is not an identity policy. Shared
deployments should configure the allowlist or place an authenticated policy
layer in front of the service.

## Event body profile

The signed record remains a normal atrib observation or revision record. Its
private `_local.content` body uses this application schema:

```json
{
  "schema": "atrib.operating-event.v1",
  "kind": "decision",
  "workspace": { "id": "workspace-1", "name": "Apollo" },
  "task": { "id": "task-1", "name": "Ship reference client" },
  "team": { "id": "team-1", "name": "Protocol" },
  "agent": { "id": "agent-alice", "name": "Alice", "role": "builder" },
  "subject": "database",
  "value": { "selected": "sqlite" },
  "source": "operating-graph-demo"
}
```

Kinds are `accepted_state`, `decision`, `outcome`, `handoff`, and
`resolution`. Handoffs use `from_agent` and `to_agent`. A resolution includes
`accepted_head` plus `resolves`, and its signed record must cite every hash in
`resolves` through `informed_by`.

Application state is deliberately body-aware. Public log commitments alone do
not reveal names, state values, or resolution choices.

## HTTP surface

| Route                | Purpose                                           |
| -------------------- | ------------------------------------------------- |
| `GET /v1/health`     | Mirror, revision, write, and trust-policy status  |
| `GET /v1/workspaces` | Named workspace index                             |
| `GET /v1/view`       | Bounded operating view                            |
| `GET /v1/search`     | Body-aware search inside the selected scope       |
| `GET /v1/stream`     | SSE revision stream with exact reconnect cursors  |
| `POST /v1/events`    | Sign an application event when writes are enabled |
| `POST /v1/resolve`   | Sign an all-head application resolution           |

`GET /v1/view` requires `workspace_id`. Optional `task_id`, `team_id`, and
`agent_id` parameters narrow the view. A signed handoff includes the handed-off
task's prior state in the receiving agent's view. `cell_limit`, `head_limit`,
and `event_limit` are bounded server-side.

The stream cursor is exclusive. A cursor ahead of the local revision returns
409 instead of silently opening a live-only stream.

Both POST routes require `Authorization: Bearer <write token>`. The browser
client asks for the token on the first resolution attempt and keeps it only in
session storage.

## Container deployment

The compose file mounts the operator's mirror read-only and keeps writes
disabled:

```sh
docker compose \
  -f apps/operating-graph/deploy/docker-compose.yml \
  up --build
```

For a hosted deployment, terminate TLS and authentication in a reverse proxy,
set `ATRIB_OPERATING_TRUSTED_CREATORS`, and mount only the mirror data the
service should read. Do not expose a writable signing environment in the same
container unless the deployment has a deliberate key-custody and policy
boundary.

The service is stateless. Reset it by replacing the container. Its source
mirror is not application-owned and must not be deleted during a reset.

## Fresh-machine proof

After committing the source:

```sh
pnpm --filter @atrib/operating-graph prove:fresh-machine
```

The script exports `HEAD` into a temporary directory, runs a frozen install,
builds the reference client, and executes its tests. It never reads the
current checkout's `node_modules`.

## Conformance participation

[`conformance/operating-view-v1.json`](conformance/operating-view-v1.json)
pins the application projection for conflicts, all-head resolution, named
identities, and handoff visibility. The fixture test consumes that file
directly.

Another application can:

1. consume the fixture and publish its result;
2. submit a new fixture that exposes an ambiguous application behavior;
3. demonstrate the same event profile in an independent client; or
4. document why its conflict policy cannot be represented with existing
   records and `informed_by`.

Only the fourth case supplies evidence for revisiting a public merge primitive.
One application preferring a different UI does not.

## Verification

```sh
pnpm --filter @atrib/operating-graph typecheck
pnpm --filter @atrib/operating-graph test
pnpm --filter @atrib/integration test -- hostile-operating-graph.test.ts
```

The hostile suite covers checkpoint rollback, result-evidence inconsistency,
permit replay and revoked credentials, withheld bodies, conflicting heads, and
an action omitted from an event projection.
