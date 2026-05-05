# @atrib/mcp-wrap

## 0.2.0

### Minor Changes

- 03fe031: Extend the local mirror with an optional pre-sign payload sidecar.

  The local jsonl mirror previously stored only the bare signed AtribRecord, so consumers (recall, atrib-trace, atrib-summarize) saw only event_type + hashes, never the semantic content (tool name, args, result, observation payload) the record's content_id / args_hash / result_hash COMMITS TO. This made the mirror impoverished relative to what an agent's own working memory needs.

  `@atrib/mcp` `AtribOptions.onRecord` now accepts an optional second argument `OnRecordSidecar` carrying `{ toolName?, args?, result? }`, the pre-sign payload context captured from the wrapped tool call. The signed record bytes are unchanged; the sidecar lives at the host's persistence layer only and is never sent to the public log (which still only sees the bare AtribRecord via the submission queue).

  `@atrib/mcp-wrap`'s `persistRecord` extends to accept the sidecar and write a new envelope shape `{ record, _local?, written_at }` per line. `loadAutoChainSeed` tolerates BOTH the new envelope shape AND legacy bare-record entries from prior wrapper versions, fully backward-compatible. Tests cover both shapes plus mixed lines in the same file.

  This lays the groundwork for richer consumer-side tools (atrib-trace, atrib-summarize) that need semantic context to be useful, and for a future spec section formalizing the two-tier "private local + public canonical" pattern (deferred until consumer evidence informs the spec).

### Patch Changes

- Updated dependencies [03fe031]
  - @atrib/mcp@0.3.0

## 0.1.2

### Patch Changes

- Updated dependencies [79199ee]
- Updated dependencies [8abcb67]
- Updated dependencies [3161e59]
- Updated dependencies [a3d24f9]
- Updated dependencies [d7c806c]
  - @atrib/mcp@0.2.0

## 0.1.1

### Patch Changes

- 5809fc2: Refresh package descriptions and READMEs for npm consistency.
  - All 6 descriptions now follow the consistent shape `<noun> for atrib. <specific value>.`
  - Removed em dashes per the writing rules
  - `@atrib/mcp-wrap` description no longer mentions an arbitrary "~30 MCPs" cap (it works for any MCP)
  - Lowercased "Atrib" to "atrib" across author + description fields per the brand convention
  - Wrote READMEs for `@atrib/cli` and `@atrib/directory` (previously had none)
  - Rewrote 115 broken relative links across mcp/agent/verify READMEs to absolute github URLs that auto-heal at public-flip
  - Stripped temporary `repository` field from package.jsons (404s while repo is private; restored at public-flip)

- Updated dependencies [5809fc2]
  - @atrib/mcp@0.1.2
