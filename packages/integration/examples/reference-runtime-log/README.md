# Reference runtime-log JSONL source

This example creates a local append-only JSONL runtime log, exports bounded
`log_window_manifest` proofs, and verifies the results with `@atrib/runtime-log`.

It is a reference source for tests and examples. It is not a hosted runtime,
scheduler, memory store, or public log. Raw event bodies stay in the JSONL file.
The manifests carry event hashes, projection roots, fork and compaction
bindings, and side-effect receipt refs.

## Run it

```bash
pnpm --filter @atrib/integration reference-runtime-log-smoke
```

The smoke writes a temporary JSONL log with a main run, a forked run, and a
compacted continuation run. It prints manifest hashes, verifier checks, receipt
counts, and the privacy posture.

## What it proves

- A host-owned runtime log can expose `append` and `exportWindow` without giving
  atrib ownership of the raw event store.
- The same JSONL inputs produce stable manifest hashes across temp directories.
- Fork manifests bind to a parent window manifest hash.
- Compaction manifests bind to both the source window manifest and the compacted
  event refs.
- Side-effect receipts keep local idempotency and external refs in JSONL while
  the manifest carries only receipt hashes and public-safe refs.

## Boundary

This example models the source contract behind
[`@atrib/runtime-log`](../../../runtime-log/). A real runtime may use SQLite,
Postgres, object storage, a workflow engine database, or a hosted trace API. The
contract is the exported manifest plus local verifier evidence, not JSONL
itself.
