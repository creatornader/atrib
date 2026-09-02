# `services/log/`

This path is retained as a historical placeholder. The deployed public Merkle log lives in [`services/log-node/`](../log-node/) and serves `https://log.atrib.dev/v1`.

Use [`services/log-node/README.md`](../log-node/README.md) for the service overview, endpoints, local development, deployment, and verification commands. The protocol contract is defined in [`atrib-spec.md`](../../atrib-spec.md#2-merkle-log-protocol).

The in-process [`@atrib/log-dev`](../../packages/log-dev/README.md) package
remains available for local tests. It is a development stub, not the deployed
public log.
