---
'@atrib/emit': minor
---

`emit` tool gains two optional inputs: `tool_name` ([§8.2](../atrib-spec.md#82-opaque-name-posture) disclosure) and `args_hash` ([§8.3](../atrib-spec.md#83-salted-commitment-posture) commitment). When supplied, these are carried verbatim into the signed AtribRecord per the JCS canonical form, matching what `@atrib/mcp` middleware emits when its disclosure pipeline is enabled. Mirrors the matching `content_id` / `tool_name` / `args_hash` filters added to `@atrib/recall` so that an emit-side producer and a recall-side consumer can agree on `(tool_name, args_hash)` as the matching key for "same tool on same target" queries. Backward-compatible (additive); existing callers unaffected.
