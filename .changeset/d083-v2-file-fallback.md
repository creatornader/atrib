---
"@atrib/mcp": minor
---

[D083](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers)
v2: file-fallback for startup-spawn harnesses.

The original [D083](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers) (shipped 2026-05-22 as `@atrib/mcp@0.8.0`) closed the
orphan-singleton class for harnesses that spawn MCP children with the
per-session env in scope (e.g. per-run Inspect arms). It did NOT close it
for harnesses that spawn MCP children ONCE at process startup, before any
session exists. Claude Code is the canonical example: MCP children listed
in `~/.claude.json` are spawned at Claude Code launch; the per-session
`CLAUDE_CODE_SESSION_ID` env var never reaches them. Post-restart
verification 2026-05-23 found every agent-initiated `mcp__atrib-emit`
call landing under a synthesized orphan context_id; historical mirror
inspection found 74 distinct orphans across 4587 producer-labeled records.

v2 extends `HarnessDiscovery` with an optional `fallbackFile?: () => string`
thunk returning a per-instance state file path. `resolveEnvContextId`'s
precedence now falls through env → file → undefined per registry entry.
File-read constraints: maximum 128 bytes, trimmed whitespace, silent
failure on all errors.

The Claude Code entry's thunk returns
`~/.claude/state/active-session-id-${process.ppid}`. Per-PPID keying
isolates concurrent Claude Code instances. The matching writer is a
SessionStart-equivalent hook in the host's hook layer (operator-side);
the writer reads `CLAUDE_CODE_SESSION_ID` from its env and writes the
file atomically.

Backward compatible: existing registry entries without `fallbackFile` keep
v1 env-only behavior. No spec change; signed records are byte-identical.
