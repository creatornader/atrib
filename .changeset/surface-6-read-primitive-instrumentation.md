---
"@atrib/mcp": minor
"@atrib/recall": minor
"@atrib/trace": minor
"@atrib/summarize": minor
---

Surface 6 of the 4th-pillar substrate-instrumentation broadening: log every
read-primitive invocation (recall family / trace / summarize) to
`~/.atrib/state/read-primitives/calls.jsonl` so the unified loop-closure
analyzer can correlate PreToolUse surfacing → read calls → cognitive writes.

`@atrib/mcp` exports two new helpers:

- `logReadPrimitiveCall(primitive, args, handler, extractHashes)` — wraps
  any read-primitive MCP handler. On call completion (success OR error)
  it appends one jsonl line with `{invoked_at, session_id, primitive,
  query_shape, result_count, elapsed_ms, sample_result_hashes[], errored}`.
  Silent-failure contract per spec [§5.8](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#58-degradation-contract): instrumentation never affects the
  primary tool path; the handler's result (or thrown error) propagates
  unchanged. `ATRIB_READ_PRIMITIVES_LOG` overrides the default path.
- `extractRecordHashesFromMcpResult(result)` — default extractor that
  deep-walks an MCP tool response for `sha256:<64-hex>` references and
  dedupes. Most callers can pass it directly; specialized servers can
  supply a tighter extractor when they know a stricter path.

All three read-primitive servers (`atrib-recall` — 5 sibling tools,
`atrib-trace`, `atrib-summarize`) wrap their handlers via these helpers.
The signed-record bytes, response shapes, and tool schemas are unchanged.

`@atrib/recall`'s compact-mode response now ALWAYS includes `record_hash`.
Without it, the analyzer (and any caller that wants to chain `recall_walk`
/ `recall_annotations` / `recall_revisions` / `trace` from a result) had to
fall back on verbose mode just to obtain the primary key. Compact response
becomes ~70 bytes larger per record; the schema gain is worth it.

Subsequent surfaces (7: SessionStart instrumentation; 8: structured cli-spawn
log; 9: unified analyzer) live in the operator's hook layer (not on npm)
and consume the same jsonl shape this surface produces.
