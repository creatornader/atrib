# P046 candidate ADR draft: atribd: public stateless-native local daemon consolidating the primitive runtime

Status: candidate ADR draft, not accepted. Compact pending entry: [DECISIONS.md P046](../DECISIONS.md). Generated 2026-07-06 by the redesign-overhaul workflow (research -> draft -> adversarial judge -> revise); source plan: [redesign-upgrade-path.md](redesign-upgrade-path.md).

Candidate set (cross-references between drafts resolve via this table):

| Pending | Key | Draft |
|---|---|---|
| P042 | evidence-envelope | [docs/adr-draft-p042-evidence-envelope.md](adr-draft-p042-evidence-envelope.md) |
| P043 | anchor-plurality | [docs/adr-draft-p043-anchor-plurality.md](adr-draft-p043-anchor-plurality.md) |
| P044 | session-checkpoint | [docs/adr-draft-p044-session-checkpoint.md](adr-draft-p044-session-checkpoint.md) |
| P045 | delegation-certificates | [docs/adr-draft-p045-delegation-certificates.md](adr-draft-p045-delegation-certificates.md) |
| P046 | atribd-daemon | [docs/adr-draft-p046-atribd-daemon.md](adr-draft-p046-atribd-daemon.md) |
| P047 | attest-recall-rename | [docs/adr-draft-p047-attest-recall-rename.md](adr-draft-p047-attest-recall-rename.md) |
| P048 | payments-spinout | [docs/adr-draft-p048-payments-spinout.md](adr-draft-p048-payments-spinout.md) |
| P049 | mcp-extension | [docs/adr-draft-p049-mcp-extension.md](adr-draft-p049-mcp-extension.md) |

---

# Dxxx (draft): atribd is the public stateless-native local daemon for the primitive runtime

**Date:** draft (source session 2026-07-06)

**Status:** Draft — pending the P046 decision and the MCP TypeScript SDK timing gate

