# @atrib/revise

## 0.2.21

### Patch Changes

- Updated dependencies [114248a]
  - @atrib/mcp@0.16.0
  - @atrib/emit@0.14.12

## 0.2.20

### Patch Changes

- Updated dependencies [c2ea30d]
  - @atrib/mcp@0.15.1
  - @atrib/emit@0.14.11

## 0.2.19

### Patch Changes

- 92352be: Add explicit npm author, homepage, and keyword metadata to the cognitive MCP packages.
- Updated dependencies [92352be]
  - @atrib/emit@0.14.10

## 0.2.18

### Patch Changes

- Updated dependencies [8ad7158]
  - @atrib/mcp@0.15.0
  - @atrib/emit@0.14.9

## 0.2.17

### Patch Changes

- Updated dependencies [d19cb28]
- Updated dependencies [cd149be]
  - @atrib/mcp@0.14.0
  - @atrib/emit@0.14.8

## 0.2.16

### Patch Changes

- Updated dependencies [24c4331]
  - @atrib/mcp@0.13.0
  - @atrib/emit@0.14.7

## 0.2.15

### Patch Changes

- Updated dependencies [ee37209]
  - @atrib/mcp@0.12.0
  - @atrib/emit@0.14.6

## 0.2.14

### Patch Changes

- Updated dependencies [7658b17]
  - @atrib/mcp@0.11.1
  - @atrib/emit@0.14.5

## 0.2.13

### Patch Changes

- Updated dependencies [b263d91]
  - @atrib/mcp@0.11.0
  - @atrib/emit@0.14.4

## 0.2.12

### Patch Changes

- Updated dependencies [847852f]
  - @atrib/mcp@0.10.0
  - @atrib/emit@0.14.3

## 0.2.11

### Patch Changes

- Updated dependencies [64f3c86]
  - @atrib/mcp@0.9.1
  - @atrib/emit@0.14.2

## 0.2.10

### Patch Changes

- Updated dependencies [df7b3d3]
  - @atrib/mcp@0.9.0
  - @atrib/emit@0.14.1

## 0.2.9

### Patch Changes

- 1d5bbf4: Per-server `producer` label in the mirror sidecar.

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

- Updated dependencies [1d5bbf4]
  - @atrib/emit@0.14.0

## 0.2.8

### Patch Changes

- ec688d0: Harness session-id discovery for cognitive-primitive MCP servers
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

- Updated dependencies [ec688d0]
  - @atrib/mcp@0.8.0
  - @atrib/emit@0.13.1

## 0.2.7

### Patch Changes

- Updated dependencies [71a2344]
  - @atrib/emit@0.13.0

## 0.2.6

### Patch Changes

- Updated dependencies [197b52c]
  - @atrib/emit@0.12.0

## 0.2.5

### Patch Changes

- Updated dependencies [b34a995]
  - @atrib/emit@0.11.2

## 0.2.4

### Patch Changes

- Updated dependencies [6c6209d]
  - @atrib/emit@0.11.1

## 0.2.3

### Patch Changes

- Updated dependencies [952dbfa]
  - @atrib/emit@0.11.0

## 0.2.2

### Patch Changes

- Updated dependencies [b89d7b8]
  - @atrib/mcp@0.7.0
  - @atrib/emit@0.10.0

## 0.2.1

### Patch Changes

- Updated dependencies [15890e6]
  - @atrib/emit@0.9.0

## 0.2.0

### Minor Changes

- 29641cb: [D079](../DECISIONS.md#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface): ship `@atrib/annotate` and `@atrib/revise` as the dedicated MCP packages for atrib's cognitive primitives #2 (annotation) and #3 (revision). Each exposes one monomorphic MCP tool with a narrow Zod schema enforcing the spec's required fields per the annotation / revision event_types. Both packages depend on `@atrib/emit` for the canonical signing + chain composition + JSONL mirror pipeline; a verifier MUST NOT distinguish records signed via these tools from those signed via `@atrib/emit`'s polymorphic surface. `@atrib/emit` adds public exports for `handleEmit`, `resolveKey`, and the input/output types so downstream specialized writers can wrap the canonical pipeline cleanly.

### Patch Changes

- Updated dependencies [29641cb]
  - @atrib/emit@0.8.0
