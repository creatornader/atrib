# @atrib/emit

## 0.14.10

### Patch Changes

- 92352be: Add explicit npm author, homepage, and keyword metadata to the cognitive MCP packages.

## 0.14.9

### Patch Changes

- Updated dependencies [8ad7158]
  - @atrib/mcp@0.15.0

## 0.14.8

### Patch Changes

- cd149be: Add [D104](../DECISIONS.md#d104-parent-child-threading-uses-atrib_parent_record_hash) parent-child `informed_by` threading through `ATRIB_PARENT_RECORD_HASH`.

  `@atrib/mcp` now validates the env value with a shared record-hash helper and applies it to the first successful wrapper-signed child record. `@atrib/emit` uses the same helper for explicit emit records, and `@atrib/mcp-wrap` documents the inherited wrapper behavior.

- Updated dependencies [d19cb28]
- Updated dependencies [cd149be]
  - @atrib/mcp@0.14.0

## 0.14.7

### Patch Changes

- Updated dependencies [24c4331]
  - @atrib/mcp@0.13.0

## Unreleased

### Patch Changes

- Default direct `atrib-emit-cli` mirrors to `~/.atrib/records/atrib-emit-${ATRIB_AGENT:-claude-code}.jsonl` when `ATRIB_MIRROR_FILE` is unset.

- Commit explicit emit content with `args_hash = sha256(JCS(content))` when callers omit `argsHash`. Caller-supplied `argsHash` still wins, and full content stays local in the mirror sidecar.

## 0.14.6

### Patch Changes

- Updated dependencies [ee37209]
  - @atrib/mcp@0.12.0

## 0.14.5

### Patch Changes

- Updated dependencies [7658b17]
  - @atrib/mcp@0.11.1

## 0.14.4

### Patch Changes

- Updated dependencies [b263d91]
  - @atrib/mcp@0.11.0

## 0.14.3

### Patch Changes

- Updated dependencies [847852f]
  - @atrib/mcp@0.10.0

## 0.14.2

### Patch Changes

- Updated dependencies [64f3c86]
  - @atrib/mcp@0.9.1

## 0.14.1

### Patch Changes

- Updated dependencies [df7b3d3]
  - @atrib/mcp@0.9.0

## 0.14.0

### Minor Changes

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

## 0.13.1

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

## 0.13.0

### Minor Changes

- 71a2344: Add `doctor` subcommand and `--describe` flag to `atrib-emit-cli`. Both inherit ergonomic patterns from the printingpress-generated [`atrib-log-pp-cli`](https://github.com/creatornader/atrib-log-pp-cli) without changing the existing emit contract.

  **`atrib-emit-cli doctor`** runs three substrate-readiness checks in parallel: key resolves (env / file / Keychain / 1Password, with the bounded timeouts from [D081](../DECISIONS.md#d081-in-process-emit-for-hook-class-producers-emitinprocess)), the log endpoint's `/v1/checkpoint` responds with a parseable signed-note, and the local mirror's parent directory is writable. Renders a text summary by default or machine-readable JSON with `--json`. Exits 0 on pass, non-zero on any failure — differs from the always-0 contract of `emit` because doctor is operator-facing diagnostic and scripts need a real signal.

  **`atrib-emit-cli --describe`** emits a stable JSON description of the CLI's contract on stdout (subcommands, options, envelope schema with required + optional field documentation, output shape, environment variables, [§1.3](../atrib-spec.md#13-canonical-serialization) / [§5.8](../atrib-spec.md#58-degradation-contract) spec references, [D079](../DECISIONS.md#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface) / [D081](../DECISIONS.md#d081-in-process-emit-for-hook-class-producers-emitinprocess) / [D082](../DECISIONS.md#d082-cli-binary-distribution-of-emitinprocess-supersedes-d081s-integration-shape) ADR references). Designed for LLM / tooling introspection: an agent that has never seen the binary can pipe `atrib-emit-cli --describe` to discover the full surface without reading source.

  The existing default behavior (read envelope on stdin, sign, write EmitOutput JSON to stdout, always exit 0) is unchanged. `atrib-emit-cli emit` is now also a recognized explicit subcommand spelling, identical to the default.

## 0.12.0

### Minor Changes

- 197b52c: Add `atrib-emit-cli` binary ([D082](../DECISIONS.md#d082-cli-binary-distribution-of-emitinprocess-supersedes-d081s-integration-shape)): a thin command-line wrapper around `emitInProcess` that reads a JSON envelope from stdin, signs the record in-process, and writes the EmitOutput JSON to stdout. Exit code is always 0 per the [§5.8](../atrib-spec.md#58-degradation-contract) degradation contract; failures surface as warnings inside the result or as a stderr diagnostic line.

  Per [D082](../DECISIONS.md#d082-cli-binary-distribution-of-emitinprocess-supersedes-d081s-integration-shape), this binary replaces the [D081](../DECISIONS.md#d081-in-process-emit-for-hook-class-producers-emitinprocess) "import `@atrib/emit` from the hook helper" integration shape. Operators install `@atrib/emit` globally (`npm install -g @atrib/emit`) and the hook helper spawns `atrib-emit-cli` instead of carrying a local `node_modules/`. Removing the npm workspace from the hook source directory eliminates a failure mode where Claude Code silently dropped hooks while the directory's package files were mutating.

  Records signed via the CLI are byte-identical to MCP-server-signed and middleware-signed records (same canonical form per [§1.3](../atrib-spec.md#13-canonical-serialization), same `handleEmit` path, same `resolveKey` with the bounded `ATRIB_KEYCHAIN_TIMEOUT_MS` / `ATRIB_OP_TIMEOUT_MS` from [D081](../DECISIONS.md#d081-in-process-emit-for-hook-class-producers-emitinprocess)). The existing `atrib-emit` MCP-server binary is unchanged.

## 0.11.2

### Patch Changes

- b34a995: Fix `emitInProcess` (and `handleEmit`) returning `log_index: null` and a "submission queued; proof not yet available" warning even when the submission had completed. The submission queue caches proofs by _bare hex_ while atrib uses the spec [§1.4.2](../atrib-spec.md#142-record-hash) `sha256:<hex>` form everywhere else, so every `queue.getProof(recordHash)` call was returning undefined. A small bridging helper now strips the prefix before querying the cache, and `emitInProcess` re-reads the proof after its flush completes so the patched result reflects what actually landed on the log.

  The fix surfaces the bug that was making the local mirror's `_local.proof` sidecar always null and producing the same misleading warning on every PostToolUse hook signing. Records were landing; the proof bookkeeping wasn't reaching the caller.

## 0.11.1

### Patch Changes

- 6c6209d: `emitInProcess` now bounds its post-sign queue flush with `flushDeadlineMs` (default 5000ms). The submission queue's own retry budget against an unreachable log is 30s, which would otherwise stall detached hook processes on a network blip. Past the deadline, `emitInProcess` returns the record with a `flush exceeded Nms deadline` warning attached: the record is still signed and mirrored locally, only `log.atrib.dev` confirmation is uncertain.

## 0.11.0

### Minor Changes

- 952dbfa: Add `emitInProcess`, an in-process signing entrypoint for hook-class producers that routes through the same `handleEmit` as the MCP server (records stay byte-identical), and bound the Keychain and `op` spawns in key resolution (`ATRIB_KEYCHAIN_TIMEOUT_MS`, `ATRIB_OP_TIMEOUT_MS`) so headless signing fails fast into the [§5.8](../atrib-spec.md#58-degradation-contract) pass-through path instead of hanging the MCP init handshake. See [D081](../DECISIONS.md#d081-in-process-emit-for-hook-class-producers-emitinprocess).

## 0.10.0

### Minor Changes

- b89d7b8: Upgrade major versions of four core deps: `@noble/ed25519` 2 → 3,
  `@noble/hashes` 1 → 2 (where applicable), `canonicalize` 2 → 3, and
  `@opentelemetry/sdk-trace-base` 1 → 2 (peer dep on `@atrib/openinference`).

  Atrib's own public APIs are unchanged, and signing-output, hash-output, and
  JCS-canonicalization-output remain byte-identical — verified by the signing
  corpus (spec [§1.4](../atrib-spec.md#14-signing-and-verification)) and the Wycheproof Ed25519 test vectors.

  The single user-visible break is `@atrib/openinference`'s peer dep: consumers
  of that package must now use `@opentelemetry/sdk-trace-base@^2.7.1` (instead
  of `^1.27.0`). The OTel SDK v2 also replaced `provider.addSpanProcessor(p)`
  with the `new BasicTracerProvider({ spanProcessors: [p] })` constructor form;
  the adapter and its tests have been migrated accordingly.

  The other deps' major-version changes were API-shape internal:
  `@noble/ed25519` v3 moved sha512 wiring from `etc.sha512Sync` to
  `hashes.sha512` and renamed `utils.randomPrivateKey` to `utils.randomSecretKey`;
  `@noble/hashes` v2 is ESM-only and requires `.js` extensions on import paths;
  `canonicalize` v3 is ESM-only (atrib was already ESM-only). None of these
  shifts touch atrib's exported surface.

### Patch Changes

- Updated dependencies [b89d7b8]
  - @atrib/mcp@0.7.0

## 0.9.0

### Minor Changes

- 15890e6: `handleEmit` now reads `ATRIB_PARENT_RECORD_HASH` from the environment and auto-prepends a valid value to `informed_by` before signing. Producers that spawn child processes (subagents, workers, framework nodes) can thread parent-child causality through the existing `§1.2.5` informed_by primitive without a spec change. Only `sha256:<64-hex>` values are honored; invalid values are silently ignored. Caller-supplied `informed_by` entries are deduplicated against the env-seeded hash via `Set`. Limitation: single-process hosts where parent and child share env cannot use this convention naively because the parent's record signature fires after the child has already emitted; those cases need retroactive annotation or a framework-native `informed_by` point. See [D104](../../DECISIONS.md#d104-parent-child-threading-uses-atrib_parent_record_hash) for the accepted baseline and future `handoff` event_type boundary.

## 0.8.0

### Minor Changes

- 29641cb: [D079](../DECISIONS.md#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface): ship `@atrib/annotate` and `@atrib/revise` as the dedicated MCP packages for atrib's cognitive primitives #2 (annotation) and #3 (revision). Each exposes one monomorphic MCP tool with a narrow Zod schema enforcing the spec's required fields per the annotation / revision event_types. Both packages depend on `@atrib/emit` for the canonical signing + chain composition + JSONL mirror pipeline; a verifier MUST NOT distinguish records signed via these tools from those signed via `@atrib/emit`'s polymorphic surface. `@atrib/emit` adds public exports for `handleEmit`, `resolveKey`, and the input/output types so downstream specialized writers can wrap the canonical pipeline cleanly.

## 0.7.0

### Minor Changes

- e559812: Honor `ATRIB_CONTEXT_ID` environment variable as the default `context_id` for the four MCP servers when the caller omits the argument. See [D078](../DECISIONS.md#d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default) for the contract. Inspect-style harnesses ([P018](../DECISIONS.md#p018-adopt-inspect-ai-as-the-track-b-harness-baseline)) can now thread a per-run [D072](../DECISIONS.md#d072-orphan-handling--synthesize-fresh-never-inherit-from-mirror-tail) `context_id` into spawned MCP subprocesses via the env block, eliminating the silent no-op that previously broke per-arm context isolation in Pattern 1 v2. Backward-compatible: explicit caller args always win; invalid env values are ignored. Per-server: `@atrib/trace` gains a new optional `context_id` tool input that scopes the walk (out-of-scope upstream records surface as dangling).

## 0.6.0

### Minor Changes

- fdba64d: `emit` tool gains two optional inputs: `tool_name` ([§8.2](../atrib-spec.md#82-opaque-name-posture) disclosure) and `args_hash` ([§8.3](../atrib-spec.md#83-salted-commitment-posture) commitment). When supplied, these are carried verbatim into the signed AtribRecord per the JCS canonical form, matching what `@atrib/mcp` middleware emits when its disclosure pipeline is enabled. Mirrors the matching `content_id` / `tool_name` / `args_hash` filters added to `@atrib/recall` so that an emit-side producer and a recall-side consumer can agree on `(tool_name, args_hash)` as the matching key for "same tool on same target" queries. Backward-compatible (additive); existing callers unaffected.

### Patch Changes

- 28c1765: `@atrib/emit` README: replace stale pre-[D072](../DECISIONS.md#d072-orphan-handling--synthesize-fresh-never-inherit-from-mirror-tail) "atrib-emit auto-chains from the wrapper mirror when context*id is absent" guidance with the post-[D067](../DECISIONS.md#d067-multi-producer-chain-composition-precedence-contract) / post-[D072](../DECISIONS.md#d072-orphan-handling--synthesize-fresh-never-inherit-from-mirror-tail) five-tier resolution cascade and a producer-ergonomics recipe table covering discrete-session (fresh UUID per run), continuous-session (deterministic seed via `sha256(jobname)[:32]`), inbound-handoff (W3C trace context), and multi-producer cross-process (`ATRIB_CHAIN_TAIL*<context_id>` env). The earlier narrative was technically misleading: post-[D072](../DECISIONS.md#d072-orphan-handling--synthesize-fresh-never-inherit-from-mirror-tail), atrib-emit no longer absorbs context-less records into the mirror tail. A production incident involving orphan observations from a heartbeat-cron producer revealed that the prior README guidance led to incorrect behavior. This has been corrected to prevent recurrence for new producers (cron jobs, watchers, daemons, scripts).

## 0.4.5

### Patch Changes

- Updated dependencies [e1f336c]
  - @atrib/mcp@0.6.2

## 0.4.4

### Patch Changes

- b16d08b: [D072](../DECISIONS.md#d072-orphan-handling--synthesize-fresh-never-inherit-from-mirror-tail): orphan handling, synthesize fresh, never inherit from mirror tail.

  When `inheritChainContext` was called with no `callerContextId`, the prior implementation read the mirror tail and inherited BOTH the most-recent record's `context_id` AND its hash as the new record's `chain_root` (label: `'mirror-context-and-tail'`). In production, runtime miswires that failed to thread session_id caused every orphan record to absorb into whichever session was at the tail, producing pseudo-sessions that accumulated 1500+ unrelated records under one `context_id`.

  `@atrib/mcp` now collapses `inheritChainContext` branch (3): when no `callerContextId` is supplied, the producer synthesizes a fresh random `context_id` and a genesis `chain_root`. The result is marked `inheritedFrom = 'fresh-orphan'` so consumers can identify orphans. The `'mirror-context-and-tail'` label is removed from the `ChainContext` union; producers MUST NOT consult the mirror tail for `context_id` inheritance. Producers that want orphan clustering for forensic reasons MAY cache a per-process synthetic and reuse it.

  `@atrib/emit` adds a warning when `inheritedFrom === 'fresh-orphan'` so operators can trace the upstream runtime miswire (typically a Layer-2 hook that didn't pass session_id through). The warning text includes the synthesized `context_id` and a hint to fix the runtime per [D072](../DECISIONS.md#d072-orphan-handling--synthesize-fresh-never-inherit-from-mirror-tail).

  Tests updated:
  - `packages/mcp/test/mirror.test.ts`: the test that asserted the buggy mirror-tail inheritance now asserts orphan synthesis with a different `context_id` even when a tail exists.
  - `services/atrib-emit/test/integration.test.ts`: replaced the autoChain-via-mirror test (which relied on the removed branch) with two tests, one for the canonical caller-managed-context_id path (`mirror-tail` branch), one for orphan isolation (two orphan emits land in different contexts).

  Layer-2 hook miswires remain the runtime-side fix path. This change does NOT relax the requirement that runtimes pass session identifiers properly; it changes what happens when they don't, surfacing orphans as visible isolates rather than silent absorption. Sidecar tagging (`_local.fallback: 'orphan'` per [D062](../DECISIONS.md#d062-local-mirror-sidecar--two-tier-private-local--public-canonical-persistence)) MAY be added by producers as polish; not implemented yet.

- Updated dependencies [b16d08b]
- Updated dependencies [b16d08b]
  - @atrib/mcp@0.6.1

## 0.4.3

### Patch Changes

- eb46d66: Multi-producer chain composition contract ([D067](../DECISIONS.md#d067-multi-producer-chain-composition-precedence-contract) / spec [§1.2.3.1](../atrib-spec.md#1231-multi-producer-chain-composition)).

  `@atrib/mcp` exports two new helpers that single-source chain-root resolution across all atrib producers signing under one identity:
  - `resolveChainRoot` gains a fourth-priority `mirrorTailHex` parameter for cross-producer mirror-file inheritance. The priority cascade is now: inbound propagation token > within-process auto-chain tail > `ATRIB_CHAIN_TAIL_<context_id>` env var > mirror-file tail (caller pre-filters by context_id) > synthetic genesis.
  - `inheritChainContext` orchestrates context_id inheritance + mirror file I/O end to end, calling `resolveChainRoot` internally. Producers omitting `callerContextId` inherit both context and chain from the mirror's most recent record; producers supplying `callerContextId` consult env-var → mirror tail (filtered to that context) → genesis. The mirror filter-by-context_id invariant blocks malformed records that would chain into a different context's chain.
  - New `readMirrorTail({path, contextId?})` reads JSONL mirror files in both bare-record and envelope shapes, optionally filtering by `context_id`.

  `atrib-emit` deletes its local `auto-chain.ts` resolver and calls `inheritChainContext` from `@atrib/mcp`. Pre-fix, the local resolver short-circuited on caller-supplied `context_id` and never consulted `ATRIB_CHAIN_TAIL_<context_id>`, producing isolated genesis records on every hook-spawned emit. The duplication is eliminated; future cognitive-primitive producers (`atrib-recall`, `atrib-trace`, `atrib-summarize`) and any third-party producer MUST use `resolveChainRoot` or replicate it bit-for-bit against the corpus.

  Conformance corpus at `spec/conformance/1.2.3/multi-producer/` covers the precedence cascade plus malformed env-var fall-through and namespace isolation. Producers in any language can consume the JSON and assert their resolver matches the expected `chain_root` per case. Reference test at `packages/mcp/test/conformance-1.2.3-multi-producer.test.ts`. Co-producer regression test at `services/atrib-emit/test/co-producer-chain.test.ts` exercises the full chain through the emit handler with simulated cross-producer state.

  The `inheritedFrom` value returned by `inheritChainContext` gains two new variants: `'env-tail'` and `'mirror-tail'` (replacing the prior `'wrapper-mirror'`); consumers reading the value must handle them.

- Updated dependencies [eb46d66]
  - @atrib/mcp@0.6.0

## 0.4.2

### Patch Changes

- Updated dependencies [b06c720]
  - @atrib/mcp@0.5.0

## 0.4.1

### Patch Changes

- 2204434: Documentation refresh, package READMEs now reflect the post-rename names and the spec-aligned mirror filename convention.

  `@atrib/recall` ships its first README (the package was previously internal and never had a public README).

  `@atrib/emit`, `@atrib/trace`, `@atrib/summarize` README headers + body refs updated from the prior `@atrib/atrib-*` form to the `@atrib/<noun>` namespace pattern.

  `@atrib/emit` README also genericizes a 1Password example that previously referenced a specific item title.

  CHANGELOGs gain a callout explaining the version-skew between local-only workspace bumps and the first npm publish (e.g. `@atrib/emit` 0.4.0 was the first npm publish even though 0.2.0 + 0.3.0 entries appear in the changelog from the workspace-private period).

  No code changes, purely docs + metadata for npmjs.com surface accuracy.

> **Pre-0.4.0 versions exist in this changelog but were never published to npm.**
> The package was renamed from `@atrib/atrib-emit` to `@atrib/emit` and flipped public on 2026-05-05; prior bumps (0.2.0, 0.3.0) were workspace-private. The first npm-published version is 0.4.0.

## 0.4.0

### Minor Changes

- c35127f: Publish the 4 cognitive-primitive MCP servers to npm.

  These were previously workspace-private (developers ran them from source). They now ship as installable npm packages so any agent runtime can pull them in directly.

  `@atrib/emit`, producer-side: agents sign explicit observations, annotations, and revisions beyond what middleware auto-signs.

  `@atrib/recall`, consumer-side: agents query their own provable past from the local signed-record mirror with per-record signature verification. Defaults to `~/.atrib/records/mcp-wrap-claude-code.jsonl`; override via `ATRIB_RECORD_FILE` env.

  `@atrib/trace`, consumer-side: walks `informed_by` chains backward from a record_hash to surface the reasoning chain that produced it.

  `@atrib/summarize`, consumer-side: synthesizes a narrative across N records via an OpenAI-compatible LLM so agents read context, not raw record bytes.

  Naming convention rationale: package names dropped the redundant `@atrib/atrib-` prefix in favor of `@atrib/<noun>` (per the `@atrib/<noun>` namespace pattern already used by `@atrib/mcp`, `@atrib/agent`, `@atrib/verify`, etc). Binary names retained the `atrib-<noun>` form to preserve operator hook-script compatibility, package rename only, no binary rename.

  Also adopted: the local mirror filename convention `<wrapper-name>-<agent>.jsonl` per spec [§5.9](../../atrib-spec.md#59-local-mirror-conventions) with the default wrapper name `mcp-wrap`. `@atrib/recall`'s default mirror path picks up this convention; existing wrappers using a different `name` config value should override `ATRIB_RECORD_FILE` accordingly.

## 0.3.0

### Minor Changes

- 3c2d0b7: Add `revises` field for revision event_type ([D059](../../DECISIONS.md#d059-promote-revision-to-atrib-normative-event_type-byte-0x06) / spec [§1.2.9](../../atrib-spec.md#129-revises)).

  `atrib-emit` now accepts a top-level `revises: "sha256:<64-hex>"` field on the `emit` tool input. REQUIRED when `event_type` is `https://atrib.dev/v1/types/revision`; FORBIDDEN on any other event_type. The require/forbid invariant surfaces as a warnings-only response per [§5.8](../../atrib-spec.md#58-degradation-contract) rather than producing a malformed signed record.

  `BuildEmitRecordInput.revises` flows through `buildAndSignEmitRecord` into the signed `AtribRecord`. JCS canonical-form ordering puts `revises` after `provenance_token` (r > p) and before `session_token` (r < s), handled automatically by `canonicalize`.

  This mirrors the `annotates` plumbing shipped in the previous release. Required for retrospective-extraction producers that classify cognitive events as revisions and need to emit them with a referent record_hash pointing at the predecessor being superseded.

  Three new integration tests cover round-trip emit, the require-when-revision invariant, and the FORBIDDEN-elsewhere invariant.

## 0.2.0

### Minor Changes

- b22913a: Annotates pipeline and auto-detect informed_by from args.

  `@atrib/mcp` adds:
  - `autoDetectInformedByFromArgs?: boolean` option on `AtribOptions` (default `false`). When `true`, the middleware scans tool-call params for `sha256:<64hex>` substrings (skipping the `chain_root` field) and merges them with the explicit `informedBy` callback result, lex-sorted per spec [§1.2.5](../../atrib-spec.md#125-informed_by). Records with auto-detected references gain INFORMED_BY graph edges automatically.
  - `SHA256_REF_PATTERN`, `SHA256_REF_GLOBAL_PATTERN`, and `extractRecordHashes(value)` exported from the package root. These are co-located so producer-side consumers (middleware, atrib-emit, out-of-tree wrappers) share one definition. Drift between them would silently produce records with inconsistent reference detection.
  - Three previously-internal `EVENT_TYPE_*_URI` constants now re-exported from the package root: `EVENT_TYPE_DIRECTORY_ANCHOR_URI`, `EVENT_TYPE_ANNOTATION_URI`, `EVENT_TYPE_REVISION_URI`. The other three were already exported.

  `atrib-emit` adds:
  - Top-level `annotates` field on the `emit` tool input schema (`sha256:<64-hex>`). REQUIRED when `event_type` is the annotation URI; FORBIDDEN on any other event_type, per spec [§1.2.7](../../atrib-spec.md#127-annotates) / [D058](../../DECISIONS.md#d058-promote-annotation-to-atrib-normative-event_type-byte-0x05). Validation surfaces as warnings-only response per [§5.8](../../atrib-spec.md#58-degradation-contract) rather than producing a malformed signed record.
  - `BuildEmitRecordInput.annotates` flows through to the signed `AtribRecord`.

  `@atrib/mcp-wrap` defaults `autoDetectInformedByFromArgs: true` so wrapper consumers (Claude Code, Cursor, generic stdio hosts) get auto-detect for free without explicit middleware configuration.

### Patch Changes

- Updated dependencies [b22913a]
  - @atrib/mcp@0.4.0

## 0.1.3

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

- Updated dependencies [5809fc2]
  - @atrib/mcp@0.1.2