**Extends:** [D120](../DECISIONS.md#d120-local-substrate-coordinator-keeps-startup-spawn-sidecars-wrapper-owned), [D127](../DECISIONS.md#d127-primitive-runtime-health-gates-recall-contract-freshness), [D128](../DECISIONS.md#d128-host-owned-primitive-runtime-updates-are-build-restart-direct-probe), [D129](../DECISIONS.md#d129-primitive-runtime-health-gates-every-mounted-primitive-surface), [D130](../DECISIONS.md#d130-primitive-runtime-health-uses-non-mutating-behavioral-probes). Builds on [D076](../DECISIONS.md#d076-long-lived-atrib-emit-daemon-opt-in--spawn-per-emit-fallback), [D078](../DECISIONS.md#d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default)/[D083](../DECISIONS.md#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers), [D135](../DECISIONS.md#d135-delegated-builder-atrib-context-threads-via-orchestrator-injected-explicit-args).

## Context

The dogfood topology already converged on one host-owned process. The private `@atrib/primitives-runtime` package (`services/atrib-primitives/`) mounts all seven cognitive-primitive MCP servers in-process over `InMemoryTransport`, routes their 15 physical tools through one MCP server, and exposes that server over stdio, Streamable HTTP, or a stdio-to-HTTP proxy. [D120](../DECISIONS.md#d120-local-substrate-coordinator-keeps-startup-spawn-sidecars-wrapper-owned) proved the process-health story; [D127](../DECISIONS.md#d127-primitive-runtime-health-gates-recall-contract-freshness)–[D130](../DECISIONS.md#d130-primitive-runtime-health-uses-non-mutating-behavioral-probes) built the health-gate stack (recall contract freshness, per-package tool-surface contracts, non-mutating behavioral probes, build/restart/direct-probe updates). What the seven-process layout cost — spawn storms per harness thread, ppid-based session discovery workarounds ([D083](../DECISIONS.md#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers) v2/v3 exist *because* of it), per-generation health gating, a coordinator — is exactly what the consolidated runtime dissolved. But the runtime is private, and public users still get the seven-stdio-server default.

Two forcing functions converge:

1. **The 2026-07-06 clean-room redesign** (`docs/redesign-upgrade-path.md`, step 5) independently re-derived one local daemon owning keys, mirror, content index, and the tool surface as the natural infrastructure ontology.
2. **MCP 2026-07-28 goes stateless.** The `initialize`/`initialized` handshake and `Mcp-Session-Id` header are removed; protocol version, client info, capabilities, and W3C Trace Context travel in `_meta` on every request (SEP-414); Streamable HTTP requires `Mcp-Method`/`Mcp-Name` routing headers validated against the body (SEP-2243); `tools/list` responses carry `ttlMs`/`cacheScope` (SEP-2549); MCP sampling enters 12-month deprecation (SEP-2577). The current HTTP host in `services/atrib-primitives/src/index.ts` is built directly on the removed machinery.

The primitives already take explicit arguments and share stateless record-producing code paths, so the runtime is *almost* stateless today. The session machinery is pure transport scaffolding; deleting it changes no signed byte.

## Decision

Promote the private primitives runtime to a **public local daemon, `atribd`** (working name; final npm name is an open question), rebuilt stateless-native against the MCP 2026-07-28 transport, as the **recommended default** local topology for the seven cognitive primitives. Constraints, all binding:

1. **Signed records are byte-identical** across standalone stdio servers, the daemon's HTTP surface, and the alias mounts. The daemon calls the same `handleEmit`/`emitInProcess` code paths; JCS canonical form ([§1.3](../atrib-spec.md#13-canonical-serialization)), Ed25519 signing ([§1.4](../atrib-spec.md#14-signing-and-verification)), the 90-byte log entry ([§2.3.1](../atrib-spec.md#231-entry-serialization)), and `resolveChainRoot` precedence ([D067](../DECISIONS.md#d067-multi-producer-chain-composition-precedence-contract), [§1.2.3.1](../atrib-spec.md#1231-multi-producer-chain-composition)) are untouched.
2. **The agent-facing surface stays the seven monomorphic primitives** per [D079](../DECISIONS.md#d079-the-six-core-cognitive-primitives-atribs-agent-facing-surface)/[D106](../DECISIONS.md#d106-verify-is-promoted-to-cognitive-primitive-7). Internally the daemon routes through two handlers (write, read); this is implementation routing, not polymorphic dispatch on the tool surface. The mounted tool list defaults to the current 15 physical tool names as thin aliases over the handlers. A tool named `atrib-revise` in the tool list actively prompts mind-change recording; a `ref.kind` enum buried in a schema does not. Any collapse of the *visible* surface is the step-6 rename ADR (`docs/attest-recall-rename-impact.md`), not this one.
3. **Context identity is explicit-first on HTTP.** The daemon does **not** define a new inbound-carrier ladder: carrier resolution is exactly the [§1.5.4](../atrib-spec.md#154-mcp-transport-params_meta) `_meta` ladder with the [§1.5.3](../atrib-spec.md#153-http-fallback-x-atrib-chain) `X-Atrib-Chain` fallback, as `readInboundContext` in `packages/mcp/src/context.ts` implements today; this ADR consumes that single canonical definition and any future rung added to it (e.g. by the companion `dev.atrib` MCP-extension ADR) is inherited, not restated here. Ambient env/file discovery ([D078](../DECISIONS.md#d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default)/[D083](../DECISIONS.md#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers)) remains only for the stdio startup-spawn shim.
4. **[D128](../DECISIONS.md#d128-host-owned-primitive-runtime-updates-are-build-restart-direct-probe)–[D130](../DECISIONS.md#d130-primitive-runtime-health-uses-non-mutating-behavioral-probes) health gates carry over verbatim** as the daemon's own `/health` probes, minus the session block.
5. **Timing gate:** the stateless rebuild lands only when the Tier-1 MCP TypeScript SDK (`@modelcontextprotocol/sdk`) ships stateless-transport support within ten weeks of 2026-07-28 (by 2026-10-06). This gate is **shared**: the companion `dev.atrib` MCP-extension ADR's reference implementation rides the same transport rebuild and MUST cite this gate rather than define its own, so a slipped SDK blocks or unblocks both decisions together. If the SDK slips, the fallback (ship on the session SDK behind an isolated transport adapter, or hold the promotion) is decided by the operator — see open questions.
6. **[§5.8](../atrib-spec.md#58-degradation-contract) applies everywhere producer-side.** Log submission, mirror writes, instrumentation, and health probing are silent-failure ([§5.8](../atrib-spec.md#58-degradation-contract)); the daemon never blocks a primary tool call on network state. A primitive tool call that cannot resolve a context on HTTP returns a typed MCP tool error to *its own caller* (the primitive call is the primary call in that case); it never throws into a wrapped host tool call.
7. **No new record semantics.** This ADR introduces no new fields, no new event types, and touches nothing behind the [D036](../DECISIONS.md#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary) gate. It is a topology and transport decision.

## Mechanism

### What gets deleted (exact symbols in `services/atrib-primitives/src/index.ts`)

| Removed | Today's role |
| --- | --- |
| `parseSessionIdHeader()` | reads the `mcp-session-id` HTTP header |
| `HttpSession` interface, `sessions: Map<string, HttpSession>`, per-session `StreamableHTTPServerTransport` with `sessionIdGenerator`/`onsessioninitialized`, `closeSession()` | one transport + outer `Server` per MCP session |
| `sweepIdleSessions()`, `sweepTimer` | idle-session reaper |
| the `isInitializeRequest(body)` gate returning `Bad Request: initialize first or provide mcp-session-id` | initialize-first rejection |
| `ATRIB_PRIMITIVES_SESSION_IDLE_MS`, `--session-idle-ms`, `sessionIdleMs` option, `DEFAULT_SESSION_IDLE_MS` | idle timeout configuration |
| `session_model: 'per-session-transport-shared-backend'` and the `sessions:` block in the health report | session diagnostics |

What stays: `createAtribPrimitivesBackend` (in-process mounting over `InMemoryTransport`), the tool router with duplicate-name detection, `callWithToolTimeout` + tool-call diagnostics, `inspectRuntimeContracts` ([D127](../DECISIONS.md#d127-primitive-runtime-health-gates-recall-contract-freshness)/[D129](../DECISIONS.md#d129-primitive-runtime-health-gates-every-mounted-primitive-surface)), `inspectPrimitiveBehavioralProbes` ([D130](../DECISIONS.md#d130-primitive-runtime-health-uses-non-mutating-behavioral-probes)), the stdio transport, and the stdio-to-HTTP proxy (`createAtribPrimitivesHttpProxyRuntime`).

### What replaces it (stateless request handling)

Every HTTP request is self-describing and any request can land on any instance:

- **Routing-header validation (SEP-2243).** The handler validates `Mcp-Method` (e.g. `tools/call`) and `Mcp-Name` (the tool name) against the parsed JSON-RPC body; mismatch → HTTP 400 with a JSON-RPC error, no state consulted.
- **Per-request `_meta` (SEP-414).** Protocol version, client info, and W3C Trace Context (`traceparent`, `tracestate`, `baggage`) are read from `_meta` on every request. `readInboundContext` in `packages/mcp/src/context.ts` already resolves `_meta.atrib` > `_meta.tracestate` > `_meta['X-Atrib-Chain']` per [§1.5.4](../atrib-spec.md#154-mcp-transport-params_meta) and the [§1.5.3](../atrib-spec.md#153-http-fallback-x-atrib-chain) fallback; that resolution now runs per-request with no session cache, all three rungs preserved.
- **Cache metadata (SEP-2549).** `tools/list` responses carry `ttlMs`/`cacheScope`. Steady-state ttl is long; during any alias-migration window (step-6 rename) the daemon advertises a short `ttlMs` so the alias window outlasts the longest client cache.
- **Legacy compatibility window.** A pre-2026-07-28 client that POSTs `initialize` gets a valid stateless response (capabilities returned, **no** session id issued, subsequent session-header requests served with the header ignored). Strict-legacy harnesses use the stdio shim. Window length is an open question.

### Internal two-handler routing with alias mounts

```
tools/list  →  [ emit, atrib-annotate, atrib-revise,            (write handler)
                 recall_* ×8, trace, trace_forward,             (read handler)
                 summarize, atrib-verify ]                      (read handler)
```

Each mounted name is a thin alias: `{name, description, inputSchema}` exactly as the standalone package publishes it, delegating to `writeHandler(kind, args)` or `readHandler(shape, args)`. The alias must be **record-transparent**: a call through the alias produces the same canonical record bytes and the same `_local.producer` sidecar label ([§5.9](../atrib-spec.md#59-local-mirror-conventions)) as the standalone server. The two handlers are not exported as MCP tools in this ADR.

### Context-identity precedence (normative for the daemon)

The inbound-carrier ladder itself is defined once — [§1.5.4](../atrib-spec.md#154-mcp-transport-params_meta) with the [§1.5.3](../atrib-spec.md#153-http-fallback-x-atrib-chain) fallback, reference-implemented by `readInboundContext` in `packages/mcp/src/context.ts` — and this ADR cites it rather than redefining it. If the companion `dev.atrib` MCP-extension ADR adds a new top carrier rung to [§1.5.4](../atrib-spec.md#154-mcp-transport-params_meta), atribd inherits it through `readInboundContext` with no change to this ADR.

**HTTP (stateless), per request:**

1. Explicit `context_id` tool argument (32-hex).
2. Inbound carrier resolution per [§1.5.4](../atrib-spec.md#154-mcp-transport-params_meta)/[§1.5.3](../atrib-spec.md#153-http-fallback-x-atrib-chain), exactly as `readInboundContext` implements: `_meta.atrib` propagation token, then the `atrib=` entry in `_meta.tracestate`, then `_meta['X-Atrib-Chain']` — the daemon deliberately keeps the `X-Atrib-Chain` fallback rung; dropping it would be a behavior change to non-tracestate HTTP callers and is out of scope. The resolved token also seeds chain-tail resolution per [D067](../DECISIONS.md#d067-multi-producer-chain-composition-precedence-contract).
3. Nothing → write primitives return a typed tool error (`atrib: context_id required on stateless transport`); read primitives that support unscoped queries proceed per their own scope rules. This is today's `ATRIB_REQUIRE_EXPLICIT_CONTEXT_ID=1` behavior promoted to the HTTP default. A single-tenant daemon may opt back into ambient discovery (env/profile-file, [D083](../DECISIONS.md#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers) v3) via an explicit flag — flag name is an open question.

**stdio shim (startup-spawn), unchanged ladder:** explicit argument > `_meta` carriers (same [§1.5.4](../atrib-spec.md#154-mcp-transport-params_meta)/[§1.5.3](../atrib-spec.md#153-http-fallback-x-atrib-chain) resolution) > `ATRIB_CONTEXT_ID` env > harness registry env (`KNOWN_HARNESS_DISCOVERIES`) > fallback file > undefined, per [D078](../DECISIONS.md#d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default)/[D083](../DECISIONS.md#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers).

Chain-root resolution itself is **not** modified: `resolveChainRoot` precedence (inbound token > autoChain tail > `ATRIB_CHAIN_TAIL_<context_id>` > mirror inheritance > synthetic genesis) applies bit-for-bit as before.

Example request `_meta`:

```json
{
  "method": "tools/call",
  "params": {
    "name": "emit",
    "arguments": { "content": { "observation": "…" }, "context_id": "9f2c…32hex" },
    "_meta": {
      "atrib": "…87-char propagation token…",
      "tracestate": "atrib=…",
      "traceparent": "00-…",
      "X-Atrib-Chain": "…87-char propagation token (fallback carrier, §1.5.3)…"
    }
  }
}
```

### Health surface ([D127](../DECISIONS.md#d127-primitive-runtime-health-gates-recall-contract-freshness)–[D130](../DECISIONS.md#d130-primitive-runtime-health-uses-non-mutating-behavioral-probes) carried over)

```json
{
  "status": "healthy | degraded | starting | error",
  "report": {
    "daemon": {
      "name": "atribd", "version": "…", "pid": 0,
      "transport": "streamable-http-stateless",
      "protocol_version": "2026-07-28",
      "endpoint": "http://127.0.0.1:8796/mcp"
    },
    "primitive_contracts": { "…": "per-package tool-surface contracts (D129)" },
    "behavioral_probes": { "…": "non-mutating probes (D130); write primitives stay skipped" },
    "recall_contract": { "coverage_version": "coverage-v1", "content_index_version": "content-index-v1" },
    "profile": { "agent": "…", "mirror_file": "…", "context_id_policy": "explicit-required" },
    "requests": { "served": 0, "rejected_header_mismatch": 0, "rejected_missing_context": 0 }
  }
}
```

The `sessions` block is gone; a `requests` counter block replaces it. Degradation logic (`runtimeContractsDegraded`, timed-out in-flight calls) carries over. `scripts/update-primitives-runtime.mjs` gains an atribd mode (build → restart → direct probe → gate), preserving [D128](../DECISIONS.md#d128-host-owned-primitive-runtime-updates-are-build-restart-direct-probe).

### Key custody and mirror ownership

The daemon owns the agent key (Keychain via `@atrib/cli` conventions or key file) **or** runs as a [D102](../DECISIONS.md#d102-sandboxed-signer-proxy-keeps-keys-outside-sandbox) signer-proxy client when callers are sandboxed. It owns the local mirror file(s) and the durable content index ([D126](../DECISIONS.md#d126-content-recall-uses-a-durable-index-behind-complete-evidence-coverage) lineage), which is precisely why one process is safer than seven writers. It binds `127.0.0.1` by default and is never a public service.

## Compatibility and migration

- **Existing signed records:** untouched. No field, canonical form, hash, signature, log entry byte, or checkpoint changes. Records emitted through atribd verify identically to records emitted through standalone servers; a verifier cannot distinguish them (by design).
- **Published packages:** the seven cognitive-primitive npm packages (`@atrib/emit` … `@atrib/verify-mcp`) continue to publish with standalone stdio binaries; the daemon is the *recommended* topology, not the only one. `atribd` becomes a new public package following `docs/publishing-new-npm-package.md`. `@atrib/mcp` needs no breaking change; its `_meta` resolution already matches the SEP-414 channel. The private `@atrib/primitives-runtime` package is superseded — either converted in place to the public package or retired after a deprecation note (open question).
- **Deployed services:** `log-node`, `graph-node`, `directory-node`, `archive-node` are unaffected. atribd is local-only.
- **Operator machines:** LaunchAgents currently running `atrib-primitives --transport streamable-http` migrate via the [D128](../DECISIONS.md#d128-host-owned-primitive-runtime-updates-are-build-restart-direct-probe) updater. `ATRIB_PRIMITIVES_SESSION_IDLE_MS` and `--session-idle-ms` are ignored with a one-line stderr deprecation notice (never a fatal error, per [§5.8](../atrib-spec.md#58-degradation-contract) posture toward configuration drift). The stdio-to-HTTP proxy shim keeps working against the stateless endpoint. `ATRIB_REQUIRE_EXPLICIT_CONTEXT_ID` becomes redundant-but-honored on HTTP (it is the default); it retains meaning on the stdio shim. The topology/measurement scripts (`report-local-substrate-topology.mjs`, `measure-local-substrate-default-trial.mjs`, `prove-local-substrate-process-health.mjs`) are updated to read the new health shape; the [D120](../DECISIONS.md#d120-local-substrate-coordinator-keeps-startup-spawn-sidecars-wrapper-owned) coordinator's route-registry evidence keys change from session counts to request counters.
- **Old MCP clients:** served through the legacy-initialize compatibility window on HTTP, or through the stdio shim indefinitely.
- **HTTP context carriers:** all three inbound carriers (`_meta.atrib`, `_meta.tracestate`, `_meta['X-Atrib-Chain']`) keep working; no caller that threads context through the [§1.5.3](../atrib-spec.md#153-http-fallback-x-atrib-chain) fallback today loses resolution when moving to the daemon.
- **Rollback:** because standalone servers keep shipping, rollback is a config change (re-point harness MCP config at the per-primitive binaries), not a data migration.

## Conformance-corpus plan

New directory: **`spec/conformance/atribd/`**, mirroring the `local-substrate-coordinator/` layout (`README.md`, `manifest.json`, `cases/`, `topology/`). Case families:

1. **`stateless-transport/`** — no-session request accepted; legacy `Mcp-Session-Id` header ignored (not 404); legacy `initialize` answered without session issuance; identical read request replayed against a "different instance" (fresh backend) returns an equivalent result.
2. **`routing-headers/`** — `Mcp-Method`/`Mcp-Name` matching body → accepted; each mismatch axis → 400 vectors; adversarial header/body divergence per SEP-2243.
3. **`context-resolution/`** — full carrier-ladder vectors: explicit argument beats `_meta.atrib` beats `_meta.tracestate` beats `_meta['X-Atrib-Chain']`; an `X-Atrib-Chain`-only request resolves (the [§1.5.3](../atrib-spec.md#153-http-fallback-x-atrib-chain) fallback rung is load-bearing, not vestigial); missing context on HTTP → typed write-primitive rejection; stdio-shim ladder vectors reusing/extending the [D083](../DECISIONS.md#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers) env/file cases; interaction vectors proving `resolveChainRoot` output is unchanged (reuse `spec/conformance/1.2.3/multi-producer/` fixtures as inputs).
4. **`record-byte-parity/`** — with injected fixed key + timestamp, the same emit/annotate/revise through (a) standalone stdio server, (b) daemon HTTP, (c) alias mount produces byte-identical canonical records and identical `_local.producer` labels.
5. **`health-gates/`** — pass/degraded/fail report snapshots for [D127](../DECISIONS.md#d127-primitive-runtime-health-gates-recall-contract-freshness) (recall contract), [D129](../DECISIONS.md#d129-primitive-runtime-health-gates-every-mounted-primitive-surface) (tool-surface contracts), [D130](../DECISIONS.md#d130-primitive-runtime-health-uses-non-mutating-behavioral-probes) (behavioral probes, write primitives skipped); the retired `sessions` block absent.
6. **`degradation/`** — log endpoint unreachable → tool call still returns with mirror-only receipt; probe timeout → degraded not fatal; malformed `_meta` → lenient parse per the [D018](../DECISIONS.md#d018-w3c-trace-context-and-baggage-conformance-leftmost-atrib-lenient-parse-evict-from-end-on-overflow) posture.

The corpus lands in the same commit as the ADR per the upgrade-path convention.

## Alternatives rejected

- **Keep seven standalone stdio processes as the public default.** Rejected: per-thread spawn storms, ppid-fragile session discovery ([D083](../DECISIONS.md#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers) v2/v3 are workarounds for exactly this), seven mirror/index writers, and per-generation health gating are operational costs the dogfood already measured and dissolved.
- **Patch the session machinery in place on the old SDK indefinitely.** Rejected: it builds on protocol machinery the 2026-07-28 spec removes; every month of investment increases the rebuild cost, and gateway/routing ecosystems will assume `Mcp-Method`/`Mcp-Name`.
- **Drop the `X-Atrib-Chain` fallback carrier on the stateless HTTP surface.** Rejected: [§1.5.3](../atrib-spec.md#153-http-fallback-x-atrib-chain) defines it and `readInboundContext` resolves it today; removing a rung would silently break non-tracestate callers and would fork the carrier ladder between the daemon and `@atrib/mcp`. The daemon consumes the one canonical ladder unmodified.
- **Collapse the visible tool surface to two tools (write/read) now.** Rejected: [D079](../DECISIONS.md#d079-the-six-core-cognitive-primitives-atribs-agent-facing-surface) explicitly rejects polymorphic dispatch as the agent-facing surface, and the tool-list affordance is load-bearing (a listed `atrib-revise` prompts revision behavior). Surface changes belong to the step-6 rename ADR with its own impact catalog.
- **Host the primitive surface as a cloud service.** Rejected: it moves keys and the mirror off the host, breaking the local-mirror center of gravity ([§5.9](../atrib-spec.md#59-local-mirror-conventions)) and the salted-commitment privacy posture; atribd must stay a local daemon.
- **Fold atribd into the [D120](../DECISIONS.md#d120-local-substrate-coordinator-keeps-startup-spawn-sidecars-wrapper-owned) coordinator unchanged.** Rejected as-is: the coordinator is optional topology glue with wrapper-owned signing; atribd is the tool surface and signing owner. Whether the coordinator's residual duties merge into atribd is an open question, not an assumption.
- **Couple the daemon and the attest/recall rename in one ADR.** Rejected: two independent blast radii; the alias mount plus SEP-2549 `ttlMs` control is what makes the rename safely land *later*.

## Doc-sync impact

- **`CLAUDE.md`:** repository-structure tree (new `services/atribd/` or renamed entry; `services/atrib-primitives/` note updated); the "twenty-nine workspace packages" count and the public/private package family lists ("Ten public SDK and integration packages", "One private local-runtime package") change; the [D083](../DECISIONS.md#d083-harness-session-id-discovery-extends-d078d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default-for-cognitive-primitive-mcp-servers) key-technical-decision bullet gains the "stdio-shim-only on HTTP" qualifier. Also fix the stale "(52 rows)" claim for `DOC-SYNC-TRIGGERS.md` in the Sync triggers section — the table currently has 64 data rows — in the same commit.
- **`scripts/check-doc-sync.mjs`:** the public-package-count and workspace-package-list-completeness number-word checks must be extended in the same commit; add a check pinning the daemon's mounted-tool count to the primitive packages' expected-tools enumeration (the `PRIMITIVE_SPECS` list); per the repo's extend-the-script guidance, also add a check tying CLAUDE.md's DOC-SYNC-TRIGGERS row-count claim to the actual table so the count cannot go stale again.
- **`README.md`:** packages table row; topology/quick-start section updated to recommend the daemon.
- **`ARCHITECTURE.md`:** public package-family summary and local-runtime description.
- **`DOC-SYNC-TRIGGERS.md`:** new-package trigger row fires; verify at integration whether the daemon topology warrants a new trigger row of its own (do not hard-code the current row count in the ADR).
- **`skills/atrib/SKILL.md`:** mounting guidance (daemon endpoint + stdio shim replaces seven-server instructions).
- **`docs/publishing-new-npm-package.md`:** followed for the new package; no content change expected.
- **`docs/redesign-upgrade-path.md`:** step 5 annotated as promoted to this ADR.
- **`METRICS.md`:** if the dogfood tracks process-count or spawn metrics, their lifecycle states update at the next quarterly review.
- **`DESIGN.md`:** no product-surface change — the daemon is headless; explicitly stating so satisfies the design-system rule.
- **Anchor hygiene note for the integrator:** this ADR uses the correct GitHub slugs for [D079](../DECISIONS.md#d079-the-six-core-cognitive-primitives-atribs-agent-facing-surface)/[D080](../DECISIONS.md#d080-primitive-lifecycle-extensions-first-dedicated-mcps-upon-promotion) (`#d079-the-six-core-cognitive-primitives-atribs-agent-facing-surface`, `#d080-primitive-lifecycle-extensions-first-dedicated-mcps-upon-promotion` — the headings use commas, which slug to single hyphens). CLAUDE.md and README carry stale double-hyphen forms of these slugs (pre-existing drift); normalize either the headings or the existing links in a follow-up sweep rather than propagating the broken form.

## Open questions (operator decisions)

- Final npm name for the daemon package: unscoped `atribd` vs scoped `@atrib/daemon` (affects the publishing runsheet, README packages table, and bin name).
- If the Tier-1 MCP TypeScript SDK misses the 2026-10-06 stateless-transport gate: ship on the session SDK behind an isolated transport adapter, or hold the promotion? This is the shared gate with the companion dev.atrib MCP-extension ADR, so the choice applies to both decisions together.
- Length and sunset criteria of the legacy-initialize compatibility window on the HTTP surface (the stdio shim covers strict-legacy harnesses indefinitely, so the window can be short — but how short?).
- Name and default of the single-tenant flag that opts a daemon back into ambient context discovery ([D083](../DECISIONS.md#d083-harness-session-id-discovery-extends-d078d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default-for-cognitive-primitive-mcp-servers) v3 env/profile-file) on HTTP, where explicit-required is the new default.
- Fate of the private @atrib/primitives-runtime workspace package: convert in place into the public package, or retire it with a deprecation note and start the public package clean.
- Whether the [D120](../DECISIONS.md#d120-local-substrate-coordinator-keeps-startup-spawn-sidecars-wrapper-owned) coordinator's residual duties (route registry, watcher WAL join-back) merge into atribd or the coordinator remains a separate optional process.
- If the companion dev.atrib MCP-extension ADR adds a new top carrier rung to the [§1.5.4](../atrib-spec.md#154-mcp-transport-params_meta) inbound ladder, where exactly does it slot relative to _meta.atrib? Owned by that ADR/spec change, but atribd's context-resolution conformance vectors must be extended in the same commit it lands.
