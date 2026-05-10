---
'@atrib/emit': minor
---

`emit` tool gains two optional inputs: `tool_name` ([§8.2](../atrib-spec.md#82-opaque-name-posture) disclosure) and `args_hash` ([§8.3](../atrib-spec.md#83-salted-commitment-posture) commitment). When supplied, these are carried verbatim into the signed AtribRecord per the JCS canonical form, matching what `@atrib/mcp` middleware emits when its disclosure pipeline is enabled. Mirrors the [`@atrib/recall@0.4.0`](./recall-content-id-tool-name-args-hash-filters.md) filters released alongside this change; together the two surfaces let an emit-side producer and a recall-side consumer agree on `(tool_name, args_hash)` as the matching key for "same tool on same target" queries. Backward-compatible (additive); existing callers unaffected. Bumps `@atrib/emit` 0.4.5 to 0.5.0.
