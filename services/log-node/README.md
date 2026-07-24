# `@atrib/log-node`

> Production atrib log for the verifiable action layer, with real RFC 9162 Merkle inclusion proofs and C2SP tlog-tiles API.
>
> This is **not** the dev stub. For local development and testing, use [`@atrib/log-dev`](../../packages/log-dev/README.md).

## What this is

`@atrib/log-node` is the production log service for the atrib protocol. It accepts signed action records over HTTP and returns real cryptographic inclusion proofs; Merkle path from the submitted leaf to the current signed checkpoint. Checkpoint signatures use Ed25519 (RFC 8032). The checkpoint format follows the C2SP signed-note spec. The log API follows the C2SP tlog-tiles read API.

This package is `private: true` and is never published to npm. It is deployed as a service at `log.atrib.dev/v1`.

## How it relates to `@atrib/log-dev`

|                                                                      | `@atrib/log-dev`                       | `@atrib/log-node`                               |
| -------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------- |
| **Use case**                                                         | Local dev, CI, end-to-end demos        | Production deployment                           |
| **Inclusion proofs**                                                 | Well-formed shapes, placeholder hashes | Real Merkle proofs                              |
| **Persistence**                                                      | In-process memory only                 | Persistent across restarts (if key is provided) |
| **Checkpoint signing**                                               | Stub (no real signature)               | Real Ed25519 signatures                         |
| **Conforms to spec [§2](../../atrib-spec.md#2-merkle-log-protocol)** | Wire format only                       | Full                                            |
| **Inspection API**                                                   | Yes (`entries`, `onSubmit`, etc.)      | HTTP read and subscription endpoints only       |
| **npm published**                                                    | No                                     | No (deployed as a service)                      |

Both services speak the same `POST /v1/entries` wire format defined in spec [§2.6.1](../../atrib-spec.md#261-submit-entry), so client code is identical for both targets. Point `ATRIB_LOG_ENDPOINT` at either URL and the `@atrib/mcp` submission queue works unchanged.

## Running locally

```bash
# Without a persistent key (random key generated on startup. Proofs won't survive restarts)
pnpm --filter @atrib/log-node start

# With a persistent Ed25519 key (base64url-encoded 32-byte seed)
ATRIB_LOG_KEY=<base64url-seed> PORT=3100 pnpm --filter @atrib/log-node start
```

## Docker

```bash
# Build (from the monorepo root)
docker build -f services/log-node/Dockerfile -t atrib-log-node .

# Run
docker run -p 3100:3100 \
  -e ATRIB_LOG_KEY=<base64url-seed> \
  atrib-log-node
```

The Dockerfile copies only `packages/mcp/` and `services/log-node/` into the image; the rest of the monorepo is excluded.

## Environment variables

| Variable        | Required | Default | Description                                                                                                                                                                                                                                                             |
| --------------- | -------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ATRIB_LOG_KEY` | No       | Random  | Base64url-encoded 32-byte Ed25519 private key seed for checkpoint signing. If omitted, a random key is generated and a warning is logged. Without a persistent key, checkpoint signatures change on every restart, invalidating all previously issued inclusion proofs. |
| `PORT`          | No       | `3100`  | TCP port to bind.                                                                                                                                                                                                                                                       |

To generate a persistent key:

```bash
node -e "const {utils} = require('@noble/ed25519'); const k = utils.randomPrivateKey(); console.log(Buffer.from(k).toString('base64url'))"
```

## API endpoints

### `POST /v1/entries`

Submit a signed attribution record. Validates the record per spec [§2.6.1](../../atrib-spec.md#261-submit-entry) Steps 1-6, appends it to the Merkle tree, and returns an inclusion proof.

**Request body**; a bare signed record (JSON, `Content-Type: application/json`):

```json
{
  "spec_version": "atrib/1.0",
  "event_type": "https://atrib.dev/v1/types/tool_call",
  "context_id": "<32-char hex trace-id>",
  "creator_key": "<base64url-ed25519-pubkey>",
  "chain_root": "sha256:<hex>",
  "content_id": "sha256:<hex>",
  "timestamp": 1743850000000,
  "signature": "<base64url-ed25519-signature>"
}
```

**Response `200 OK`**; a proof bundle (spec [§2.6.2](../../atrib-spec.md#262-inclusion-proof-response)):

```json
{
  "log_index": 42,
  "checkpoint": "<signed-note>",
  "inclusion_proof": ["<base64-hash>", ...],
  "leaf_hash": "<base64-hash>"
}
```

All hashes in the response are standard base64 (RFC 4648 §4, with padding), matching the tlog-tiles checkpoint format.

**Error responses** use RFC 9457 `application/problem+json`.

### `GET /v1/proof/<record_hash_hex>`

Returns a proof bundle for a record that is already included in the log. This is a read-only recovery endpoint: it does not append the record and it does not require the signed record body. It lets mirrors that currently hold `proof: null` recover inclusion evidence without duplicate submission.

**Response `200 OK`** uses the same proof-bundle shape as `POST /v1/entries`. A missing record returns `404 Not Found`.

### `GET /v1/checkpoint`

Returns the latest signed checkpoint as `text/plain` in C2SP signed-note format. Includes the current tree size and root hash signed by the log's Ed25519 key.

### `GET /v1/stream`

Server-Sent Events subscription surface for new decoded log entries. The stream emits a `ready` event followed by `log_entry` events:

```text
event: ready
data: {"tree_size":42,"filters":{"event_type":"tool_call","after":39},"resume_after":39,"replay_through":41}

id: 42
event: log_entry
data: {"tree_size":43,"entry":{"index":42,"record_hash":"sha256:..."}}
```

Supported filters: `creator_key`, `context_id`, `event_type`, inclusive
`since`, and exclusive log-index cursor `after`. The log is commitment-only,
so filters that require record bodies (`topic`, `importance`) return
`400 Bad Request`.

For exact reconnect, send the last processed log index as `Last-Event-ID` or
`after`. The header wins when both are present, matching native `EventSource`
reconnect behavior. A malformed cursor returns 400. A cursor beyond the current
tail returns 409 instead of silently losing the disconnected interval.

### `GET /v1/feed.json`

JSON Feed 1.1 companion for consumers that cannot hold a long-lived SSE connection. Items are newest-first and carry the decoded log entry in `_atrib`.

Supported filters match `/v1/stream`: `creator_key`, `context_id`,
`event_type`, `since`, and `after`. `limit` and `offset` paginate the feed.

## Operator recovery

Producer mirrors can contain entries shaped as `{ record, proof: null, _local }` when a record was signed and mirrored locally but log submission exceeded the producer flush deadline. Use `GET /v1/proof/<record_hash_hex>` to recover evidence for records already in the log. Use the proof-null replay script to audit the remaining records and append only the ones absent from the log.

The script is scan-only by default. Set `SUBMIT=1` to append missing records.

```bash
pnpm --filter @atrib/log-node replay-proof-null

SUBMIT=1 RECORD_HASH=sha256:<64-hex> \
  pnpm --filter @atrib/log-node replay-proof-null
```

## Live graph canary

`pnpm --filter @atrib/log-node graph-canary` signs a small canary record,
submits it to the configured log endpoint, then polls the graph trace endpoint
until the same `record_hash` appears at the returned `log_index`. It defaults
to `https://log.atrib.dev/v1` and `https://graph.atrib.dev/v1`, so it writes
an immutable public canary record when run without overrides.

```bash
pnpm --filter @atrib/log-node graph-canary

LOG_ENDPOINT=http://127.0.0.1:3100/v1 \
GRAPH_ENDPOINT=http://127.0.0.1:3200/v1 \
  pnpm --filter @atrib/log-node graph-canary
```

The default signer is a public, non-authoritative canary key so repeated
deploy checks use one stable creator. Set `ATRIB_GRAPH_CANARY_KEY` to a
base64url-encoded 32-byte Ed25519 seed to use a private canary signer.

## Tests

The test suite covers entry serialization, Merkle tree correctness, checkpoint signing and parsing, HTTP server behavior, and proof verification.

```bash
pnpm --filter @atrib/log-node test
```
