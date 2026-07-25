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

Use a published image digest after the image workflow has completed. Confirm
that the GHCR package is public, or configure operator-owned pull credentials.
A tag is useful for discovery but does not pin the reviewed build.

Build the operator helper, then create a private environment file and a
separate public trust-root file:

```sh
pnpm --recursive --filter @atrib/witness-node... \
  --workspace-concurrency=1 run build

pnpm --silent --filter @atrib/witness-node operator -- init \
  --name witness.example.org \
  --epoch 1 \
  --image 'ghcr.io/creatornader/atrib-witness-node@sha256:<reviewed-digest>' \
  --log-public-key '<authenticated log key>' \
  --env-file ./operator.env \
  --trust-root-file ./witness-trust-root.json
```

`operator.env` is created with mode `0600` and contains the witness seed.
`witness-trust-root.json` contains only the public key, key ID, name, and
epoch.

For Docker Compose:

```sh
docker compose \
  -f services/witness-node/deploy/docker-compose.yml \
  --env-file ./operator.env \
  up -d
```

The compose service uses a persistent state volume and a read-only root
filesystem. The Fly template in `deploy/fly.toml.example` uses a persistent
volume, scheduled snapshots, a 512 MB Machine, and the same health endpoint.
The operator owns the Fly organization, app, billing, volume, secrets, and
hostname.

Prove the deployed endpoint from a separate machine with
`scripts/prove-deployment.mjs`. Copy `deploy/monitor.yml.example` into an
operator-controlled repository for a scheduled independent check.

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
ATRIB_WITNESS_HEALTH_MAX_CHECK_AGE_SECONDS=120 \
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
- `GET /v1/health`
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

`/v1/health` measures whether the witness recently completed a successful log
check. It does not reuse the cosignature timestamp as process liveness. A quiet
log can keep the same checkpoint and cosignature while the witness continues
to poll successfully. `/v1/status` exposes both
`checkpoint_witnessed_at` and `last_successful_check_at`.

Leaf hashes use an append-only binary history. The service fsyncs new hashes
and immutable cosignatures before atomically advancing checkpoint state. If a
crash leaves an uncommitted binary tail, the next update truncates back to the
last committed tree size before appending.

Split-view incidents use deterministic IDs over the operator origin, conflict
kind, sources, checkpoint hashes, tree sizes, and roots. Repeated observation
of the same conflict preserves the first immutable incident artifact instead
of creating a new row on every poll.

## Backups and retirement

Stop the witness before taking an application-level backup:

```sh
pnpm --silent --filter @atrib/witness-node operator -- backup \
  --state-dir /path/to/stopped/state \
  --output-dir /path/to/backup \
  --witness-name witness.example.org \
  --witness-epoch 1 \
  --witness-public-key '<public witness key>' \
  --log-public-key '<authenticated log key>' \
  --confirm-stopped
```

The operator must stop the witness and attest to that fact with
`--confirm-stopped`. The helper detects mutation during the copy, verifies the
checkpoint and cosignature against the supplied trust roots, hashes every
regular state file, rejects symlinks and unfinished durable writes, and records
the committed tree state in a manifest. `verify-backup` checks the packet.
`restore` writes only to an absent target directory.

If the operator ends the role or loses rollback state, publish a signed
retirement and start a new epoch with a new key:

```sh
pnpm --silent --filter @atrib/witness-node operator -- retire \
  --env-file ./operator.env \
  --epoch 1 \
  --reason 'operator ended the pilot' \
  --output-file ./witness-retirement.json
```

The helper binds the retirement to the epoch stored during `operator init`.
`@atrib/verify` can verify the artifact. Consumers enforce retirement by
removing that key and epoch from their accepted witness set.
