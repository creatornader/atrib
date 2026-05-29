# atrib: the protocol for verifiable agent actions

## What this is

atrib makes the actions an AI agent takes provable. Every agent action becomes a signed, chain-linked record committed to a public Merkle log; downstream consumers (the agent itself, merchants, auditors, other agents) can independently verify what happened without trusting any operator. "Agent action" covers three categories that all land on the same log: tool calls (MCP via `@atrib/mcp-wrap`, framework-native via `@atrib/agent` or `@atrib/openinference`), transactions (six payment protocols detected: ACP, UCP, x402, MPP, AP2, a2a-x402), and the agent's own intentional records and reads via the seven cognitive primitives (`atrib-emit`, `atrib-annotate`, `atrib-revise` writes; `atrib-recall`, `atrib-trace`, `atrib-summarize`, `atrib-verify` reads). The substrate enables several use cases: provable recall by the agent, independent audit by third parties, settlement when commerce closes a chain, and verifiable causality across agent handoffs. atrib is the layer between identity (DIF/W3C) and payment rails (ACP/UCP/x402/MPP/AP2), but more fundamentally, it's the layer that makes any post-hoc claim about agent activity provable.

The canonical positioning used across the README, spec abstract, and per-package READMEs:

- **Headline:** Verifiable agent actions.
- **Sub-line:** Every action becomes signed context for the next.
- **Tagline:** Agents that reason from a past they can prove.

Use this language in any new docs or commit messages that need a one-line description of the project. Don't reword it without an accompanying change to the README and spec.

