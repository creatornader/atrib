# `@atrib/graph-node`

Public reference graph query service for atrib. It derives deterministic
relationships from signed records and serves the graph, trace, chain, creator,
and operational statistics endpoints defined by [§3](../../atrib-spec.md#3-graph-query-interface).

The deployed reference instance is `https://graph.atrib.dev/v1`. The service is
independently deployable and does not require the public explorer or any hosted
application.

## Endpoints

- `GET /v1/graph/<context_id>`: graph projection for a context.
- `GET /v1/graph/<context_id>/nodes`: nodes for a context graph.
- `GET /v1/graph/<context_id>/transaction`: transaction projection for a context.
- `GET /v1/creators/<creator_key>/sessions`: sessions for a creator.
- `GET /v1/creators/<creator_key>/graph`: creator graph projection.
- `GET /v1/trace/<record_hash>`: declared-relationship trace.
- `GET /v1/chain/<record_hash>`: chronology projection.
- `GET /v1/stats`: implementation statistics and liveness state.
- `POST /v1/ingest`: validate and add a signed record to the graph store.

The bare service URL returns a JSON endpoint catalog. Browser reads are
cross-origin enabled. Ingestion is intended for the configured log-to-graph
fan-out or an equivalent trusted operator path.

## Local development

From the repository root:

```sh
pnpm --filter @atrib/graph-node build
pnpm --filter @atrib/graph-node test
pnpm --filter @atrib/graph-node dev
```

The service uses an in-memory derived store by default. The deployed reference
configuration replays its append-only record archive on startup. See
[`fly.toml`](fly.toml) and [§3](../../atrib-spec.md#3-graph-query-interface) for
the deployment and protocol context.
