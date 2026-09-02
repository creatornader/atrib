# `@atrib/directory-node`

Public reference HTTP service for atrib's AKD-backed public-key directory. It
validates and publishes signed identity claims, serves current and historical
lookups, publishes consistency proofs, and anchors each successful operation
back into the atrib log as a `directory_anchor` record under
[§6](../../atrib-spec.md#6-key-directory).

The deployed reference instance is `https://directory.atrib.dev/v6`. The
service is independently deployable and does not require the public explorer
or any hosted application.

## Endpoints

- `POST /v6/publish`: publish a signed identity claim.
- `GET /v6/lookup/<creator_key>`: return the current claim for a key.
- `GET /v6/history/<creator_key>`: return the claim version chain.
- `GET /v6/anchor`: return the latest anchored directory snapshot.
- `GET /v6/audit-proof`: return an append-only consistency proof between epochs.

The bare service URL returns a JSON endpoint catalog. Public reads and signed
claim publishes are cross-origin enabled. The operator key signs directory
anchors; claim signatures remain the authority for published identity claims.

## Local development

From the repository root:

```sh
pnpm --filter @atrib/directory-node build
pnpm --filter @atrib/directory-node test
pnpm --filter @atrib/directory-node dev
```

Set `ATRIB_DIRECTORY_ORIGIN`, `ATRIB_LOG_ENDPOINT`, and
`ATRIB_DIRECTORY_PERSIST` for a persistent deployment. The deployed reference
configuration replays its claim journal and durable anchor journal on startup.
See [`fly.toml`](fly.toml) and [§6.2.4](../../atrib-spec.md#624-anchor-cross-reference-into-the-tessera-log).