The complete protocol specification is in `atrib-spec.md` ([§0](atrib-spec.md#0-foundations)-[§7](atrib-spec.md#7-harness-integration-patterns)). The technical architecture overview is in `ARCHITECTURE.md`. Read the spec before making any implementation decisions.

## Repository structure

```
atrib/
  .github/
    scripts/check-log-smoke.mjs # Shared public log smoke checker for deploy and scheduled workflows. Checks response shape plus TTFB/total latency budgets for pubkey, stats, recent, feed, explorer shell, and live marketing/explorer asset parity.
  README.md                    # Public-facing project description (customer entry point)
  CLAUDE.md                    # THIS FILE: hub doc, conventions, invariants
  DESIGN.md                    # Product design system source of truth: current state, target state, tokens, components, surface backlog
  atrib-spec.md                # The single source of truth for the protocol
  DECISIONS.md                 # Architectural decision log (D001-D108; D070 + D073 are placeholder ADRs for the Record Body Archive Layer per §2.12 and the `handoff` event_type byte respectively; D071 codifies spec writing conventions; D072 governs orphan handling; D074 + D075 capture the git-trailer integration and compose-not-override hook config patterns; D076 introduces the opt-in long-lived atrib-emit daemon; D077 codifies pass^k as the primary Track B reporting metric, k=3 default, promoted from P019 on 2026-05-10; D081 introduces emitInProcess for hook-class producers (signing in-process, byte-identical to MCP-signed records); D082 supersedes D081's integration shape by shipping `atrib-emit-cli` from `@atrib/emit` and having the hook helper spawn the binary, so the hook source directory never becomes an npm workspace; D083 extends D078 with a harness session-id discovery registry in `@atrib/mcp` so cognitive-primitive MCP servers spawned by Claude Code, and future harnesses, derive `context_id` from the parent's session_id env var without operator-side config (v2 2026-05-23 adds optional file-fallback to the registry for startup-spawn harnesses like Claude Code whose MCP children pre-date the per-session env; SessionStart hook writes `~/.claude/state/active-session-id-<ppid>` and `resolveEnvContextId` reads it when env is unset); D084 ships per-event instrumentation jsonl files under `~/.atrib/state/` for read primitives (Surface 6, via `logReadPrimitiveCall` in `@atrib/mcp@0.10.0`), SessionStart (Surface 7), cli-spawn transport (Surface 8), plus a unified analyzer (Surface 9, host-side) that joins all four jsonl pillars + the signed-record mirror so the loop-closure question can be answered against data instead of inferred from one source; `@atrib/recall` compact-mode response now always carries `record_hash` so callers can chain other primitives from any result; D085/D086 tune recall calibration and BM25 content indexing; D087 formalizes signed diagnostic outcome + causal trace replay as the canonical repair/refinement pattern; D088 updates AP2 transaction detection to successful CheckoutReceipt / PaymentReceipt as the current v0.2 hook while keeping the v0.1 PaymentMandate DataPart fallback; D089 adds verifier-side AP2 / Verifiable Intent evidence checks in `@atrib/verify`; D090 adds async AP2 receipt JWT verification with `jose`, trusted JWKS, and verifier metadata; D091 adds async AP2 / VI SD-JWT conformance with OpenWallet `sd-jwt-js`; D092 adds typed AP2 / VI mandate constraint evaluation; D093 makes the AP2 / VI fixture directory the local verifier corpus; D094 attaches AP2 / VI evidence to verifier results as a tiered block; D095 adds an AP2 Path 2 content_id receipt identity ladder; D096 adds a pinned offline AP2 / VI crypto conformance corpus and named verifier hardening for JOSE, JWKS, SD-JWT, and clock edges; D097 adds an opt-in AP2 live interop artifact harness in `@atrib/integration`; D098 keeps AP2 receipt signatures as external evidence and makes Path 2 transaction records carry an agent `signers[]` entry via `signTransactionRecord`; D099 commits explicit emit content through default `args_hash` and gives direct CLI emits a default mirror path; D100 lets MCP middleware sign and run `onRecord` with log submission disabled for offline tests and local-mirror-only hosts; D101 adds the substrate-wide adversarial conformance corpus for §1.4 signing, §3.2.4 full edge derivation, D067 race vectors, and D052 creator-signer separation; D102 requires sandboxed producers to keep Ed25519 signing keys outside the sandbox through a host signer proxy; D103 adds optional SSE and JSON Feed subscription surfaces over commitment-visible log entry fields; D104 codifies `ATRIB_PARENT_RECORD_HASH` parent-child threading through `informed_by`; D105 adds verifier-side Pattern 3 handoff claim acceptance in `@atrib/verify`; D106 promotes `@atrib/verify-mcp` as cognitive primitive #7 after two independent Pattern 3 receiving flows; D107 adds AP2 counterparty attestation over atrib transaction bytes and makes `cross_attestation.signers_valid` count distinct verified keys; D108 makes OpenTelemetry/OpenInference span trees an intake/correlation layer and puts rich observability fields in local sidecar content for recall, trace, and summarize). A "Pending decisions" section at the end (forward-looking pattern) tracks forward-looking decisions awaiting action (P002, P004, P005, P008, P009, P010, P012, P013, P016-P018, P021, P024, P026, P027, P036-P040). P012, P013, P016, and P017 cover remaining runtime and sandboxing patterns. P018 and P021 cover eval-framework adoption and benchmark publication. P024, P026, and P027 cover spec hosting, multi-creator SessionStart, and host-side hook deployment. P036-P040 cover the support/RCA implication set from the Autumn support-investigation case study: cross-harness continuation packets, skill/context provenance, hosted-agent diagnostics, the support/RCA demo wedge, and Mastra source verification.
  ARCHITECTURE.md              # Technical architecture overview: trust model, protocol layers, design decisions
  PRIOR-ART.md                 # Prior art & standards map: every spec/protocol atrib builds on, organized by layer
  METRICS.md                   # Tiered metrics framework + lifecycle states + quarterly evolution review for the dogfood experiment
  metrics/                     # Dated JSON snapshots from `pnpm --filter @atrib/log-node metrics`
  packages/
    mcp/                       # @atrib/mcp: MCP server middleware (public)
    agent/                     # @atrib/agent: Agent middleware + framework adapters (public)
    verify/                    # @atrib/verify: Verifier library (record verification, §4.6 calc, settlement, AP2 / VI evidence checks, Pattern 3 handoff claim acceptance) (public)
    cli/                       # @atrib/cli: keygen + Keychain key management (public)
    mcp-wrap/                  # @atrib/mcp-wrap: generic config-driven MCP wrapper (public). Library + binary. Wraps any upstream MCP server with @atrib/mcp middleware so every tool call is signed and logged. Multiplies coverage to ~30 MCPs at zero per-server code cost. Library surface (`wrap`, `parseConfig`, `buildPreCallTransform`, `resolveKey`, helpers) for in-tree wrappers; `atrib-wrap` binary reads $ATRIB_WRAP_CONFIG or ~/.atrib/wrap-config.json.
    directory/                 # @atrib/directory: AKD-backed identity-claim directory SDK (public). Bundles wasm/ artifacts built from packages/directory-bridge.
    directory-bridge/          # atrib-directory-bridge: Rust crate wrapping facebook/akd via wasm-bindgen. Source-only; build artifacts ship inside @atrib/directory.
    openinference/             # @atrib/openinference: OpenTelemetry SpanProcessor consuming OpenInference-shaped spans and emitting signed atrib records plus recall-readable local sidecar content. Reference impl of spec §9 Pattern #4. Mirrors @arizeai/openinference-vercel ergonomics so callers compose it alongside their OpenInference pipeline; one adapter transitively reaches every framework with OpenInference instrumentation (OpenAI Agents SDK, Claude Agent SDK, LangChain, Vercel AI, CrewAI, LlamaIndex, DSPy, MCP, Microsoft Agent Framework, Bedrock AgentCore, smolagents, Pydantic AI, Agno, +20 more). Peer deps on @opentelemetry/api + @opentelemetry/sdk-trace-base.
    log-dev/                   # @atrib/log-dev: in-memory dev Merkle log stub (PRIVATE, dev only)
    integration/               # @atrib/integration: cross-package tests + runnable framework examples (private)
      scripts/
        ap2-live-interop.ts    # Opt-in AP2 reference artifact harness. Reads AP2 result + AP2/VI evidence JSON, optionally verifies an atrib transaction-record artifact with counterparty attestation, and exits nonzero on drift.
        extract-google-ap2-sample-artifacts.ts # Official Google AP2 sample extractor. Converts captured A2A events plus the sample .temp-db into live interop artifacts.
        generate-ap2-local-participant-artifacts.ts # Local AP2 participant generator. Rehydrates AP2 / VI artifact bundles and writes an atrib transaction record with agent and counterparty signers over transaction bytes.
        generate-ap2-reference-receipts.py # Opt-in generator that imports the official google-agentic-commerce/AP2 Python SDK from a local checkout and writes compact receipt-JWT fixtures for the AP2 interop harness.
        generate-ap2-vi-reference-evidence.py # Opt-in generator that imports official AP2 SDK receipts plus the public agent-intent/verifiable-intent reference implementation and writes combined AP2 / VI fixture artifacts for the live interop harness.
      examples/
        end-to-end/            # Runnable demo for customer walkthroughs (`pnpm demo`)
        claude-agent-sdk/      # Case A + Case B examples
        cloudflare-agents/     # McpAgent + Agent examples
          live-worker-proof/   # Real Cloudflare Worker + Durable Object proof for server-side MCP signing and prior-action recall.
          live-client-proof/   # Real Cloudflare Agent.addMcpServer proof for client-side wrapping and fallback transaction signing.
          approval-trace/      # Interactive Cloudflare Agents HITL example: proposal -> human approval -> MCP execution -> signed audit trace.
        vercel-ai-sdk/         # createMCPClient + AI Gateway example
        langchain-js/          # MultiServerMCPClient + loadMcpTools example
        signer-proxy/          # D102 sandboxed-execution signer proxy example. Sandbox requests signatures, host signer keeps the key outside the sandbox.
  policies/                     # Attribution policy templates and guide (6 templates + README)
  skills/
    atrib/SKILL.md             # The atrib practice doc, agent-facing guidance for using atrib from the inside out (memory, reasoning, getting smarter over time). Source of truth; symlinked to ~/.claude/skills/atrib/SKILL.md so any Claude Code session anywhere on the host machine discovers it.
  apps/
    dashboard/                  # Public explorer (D054 option 1): vanilla HTML/CSS/JS served from log-node's Docker image. Composes log + graph + directory read APIs into 7 views (overview, identity, session, action, demo, anchoring, trace). Defaults to https://log.atrib.dev / graph.atrib.dev / directory.atrib.dev; URL params override for local services. Pure graph-rendering helpers extracted to `graph-utils.mjs` (sibling module, served at `/graph-utils.mjs` by log-node) so they're unit-testable without a browser; `test/graph-utils.test.mjs` exercises layout selection, degree computation, node-size encoding, bbox math, and Sigma 3 framed-default camera state.
  services/
    log/                       # FUTURE: Tessera-backed Merkle log (Go), placeholder README
    log-node/                  # Production Node.js Merkle log with real RFC 6962 proofs. Deployed at https://log.atrib.dev/v1 with persistent Fly volume, C2SP-canonical signed-note checkpoints, and optional SSE / JSON Feed subscription surfaces. Includes scripts/verify-loop.mjs (13-gate dogfood verifier), scripts/chain-demo.mjs, scripts/multi-agent-demo.mjs, scripts/metrics.mjs.
    graph-node/                # Production Node.js graph query service. Implements §3.2.4 derivation. Deployed at https://graph.atrib.dev/v1. Recovery scripts include scripts/replay-from-mirror.mjs for full mirror replay and scripts/replay-missing-references-from-mirrors.mjs for targeted missing-reference backfill.
    directory-node/            # Production Node.js AKD-backed identity-claim directory service per §6.2. Per-operation anchoring (§6.2.4) emits directory_anchor records to log-node automatically.
    atrib-emit/                # MCP server exposing the explicit `emit` tool. Producer-side cognitive primitive #1 of D079 for observations the @atrib/mcp wrapper doesn't auto-sign. Records are byte-identical to wrapper-signed records; same key (the agent's). Standalone stdio binary; runs in the agent's process alongside other MCP servers.
    atrib-annotate/            # MCP server exposing the `atrib-annotate` tool. Producer-side cognitive primitive #2 of D079: marks a past record's importance / summary / topics. Adds an ANNOTATES graph edge per §3.2.4 step 8. Specialized form of @atrib/emit per D079's package layering. Stdio binary; same process model as atrib-emit.
    atrib-revise/              # MCP server exposing the `atrib-revise` tool. Producer-side cognitive primitive #3 of D079: supersedes a prior position with a stated reason. Adds a REVISES graph edge per §3.2.4 step 9. Specialized form of @atrib/emit per D079's package layering. Stdio binary; same process model as atrib-emit.
    atrib-recall/              # MCP server exposing the `recall_my_attribution_history` tool. Consumer-side cognitive primitive #4 of D079: reads the local mirror (per §5.9), filters by creator_key / context_id / time window / event_type, and indexes normalized sidecar content, including OpenInference span payload fields when present. Read-only; does not sign. Stdio binary; same process model as atrib-emit. The harness design is documented in D040.
    atrib-trace/               # MCP server for backward causal-chain walking. Consumer-side cognitive primitive #5 of D079: reads the local mirror (per §5.9), follows `informed_by` edges backward from a starting record_hash, surfaces sidecar_summary per visited record (tool_name, span kind/name, model, prompt version, topics, importance). Read-only; does not sign. Stdio binary; same process model as atrib-emit.
    atrib-summarize/           # MCP server for narrative synthesis across N records. Consumer-side cognitive primitive #6 of D079: reads N records by context_id and/or record_hashes from the local mirror, calls an OpenAI-compatible LLM (defaults to NIM qwen3.5-397b) to produce a narrative, including normalized sidecar content such as OpenInference prompt/output/usage/cost metadata when present. Closes the consumer-side cognitive loop (agents read context, not raw records). Stdio binary; same process model as atrib-emit.
    atrib-verify/              # MCP server exposing the `atrib-verify` tool. Consumer-side cognitive primitive #7 of D079/D106: verifies counterparty handoff evidence before a receiving agent links follow-up work through `informed_by`. Read-only; does not sign. Stdio binary; same process model as atrib-emit.
  spec/
    conformance/
      1.2.6/                   # provenance_token conformance corpus (test vectors for §1.2.6, D044). Generator at packages/log-dev/scripts/generate-conformance-1.2.6.ts; reference test at packages/verify/test/conformance-1.2.6.test.ts. Four cases cover canonical-form invariance, derivation rule, genesis-only invariant, absence-not-null contract.
      1.4/                     # Signing conformance corpus (test vectors and adversarial vectors for §1.4, D101)
      1.9/                     # Key rotation/revocation conformance corpus (test vectors for §1.9, D033). Skeleton; fixtures land in an upcoming implementation phase.
      ap2-vi-crypto/           # AP2 / Verifiable Intent crypto conformance corpus (D096, §5.5.4). Offline JOSE/JWKS/SD-JWT/clock adversarial cases consumed by @atrib/verify.
      2.6.1/                   # Submission API conformance corpus (consumed by @atrib/log-dev and log-node)
      3.2.4/                   # Full graph edge derivation conformance corpus (§3.2.4, D101). Covers all nine edge types, all-pairs session edges, and dangling producer-declared references.
      4.6/                     # Calculation conformance corpus (test vectors for §4.6)
      6/                       # Public-key directory conformance corpus (test vectors for §6, D034). Skeleton; fixtures land alongside the directory implementation.
```

Public packages are intended for npm publication. Private workspace packages and services (`log-dev`, `integration`, `cloudflare-live-proof`, `cloudflare-live-client-proof`, `cloudflare-approval-trace`, `log-node`, `graph-node`, `directory-node`, `dashboard`) are fixtures, proof harnesses, deployed services, or product surfaces with `private: true` in their `package.json` so they cannot be accidentally published. The `directory-bridge` Rust crate is source-only, its WASM build artifacts ship inside `@atrib/directory` (see [`packages/directory-bridge/README.md`](packages/directory-bridge/README.md) for the build procedure).

## Hub doc

CLAUDE.md is the navigational center. The spec (`atrib-spec.md`) is the authoritative technical reference.

## Authoritative docs

| Doc               | Responsible for                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `atrib-spec.md`   | Complete protocol specification: record format, Merkle log, graph model, policy format, SDK contract                                 |
| `CLAUDE.md`       | Project conventions, invariants, implementation guidance                                                                             |
| `ARCHITECTURE.md` | Technical architecture overview: trust model, protocol layers, payment integration, design decisions                                 |
| `DESIGN.md`       | Product design system: current surface inventory, north-star direction, tokens, components, UI writing rules, design backlog         |
| `DECISIONS.md`    | Architectural decision log: what was decided, why, what alternatives were considered                                                 |
| `PRIOR-ART.md`    | Every standard and protocol atrib builds on, extends, or hooks into, organized by layer                                              |
| `METRICS.md`      | Tiered metrics framework, metric lifecycle states, quarterly evolution review process, annual meta-review for the dogfood experiment |

## Sync triggers

The full event-to-doc mapping lives at [`DOC-SYNC-TRIGGERS.md`](DOC-SYNC-TRIGGERS.md) (52 rows). It was extracted from this file so the hub doc stays under the 40k-char SessionStart performance threshold. Both files are authoritative; this section is the quick reference, the linked file is the canonical source.

A subset of triggers is mechanically enforced by `scripts/check-doc-sync.mjs` (run via `pnpm doc-sync` and integrated into CI). It detects number-word drift between canonical sources and target documents (edge type count, node type count, dashboard view count, public package count, workspace package list completeness). When adding a new "<word> <thing>" claim that should remain synchronized with an enumeration, extend the script with a new check to avoid reliance on manual review.

### Quick reference (most-frequent triggers)

| Event                          | Update                                                                                                                                                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Architectural decision made    | `DECISIONS.md`: new entry with date, context, decision, alternatives                                                                                                                                             |
| New package created            | This file (repository structure) AND `README.md` (packages table)                                                                                                                                                |
| Product design surface changed | `DESIGN.md` first, then the surface README if a view/component contract changed                                                                                                                                  |
| New framework adapter shipped  | `packages/agent/README.md` (adapter table + side-by-side quick-starts) AND `README.md` (top-level adapter table) AND `DECISIONS.md` (a Dxxx entry with the integration shape decision and rejected alternatives) |

## Critical invariants (never violate)

These are non-negotiable. They come from the founding conversation and are the load-bearing design decisions.

1. **atrib failures must never affect the primary tool call or agent response.** All exceptions caught. All network failures silent with retry. Pass-through mode if no key. This is [§5.8](atrib-spec.md#58-degradation-contract) of the spec. No exceptions.

2. **The graph records structure, not causality.** Never add edge types based on semantic interpretation of tool names or response content. Edges are derived from observable record structure only. This is [§3.1](atrib-spec.md#31-design-principles-and-rationale) of the spec.

3. **The calculation algorithm is a pure function.** Graph + policy = distribution. No network calls during calculation. No timestamps beyond those in the records. No randomness. Any party with the same inputs must get the same result. This is [§4.6](atrib-spec.md#46-the-calculation-algorithm) of the spec.

4. **Transaction records are non-blocking.** Never `await` log submission before returning a response. Priority queue yes, synchronous no. This is [§5.3.5](atrib-spec.md#535-log-submission) of the spec.

5. **session_token is optional and omitted (not null) when absent.** Its presence/absence changes the JCS canonical form and therefore the signature. This is [§1.3](atrib-spec.md#13-canonical-serialization) of the spec.

6. **Fact/policy separation is absolute.** The graph ([§3](atrib-spec.md#3-graph-query-interface)) is a pure fact layer. The policy ([§4](atrib-spec.md#4-attribution-policy-format)) is where weights and distribution decisions live. Graph endpoints must never return weighted data. This is [§3.6](atrib-spec.md#36-implementation-notes) of the spec.

7. **The protocol has no thumb on the scale.** atrib does not decide what contributions are worth. Merchants and creators publish machine-readable policy documents. Agents negotiate them. The protocol provides the schema; the parties provide the values. This is [§4.1](atrib-spec.md#41-purpose-and-position-in-the-protocol) of the spec.

## Key technical decisions (preserve exactly)

- **Ed25519, 32-byte seed.** Not 64-byte NaCl format. Not DIDs. Simple, fast, no PKI. See [§1.4.1](atrib-spec.md#141-key-format).
- **JCS canonicalization (RFC 8785).** Lexicographic key ordering. No whitespace. New optional fields slot lexicographically: `informed_by` after `event_type` (i > e), `provenance_token` after `informed_by` (p > i) and before `session_token` (p < s). Presence/absence of any optional field affects the signature. See [§1.3](atrib-spec.md#13-canonical-serialization) + [D041](DECISIONS.md#d041-informed_by-linking-primitive-and-informed_by-edge-type) + [D044](DECISIONS.md#d044-provenance_token-field-for-cross-session-causal-anchoring).
- **Token format:** `base64url(sha256(jcs(signed_record))) + "." + base64url(creator_key_bytes)`. 87 chars max, fits W3C tracestate limit. See [§1.5.2](atrib-spec.md#152-http-transport-tracestate).
- **Genesis chain_root:** `"sha256:" + hex(SHA-256(UTF-8(context_id)))`. Not null, not random. See [§1.2.3](atrib-spec.md#123-chain_root-for-genesis-records).
- **Multi-producer chain composition is normative ([D067](DECISIONS.md#d067-multi-producer-chain-composition-precedence-contract), [§1.2.3.1](atrib-spec.md#1231-multi-producer-chain-composition)).** Chain-root resolution precedence is fixed: inbound propagation token > within-process autoChain tail > `ATRIB_CHAIN_TAIL_<context_id>` env var > mirror-file inheritance (filtered by context_id) > synthetic genesis. Producers MUST use [`resolveChainRoot`](packages/mcp/src/chain-root.ts) from `@atrib/mcp` or replicate it bit-for-bit against the [conformance corpus](spec/conformance/1.2.3/multi-producer/). The corollary: never reimplement chain selection in a new producer.
- **Log entry:** 90 bytes fixed: version(1) + record_hash(32) + creator_key(32) + context_id(16) + timestamp_ms(8) + event_type(1). See [§2.3.1](atrib-spec.md#231-entry-serialization). event_type byte mapping: 0x01 tool_call, 0x02 transaction, 0x03 observation, 0x04 directory_anchor ([D056](DECISIONS.md#d056-promote-directory_anchor-to-atrib-normative-event_type-byte-0x04)), 0x05 annotation ([D058](DECISIONS.md#d058-promote-annotation-to-atrib-normative-event_type-byte-0x05)), 0x06 revision ([D059](DECISIONS.md#d059-promote-revision-to-atrib-normative-event_type-byte-0x06)), 0x07-0xFE reserved per [D036](DECISIONS.md#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary), 0xFF extension URI.
- **Proof bundle caching:** keyed by `record_hash`, not `context_id`. See [§5.3.5](atrib-spec.md#535-log-submission).
- **C2SP tlog-tiles ecosystem.** Checkpoints, tiles, signed notes, witnessing. Not a custom log format. See [§2](atrib-spec.md#2-merkle-log-protocol).
- **Nine edge types, deterministic derivation.** CHAIN_PRECEDES, SESSION_PRECEDES, SESSION_PARALLEL, CONVERGES_ON, CROSS_SESSION, INFORMED_BY ([D041](DECISIONS.md#d041-informed_by-linking-primitive-and-informed_by-edge-type)), PROVENANCE_OF ([D044](DECISIONS.md#d044-provenance_token-field-for-cross-session-causal-anchoring)), ANNOTATES ([D058](DECISIONS.md#d058-promote-annotation-to-atrib-normative-event_type-byte-0x05)), REVISES ([D059](DECISIONS.md#d059-promote-revision-to-atrib-normative-event_type-byte-0x06)). Two implementations on identical input must produce identical edge sets. See [§3.2.4](atrib-spec.md#324-edge-derivation-rules).
- **Provenance_token is the genesis-record-only stricter subset of informed_by.** Single-valued, scoped to session ancestry, truncated to 16 bytes for cross-session API ergonomics. Multi-valued / per-record consultation references use informed_by with full hashes. See [D044](DECISIONS.md#d044-provenance_token-field-for-cross-session-causal-anchoring) + [§1.2.6](atrib-spec.md#126-provenance_token).
- **Transaction records require ≥2 distinct verified signer keys ([D052](DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records), [§1.7.6](atrib-spec.md#176-cross-attestation-requirement-for-transaction-records), [D107](DECISIONS.md#d107-ap2-counterparty-attestation-signs-atrib-transaction-bytes)).** The `signers` array carries both agent and counterparty signatures over the same canonical bytes. Duplicate signer entries do not satisfy the minimum. Path 2 producer fallback records carry the agent signer via `signTransactionRecord()` but still flag `cross_attestation_missing: true` until a counterparty signs the same bytes. AP2 receipt signatures remain external evidence per [D098](DECISIONS.md#d098-ap2-receipts-stay-external-evidence-for-cross-attestation).
- **Cross-log replication is OPTIONAL ([D050](DECISIONS.md#d050-cross-log-replication-for-equivocation-defense), [§2.11](atrib-spec.md#211-cross-log-replication)).** Single-log bundles remain valid; multi-log bundles use the `log_proofs` array form. Verifier threshold M ≥ 2 with a trusted set of independent logs gives equivocation-detection.
- **Record body archive is a SEPARATE service from the log ([D070](DECISIONS.md#d070-record-body-archive-layer-placeholder-adr) placeholder, [§2.12](atrib-spec.md#212-record-body-archive-layer)).** The log commits to a record's hash; the body lives at the producer's mirror ([§5.9](atrib-spec.md#59-local-mirror-conventions)) and OPTIONALLY at a separate Record Body Archive Layer ([§2.12](atrib-spec.md#212-record-body-archive-layer)). Never collapse the archive into the log operator's surface - that would erode the salted-commitment privacy posture ([§8.3](atrib-spec.md#83-salted-commitment-posture)) the commitment-only design exists to support. Verifiability is tiered: Tier 1 (commitment) needs the log; Tier 2 (body retrieval) needs producer-mirror or archive; Tier 3 (signature re-verification) needs Tier 2. Cross-harness continuation is the product forcing function: a future agent can prove a record existed from Tier 1, but it needs Tier 2/3 material plus redacted evidence, skill versions, chain tail, and provenance anchors to continue the work without guessing.
- **Capability declarations are OPTIONAL ([D051](DECISIONS.md#d051-capability-scoped-records-via-directory-published-envelopes), [§6.7](atrib-spec.md#67-capability-declarations)).** Identity claims gain a `capabilities` field; verifiers flag out-of-envelope records with `in_envelope: false` but do not invalidate them (signal not block).
- **Adversarial threat model lives at [§8.7](atrib-spec.md#87-adversarial-threat-model).** atrib does NOT certify truth, only signing. Trust assessment is a 10-layer stack (signature, identity, capability, revocation, cross-attestation, tool-side attestation, external evidence, witnessing, cross-log replication, structural anomaly detection). See [§8.7](atrib-spec.md#87-adversarial-threat-model) for the full enumeration.
- **Edge weight uses max(), not sum().** Because every node has CONVERGES_ON plus its primary edge. Sum would inflate all structural contributors equally. See [§4.2.2](atrib-spec.md#422-edge-weights).
- **Seven core cognitive primitives ([D079](DECISIONS.md#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface), [D106](DECISIONS.md#d106-verify-is-promoted-to-cognitive-primitive-7)).** atrib's agent-facing surface is seven monomorphic MCP tools: `atrib-emit` (observation), `atrib-annotate` (annotation), `atrib-revise` (revision), `atrib-recall` (read), `atrib-trace` (read), `atrib-summarize` (read), and `atrib-verify` (read). Each meets the bash standard: one purpose, narrow input, composable output, stable API. New write primitives still require a new event_type promoted per [D036](DECISIONS.md#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary). New read primitives require the [D080](DECISIONS.md#d080-primitive-lifecycle--extensions-first-dedicated-mcps-upon-promotion) extension-first gate and a boundary-drawing test: different cognitive purpose, different required args, and no duplicate graph effect. Polymorphic dispatch (one tool, switch on event_type enum) is explicitly rejected by [D079](DECISIONS.md#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface).
- **Harness session-id discovery extends env-default lookup ([D083](DECISIONS.md#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers)).** Extends [D078](DECISIONS.md#d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default). When `ATRIB_CONTEXT_ID` is unset or invalid, the four cognitive-primitive MCP servers consult `resolveEnvContextId` in `@atrib/mcp`, which checks a static registry (`KNOWN_HARNESS_DISCOVERIES` in [`packages/mcp/src/harness-context.ts`](packages/mcp/src/harness-context.ts)) to derive `context_id` from a documented harness env var. The initial registry contains `CLAUDE_CODE_SESSION_ID` (UUID stripped + lowercased to 32-hex). Annotate and revise inherit via `handleEmit` delegation. Adding a new harness is a one-line registry entry. No spec change; signed records are byte-identical. **[D083](DECISIONS.md#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers) v2 (2026-05-23)** extends each registry entry with an optional `fallbackFile: () => string` thunk so `resolveEnvContextId` can fall through env → file → undefined. Required for startup-spawn harnesses (Claude Code spawns MCP children at process launch, before any session exists, so the per-session env var never reaches them). The Claude Code entry's thunk returns `~/.claude/state/active-session-id-${process.ppid}`; the writer is a SessionStart hook in the host's hook layer (operator-side); the field is purely additive, existing harness entries without it keep v1 env-only behavior.
- **Per-server producer label in mirror sidecar.** `handleEmit` and `emitInProcess` accept an optional `producer` field that routes to `_local.producer` for cross-source disambiguation. `atrib-emit` writes `'atrib-emit'`. `atrib-annotate` writes `'atrib-annotate'`. `atrib-revise` writes `'atrib-revise'`. The `atrib-emit-cli` binary writes `'atrib-emit-cli'` by default and accepts an envelope `producer` field override so hook helpers can stamp finer attribution (e.g. `'claude-hooks-builtin-2b'`). The signed `AtribRecord` bytes are unchanged; producer is sidecar metadata only. Mirror consumers (SessionStart by-producer aggregation, recall filters, audit tooling) read `_local.producer` per the `LocalSidecar` type in `services/atrib-emit/src/storage.ts`.
- **Explicit emit content commitment per [D099](DECISIONS.md#d099-explicit-emit-records-commit-local-content-through-default-args_hash).** `@atrib/emit` computes `args_hash = sha256(JCS(content))` when callers omit `argsHash`. Full content stays local in `_local.content`; the signed record carries the replay-checkable hash. `content_id` remains the event-kind identifier, not a body hash. Direct `atrib-emit-cli` mirrors default to `~/.atrib/records/atrib-emit-${ATRIB_AGENT:-claude-code}.jsonl` when `ATRIB_MIRROR_FILE` is unset.
- **Loop-closure instrumentation per [D084](DECISIONS.md#d084-read-primitive-instrumentation-for-empirical-loop-closure-measurement).** Five jsonl pillars under `~/.atrib/state/` together let a unified analyzer in the host integration's hook layer answer the four loop-closure questions (does surfacing drive reads, does reading drive writes, does SessionStart drive same-session reads, per-session totals) plus cli-spawn transport health. Producers: (1) the PreToolUse decision-guidance hook writes `decision-guidance/fires.jsonl` (Surface 5, pre-existing); (2) the three read-primitive MCP servers (`@atrib/recall` family, `@atrib/trace`, `@atrib/summarize`) wrap their handlers with `logReadPrimitiveCall` from `@atrib/mcp@0.10.0` and write `read-primitives/calls.jsonl` (Surface 6); (3) the host's SessionStart hook writes `session-start/surfaces.jsonl` with per-block byte counts keyed by `SURFACE_7_BLOCK_NAMES` (Surface 7); (4) the host's cli-spawn helper writes `cli-spawn/calls.jsonl` with stripped 32-hex `session_id` matching the read-primitives schema (Surface 8). Each writer is silent-failure per [§5.8](atrib-spec.md#58-degradation-contract); instrumentation never blocks the primary path. `@atrib/recall`'s compact response now always includes `record_hash` so callers can chain `recall_walk` / `recall_annotations` / `recall_revisions` / `trace` from any result and so the analyzer can correlate read returns against fires top-k without a verbose-mode round-trip.

## V2 deferrals (do not implement)

- Per-conversation key derivation (deferred [D038](DECISIONS.md#d038-per-conversation-key-derivation))
- Policy versioning (immutable snapshots)
- Log federation across operators
- Settlement webhook format
- Dispute mechanism
- Multi-transaction session handling
- Agent-published policies (empirical weighting models)
- DIF/C2PA interoperability profiles (see [§1.8](atrib-spec.md#18-scope-boundaries) Interoperability Roadmap)
- Zero-knowledge commitment schemes for args/result (Pedersen, KZG; [D045](DECISIONS.md#d045-privacy-postures-normative-spec-section) leaves the [§8.3](atrib-spec.md#83-salted-commitment-posture) extensibility shape open)

## Design system

Read `DESIGN.md` before making visual, UI writing, explorer, website, share-image, or user-facing reliability-state changes. It is the design source of truth for current surface inventory, target direction, tokens, components, and the design backlog. If a change alters a product surface, update `DESIGN.md` in the same commit or state why the contract did not change.

## Implementation conventions

### Monorepo

This is a TypeScript monorepo with **twenty-three workspace packages**:

- **Seven core public packages** (`@atrib/mcp`, `@atrib/agent`, `@atrib/verify`, `@atrib/cli`, `@atrib/mcp-wrap`, `@atrib/directory`, `@atrib/openinference`)
- **Seven cognitive-primitive MCP servers** (`@atrib/emit`, `@atrib/annotate`, `@atrib/revise`, `@atrib/recall`, `@atrib/trace`, `@atrib/summarize`, `@atrib/verify-mcp`) - published to npm with binaries
- **Two private test/example packages** (`@atrib/log-dev`, `@atrib/integration`)
- **Three private deployed-service packages** (`@atrib/log-node`, `@atrib/graph-node`, `@atrib/directory-node`)
- **One private product-surface package** (`@atrib/dashboard`)
- **Three private Cloudflare example packages** (`@atrib/cloudflare-live-proof`, `@atrib/cloudflare-live-client-proof`, `@atrib/cloudflare-approval-trace`)

Plus a Rust crate (`atrib-directory-bridge`, source-only; built artifacts ship inside `@atrib/directory`). Uses pnpm workspaces and turborepo for the TypeScript builds; the Rust bridge is built once via `wasm-pack` and the resulting WASM artifacts are checked into `packages/directory/wasm/`. Three deployable services not on npm: `services/log-node`, `services/graph-node`, `services/directory-node`.

### Package structure

Each package under `packages/` follows:

```
packages/<name>/
  src/
    index.ts          # Public API surface
    adapters/         # Framework adapters (only in packages with multiple host integrations, e.g. @atrib/agent)
  test/
    *.test.ts         # Tests
  README.md           # Customer-facing documentation (per-package)
  package.json
  tsconfig.json
```

The `@atrib/integration` package also has an `examples/` directory containing one runnable example per supported framework (excluded from `tsconfig` so examples typecheck against user-installed dependency versions, not the workspace build). New framework support always ships with both a unit test in `packages/agent/test/` and a runnable example in `packages/integration/examples/`.

### Framework adapter pattern (established by [D018](DECISIONS.md#d018-w3c-trace-context-and-baggage-conformance-leftmost-atrib-lenient-parse-evict-from-end-on-overflow), [D021](DECISIONS.md#d021-claude-agent-sdk-case-a-is-zero-new-code-case-b-uses-createatribproxy-in-process-forwarder), [D022](DECISIONS.md#d022-cloudflare-agents-adapter-mcpagent-server-side-is-zero-code-agent-client-side-uses-attributecloudflareagentmcp-not-createatribproxy), [D023](DECISIONS.md#d023-vercel-ai-sdk-mcp-adapter-monkey-patch-mcpclientrequest-not-wrapmcpclient-and-not-the-tools-execute-callbacks), [D024](DECISIONS.md#d024-langchain-js-mcp-adapter-not-docs-only-multiservermcpclient-needs-a-proper-helper-because-its-internal-client-references-are-private))

When adding support for a new MCP framework, the integration shape is determined by **source-reading the host framework first**, not by guessing from the dependency graph. Five integrations have shipped (`@modelcontextprotocol/sdk` raw client, Claude Agent SDK Cases A and B, Cloudflare Agents, Vercel AI SDK, LangChain JS) and every one had a different correct integration point that the source revealed. The general approach holds: one `atrib()` interceptor + one adapter helper per framework + identical observable behavior. The adapter helper signature varies because the host framework's surface varies; that variation is forced, not invented.

Each adapter ships with:

1. Source file at `packages/agent/src/adapters/<framework>.ts`
2. Test file at `packages/agent/test/<framework>.test.ts` covering at minimum: passthrough, `_meta` injection, no caller mutation, response flow, idempotency, and [§5.8](atrib-spec.md#58-degradation-contract) degradation
3. Runnable example at `packages/integration/examples/<framework>/` with both `README.md` and `integration.ts`
4. Entry in the unified adapter table in `packages/agent/README.md`
5. A `Dxxx` entry in `DECISIONS.md` documenting the integration-shape choice and the alternatives rejected
6. Adapter export from `packages/agent/src/index.ts`

### Protocol adapter pattern (established by [D027](DECISIONS.md#d027-protocol-adapters-as-a-parallel-integration-surface-to-framework-adapters))

Distinct from (and orthogonal to) framework adapters. Framework adapters hook atrib INTO a host agent framework at runtime (`@atrib/agent` + host). Protocol adapters provide observability FOR a specific payment protocol's ecosystem, independent of any single agent session.

Each protocol adapter has three canonical layers: **registry** (versioned source of truth for the protocol's on-chain actors), **scanner** (ecosystem-level volume aggregation via Dune / HyperSync / RPC), and **attribution** (maps scanned senders to registry actors, surfaces unattributed residual). The spec stays protocol-agnostic; protocol-specific attribution rationale lives in the adapter's docs per [§3.6](atrib-spec.md#36-implementation-notes) fact/policy separation.

Two observation surfaces compose cleanly per protocol: runtime (via `@atrib/agent` + framework adapter) and retrospective (via protocol adapter scanner). A complete per-protocol artifact demonstrates both: Path A (retrospective, exercises [§3](atrib-spec.md#3-graph-query-interface) + [§4](atrib-spec.md#4-attribution-policy-format)) plus Path B (a reference agent using `@atrib/agent` to make real payments with signed receipts flowing through the log to merchant-side verify, exercises [§1](atrib-spec.md#1-attribution-record-format), [§2.6.1](atrib-spec.md#261-submit-entry), [§5](atrib-spec.md#5-sdk-specification)).

Protocol-adapter implementations do not live in this repo yet. The first (`x402`) is being validated outside the public tree and will move to `packages/x402/` or `services/x402-scanner/` on public release. See ARCHITECTURE.md "Protocol adapters" section and [D027](DECISIONS.md#d027-protocol-adapters-as-a-parallel-integration-surface-to-framework-adapters) for the architectural rationale.

Future protocol adapters (ACP, UCP, AP2, MPP) follow the same template.

### Dependencies

- **Ed25519:** Use `@noble/ed25519`. Pure JS, no native deps, audited.
- **JCS:** Use `canonicalize` npm package (RFC 8785 implementation).
- **SHA-256:** Use `@noble/hashes/sha2.js` (`sha256` named export). The earlier convention of "Web Crypto API with Node fallback" was simplified; `@noble/hashes` works in both runtimes without a fallback path and is already a dep.
- **MCP SDK:** `@modelcontextprotocol/sdk`, the official MCP TypeScript SDK. Note that `@ai-sdk/mcp` (Vercel) and the LangChain `MultiServerMCPClient` ship their own JSON-RPC implementations and are NOT structurally compatible with this SDK at the Client level; see [D023](DECISIONS.md#d023-vercel-ai-sdk-mcp-adapter-monkey-patch-mcpclientrequest-not-wrapmcpclient-and-not-the-tools-execute-callbacks) and [D024](DECISIONS.md#d024-langchain-js-mcp-adapter-not-docs-only-multiservermcpclient-needs-a-proper-helper-because-its-internal-client-references-are-private) for the integration implications.
- **Framework dependencies (Vercel AI SDK, LangChain, Cloudflare Agents, Claude Agent SDK):** Never imported as hard dependencies of `@atrib/agent`. Adapters use structural typing against the host framework's public shape so users only pay the dependency cost of frameworks they actually use.

### Testing

Every normative MUST in the spec must have a corresponding test. The spec's test vectors ([§1.4.4](atrib-spec.md#144-test-vector-validation) Wycheproof) are mandatory. The calculation algorithm ([§4.6](atrib-spec.md#46-the-calculation-algorithm)) must have determinism tests: two runs on identical input must produce identical output.

### Code style

- TypeScript strict mode.
- No `any` types. The spec defines exact shapes; use them.
- Error handling follows the degradation contract ([§5.8](atrib-spec.md#58-degradation-contract)): catch everything, log with `atrib:` prefix, never throw to caller.
