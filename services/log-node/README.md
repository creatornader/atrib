# `@atrib/log-node`

> Production atrib attribution log with real RFC 9162 Merkle inclusion proofs and C2SP tlog-tiles API.
>
> This is **not** the dev stub. For local development and testing, use [`@atrib/log-dev`](../../packages/log-dev/README.md).

## What this is

`@atrib/log-node` is the production log service for the atrib value provenance protocol. It accepts signed attribution records over HTTP and returns real cryptographic inclusion proofs, Merkle path from the submitted leaf to the current signed checkpoint. Checkpoint signatures use Ed25519 (RFC 8032). The checkpoint format follows the C2SP signed-note spec. The log API follows the C2SP tlog-tiles read API.

This package is `private: true` and is never published to npm. It is deployed as a service at `log.atrib.dev/v1`.

## How it relates to `@atrib/log-dev`

|                         | `@atrib/log-dev`                       | `@atrib/log-node`                               |
| ----------------------- | -------------------------------------- | ----------------------------------------------- |
| **Use case**            | Local dev, CI, end-to-end demos        | Production deployment                           |
| **Inclusion proofs**    | Well-formed shapes, placeholder hashes | Real Merkle proofs                              |
| **Persistence**         | In-process memory only                 | Persistent across restarts (if key is provided) |
| **Checkpoint signing**  | Stub (no real signature)               | Real Ed25519 signatures                         |
| **Conforms to spec §2** | Wire format only                       | Full                                            |
| **Inspection API**      | Yes (`entries`, `onSubmit`, etc.)      | No                                              |
| **npm published**       | No                                     | No, deployed as a service                      |

Both services speak the same `POST /v1/entries` wire format defined in spec §2.6.1, so client code is identical for both targets. Point `ATRIB_LOG_ENDPOINT` at either URL and the `@atrib/mcp` submission queue works unchanged.

## Running locally

```bash
# Without a persistent key (random key generated on startup, proofs won't survive restarts)
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

The Dockerfile copies only `packages/mcp/` and `services/log-node/` into the image, the rest of the monorepo is excluded.

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

Submit a signed attribution record. Validates the record per spec §2.6.1 Steps 1-6, appends it to the Merkle tree, and returns an inclusion proof.

**Request body**, a bare signed record (JSON, `Content-Type: application/json`):

```json
{
  "spec_version": "1.0",
  "event_type": "tool_call",
  "context_id": "<uuid-v4>",
  "creator_key": "<base64url-ed25519-pubkey>",
  "chain_root": "sha256:<hex>",
  "record_hash": "<base64url-sha256>",
  "signature": "<base64url-ed25519-signature>"
}
```

**Response `200 OK`**, a proof bundle (spec §2.6.2):

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

### `GET /v1/checkpoint`

Returns the latest signed checkpoint as `text/plain` in C2SP signed-note format. Includes the current tree size and root hash signed by the log's Ed25519 key.

## Tests

38 tests across 5 files covering entry serialization, Merkle tree correctness, checkpoint signing and parsing, HTTP server behavior, and end-to-end proof verification.

```bash
pnpm --filter @atrib/log-node test
```
