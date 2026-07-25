# Independent operator guide

atrib's public log is useful without an external operator, but one operator can
still censor submissions, withhold bodies, or show inconsistent checkpoints to
isolated clients. Independent operation is the path from operator-signed
evidence to a trust posture that can detect those failures.

The first open role is a checkpoint witness for `log.atrib.dev`. The reference
service is ready. No independently controlled witness is live yet.

## What the first operator is agreeing to

The initial request can be a bounded 90-day pilot. The operator is agreeing to:

- run one small always-on witness service in an account they control;
- own the cloud bill, hostname, TLS, access credentials, and state volume;
- keep one Ed25519 seed private and publish the corresponding public key;
- pin atrib's log key from a channel other than the live log endpoint;
- retain rollback state and backups instead of silently starting from empty
  state;
- run an external cryptographic check at least every 15 minutes;
- preserve any split-view or rollback incident artifact; and
- publish a signed retirement if the pilot ends or durable state is lost.

The operator is not reviewing agent actions, storing record bodies, approving
submissions, or running another atrib log. The witness reads public checkpoint
and tile data. Its durable leaf history grows by 32 bytes per log entry, plus
small checkpoint, cosignature, health, and incident files.

At the end of the pilot, the operator can continue, hand the role to a
successor through a new key and epoch, or publish a signed retirement. Key
custody and rollback-state continuity matter more than perfect uptime during
the pilot. An outage makes the witness unavailable. Lost state without an
epoch change destroys its ability to detect a rollback against its prior view.

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
2. Build the witness and operator helper from the accepted source revision.
3. Run `operator init` to create the private `operator.env` and public
   `witness-trust-root.json` files. Keep the private file out of source control,
   support tickets, and atrib-operated secret stores.
4. Replace the image tag with the reviewed container digest.
5. Obtain the log origin and public key through an authenticated out-of-band
   channel. Do not discover the trust root from the live `/v1/pubkey` endpoint.
6. Start the container from the repository root:

   ```sh
   docker compose \
     -f services/witness-node/deploy/docker-compose.yml \
     --env-file ./operator.env \
     up -d
   ```

7. Expose the service through the operator's own HTTPS hostname.
8. Publish `witness-trust-root.json` through a second operator-controlled
   channel.
9. Run the deployment proof from a separate verifier machine.
10. Install the scheduled monitor from
    [`monitor.yml.example`](../services/witness-node/deploy/monitor.yml.example)
    in an operator-controlled repository.

The compose deployment uses a persistent state volume and a read-only root
filesystem. The witness fsyncs leaf history, cosignatures, and checkpoint state
before advancing its durable view.

### Fly.io pilot

Fly.io is an optional concrete path, not a requirement. The operator can use
any host that provides a persistent volume and HTTPS. For Fly:

1. Copy `deploy/fly.toml.example`, choose the operator's app name and region,
   and keep the 1 GB `witness_state` volume.
2. Create the app in the operator's Fly organization.
3. Import `operator.env` as app secrets.
4. Confirm the GHCR package is public, or configure operator-owned pull
   credentials before deployment.
5. Deploy the reviewed GHCR digest with `fly deploy --image`.
6. Attach the operator's hostname and verify its certificate.
7. Keep scheduled snapshots enabled and take an on-demand snapshot before an
   upgrade.

An example sequence, after filling the template, is:

```sh
fly apps create <operator-owned-app>
fly secrets import -a <operator-owned-app> < ./operator.env
fly deploy \
  -a <operator-owned-app> \
  -c ./fly.toml \
  --image ghcr.io/creatornader/atrib-witness-node@sha256:<reviewed-digest>
fly certs add -a <operator-owned-app> witness.example.org
```

The operator owns the Fly organization, billing, app, volume, secrets, and
domain. An atrib-owned Fly app does not count as independent operation.

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
ATRIB_WITNESS_MAX_CHECK_AGE_SECONDS=120 \
node services/witness-node/scripts/prove-deployment.mjs
```

The proof fetches the operator-signed checkpoint stored by the witness, then
fetches its cosignature. It verifies both signatures, key identities, the
one-witness threshold, process liveness, and a bounded
tree-size lag against a separately verified live-log checkpoint. It also
enforces cosignature age when `ATRIB_WITNESS_MAX_AGE_SECONDS` is set. This
avoids requiring exact equality between two checkpoints fetched while the log
is advancing.

The process-liveness gate uses `last_successful_check_at`, not the checkpoint
cosignature time. A quiet log can keep the same cosignature for longer than the
monitor interval. Set `ATRIB_WITNESS_MAX_AGE_SECONDS` only when a consumer also
wants to reject old checkpoint evidence. That evidence-freshness policy is
separate from whether the witness process is healthy.

The example scheduled workflow expects repository variables for the witness
URL, witness name, witness public key, log public key, and
`ATRIB_VERIFIER_REF`. Set the verifier ref to a reviewed commit SHA, not a
moving branch. The witness and log keys are public trust roots, but their
publication channels must remain independent of the endpoints they verify.

## Operating contract

The operator should monitor:

- `/v1/health` for recent successful polling;
- `/v1/status` for a non-null tree size, `health: "ok"`, and `error: null`;
- container restarts and persistent-volume health;
- changes to the pinned log key or origin;
- immutable artifacts under `/v1/incidents`; and
- proof failures from an external verifier.

Back up the state volume after the first successful checkpoint, before every
upgrade, and on a regular schedule. The operator must stop the witness and
attest to that fact with `--confirm-stopped`. The helper detects state changes
during its copy, then verifies the stored checkpoint and cosignature against
the declared witness and log keys. Fly volume snapshots are useful recovery
material, but they do not replace the helper's file-level manifest.

Restoration must preserve the latest witnessed tree size and leaf history.
Starting from empty state after previously publishing cosignatures loses
rollback memory. Retire the old key and publish a new witness epoch instead of
silently reusing the old identity.

`@atrib/verify` verifies the signed retirement artifact. Retirement takes
effect when a consumer, or the atrib-maintained reference profile, verifies
that artifact and removes the retired key and epoch from its accepted witness
set. The artifact cannot prevent a private-key holder from producing more
signatures. A verifier that still trusts the retired key will still accept
them.

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
5. an atrib-maintained reference verification profile pins the independent
   name, public key, and endpoint.

Until all five hold, documentation and verifier output must continue to say
that no independent witness is deployed. Software readiness alone does not
close that gate.

Consumers still choose their own trust policy. Inclusion in an atrib-maintained
reference profile does not make a witness globally trusted. The verifier fetches
cosignatures from caller-pinned witness endpoints and verifies them locally.
Witness-looking lines delivered only by the log do not satisfy that
endpoint-bound check.

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
