---
"@atrib/mcp": patch
---

[D083](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers)
v2 defensive fixes from the 2026-05-23 audit pass.

- `resolveEnvContextId` now try-catches calls to `discovery.parse()` on
  both the env-var path and the file path. A buggy or asserting parser
  in a future `KNOWN_HARNESS_DISCOVERIES` entry no longer breaks the
  documented silent-failure contract; the resolver falls through to the
  next discovery or undefined.
- Multi-session-within-instance limitation documented in both the
  Claude Code registry entry's inline comment and the [D083](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers) v2 ADR
  consequences section: if Claude Code serves multiple sessions in
  sequence from the same instance (e.g. via `/clear`), the state file
  holds only the most-recent session id; agents that need to
  disambiguate must thread `context_id` explicitly.
- Two defensive-path unit tests added (env parse() throw, file thunk
  throw); test count 24 -> 26 -> 28 across the file-fallback suite,
  453 total across `@atrib/mcp`.
- `ATRIB_ACTIVE_SESSION_STATE_DIR` env override removed from the
  reference writer; the reader hardcodes `~/.claude/state/`, so the
  override was writer-only and silently broke the writer-reader pairing
  when set. Tests use `process.env.HOME` override instead.
