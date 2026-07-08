# @atrib/mcp

## 0.19.0

### Minor Changes

- 3c8e63d: Add four opt-in protocol surfaces: the anchors module per [D138](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d138-anchor-plurality-as-the-default-trust-posture) (anchor-set posture resolution, anchoring-claim builder with fresh Ed25519 signatures, non-blocking multi-anchor fan-out with the atrib-log transport live and rekor/rfc3161/ots transports stubbed behind `AnchorTransport`), session checkpoints per [D139](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d139-session_checkpoint-event-type-the-session-stream-formalized) (RFC 6962 session roots, checkpoint record assembly under the extension URI, inclusion and consistency proofs, equivocation detection), delegation-certificate issuance per [D140](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d140-delegation-certificates-principal-keys-certify-ephemeral-run-keys) (`issueDelegationCertificate`, `withDelegationCertHash`, run-key revocation builder), and the `dev.atrib/attribution` extension surface per [D141](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d141-devatribattribution-first-class-mcp-extension-sep-2133) (capability negotiation including legacy-initialize gating, attestation receipt building and application, middleware `extensionAttribution` flag). Middleware and proxy behavior is byte-identical when none of these are configured.

## 0.18.1

### Patch Changes

- 44bc84d: Raise the local-substrate coordinator default timeout to 1500 ms and reuse cached local mirror hash scans across repeated unresolved reference checks. `@atrib/mcp-wrap` now includes lookup timing fields when it drops unresolved `informed_by` candidates.

## 0.18.0

### Minor Changes

- e700e1a: Add opt-in startup-spawn local-substrate commit mode. `@atrib/mcp` can send a post-success `sign_record` commit request to a coordinator and skip its local log-submission queue after the returned `record_hash` matches. `@atrib/mcp-wrap` exposes the path through `localSubstrate.mode = "commit"` while keeping shadow mode as the default.

## 0.17.6

### Patch Changes

- 7ffd086: Publish active-session profile fallback and trace wording updates.

  `@atrib/mcp` now resolves Codex thread IDs and profile-scoped active-session files for host-owned primitive runtimes. `@atrib/emit` documents and carries the same context inputs. The read primitives align package docs and output wording with chronology plus declared relationship traces.

## 0.17.5

### Patch Changes

- 61c1ec7: Allow the in-process local substrate coordinator to accept watcher-WAL commit requests with explicit receipt join metadata. Add shared Fetch, plain-result, and Node HTTP service handlers for hosts that expose the same coordinator through a supervised local endpoint.

## 0.17.4

### Patch Changes

- 95cd2ca: Add opt-in local substrate coordinator client and health-probe helpers for P042. The new APIs validate requests and responses, classify unavailable coordinators without blocking primary work, provide an explicit HTTP transport helper, and build rollout-gate health reports without adding a required daemon.
- 95cd2ca: Add exported local substrate coordinator contract helpers for P042. The new
  surface validates coordinator requests, health reports, and fixture packets,
  and computes canonical unsigned record-body hashes so startup-spawn wrappers,
  long-lived agents, and watcher WAL pipelines can share the same adapter
  boundary without changing signed record bytes.
- 95cd2ca: Add an opt-in in-process local substrate coordinator prototype for P042 startup-spawn trials. The helper exposes a transport for the shared coordinator client, signs only bodies whose creator key matches the coordinator signer, reports health through the P042 probe shape, and keeps the default scope to startup-spawn without making a daemon required.
- c738147: Add opt-in local substrate shadow wiring for startup-spawn wrappers. `@atrib/mcp`
  now accepts a transport-backed shadow option that sends the exact unsigned record
  body to a coordinator with `mode: "shadow_probe"`, compares the returned hash to
  the local signer, and keeps local signing, mirror append, outbound context, and
  queue submission authoritative. `@atrib/mcp-wrap` exposes the first JSON config
  path through an HTTP endpoint and logs each shadow attempt for rollout checks.

## 0.17.3

### Patch Changes

- 3de7d59: Shut down stdio wrappers when host stdin closes, the parent process exits, or the wrapper is reparented after a host restart. Make MCP proxy close idempotent so duplicate lifecycle events do not turn cleanup into a new error.

## 0.17.2

### Patch Changes

- ed766a4: Normalize common `atrib.dev` typo event type URIs to canonical normative event types.

## 0.17.1

### Patch Changes

