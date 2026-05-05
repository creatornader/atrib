---
"@atrib/mcp": minor
"@atrib/mcp-wrap": minor
---

Extend the local mirror with an optional pre-sign payload sidecar.

The local jsonl mirror previously stored only the bare signed AtribRecord, so consumers (recall, atrib-trace, atrib-summarize) saw only event_type + hashes, never the semantic content (tool name, args, result, observation payload) the record's content_id / args_hash / result_hash COMMITS TO. This made the mirror impoverished relative to what an agent's own working memory needs.

`@atrib/mcp` `AtribOptions.onRecord` now accepts an optional second argument `OnRecordSidecar` carrying `{ toolName?, args?, result? }`, the pre-sign payload context captured from the wrapped tool call. The signed record bytes are unchanged; the sidecar lives at the host's persistence layer only and is never sent to the public log (which still only sees the bare AtribRecord via the submission queue).

`@atrib/mcp-wrap`'s `persistRecord` extends to accept the sidecar and write a new envelope shape `{ record, _local?, written_at }` per line. `loadAutoChainSeed` tolerates BOTH the new envelope shape AND legacy bare-record entries from prior wrapper versions, fully backward-compatible. Tests cover both shapes plus mixed lines in the same file.

This lays the groundwork for richer consumer-side tools (atrib-trace, atrib-summarize) that need semantic context to be useful, and for a future spec section formalizing the two-tier "private local + public canonical" pattern (deferred until consumer evidence informs the spec).
