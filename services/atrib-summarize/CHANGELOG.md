# @atrib/summarize

## 0.4.1

### Patch Changes

- Updated dependencies [b263d91]
  - @atrib/mcp@0.11.0

## 0.4.0

### Minor Changes

- 847852f: Surface 6 of the 4th-pillar substrate-instrumentation broadening: log every
  read-primitive invocation (recall family / trace / summarize) to
  `~/.atrib/state/read-primitives/calls.jsonl` so the unified loop-closure
  analyzer can correlate PreToolUse surfacing → read calls → cognitive writes.

  `@atrib/mcp` exports two new helpers:
  - `logReadPrimitiveCall(primitive, args, handler, extractHashes)` — wraps
    any read-primitive MCP handler. On call completion (success OR error)
    it appends one jsonl line with `{invoked_at, session_id, primitive,
query_shape, result_count, elapsed_ms, sample_result_hashes[], errored}`.
    Silent-failure contract per spec [§5.8](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#58-degradation-contract): instrumentation never affects the
    primary tool path; the handler's result (or thrown error) propagates
    unchanged. `ATRIB_READ_PRIMITIVES_LOG` overrides the default path.
  - `extractRecordHashesFromMcpResult(result)` — default extractor that
    deep-walks an MCP tool response for `sha256:<64-hex>` references and
    dedupes. Most callers can pass it directly; specialized servers can
    supply a tighter extractor when they know a stricter path.

  All three read-primitive servers (`atrib-recall` — 5 sibling tools,
  `atrib-trace`, `atrib-summarize`) wrap their handlers via these helpers.
  The signed-record bytes, response shapes, and tool schemas are unchanged.

  `@atrib/recall`'s compact-mode response now ALWAYS includes `record_hash`.
  Without it, the analyzer (and any caller that wants to chain `recall_walk`
  / `recall_annotations` / `recall_revisions` / `trace` from a result) had to
  fall back on verbose mode just to obtain the primary key. Compact response
  becomes ~70 bytes larger per record; the schema gain is worth it.

  Subsequent surfaces (7: SessionStart instrumentation; 8: structured cli-spawn
  log; 9: unified analyzer) live in the operator's hook layer (not on npm)
  and consume the same jsonl shape this surface produces.

### Patch Changes

- Updated dependencies [847852f]
  - @atrib/mcp@0.10.0

## 0.3.4

### Patch Changes

- Updated dependencies [64f3c86]
  - @atrib/mcp@0.9.1

## 0.3.3

### Patch Changes

- Updated dependencies [df7b3d3]
  - @atrib/mcp@0.9.0

## 0.3.2

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

## 0.3.1

### Patch Changes

- Updated dependencies [b89d7b8]
  - @atrib/mcp@0.7.0

## 0.3.0

### Minor Changes

- e559812: Honor `ATRIB_CONTEXT_ID` environment variable as the default `context_id` for the four MCP servers when the caller omits the argument. See [D078](../DECISIONS.md#d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default) for the contract. Inspect-style harnesses ([P018](../DECISIONS.md#p018-adopt-inspect-ai-as-the-track-b-harness-baseline)) can now thread a per-run [D072](../DECISIONS.md#d072-orphan-handling--synthesize-fresh-never-inherit-from-mirror-tail) `context_id` into spawned MCP subprocesses via the env block, eliminating the silent no-op that previously broke per-arm context isolation in Pattern 1 v2. Backward-compatible: explicit caller args always win; invalid env values are ignored. Per-server: `@atrib/trace` gains a new optional `context_id` tool input that scopes the walk (out-of-scope upstream records surface as dangling).

## 0.2.5

### Patch Changes

- Updated dependencies [e1f336c]
  - @atrib/mcp@0.6.2

## 0.2.4

### Patch Changes

- Updated dependencies [b16d08b]
- Updated dependencies [b16d08b]
  - @atrib/mcp@0.6.1

## 0.2.3

### Patch Changes

- Updated dependencies [eb46d66]
  - @atrib/mcp@0.6.0

## 0.2.2

### Patch Changes

- Updated dependencies [b06c720]
  - @atrib/mcp@0.5.0

## 0.2.1

### Patch Changes

- 2204434: Documentation refresh, package READMEs now reflect the post-rename names and the spec-aligned mirror filename convention.

  `@atrib/recall` ships its first README (the package was previously internal and never had a public README).

  `@atrib/emit`, `@atrib/trace`, `@atrib/summarize` README headers + body refs updated from the prior `@atrib/atrib-*` form to the `@atrib/<noun>` namespace pattern.

  `@atrib/emit` README also genericizes a 1Password example that previously referenced a specific item title.

  CHANGELOGs gain a callout explaining the version-skew between local-only workspace bumps and the first npm publish (e.g. `@atrib/emit` 0.4.0 was the first npm publish even though 0.2.0 + 0.3.0 entries appear in the changelog from the workspace-private period).

  No code changes, purely docs + metadata for npmjs.com surface accuracy.

> **Pre-0.2.0 versions exist in this changelog but were never published to npm.**
> The package was renamed from `@atrib/atrib-summarize` to `@atrib/summarize` and flipped public on 2026-05-05; prior bumps were workspace-private. The first npm-published version is 0.2.0.

## 0.2.0

### Minor Changes

- c35127f: Publish the 4 cognitive-primitive MCP servers to npm.

  These were previously workspace-private (developers ran them from source). They now ship as installable npm packages so any agent runtime can pull them in directly.

  `@atrib/emit`, producer-side: agents sign explicit observations, annotations, and revisions beyond what middleware auto-signs.

  `@atrib/recall`, consumer-side: agents query their own provable past from the local signed-record mirror with per-record signature verification. Defaults to `~/.atrib/records/mcp-wrap-claude-code.jsonl`; override via `ATRIB_RECORD_FILE` env.

  `@atrib/trace`, consumer-side: walks `informed_by` chains backward from a record_hash to surface the reasoning chain that produced it.

  `@atrib/summarize`, consumer-side: synthesizes a narrative across N records via an OpenAI-compatible LLM so agents read context, not raw record bytes.

  Naming convention rationale: package names dropped the redundant `@atrib/atrib-` prefix in favor of `@atrib/<noun>` (per the `@atrib/<noun>` namespace pattern already used by `@atrib/mcp`, `@atrib/agent`, `@atrib/verify`, etc). Binary names retained the `atrib-<noun>` form to preserve operator hook-script compatibility, package rename only, no binary rename.

  Also adopted: the local mirror filename convention `<wrapper-name>-<agent>.jsonl` per spec [§5.9](../../atrib-spec.md#59-local-mirror-conventions) with the default wrapper name `mcp-wrap`. `@atrib/recall`'s default mirror path picks up this convention; existing wrappers using a different `name` config value should override `ATRIB_RECORD_FILE` accordingly.

## 0.1.2

### Patch Changes

- Updated dependencies [b22913a]
  - @atrib/mcp@0.4.0

## 0.1.1

### Patch Changes

- Updated dependencies [03fe031]
  - @atrib/mcp@0.3.0
