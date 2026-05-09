---
"@atrib/recall": minor
---

Default mirror discovery is now directory-scan, not single-file. Envelope shape parsed alongside bare records.

Two latent bugs compounded into recall being blind to ~97% of an agent's own history:

- The default `ATRIB_RECORD_FILE` pointed at one specific producer's mirror (`mcp-wrap-claude-code.jsonl`). When that producer goes silent, recall returns stale results. The wrapper had been silently dormant since 2026-05-05; current production records land in `atrib-emit-claude-code.jsonl` via the Layer-2 hooks.
- Even pointing recall at the emit mirror would have returned zero records because the parser required `spec_version` at the top level. emit writes the [D062](../DECISIONS.md#d062-local-mirror-sidecar--two-tier-private-local--public-canonical-persistence) envelope shape `{record, proof, _local}` where `spec_version` is nested under `.record`.

New design:

- Default: scan `ATRIB_MIRROR_DIR` (defaults `~/.atrib/records/`) and load every `*.jsonl`. The directory IS the contract per spec [§5.9](../atrib-spec.md#59-local-mirror-conventions).
- Back-compat: if `ATRIB_RECORD_FILE` is set, use only that file.
- Parser handles both bare records and [D062](../DECISIONS.md#d062-local-mirror-sidecar--two-tier-private-local--public-canonical-persistence) envelopes; nested record extraction matches the wrapper-side `normalizeMirrorLine`.
- Result includes `record_files` array; legacy `record_file` kept as deprecated single-string for back-compat with existing callers.

Three new exports: `loadRecordsFromDir(dir)`, `discoverRecords(recordFile?)`, plus the existing `loadRecords(path)` extended with envelope parsing. 17 prior tests still pass; 10 new tests added covering envelope parsing, dir-scan, mixed shapes, back-compat priority, ignored non-jsonl files.
