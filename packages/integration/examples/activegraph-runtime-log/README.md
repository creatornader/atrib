# ActiveGraph runtime-log proof

This example verifies a bounded ActiveGraph `export-trace` JSONL window with
`@atrib/runtime-log`.

The fixture comes from a fresh read of `yoheinakajima/activegraph` `v1.1.0`
(`27c2901b86119b676f1da985100d2d2c397b6969`) and a Diligence pack run that
exports approval-gate events. ActiveGraph owns the runtime log. atrib verifies a
bounded exported claim over that log.

## Run it

```bash
pnpm --filter @atrib/integration activegraph-runtime-log-smoke
```

The smoke reads
`fixtures/activegraph-v1.1.0-diligence-approval-window.jsonl`, builds a
`log_window_manifest`, extracts two `activegraph.approval_gate` receipts, and
verifies the manifest with local evidence. It also exercises the
`atrib-runtime-log attest` and `atrib-runtime-log verify` CLI paths from the
same evidence files.

## What it proves

- ActiveGraph `export-trace --format jsonl` output can be converted into
  `RuntimeLogEventRef` rows.
- The manifest binds ActiveGraph version, source commit, session definition,
  event hashes, approval-gate projection root, and side-effect receipt root.
- The approval receipts cover `approval.proposed`, `approval.granted`, and the
  following `object.created` event.
- A verifier rejects tampered event bodies, mismatched session definitions, and
  missing approval events when approval proof is requested.
- Raw ActiveGraph event bodies stay outside the manifest. In production they can
  stay with ActiveGraph or the user; this repo only commits a small fixture.

## What it does not prove

This does not publish to `log.atrib.dev`, replace ActiveGraph's event store,
prove that ActiveGraph needs atrib, or claim that every ActiveGraph run has an
approval gate. It only proves the companion proof shape for the fields present
in the current Diligence export.
