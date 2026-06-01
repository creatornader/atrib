# @atrib/archive-node

Reference Record Body Archive Layer for atrib [§2.12](../../atrib-spec.md#212-record-body-archive-layer).

The archive is separate from `log-node`. The log stores fixed commitment entries. The archive stores full signed record bodies and optional verifier evidence for producers that opt into public body retrieval.

## API

| Endpoint | Purpose |
| --- | --- |
| `POST /v1/records` | Archive a full signed `AtribRecord` body after confirming its hash is already committed in a trusted log. |
| `GET /v1/record/<record_hash_hex>` | Retrieve the full body, log proofs, resolved facts, and verifier evidence results. |
| `GET /v1/evidence/<record_hash_hex>` | Retrieve only the evidence projection used by explorer action views. |
| `GET /v1/retention` | Publish the archive retention manifest. |

`POST /v1/records` accepts:

```json
{
  "record": { "spec_version": "atrib/1.0" },
  "proof": {},
  "authorizationEvidence": [],
  "resolvedFacts": {}
}
```

`authorizationEvidence` uses the `@atrib/verify` OAuth / MCP evidence input shape. The archive verifies those inputs on retrieval and returns generic `evidence[]` blocks. It does not return raw bearer tokens. Producers should not submit records whose privacy posture requires producer-local-only bodies.

## Local Run

```bash
ATRIB_ARCHIVE_LOG_ENDPOINTS=http://127.0.0.1:3100/v1 \
ATRIB_ARCHIVE_PERSIST=.tmp/archive.jsonl \
PORT=3400 \
pnpm --filter @atrib/archive-node dev
```

For isolated tests only, set `ATRIB_ARCHIVE_ALLOW_UNCOMMITTED=1` to skip trusted-log confirmation.
