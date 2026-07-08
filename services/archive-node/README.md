# @atrib/archive-node

Reference Record Body Archive Layer for atrib's verifiable action layer, per [§2.12](../../atrib-spec.md#212-record-body-archive-layer).

The archive is separate from `log-node`. The log stores fixed commitment entries. The archive stores full signed record bodies and optional verifier evidence for producers that opt into public body retrieval.

Production deploy target: `https://archive.atrib.dev/v1`, backed by the Fly app `atrib-archive`.

## API

| Endpoint                             | Purpose                                                                                                   |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `POST /v1/records`                   | Archive a full signed `AtribRecord` body after confirming its hash is already committed in a trusted log. |
| `GET /v1/record/<record_hash_hex>`   | Retrieve the full body, log proofs, resolved facts, and verifier evidence results.                        |
| `GET /v1/evidence/<record_hash_hex>` | Retrieve only the evidence projection used by explorer action views.                                      |
| `GET /v1/retention`                  | Publish the archive retention manifest.                                                                   |

`POST /v1/records` accepts:

```json
{
  "record": { "spec_version": "atrib/1.0" },
  "proof": {},
  "authorizationEvidence": [],
  "resolvedFacts": {}
}
```

`authorizationEvidence` uses the `@atrib/verify` generic authorization evidence input shapes for MCP/OAuth, AAuth, and x401. The archive verifies those inputs on submission or retrieval and returns generic `evidence[]` blocks. It does not return raw bearer tokens, raw AAuth JWTs, raw x401 proof-response headers, or private credential payloads. Producers should not submit records whose privacy posture requires producer-local-only bodies.

x401 evidence is projected before storage. The archive keeps verifier result blocks, proof hashes, proof-gate status, payment-separation facts, and hashed origin, issuer-trust, or proof-payment binding references, then removes the raw x401 authorization input from the stored body.

`@atrib/mcp` and `@atrib/mcp-wrap` can submit to this API through the opt-in `archiveSubmission` config. The producer path sends the signed record body, the log proof returned by `POST /v1/entries`, optional `authorizationEvidence`, and optional `resolvedFacts`. It does not send local-only sidecar `args` or `result` fields.

## Local Run

```bash
ATRIB_ARCHIVE_LOG_ENDPOINTS=http://127.0.0.1:3100/v1 \
ATRIB_ARCHIVE_PERSIST=.tmp/archive.jsonl \
PORT=3400 \
pnpm --filter @atrib/archive-node dev
```

For isolated tests only, set `ATRIB_ARCHIVE_ALLOW_UNCOMMITTED=1` to skip trusted-log confirmation.

## Fly Deployment

The service deploys from `services/archive-node/fly.toml`. The deploy workflow includes an `archive-node` dispatch option and redeploys the archive when `services/archive-node/`, `spec/conformance/2.12/`, `packages/mcp/`, or `packages/verify/` changes.

One-time infrastructure setup:

```bash
flyctl apps create atrib-archive --org personal
flyctl volumes create atrib_archive_data --region iad --size 1 --yes -a atrib-archive
flyctl certs create archive.atrib.dev -a atrib-archive
```

After DNS points `archive.atrib.dev` at the Fly app, verify:

```bash
curl -fsS https://archive.atrib.dev/v1/retention
```
