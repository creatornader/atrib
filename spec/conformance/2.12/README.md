# Record Body Archive Layer conformance

This corpus pins the [§2.12](../../../atrib-spec.md#212-record-body-archive-layer) V1 archive API added by [D070](../../../DECISIONS.md#d070-record-body-archive-layer).

The cases cover the public contract that archive implementations need to agree on:

- successful full-record retrieval
- explorer evidence projection
- retention expiry as `410 Gone`
- rejection of uncommitted submitted bodies

The reference implementation lives in [`services/archive-node`](../../../services/archive-node/).
