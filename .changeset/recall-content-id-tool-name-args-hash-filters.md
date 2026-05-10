---
'@atrib/recall': minor
---

`recall_my_attribution_history` gains three orthogonal filter arguments: `content_id` (exact match on the spec §1.2.2 content_id), `tool_name` (exact match on the §8.2 disclosed tool name), and `args_hash` (exact match on the §8.3 args_hash commitment). All three are optional and AND-combined with the existing `context_id` and `event_type` filters. Added to address the API gap surfaced by Track B Pattern 1 hook design: agents instrumenting pre-action verification need to query "have I called this tool on this target before?" without pulling the entire mirror and filtering client-side. content_id alone groups by (server, tool); tool_name groups by disclosed name across servers; args_hash groups by canonical-args replay. Backward-compatible (additive); existing callers unaffected.