- 5ee04c5: Export shared event type alias helpers and bounded record-reference lookup options.

  `EVENT_TYPE_SHORT_NAMES`, `EVENT_TYPE_SHORT_TO_URI`, and `normalizeEventType`
  now live next to the canonical event type URI constants. Producer and consumer
  packages can use one shared mapping instead of each package carrying its own
  short-name table.

  `defaultRecordReferenceResolver()` now also accepts `localLookupTimeoutMs` and
  `logLookupTimeoutMs`. Local mirror scanning streams JSONL files instead of
  reading whole mirrors into memory. If the local scan times out and log lookup
  does not find the record, the resolver returns `unknown` rather than
  misreporting a definite miss.

## 0.17.0

### Minor Changes

- 80310e7: Add `buildSubagentProducerEnv()` for same-session agent-to-subagent handoff.

  The helper builds the canonical child producer env bundle with `ATRIB_CONTEXT_ID`,
  `ATRIB_CHAIN_TAIL_<context_id>`, and `ATRIB_PARENT_RECORD_HASH` so adapters do
  not hand-copy the parent-child threading rules.

  Add source-aware `informed_by` validation hooks and shared record-reference
  resolution through local mirrors plus log lookup. `@atrib/mcp-wrap` now uses the
  resolver for configured `informedByPaths`, and `@atrib/emit` reuses the shared
  resolver implementation.

## 0.16.1

### Patch Changes

- f790fa0: Tighten producer-side informed_by handling.

  `@atrib/mcp` now limits `autoDetectInformedByFromArgs` to structured record-reference fields and exports `extractRecordReferenceCandidates` for callers that need the same behavior. It no longer turns hashes in prose, commitment fields, or nested `informed_by` envelopes into automatic graph claims.

  `@atrib/emit` now checks informed_by refs before signing. Refs found in local mirrors or the configured log lookup are kept. Operationally unknown refs are kept with a warning. Refs that are absent from both local mirrors and log lookup are dropped unless the caller sets `allow_unresolved_informed_by: true`.

## 0.16.0

### Minor Changes

- 114248a: Add opt-in producer archive submission after log proof, pass archive config through the generic MCP wrapper, and expose an HTTP-backed DPoP replay-cache adapter for shared deployment state.

## 0.15.1

### Patch Changes

- c2ea30d: Add harness context resolution and structured informed_by controls for long-lived wrappers. `@atrib/mcp-wrap` now keeps broad hash scanning off by default, so wrappers only sign provenance links from explicit paths unless an operator opts into free-text detection.

## 0.15.0

### Minor Changes

- 8ad7158: Add OpenInference sidecar content for cognitive recall.

  `@atrib/openinference` now mirrors span payloads as local-only sidecar content for recall, trace, and summarize while signed records stay canonical. `@atrib/mcp` exposes shared sidecar normalization helpers, and the read primitives consume normalized wrapper and OpenInference content. The OpenInference processors now resolve custom chain roots against the actual signed `context_id`, including spans that use `session.id`.

  OpenInference args/result commitments now hash verifier-compatible JCS material: JSON strings are parsed before hashing, while non-JSON strings are hashed as JCS string values. This lets `@atrib/verify` replay `args_hash` and `result_hash` from supplied body material. Integration coverage now includes a dual-export OTLP smoke, body-commitment replay, richer recall queries over OpenInference sidecars, and a negative guard that generic OTel parent-child nesting does not create `informed_by`.

## 0.14.0

### Minor Changes

- d19cb28: Add AP2 counterparty transaction attestation support.

  `@atrib/mcp` now exposes `signTransactionAttestation()` so AP2 counterparties can sign the finalized atrib transaction bytes. `@atrib/verify` now counts distinct verified signer keys for transaction cross-attestation, so duplicate signer entries cannot satisfy the two-party requirement.

