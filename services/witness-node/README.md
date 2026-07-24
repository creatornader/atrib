# atrib witness node

`@atrib/witness-node` implements the checkpoint witness contract in
[`atrib-spec.md` §2.9](../../atrib-spec.md#29-witnessing-and-cosignatures).

The service:

- verifies every log checkpoint against an operator key pinned in local
  configuration;
- reconstructs the current RFC 6962 root from canonical level-zero tiles;
- compares the later tile prefix with the last durably witnessed view;
- refuses rollback, same-size split views, changed historical leaves, and root
  mismatches;
- optionally compares complete signed views from configured checkpoint sources,
  refuses to cosign on a conflict, and persists a public immutable incident;
- signs the normative 76-byte C2SP cosignature payload;
- publishes immutable cosignatures from the witness, not from the log.

Running this service under atrib's control proves the software path but does
not create an independent witness. An independence claim requires a separate
operator, key custody, infrastructure, and trust-root distribution path.
The complete recruitment, deployment, backup, upgrade, incident, and
acceptance contract is in the
[independent operator guide](../../docs/independent-operator.md).

## Container deployment

From the repository root:

```sh
cp services/witness-node/deploy/.env.example \
  services/witness-node/deploy/.env
# Fill the operator-controlled secrets and pinned trust roots.
docker compose \
  -f services/witness-node/deploy/docker-compose.yml \
  up --build -d
```

The compose service uses a persistent state volume and a read-only root
filesystem. Prove the deployed endpoint from a separate machine with
`scripts/prove-deployment.mjs`; the independent operator guide lists the
required caller-pinned inputs.

## Configuration

The log key is a trust root. Copy it through an authenticated out-of-band
channel. Do not discover it from `/v1/pubkey` at runtime.

```sh
ATRIB_WITNESS_NAME=witness.example.org \
ATRIB_WITNESS_KEY='<base64url 32-byte Ed25519 seed>' \
ATRIB_WITNESS_LOG_URL=https://log.atrib.dev \
ATRIB_WITNESS_LOG_ORIGIN=log.atrib.dev/v1 \
ATRIB_WITNESS_LOG_PUBLIC_KEY='<pinned base64url key>' \
ATRIB_WITNESS_STATE_DIR=/var/lib/atrib-witness \
ATRIB_WITNESS_GOSSIP_SOURCES='[{"source_id":"observer.example","log_base_url":"https://observer.example/atrib-log"}]' \
pnpm --filter @atrib/witness-node start
```

Every configured gossip source is required. It must expose the same
`/v1/checkpoint` and canonical level-zero tile routes as the primary log. The
witness verifies the pinned operator signature, reconstructs each source's
root, compares the shared leaf prefix, and refuses to cosign if a source is
unavailable, invalid, inconclusive, or conflicting.

Configuring two URLs under one operator's control does not create independent
trust. Gossip only becomes an independent observation path when another party
controls at least one source and its delivery path.

The witness serves:

- `GET /v1/pubkey`
- `GET /v1/log-pubkey`
- `GET /v1/status`
- `GET /v1/checkpoint`
- `GET /v1/incidents`
- `GET /v1/incidents/<incident-id-without-sha256-prefix>`
- `GET /v1/cosig/<percent-encoded-log-origin>/<root-hash-base64url>`

The service performs one update during startup and then polls on its configured
interval. It does not expose a public endpoint that triggers witness work.
`/v1/checkpoint` returns the operator-signed checkpoint bytes the witness
actually cosigned. Deployment verification uses those stored bytes and checks
their bounded lag against the current live-log checkpoint.

Leaf hashes use an append-only binary history. The service fsyncs new hashes
and immutable cosignatures before atomically advancing checkpoint state. If a
crash leaves an uncommitted binary tail, the next update truncates back to the
last committed tree size before appending.

Split-view incidents use deterministic IDs over the operator origin, conflict
kind, sources, checkpoint hashes, tree sizes, and roots. Repeated observation
of the same conflict preserves the first immutable incident artifact instead
of creating a new row on every poll.
