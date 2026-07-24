# Independent operator guide

atrib's public log is useful without an external operator, but one operator can
still censor submissions, withhold bodies, or show inconsistent checkpoints to
isolated clients. Independent operation is the path from operator-signed
evidence to a trust posture that can detect those failures.

The first open role is a checkpoint witness for `log.atrib.dev`. The reference
service is ready. No independently controlled witness is live yet.

## What counts as independent

An operator counts as independent only when all of these are outside atrib's
control:

- the witness signing key and its recovery process;
- the runtime account, host, billing, and deployment credentials;
- the public hostname and TLS termination;
- the state volume and backups;
- the channel that publishes the witness public key; and
- the decision to upgrade, stop, or report an incident.

A second container, account, or region paid for and administered by atrib does
not satisfy this condition.

## Witness deployment

1. Review [`services/witness-node/`](../services/witness-node/) and its tests.
2. Copy `services/witness-node/deploy/.env.example` to `.env`.
3. Generate the witness seed on the operator-controlled machine. Keep it out of
   source control, support tickets, and atrib-operated secret stores.
4. Obtain the log origin and public key through an authenticated out-of-band
   channel. Do not discover the trust root from the live `/v1/pubkey` endpoint.
5. Start the container from the repository root:

   ```sh
   docker compose \
     -f services/witness-node/deploy/docker-compose.yml \
     up --build -d
   ```

6. Expose the service through the operator's own HTTPS hostname.
7. Publish the witness name and public key through a second operator-controlled
   channel.
8. Run the deployment proof from a separate verifier machine.

The compose deployment uses a persistent state volume and a read-only root
filesystem. The witness fsyncs leaf history, cosignatures, and checkpoint state
before advancing its durable view.

## Deployment proof

Set caller-owned trust roots. Do not copy keys from the endpoints during the
same proof:

```sh
ATRIB_WITNESS_URL=https://witness.example.org \
ATRIB_WITNESS_NAME=witness.example.org \
ATRIB_WITNESS_PUBLIC_KEY='<pinned witness public key>' \
ATRIB_WITNESS_LOG_URL=https://log.atrib.dev \
ATRIB_WITNESS_LOG_ORIGIN=log.atrib.dev/v1 \
ATRIB_WITNESS_LOG_PUBLIC_KEY='<pinned log public key>' \
ATRIB_WITNESS_MAX_TREE_LAG=1000 \
ATRIB_WITNESS_MAX_AGE_SECONDS=300 \
node services/witness-node/scripts/prove-deployment.mjs
```

The proof fetches the operator-signed checkpoint stored by the witness, then
fetches its cosignature. It verifies both signatures, freshness, key
identities, the one-witness threshold, and a bounded tree-size lag against a
separately verified live-log checkpoint. This avoids requiring exact equality
between two checkpoints fetched while the log is advancing.

## Operating contract

The operator should monitor:

- `/v1/status` for a non-null tree size, recent `witnessed_at`, and `error:
null`;
- container restarts and persistent-volume health;
- changes to the pinned log key or origin;
- immutable artifacts under `/v1/incidents`; and
- proof failures from an external verifier.

Back up the state volume after the first successful checkpoint and on a regular
schedule. Restoration must preserve the latest witnessed tree size and leaf
history. Starting from empty state after previously publishing cosignatures
loses rollback memory and should be disclosed as a new witness epoch.

Every configured gossip source is required. Add one only when another party
controls the observation source and delivery path. An unavailable or
inconclusive required source stops cosigning.

## Upgrade and incident handling

Before upgrading:

1. record the current status and public key;
2. back up the state volume;
3. run package tests and the deployment proof against the candidate version;
4. replace the container without replacing the state volume; and
5. rerun the external deployment proof.

If the witness detects rollback, a historical rewrite, or a conflicting
gossiped view, preserve the incident endpoint and stop automatic remediation.
The incident is evidence. Do not delete state or rotate the key to make the
status green.

## Default verification acceptance

The witness can enter atrib's default verification policy only after:

1. an independent operator controls it;
2. its public endpoint and out-of-band trust-root publication are live;
3. the deployment proof passes from a machine outside atrib's infrastructure;
4. an atrib proof bundle carries its cosignature; and
5. default verifier configuration pins the independent trust root.

Until all five hold, documentation and verifier output must continue to say
that no independent witness is deployed. Software readiness alone does not
close that gate.

## Other independent roles

The same control test applies to other services:

- an independent log accepts and proves the same records under a distinct log
  origin;
- an independent archive retains signed bodies under its own access and
  retention policy;
- an independent verifier publishes policy and acceptance results under its
  own key; and
- an independent checkpoint observer delivers signed views to witness gossip.

These roles can be operated separately. Running all of them under one new
operator creates one independent operator group, not four.
