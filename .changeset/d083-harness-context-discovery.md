---
"@atrib/mcp": minor
"@atrib/emit": patch
"@atrib/recall": patch
"@atrib/trace": patch
"@atrib/summarize": patch
"@atrib/annotate": patch
"@atrib/revise": patch
---

Harness session-id discovery for cognitive-primitive MCP servers
([D083](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers)).

Extends [D078](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default)'s
`ATRIB_CONTEXT_ID` env-var default with a second fallback layer: when
`ATRIB_CONTEXT_ID` is unset or invalid, derive a deterministic 32-hex
context_id from a registered harness env var (e.g. `CLAUDE_CODE_SESSION_ID`).

`@atrib/mcp` now exports `resolveEnvContextId()` and the
`KNOWN_HARNESS_DISCOVERIES` registry. The four cognitive-primitive MCP
servers (`@atrib/emit`, `@atrib/recall`, `@atrib/trace`, `@atrib/summarize`)
consume the helper as their env-default resolution point. `@atrib/annotate`
and `@atrib/revise` inherit the behavior transparently via `handleEmit`
delegation. No spec change; signed records are byte-identical.

Closes the steady-state orphan-singleton-chain class for Claude Code MCP
children. Adding a new harness is a one-entry edit to
`KNOWN_HARNESS_DISCOVERIES`.
