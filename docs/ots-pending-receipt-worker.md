# OpenTimestamps pending-receipt worker

`scripts/upgrade-ots-receipts.mjs` is a host-owned maintenance worker. It
scans a mirror directory for JSONL envelopes with `_local.ots_receipts` and
replaces only receipts that move from `pending` to `complete`. It never edits
the signed `record` object.

Run it against one mirror directory:

```sh
node scripts/upgrade-ots-receipts.mjs --mirror-dir ~/.atrib/records
```

The worker follows the degradation contract. It logs failures with the
`atrib:` prefix, keeps the pending receipt, and exits successfully. It needs
an `@atrib/verify` OTS receipt-upgrade transport. The current checkout does
not expose that transport, so the default worker run records a skipped
upgrade until the host supplies it.

An example launchd schedule, for an operator who has installed the transport,
is a `StartInterval` of `3600` with `ProgramArguments` set to `node`, the
absolute script path, `--mirror-dir`, and the absolute mirror directory. The
worker does not install or modify any LaunchAgent.
