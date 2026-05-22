---
"@atrib/emit": minor
"@atrib/annotate": patch
"@atrib/revise": patch
---

Per-server `producer` label in the mirror sidecar.

`handleEmit` and `emitInProcess` now accept an optional `producer` field that
routes to the sidecar's `_local.producer` slot. Defaults to `'atrib-emit'`
for the bare server path, `'atrib-emit-cli'` for the CLI binary, and the
specialized wrappers (`@atrib/annotate`, `@atrib/revise`) pass their own
identity so mirror consumers can bucket records by emitter without
inspecting envelopes.

The `atrib-emit-cli` envelope gains an optional `producer` field for
hook-class callers that want finer attribution (e.g.
`'claude-hooks-builtin-2b'`, `'claude-hooks-mcp-2a'`); when omitted the
CLI defaults to `'atrib-emit-cli'`.

No wire-format change. The signed `AtribRecord` bytes are unchanged; only
the sidecar metadata varies.
