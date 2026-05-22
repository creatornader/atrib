# @atrib/revise

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