- cd149be: Add [D104](../DECISIONS.md#d104-parent-child-threading-uses-atrib_parent_record_hash) parent-child `informed_by` threading through `ATRIB_PARENT_RECORD_HASH`.

  `@atrib/mcp` now validates the env value with a shared record-hash helper and applies it to the first successful wrapper-signed child record. `@atrib/emit` uses the same helper for explicit emit records, and `@atrib/mcp-wrap` documents the inherited wrapper behavior.

## Unreleased

### Minor Changes

- Add `signTransactionAttestation()` for counterparty signer entries over transaction cross-attestation bytes. The root and Worker entrypoints both export it.

## 0.13.0

### Minor Changes

- 24c4331: Add `signTransactionRecord()` for [D052](../DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records) transaction cross-attestation bytes and use it for agent-side Path 2 transaction records.

  Path 2 records now carry an agent `signers[]` entry over the atrib transaction record bytes. AP2 receipt JWT signatures remain verifier evidence and are not counted as transaction signers unless a counterparty signs the same atrib canonical bytes.

## 0.12.0

### Minor Changes

- ee37209: Add a Worker-safe `@atrib/mcp/worker` entrypoint for Cloudflare Workers and other runtimes that cannot bundle Node-only helpers.

## 0.11.1

### Patch Changes

- 7658b17: Documents the normative content-shape contracts shipped in [D086](./DECISIONS.md#d086-bm25-corpus-extended-from-annotations-to-per-event_type-record-content). The `0.11.0` ship added `extractIndexableText` + per-event_type type defs (`ObservationContent`, `AnnotationContent`, `RevisionContent`, `ToolCallContent`, `TransactionContent`, `DirectoryAnchorContent`) + the per-event_type extractor functions + `DEFAULT_FIELD_CAP`, but the package README didn't cover them. This patch adds a dedicated "Normative content-shape contracts" section under the API reference with the per-event_type extraction table + extension-URI handling guidance, plus a one-line cross-reference in the "Lower-level primitives" paragraph so the new exports show up alongside the other helper exports. No code change.

## 0.11.0

### Minor Changes

- b263d91: [D086](./DECISIONS.md#d086-bm25-corpus-extended-from-annotations-to-per-event_type-record-content) extends the BM25 indexable corpus from `annotation summary + topics only` to `per-event_type record content + annotation summary + topics`. Lifts the per-event_type extraction to `@atrib/mcp` as a normative protocol-level contract so producers and consumers round-trip via the same shape definition.

  **New in `@atrib/mcp`:** `extractIndexableText(eventTypeUri, content, opts?)` dispatcher + per-event_type type definitions (`ObservationContent`, `AnnotationContent`, `RevisionContent`, `ToolCallContent`, `TransactionContent`, `DirectoryAnchorContent`) + per-event_type extractors. Generic recursive string-walk fallback for extension URIs (depth ≤ 4, field cap 2KB via `DEFAULT_FIELD_CAP`). All additive; no removals.

  **Changed in `@atrib/recall`:** `recall_by_content` and `rank_by='relevance'` BM25 corpus now indexes record-content tokens for ALL records (not just annotated ones). Empirical impact on the 2026-05-24 operator mirror: 84.6% of records produce non-zero indexable tokens, up from near-0% pre-ship. `ATRIB_RECALL_NOISE_FLOOR` default raised from 0.15 → 0.6 to track the corpus shift (the prior floor became a no-op against the content-extended corpus; new floor sits between the recent+annotated-only baseline ~0.55 and the empirical real-query minimum ~0.70). BM25 contribution clamped to `[0, 1]` at the parkScore site to honor the documented Park-component bound (raw BM25 was unbounded, accidentally fine when the corpus was sparse).

  **Behavior change visible to callers:** queries that previously returned empty (no annotation in corpus) now may return records. Token weight in agent context windows scales with the existing `limit` parameter (default 10, unchanged from [D085](./DECISIONS.md#d085-recall-calibration-defaults-survey-grounded-rationale)). Callers relying on the 0.15 floor to NOT trip suppression will see more `quality:below_threshold` responses; the env var still overrides for callers that want to retain prior behavior.

  **Extension URIs:** non-normative event_type URIs fall back to the generic walker by default. Producers SHOULD adopt one of the recognizable normative-shape field names (`what`, `why_noted`, `summary`, `description`, `topics`) so the walker picks them up naturally, OR call `atrib-annotate` on important records to lift them via the curator path. The full extension-URI handling rationale is in the linked ADR.

  Empirical calibration evidence: `services/atrib-recall/scripts/calibration-sweep-d086.mjs` (real vs nonsense query distributions against the 2026-05-24 mirror). Final calibration deferred to the gold-standard eval sweep queued in [D085](./DECISIONS.md#d085-recall-calibration-defaults-survey-grounded-rationale).

## 0.10.0

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

## 0.9.1

### Patch Changes

- 64f3c86: [D083](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers)
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

## 0.9.0

### Minor Changes

- df7b3d3: [D083](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers)
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

## 0.8.0

### Minor Changes

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

## 0.7.0

### Minor Changes

- b89d7b8: Upgrade major versions of four core deps: `@noble/ed25519` 2 → 3,
  `@noble/hashes` 1 → 2 (where applicable), `canonicalize` 2 → 3, and
  `@opentelemetry/sdk-trace-base` 1 → 2 (peer dep on `@atrib/openinference`).

  atrib's own public APIs are unchanged, and signing-output, hash-output, and
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

## 0.6.2

### Patch Changes

- e1f336c: Three design ADRs from the harness field study (no code changes; all forward-looking).

  [D073](../DECISIONS.md#d073-handoff-event_type-byte-placeholder-adr) reserves byte `0x07` for a future `handoff` event_type. Multi-agent platforms (OpenAI Agents SDK, Microsoft Agent Framework, AutoGen, LangGraph, CrewAI) model handoffs as a structurally distinct event from a tool call, but atrib producers currently encode them as `tool_call` records whose `tool_name` happens to match a handoff string. Verifiers can't reason about cross-agent causality without parsing strings. The ADR is a placeholder per the [D070](../DECISIONS.md#d070-record-body-archive-layer-placeholder-adr) pattern: byte slot reserved at the design level, full normative promotion gated on the [D036](../DECISIONS.md#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary) bar (five-indicator evaluation). Producers requiring handoff semantics in advance of promotion emit under the extension URI `https://atrib.dev/v1/types/handoff`.

  [D074](../DECISIONS.md#d074-git-trailer-record-hash-binding-for-repo-scoped-agents) defines the `Atrib-Record-Hash` git commit trailer format. Repo-scoped agents (Aider, Claude Code in code mode, Cursor coding mode) commit changes whose connection to the authoring atrib record is currently implicit. Adding a structured trailer (`Atrib-Record-Hash: sha256:<64-hex>` plus optional `Atrib-Creator-Key`) gives cryptographic lineage between commit and atrib record at zero new storage cost. Trailers are MAY (not MUST); orthogonal to Sigstore commit signing. Verification semantics: extract → log lookup → signature verify → optional content reference.

  [D075](../DECISIONS.md#d075-compose-not-override-hook-config-layering) documents atrib's recommendation that producer-side hook configurations layer by list-extension (project + user + organization), not override. Override semantics are the upstream cause of the orphan-record pathology that [D072](../DECISIONS.md#d072-orphan-handling--synthesize-fresh-never-inherit-from-mirror-tail) catches but doesn't prevent: a project-level config that wires a single dev-time hook silently disables the user-level atrib signing hook, producing unsigned records the operator believed were being signed. Composition with identity-based de-duplication is the path forward. Producer-side recommendation, not normative spec; informs any future `@atrib/install-hooks` helper.

  CLAUDE.md sync triggers gain rows for the future `handoff` byte promotion (with the [D056](../DECISIONS.md#d056-promote-directory_anchor-to-atrib-normative-event_type-byte-0x04) checklist), the first git-trailer-emitting producer's adoption, and any future hook-installer helper.

## 0.6.1

### Patch Changes

- b16d08b: [D071](../DECISIONS.md#d071-spec-writing-conventions): codify ten spec writing conventions as binding ADR.

  The atrib specification grew from [D041](../DECISIONS.md#d041-informed_by-linking-primitive-and-informed_by-edge-type) through [D070](../DECISIONS.md#d070-record-body-archive-layer-placeholder-adr) over six weeks of intensive spec work, with sections varying in their treatment of normative vs informative status, cross-reference style, conformance-corpus binding, and pattern-subsection layout. Drift across these dimensions creates costs both for readers (`MUST` claims meaning different things in different sections) and for spec maintenance (no clear template for new sections).

  The new ADR adopts ten conventions as binding for new spec material and substantive edits to existing material. Existing sections that predate the ADR are grandfathered until substantively edited. Conventions:
  1. Section status declaration (`_This section is normative._` / `_informative._`)
  2. RFC 2119 language for normative claims
  3. Inline cross-references via markdown anchor links (mechanically enforced by `scripts/check-doc-sync.mjs`)
  4. Pattern subsection template (`Where it fits` / `How atrib mounts` / `Causality formation` / `Reference implementation` / `Trade-offs`)
  5. Reference implementation status tags (shipped or planned with sequencing note)
  6. Conformance corpus jointly normative with Appendix A
  7. Prose audit on every push (mechanically enforced by `scripts/check-leaks.mjs`)
  8. Sync triggers updated when sections change (mechanically enforced by `scripts/check-doc-sync.mjs`)
  9. ADR template (`Date` / `Context` / `Decision` / `Alternatives considered` / `Consequences` / `Cross-references`)
  10. Architectural framing, not session narrative

  Conventions 3, 7, and 8 have mechanical enforcement; others are review-enforced. No code changes in `@atrib/mcp` itself; this changeset documents the spec-side governance change since `@atrib/mcp` is the canonical reference implementation that future spec sections will cite.

- b16d08b: [D072](../DECISIONS.md#d072-orphan-handling--synthesize-fresh-never-inherit-from-mirror-tail): orphan handling, synthesize fresh, never inherit from mirror tail.

  When `inheritChainContext` was called with no `callerContextId`, the prior implementation read the mirror tail and inherited BOTH the most-recent record's `context_id` AND its hash as the new record's `chain_root` (label: `'mirror-context-and-tail'`). In production, runtime miswires that failed to thread session_id caused every orphan record to absorb into whichever session was at the tail, producing pseudo-sessions that accumulated 1500+ unrelated records under one `context_id`.

  `@atrib/mcp` now collapses `inheritChainContext` branch (3): when no `callerContextId` is supplied, the producer synthesizes a fresh random `context_id` and a genesis `chain_root`. The result is marked `inheritedFrom = 'fresh-orphan'` so consumers can identify orphans. The `'mirror-context-and-tail'` label is removed from the `ChainContext` union; producers MUST NOT consult the mirror tail for `context_id` inheritance. Producers that want orphan clustering for forensic reasons MAY cache a per-process synthetic and reuse it.

  `@atrib/emit` adds a warning when `inheritedFrom === 'fresh-orphan'` so operators can trace the upstream runtime miswire (typically a Layer-2 hook that didn't pass session_id through). The warning text includes the synthesized `context_id` and a hint to fix the runtime per [D072](../DECISIONS.md#d072-orphan-handling--synthesize-fresh-never-inherit-from-mirror-tail).

  Tests updated:
  - `packages/mcp/test/mirror.test.ts`: the test that asserted the buggy mirror-tail inheritance now asserts orphan synthesis with a different `context_id` even when a tail exists.
  - `services/atrib-emit/test/integration.test.ts`: replaced the autoChain-via-mirror test (which relied on the removed branch) with two tests, one for the canonical caller-managed-context_id path (`mirror-tail` branch), one for orphan isolation (two orphan emits land in different contexts).

  Layer-2 hook miswires remain the runtime-side fix path. This change does NOT relax the requirement that runtimes pass session identifiers properly; it changes what happens when they don't, surfacing orphans as visible isolates rather than silent absorption. Sidecar tagging (`_local.fallback: 'orphan'` per [D062](../DECISIONS.md#d062-local-mirror-sidecar--two-tier-private-local--public-canonical-persistence)) MAY be added by producers as polish; not implemented yet.

## 0.6.0

### Minor Changes

- eb46d66: Multi-producer chain composition contract ([D067](../DECISIONS.md#d067-multi-producer-chain-composition-precedence-contract) / spec [§1.2.3.1](../atrib-spec.md#1231-multi-producer-chain-composition)).

  `@atrib/mcp` exports two new helpers that single-source chain-root resolution across all atrib producers signing under one identity:
  - `resolveChainRoot` gains a fourth-priority `mirrorTailHex` parameter for cross-producer mirror-file inheritance. The priority cascade is now: inbound propagation token > within-process auto-chain tail > `ATRIB_CHAIN_TAIL_<context_id>` env var > mirror-file tail (caller pre-filters by context_id) > synthetic genesis.
  - `inheritChainContext` orchestrates context_id inheritance + mirror file I/O end to end, calling `resolveChainRoot` internally. Producers omitting `callerContextId` inherit both context and chain from the mirror's most recent record; producers supplying `callerContextId` consult env-var → mirror tail (filtered to that context) → genesis. The mirror filter-by-context_id invariant blocks malformed records that would chain into a different context's chain.
  - New `readMirrorTail({path, contextId?})` reads JSONL mirror files in both bare-record and envelope shapes, optionally filtering by `context_id`.

  `atrib-emit` deletes its local `auto-chain.ts` resolver and calls `inheritChainContext` from `@atrib/mcp`. Pre-fix, the local resolver short-circuited on caller-supplied `context_id` and never consulted `ATRIB_CHAIN_TAIL_<context_id>`, producing isolated genesis records on every hook-spawned emit. The duplication is eliminated; future cognitive-primitive producers (`atrib-recall`, `atrib-trace`, `atrib-summarize`) and any third-party producer MUST use `resolveChainRoot` or replicate it bit-for-bit against the corpus.

  Conformance corpus at `spec/conformance/1.2.3/multi-producer/` covers the precedence cascade plus malformed env-var fall-through and namespace isolation. Producers in any language can consume the JSON and assert their resolver matches the expected `chain_root` per case. Reference test at `packages/mcp/test/conformance-1.2.3-multi-producer.test.ts`. Co-producer regression test at `services/atrib-emit/test/co-producer-chain.test.ts` exercises the full chain through the emit handler with simulated cross-producer state.

  The `inheritedFrom` value returned by `inheritChainContext` gains two new variants: `'env-tail'` and `'mirror-tail'` (replacing the prior `'wrapper-mirror'`); consumers reading the value must handle them.

## 0.5.0

### Minor Changes

- b06c720: Add `ATRIB_CHAIN_TAIL_<context_id>` env var as the cross-producer chain-tail handoff. When a parent process spawns a child producer (different middleware instance, e.g. wrapper spawning an atrib-emit subprocess) and writes its current chain tail to this env var, the child's first sign chains to the parent's tail instead of starting at synthetic-genesis. Fills the gap between within-process autoChain and cross-process traceparent propagation.

  Priority cascade now: inbound traceparent ([§1.5.2](../../atrib-spec.md#152-http-transport-tracestate)) > autoChain in-memory tail > `ATRIB_CHAIN_TAIL_<context_id>` env var > synthetic genesis.

  Refactored chain_root determination into a pure `resolveChainRoot` helper exported from `@atrib/mcp` for unit-testable composition.

## 0.4.0

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

## 0.3.0

### Minor Changes

- 03fe031: Extend the local mirror with an optional pre-sign payload sidecar.

  The local jsonl mirror previously stored only the bare signed AtribRecord, so consumers (recall, atrib-trace, atrib-summarize) saw only event_type + hashes, never the semantic content (tool name, args, result, observation payload) the record's content_id / args_hash / result_hash COMMITS TO. This made the mirror impoverished relative to what an agent's own working memory needs.

  `@atrib/mcp` `AtribOptions.onRecord` now accepts an optional second argument `OnRecordSidecar` carrying `{ toolName?, args?, result? }`, the pre-sign payload context captured from the wrapped tool call. The signed record bytes are unchanged; the sidecar lives at the host's persistence layer only and is never sent to the public log (which still only sees the bare AtribRecord via the submission queue).

  `@atrib/mcp-wrap`'s `persistRecord` extends to accept the sidecar and write a new envelope shape `{ record, _local?, written_at }` per line. `loadAutoChainSeed` tolerates BOTH the new envelope shape AND legacy bare-record entries from prior wrapper versions, fully backward-compatible. Tests cover both shapes plus mixed lines in the same file.

  This lays the groundwork for richer consumer-side tools (atrib-trace, atrib-summarize) that need semantic context to be useful, and for a future spec section formalizing the two-tier "private local + public canonical" pattern (deferred until consumer evidence informs the spec).

## 0.2.0

### Minor Changes

- 79199ee: Add `args_commitment_form` and `result_commitment_form` posture detection (atrib spec [§8.3](../../atrib-spec.md#83-salted-commitment-posture) / [D045](../../DECISIONS.md#d045-privacy-postures-normative-spec-section)).

  `@atrib/mcp` `AtribRecord` type gains optional `args_salt` and `result_salt` fields. These were already MAY fields per spec [§1.2.1](../../atrib-spec.md#121-field-definitions) (lines 293-294 of `atrib-spec.md`) but had not been surfaced in the TypeScript type. JCS-canonical sort positions: `args_salt` between `annotates` and `chain_root` (a-n < a-r < c); `result_salt` between `provenance_token` and `revises` (p < r-e-s < r-e-v). Backward-compatible (absence preserves default posture).

  `@atrib/verify` `PostureAnnotation` gains `args_commitment_form` and `result_commitment_form` fields (`'plain-sha256' | 'salted-sha256'`). Detection is structural per [§8.3](../../atrib-spec.md#83-salted-commitment-posture): presence of `args_salt` / `result_salt` ⇒ `salted-sha256`; absence ⇒ `plain-sha256`. The [§8.3](../../atrib-spec.md#83-salted-commitment-posture) `hmac-sha256` variant is signaled out-of-band and is not structurally detectable.

  5 new tests added; verify package now at 247 passing.

  Implements the args/result commitment-posture half of the [§8.3](../../atrib-spec.md#83-salted-commitment-posture) surface. The `tool_name_form` ([§8.2](../../atrib-spec.md#82-opaque-name-posture)) surface remains blocked on a [§1.2.1](../../atrib-spec.md#121-field-definitions) spec extension to add `tool_name` as a MAY field.

- 8abcb67: [D052](../../DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records) / [§1.7.6](../../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records): cross-attestation type + verifier surface.

  `@atrib/mcp` `AtribRecord` type gains optional `signers?: SignerEntry[]` field for transaction records per spec [§1.7.6](../../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records). New `canonicalCrossAttestationInput(record)` helper exported alongside `canonicalRecord` / `canonicalSigningInput` produces the JCS form with `signers: []` and the top-level `signature` field omitted, the bytes every signer in `signers[]` covers per [§1.7.6](../../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records).

  `@atrib/verify` `verifyRecord()` now surfaces `cross_attestation: { signers_count, signers_valid, missing }` on transaction records (`event_type = transaction`). Verifies each signer's Ed25519 signature against the cross-attestation canonical bytes; flags `missing: true` when below the [§1.7.6](../../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records) normative minimum of 2 verified signers. Per [§1.7.6](../../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records) missing is a SIGNAL, not invalidation: the underlying signature path keeps the record cryptographically valid. Legacy single-signer transaction records (no `signers[]`, top-level `signature` only) surface as `signers_count: 0, missing: true`.

  The verifier's top-level signature check is skipped for transaction records that carry a populated `signers[]` array per [§1.2.1](../../atrib-spec.md#121-field-definitions)'s "signature is OPTIONAL on transaction records" clause; in those records `signatureOk` is set to `true` and the actual cryptographic validity flows through `cross_attestation.signers_valid`.

  `spec/conformance/1.7.6/` corpus (5 cases) ships alongside: legacy-single-signer, one-signer (below minimum), two-signers-valid (canonical happy path), three-signers (above minimum), tampered-second-signature (count vs valid independence). Reference test at `packages/verify/test/conformance-1.7.6.test.ts`.

  7 new verifier tests + 5 conformance-corpus reference tests added; verify package now at 279 passing tests.

  **Middleware-side signing of multi-signer transaction records is a separable follow-up.** This change implements the verifier; the producer-side counterparty-coordination protocol (how the agent and counterparty exchange signatures over the same canonical bytes) is its own design problem and ships in a separate ADR when payment-protocol integration work begins.

- 3161e59: [D061](../../DECISIONS.md#d061-add-tool_name-args_hash-result_hash-fields-to-121): add `tool_name`, `args_hash`, `result_hash` to the [§1.2.1](../../atrib-spec.md#121-field-definitions) canonical record schema.

  Closes the spec gap where [§8.2](../../atrib-spec.md#82-opaque-name-posture) (opaque-name posture) and [§8.3](../../atrib-spec.md#83-salted-commitment-posture) (salted-commitment posture) referenced record fields that had never been added to the [§1.2](../../atrib-spec.md#12-the-attribution-record) canonical shape. Verifier surfaces for both postures now have structural inputs to detect against.

  `@atrib/mcp` `AtribRecord` type gains three optional fields with documented JCS-canonical sort positions:
  - `tool_name?`, last in current schema (`t-o-...` after `t-i-...`)
  - `args_hash?`, between `annotates` and `args_salt`
  - `result_hash?`, between `provenance_token` and `result_salt`

  All three default to absence (preserving the [§8.1](../../atrib-spec.md#81-default-posture) default posture). Backward-compatible: existing records continue to verify identically.

  `@atrib/verify` `PostureAnnotation` gains `tool_name_form: 'hashed' | 'plain' | null`. Detection per the [D061](../../DECISIONS.md#d061-add-tool_name-args_hash-result_hash-fields-to-121) fix to [§8.2](../../atrib-spec.md#82-opaque-name-posture)'s regex ambiguity:
  - `'hashed'` when value matches `^sha256:[0-9a-f]{64}$` (unambiguous)
  - `'plain'` for any other present value (verbatim and opaque-label NOT structurally distinguishable; both surface as plain)
  - `null` when the field is absent

  5 new verifier tests + 4 conformance-corpus reference tests added; verify package now at 267 passing tests. New `spec/conformance/8.2/` corpus (4 cases) ships alongside.

  [§8.2](../../atrib-spec.md#82-opaque-name-posture) prose updated to acknowledge the regex ambiguity. [§8.3](../../atrib-spec.md#83-salted-commitment-posture) prose clarifies that `args_hash` / `result_hash` are [§1.2.1](../../atrib-spec.md#121-field-definitions) MAY fields. [§1.2.1](../../atrib-spec.md#121-field-definitions) standard-shape example record + field table extended with all three fields.

  Middleware-side opt-in (config-gated emission of the new fields) is a separate follow-up; this change is verifier-only and spec-only and does not change the bytes any existing record produces.

- a3d24f9: Add opt-in `disclosure` option to `atrib()` middleware ([D061](../../DECISIONS.md#d061-add-tool_name-args_hash-result_hash-fields-to-121) / [§8.2](../../atrib-spec.md#82-opaque-name-posture) / [§8.3](../../atrib-spec.md#83-salted-commitment-posture)).

  `AtribOptions.disclosure` lets callers opt into producing records with `tool_name`, `args_hash`, and `args_salt` populated. Both dials default to `'omit'`, preserving the [§8.1](../../atrib-spec.md#81-default-posture) default posture; existing callers see no behavior change and produce byte-identical records.

  ```ts
  atrib(server, {
    creatorKey,
    serverUrl,
    disclosure: {
      tool_name: 'verbatim', // 'omit' | 'verbatim' | 'hashed'
      args: 'salted-sha256', // 'omit' | 'plain-sha256' | 'salted-sha256'
    },
  })
  ```

  - `tool_name: 'verbatim'` writes the raw tool name from the MCP request.
  - `tool_name: 'hashed'` writes `sha256:<64 hex>` of the verbatim name.
  - `args: 'plain-sha256'` writes `args_hash = sha256(JCS(arguments))`.
  - `args: 'salted-sha256'` generates a 16-byte random salt per record and writes both `args_salt` and `args_hash = sha256(salt ‖ JCS(arguments))`.

  Result-side commitment (`result_hash`/`result_salt`) is intentionally NOT in this surface because signing happens before the upstream handler returns (to support `preCallTransform`). A separate post-call signing path is the next ADR.

  8 new middleware tests added; mcp package now at 384 passing tests.

- d7c806c: Add `disclosure.result` to the middleware opt-in dial ([D061](../../DECISIONS.md#d061-add-tool_name-args_hash-result_hash-fields-to-121) / [§8.3](../../atrib-spec.md#83-salted-commitment-posture) result-side commitment).

  `AtribOptions.disclosure.result: 'omit' | 'plain-sha256' | 'salted-sha256'` populates `result_hash` (and optionally `result_salt`) on the signed record. The result is hashed BEFORE atrib mutates `result._meta` with its own propagation token, so the commitment covers exactly what the upstream handler returned. Same scheme as the existing `args` disclosure.

  ```ts
  atrib(server, {
    creatorKey,
    serverUrl,
    disclosure: {
      args: 'salted-sha256',
      result: 'salted-sha256',
    },
  })
  ```

  **Compatibility note**: `disclosure.result` requires the post-call signing path and is INCOMPATIBLE with `preCallTransform` (which signs pre-call when no result is available). When both are set, `result` disclosure is silently inactive on the pre-call path and an init-time warning fires so the conflict is visible at config time rather than as silently-missing fields.

  4 new middleware tests added; mcp package now at 388 passing tests.

  Closes the [§8.3](../../atrib-spec.md#83-salted-commitment-posture) commitment-form middleware surface end-to-end. The verifier's `args_commitment_form` and `result_commitment_form` posture annotations now have real-data inputs.

## 0.1.2

### Patch Changes

- 5809fc2: Refresh package descriptions and READMEs for npm consistency.
  - All 6 descriptions now follow the consistent shape `<noun> for atrib. <specific value>.`
  - Removed em dashes per the writing rules
  - `@atrib/mcp-wrap` description no longer mentions an arbitrary "~30 MCPs" cap (it works for any MCP)
  - Lowercased "atrib" to "atrib" across author + description fields per the brand convention
  - Wrote READMEs for `@atrib/cli` and `@atrib/directory` (previously had none)
  - Rewrote 115 broken relative links across mcp/agent/verify READMEs to absolute github URLs that auto-heal at public-flip
  - Stripped temporary `repository` field from package.jsons (404s while repo is private; restored at public-flip)
