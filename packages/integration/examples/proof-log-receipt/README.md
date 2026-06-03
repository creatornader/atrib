<!-- SPDX-License-Identifier: Apache-2.0 -->

# Proof-log receipt example

This example builds one inspectable receipt around a single signed atrib record.
It is meant for proof-log and transparency-infrastructure review, where the
reader needs one hash and a clear chain of evidence rather than a broad product
tour.

The smoke uses a fixture MCP/OAuth tool call from the integration harness. It:

- signs one atrib record
- submits the record to a Merkle log
- verifies the checkpoint signature from the log pubkey
- verifies the inclusion proof against the checkpoint root
- submits the record body and selected sidecar evidence to the archive
- retrieves the archive record and evidence projection
- verifies the record signature and evidence block with `@atrib/verify`
- checks that the fixture bearer token is not published by archive responses

Run:

```bash
pnpm --filter @atrib/integration proof-log-receipt
```

By default the command uses `https://log.atrib.dev/v1`,
`https://archive.atrib.dev/v1`, and `https://explore.atrib.dev`. It submits one
fixture record, record body, and evidence projection to the public log and
archive services. For local or staging runs, set:

```bash
ATRIB_PROOF_LOG_ENDPOINT=http://127.0.0.1:3000/v1 \
ATRIB_PROOF_ARCHIVE_ENDPOINT=http://127.0.0.1:3001/v1 \
ATRIB_PROOF_EXPLORER_ORIGIN=http://127.0.0.1:3000 \
pnpm --filter @atrib/integration proof-log-receipt
```

The receipt is intentionally narrow. It does not claim witness cosignatures,
cross-log replication, Rekor integration, CT integration, AKD adoption, or that
the archive stores every record body.
