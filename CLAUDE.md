# atrib: the protocol for verifiable agent actions

## What this is

atrib makes the actions an AI agent takes provable. Every MCP tool call becomes a signed, chain-linked record committed to a public Merkle log; downstream consumers (the agent itself, merchants, auditors, other agents) can independently verify what happened without trusting any operator. The substrate enables several use cases: provable recall by the agent, independent audit by third parties, settlement when commerce closes a chain, and verifiable causality across agent handoffs. atrib is the layer between identity (DIF/W3C) and payment rails (ACP/UCP/x402/MPP), but more fundamentally, it's the layer that makes any post-hoc claim about agent activity provable.

The canonical positioning used across the README, spec abstract, and per-package READMEs:

- **Headline:** Verifiable agent actions.
- **Sub-line:** Every tool call becomes signed context for the next.
- **Tagline:** Agents that reason from a past they can prove.

Use this language in any new docs or commit messages that need a one-line description of the project. Don't reword it without an accompanying change to the README and spec.

The complete protocol specification is in `atrib-spec.md` ([§0](atrib-spec.md#0-foundations)-[§7](atrib-spec.md#7-harness-integration-patterns)). The technical architecture overview is in `ARCHITECTURE.md`. Read the spec before making any implementation decisions.

## Repository structure

```
atrib/
  README.md                    # Public-facing project description (customer entry point)
  CLAUDE.md                    # THIS FILE: hub doc, conventions, invariants
  atrib-spec.md                # The single source of truth for the protocol
  DECISIONS.md                 # Architectural decision log (D001-D056; D040 reserved for the @atrib/recall harness ADR). A "Pending decisions" section at the end (forward-looking pattern) tracks forward-looking decisions awaiting action (P002+).
  ARCHITECTURE.md              # Technical architecture overview: trust model, protocol layers, design decisions
  PRIOR-ART.md                 # Prior art & standards map: every spec/protocol atrib builds on, organized by layer
  METRICS.md                   # Tiered metrics framework + lifecycle states + quarterly evolution review for the dogfood experiment
  metrics/                     # Dated JSON snapshots from `pnpm --filter @atrib/log-node metrics`
  packages/
    mcp/                       # @atrib/mcp: MCP server middleware (public)
    agent/                     # @atrib/agent: Agent middleware + framework adapters (public)
    verify/                    # @atrib/verify: Verifier library (record verification, §4.6 calc, settlement) (public)
    cli/                       # @atrib/cli: keygen + Keychain key management (public)
    directory/                 # @atrib/directory: AKD-backed identity-claim directory SDK (public). Bundles wasm/ artifacts built from packages/directory-bridge.
    directory-bridge/          # atrib-directory-bridge: Rust crate wrapping facebook/akd via wasm-bindgen. Source-only; build artifacts ship inside @atrib/directory.
    log-dev/                   # @atrib/log-dev: in-memory dev Merkle log stub (PRIVATE, dev only)
    integration/               # @atrib/integration: cross-package tests + runnable framework examples (private)
      examples/
        end-to-end/            # Runnable demo for customer walkthroughs (`pnpm demo`)
        claude-agent-sdk/      # Case A + Case B examples
        cloudflare-agents/     # McpAgent + Agent examples
        vercel-ai-sdk/         # createMCPClient + AI Gateway example
        langchain-js/          # MultiServerMCPClient + loadMcpTools example
  policies/                     # Attribution policy templates and guide (6 templates + README)
  skills/
    atrib/SKILL.md             # The atrib practice doc — agent-facing guidance for using atrib from the inside out (memory, reasoning, getting smarter over time). Source of truth; symlinked to ~/.claude/skills/atrib/SKILL.md so any Claude Code session anywhere on the operator's machine discovers it.
  apps/
    dashboard/                  # Public explorer (D054 option 1): single-file HTML/CSS/JS, no build step. Composes log + graph + directory read APIs into 5 views (overview, identity, session, action, anchoring). Defaults to https://log.atrib.dev / graph.atrib.dev / directory.atrib.dev; URL params override for local services.
  services/
    log/                       # FUTURE: Tessera-backed Merkle log (Go), placeholder README
    log-node/                  # Production Node.js Merkle log with real RFC 6962 proofs. Deployed at https://log.atrib.dev/v1 with persistent Fly volume + C2SP-canonical signed-note checkpoints. Includes scripts/verify-loop.mjs (13-gate dogfood verifier), scripts/chain-demo.mjs, scripts/multi-agent-demo.mjs, scripts/metrics.mjs.
    graph-node/                # Production Node.js graph query service. Implements §3.2.4 derivation. Deployed at https://graph.atrib.dev/v1.
    directory-node/            # Production Node.js AKD-backed identity-claim directory service per §6.2. Per-operation anchoring (§6.2.4) emits directory_anchor records to log-node automatically.
  spec/
    conformance/
      1.4/                     # Signing conformance corpus (test vectors for §1.4)
      1.9/                     # Key rotation/revocation conformance corpus (test vectors for §1.9, D033). Skeleton; fixtures land in an upcoming implementation phase.
      2.6.1/                   # Submission API conformance corpus (consumed by @atrib/log-dev and log-node)
      4.6/                     # Calculation conformance corpus (test vectors for §4.6)
      6/                       # Public-key directory conformance corpus (test vectors for §6, D034). Skeleton; fixtures land alongside the directory implementation.
```

Public packages are intended for npm publication. Private packages (`log-dev`, `integration`) live in the workspace as fixtures and demos and have `private: true` in their `package.json` so they cannot be accidentally published. The `directory-bridge` Rust crate is source-only — its WASM build artifacts ship inside `@atrib/directory` (see [`packages/directory-bridge/README.md`](packages/directory-bridge/README.md) for the build procedure).

## Hub doc

CLAUDE.md is the navigational center. The spec (`atrib-spec.md`) is the authoritative technical reference.

## Authoritative docs

| Doc                         | Responsible for                                                                                       |
| --------------------------- | ----------------------------------------------------------------------------------------------------- |
| `atrib-spec.md`             | Complete protocol specification: record format, Merkle log, graph model, policy format, SDK contract |
| `CLAUDE.md`                 | Project conventions, invariants, implementation guidance                                              |
| `ARCHITECTURE.md`           | Technical architecture overview: trust model, protocol layers, payment integration, design decisions |
| `DECISIONS.md`              | Architectural decision log: what was decided, why, what alternatives were considered                 |
| `PRIOR-ART.md`              | Every standard and protocol atrib builds on, extends, or hooks into, organized by layer              |
| `METRICS.md`                | Tiered metrics framework, metric lifecycle states, quarterly evolution review process, annual meta-review for the dogfood experiment |

## Sync triggers

| Event                                 | Update                                                                                                                                                                                                           |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Protocol decision changed             | `atrib-spec.md` first, then `ARCHITECTURE.md` if design overview affected                                                                                                                                        |
| Architectural decision made           | `DECISIONS.md`: new entry with date, context, decision, alternatives                                                                                                                                            |
| New package created                   | This file (repository structure) AND `README.md` (packages table)                                                                                                                                                |
| New framework adapter shipped         | `packages/agent/README.md` (adapter table + side-by-side quick-starts) AND `README.md` (top-level adapter table) AND `DECISIONS.md` (a Dxxx entry with the integration shape decision and rejected alternatives) |
| New runnable example added            | `packages/integration/README.md` AND a `README.md` inside the example directory                                                                                                                                  |
| Implementation convention established | This file (conventions section)                                                                                                                                                                                  |
| Wire-format or wire-protocol change   | `atrib-spec.md` (if normative), this file's "Key technical decisions" section, AND DECISIONS.md                                                                                                                  |
| [§2.6.1](atrib-spec.md#261-submit-entry) validation rule changed        | Regenerate `spec/conformance/2.6.1/` corpus via `pnpm --filter @atrib/log-dev corpus`, update `spec/conformance/2.6.1/README.md` if the format changed                                                           |
| [§1.9](atrib-spec.md#19-key-rotation-and-revocation) rotation/revocation logic touched | Update `spec/conformance/1.9/` corpus if generated, update `spec/conformance/1.9/README.md` case list if added/removed, regression-test in `@atrib/verify` and `services/graph-node`                              |
| [§6](atrib-spec.md#6-key-directory) directory operation added           | Update `spec/conformance/6/` corpus if generated, update `spec/conformance/6/README.md` case list, ensure unblinded mode (atrib's primary use) still passes, refresh `@atrib/directory` SDK docs                  |
| Anchoring cadence changed ([§6.2.4](atrib-spec.md#624-anchor-cross-reference-into-the-tessera-log)) | Update [§6.5](atrib-spec.md#65-conformance) conformance vectors covering per-operation anchoring + batched-directory window, update `services/directory-node` to emit `directory_anchor` per operation, update `@atrib/verify` to honor `directory_batching_window_ms` signal |
| Verifier consultation algorithm changed ([§6.3](atrib-spec.md#63-verifier-consultation-algorithm)) | Update [§6.5](atrib-spec.md#65-conformance) conformance vectors per failure-class (hard vs soft signals), update `@atrib/verify` `identity_resolution` output schema, update [§6.7.2](atrib-spec.md#672-verifier-semantics) capability check to consume the resolved envelope from [§6.3](atrib-spec.md#63-verifier-consultation-algorithm) step 9 |
| `packages/directory-bridge/src/lib.rs` modified | Re-run `wasm-pack build --target nodejs --release` from `packages/directory-bridge/`, copy `pkg/atrib_directory_bridge.{js,d.ts}` and `pkg/atrib_directory_bridge_bg.wasm` into `packages/directory/wasm/`, then run `pnpm --filter @atrib/directory test` to confirm the SDK still passes against the new WASM. The WASM artifacts in `packages/directory/wasm/` ARE checked into git so the SDK ships the bridge inline. |
| New AKD operation exposed via the bridge | Add the operation to `packages/directory-bridge/src/lib.rs`, expose via the `@atrib/directory` SDK in `packages/directory/src/index.ts`, surface in `services/directory-node/src/server.ts` HTTP API per [§6.2](atrib-spec.md#62-directory-operations), update spec [§6.2](atrib-spec.md#62-directory-operations) if normative |
| Positioning / framing change           | The canonical positioning at the top of this file is the reference. If it changes, update the top of `README.md`, the abstract of `atrib-spec.md`, the lead paragraph of every per-package README, and the GitHub repo description in lockstep. |
| Prior art landscape changed           | Update `PRIOR-ART.md` with new entries                                                                                                                                                                           |
| Test count changed materially         | `README.md` and `CONTRIBUTING.md` test count references                                                                                                                                                          |
| Metric added/removed/promoted/demoted | `METRICS.md` (table entry + lifecycle status) AND `services/log-node/scripts/metrics.mjs` (`METRICS` array: `name`, `tier`, `status`, `decisionSupported`, `run`). Both must agree.                              |
| New deployed service                  | This file (repository structure) AND `README.md` (deployed-service URL note) AND `ARCHITECTURE.md` (operator footprint) AND `services/<name>/fly.toml` if Fly-deployed                                            |
| `informed_by` field semantics changed ([D041](DECISIONS.md#d041-informed_by-linking-primitive-and-informed_by-edge-type)) | Update `spec/conformance/3.2.4/informed-by/` corpus, regenerate INFORMED_BY edge derivation tests, refresh `@atrib/verify` informed_by_resolution surfacing                                                  |
| `provenance_token` field semantics changed ([D044](DECISIONS.md#d044-provenance_token-field-for-cross-session-causal-anchoring)) | Update `spec/conformance/3.2.4/provenance/` corpus, regenerate PROVENANCE_OF edge derivation tests, refresh `@atrib/verify` provenance_chain surfacing, audit the `provenance_token` derivation invariant (`base64url(sha256(jcs(U))[:16]) == T`) |
| Privacy posture spec section [§8](atrib-spec.md#8-privacy-postures) changed ([D045](DECISIONS.md#d045-privacy-postures-normative-spec-section)) | Update `spec/conformance/8/` corpus per posture, refresh `@atrib/verify` posture detection logic, update [§7.5](atrib-spec.md#75-harness-side-reasoning-chains) posture-selection guidance |
| Edge type added/removed ([§3.2.3](atrib-spec.md#323-edge-types) + [§3.2.4](atrib-spec.md#324-edge-derivation-rules))     | Update [§3](atrib-spec.md#3-graph-query-interface) lead-in count, update [§3.2.1](atrib-spec.md#321-node-types) participation matrix, update CLAUDE.md "Key technical decisions" edge type list, update `services/graph-node` derivation, update `@atrib/verify` calculation if contributing-set affected |
| Adapter conformance contract changed ([D048](DECISIONS.md#d048-plug-and-play-enforcement-contract-for-adapters)) | Refresh `packages/agent/test/conformance.test.ts`, update `packages/agent/README.md` adapter table, update `packages/agent/CONTRIBUTING.md` adapter authoring guide |
| Layered leak defense updated ([D049](DECISIONS.md#d049-layered-leak-defense-regex-llm-semantic-cloud-audit-style-guide))            | Update operator-side prose style guide, refresh `scripts/check-leaks.mjs` and `scripts/check-leaks-semantic.mjs`, update cloud audit routine with new patterns |
| Cross-log replication semantics changed ([D050](DECISIONS.md#d050-cross-log-replication-for-equivocation-defense), [§2.11](atrib-spec.md#211-cross-log-replication)) | Update `spec/conformance/2.11/` corpus, refresh `@atrib/verify` cross-log proof verification, update [§2.8](atrib-spec.md#28-proof-bundle-format) proof bundle format if multi-log shape changes, ensure backwards compatibility with single-log bundles |
| Capability declarations changed ([D051](DECISIONS.md#d051-capability-scoped-records-via-directory-published-envelopes), [§6.7](atrib-spec.md#67-capability-declarations))  | Update `spec/conformance/6.7/` corpus, refresh `@atrib/cli publish-claim` to support `--capabilities`, update `@atrib/verify` envelope-check output, update directory-node to serve capabilities in lookup |
| Cross-attestation requirement changed ([D052](DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records), [§1.7.6](atrib-spec.md#176-cross-attestation-requirement-for-transaction-records)) | Update `spec/conformance/1.7.6/` corpus, refresh `@atrib/mcp` transaction signing path to emit `signers` array, update payment-protocol adapters in `@atrib/agent` to coordinate counterparty signature collection, update `@atrib/verify` multi-signature path |
| Adversarial threat model changed ([§8.7](atrib-spec.md#87-adversarial-threat-model)) | Update [§8.7](atrib-spec.md#87-adversarial-threat-model) trust-assessment stack table, refresh README + ARCHITECTURE positioning if framing changes, update `@atrib/verify` to surface new annotations from any new trust layer |
| Inclusion-proof aggregation formally added ([D053](DECISIONS.md#d053-inclusion-proof-aggregation-flagged-for-follow-up) → real ADR) | The placeholder [D053](DECISIONS.md#d053-inclusion-proof-aggregation-flagged-for-follow-up) entry is informative; once a formal ADR is written, replace [D053](DECISIONS.md#d053-inclusion-proof-aggregation-flagged-for-follow-up) with the new ADR (preserving the number for cross-reference history), update [§2.11](atrib-spec.md#211-cross-log-replication) or new §2.12 with normative content, write conformance corpus, refresh `@atrib/verify` |
| Explorer view changes ([D054](DECISIONS.md#d054-unified-public-explorer-vs-per-service-admin-uis)) | Update `apps/dashboard/index.html` (option 1) AND `apps/dashboard/README.md` if view list changes; verify `services/log-node/Dockerfile` still `COPY apps/dashboard/`; verify `Access-Control-Allow-Origin: *` still set on log-node, graph-node, directory-node read endpoints (CORS regression test in each `services/<name>/test/server.test.ts`); the canonical hosting URL is `https://explore.atrib.dev/` (host-based routing in log-node serves the dashboard at `/` when `Host=explore.atrib.dev`, falling back to `/dashboard` on log.atrib.dev) — keep both tests green; never add per-service inline admin HTML for any OTHER service; never repurpose `dashboard.atrib.dev` for this surface (that subdomain is reserved for the auth-gated personal dashboard product); never add a logged-in-user concept to the explorer. |
| event_type byte allocated ([D056](DECISIONS.md#d056-promote-directory_anchor-to-atrib-normative-event_type-byte-0x04) pattern) | Apply this checklist for any URI promoted from extension to atrib normative per [D036](DECISIONS.md#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary): write the ADR with explicit five-indicator evaluation; update [§1.2.4](atrib-spec.md#124-event_type-values) URI table (add row with byte assignment); update [§2.3.1](atrib-spec.md#231-entry-serialization) byte mapping table (add row, narrow reserved range); add `EVENT_TYPE_<NAME>_URI` constant in `packages/mcp/src/types.ts` AND include it in `NORMATIVE_EVENT_TYPE_URIS`; add `EVENT_TYPE_<NAME>` byte constant in `packages/mcp/src/entry.ts` + extend `eventTypeUriToByte` switch + update doc comment; extend `EventType` union in `packages/verify/src/types.ts` + add case in `graphLabelFromEventTypeUri`; extend log-node decoder switch in `services/log-node/src/server.ts` (label + stats counter + endpoint doc comment); add chip color rule in `apps/dashboard/index.html` (CSS variable + `.chip.event-<name>` rule); existing pre-promotion records (encoded `0xFF`) remain valid — verifiers wanting comprehensive queries filter by URI for the transition window, NOT by byte. |
| Revocation logic changed ([D033](DECISIONS.md#d033-key-rotation-and-revocation), [§1.9](atrib-spec.md#19-key-rotation-and-revocation)) | Update `packages/verify/src/revocations.ts` if the registry shape changes; regenerate `spec/conformance/1.9/cases/` via `pnpm --filter @atrib/log-dev exec tsx scripts/generate-conformance-1.9.ts`; verify `services/graph-node/src/server.ts` still passes the registry into `buildGraph` per request; the `x-atrib-log-index` header on log-node→graph-node fanout MUST be preserved — without it, graph-node has no log_index to compare against the revocation; `atrib revoke` CLI flags + dry-run output covered by `packages/cli/test/publish-claim-revoke.test.ts`. |
| Identity resolution changed ([§6.3](atrib-spec.md#63-verifier-consultation-algorithm)) | Update `packages/verify/src/resolve-identity.ts`; regenerate `spec/conformance/6/cases/` via `pnpm --filter @atrib/log-dev exec tsx scripts/generate-conformance-6.ts`; the IMPLEMENTATION-GAP warnings (steps 1, 3, 4, 5, 7) MUST stay visible in the output — when a step graduates from warning to actually-checked, remove the corresponding warning string AND set the corresponding output field (`anchor`, `lookup_proof_valid`, `append_only_consistent`) to a non-null value. The output schema is the contract; downstream consumers depend on null vs true to distinguish "not checked" from "checked + passed". |
| HSM/KMS profile added or modified ([D037](DECISIONS.md#d037-hsmkms-operator-profile)) | Update `packages/agent/src/keystore-<profile>.ts` (or wrapper-side equivalent); document operator runbook at `docs/operator/hsm-<profile>.md` (operator-internal first); the `keystore: 'callback'` middleware contract is normative and MUST NOT change without a coordinated wrapper update + ADR amendment. |
| Audit log format changed ([D039](DECISIONS.md#d039-audit-log-for-creator-key-access)) | Update `packages/mcp/src/audit.ts` (when implemented); preserve the JSONL line shape (ts, op, pid, ppid, node_v, creator_key, context_id, record_hash); operators with SIEM forwarding rely on the schema. NEVER log seed bytes or signature bytes — both are absent from the schema by design. |
| New CLI subcommand or option ([§5.6.1](atrib-spec.md#561-cli-subcommands)) | Update `packages/cli/src/cli.ts` HELP block AND `packages/cli/test/` covers each path; if the subcommand reads or writes the directory, document the `--directory URL` override default (`https://directory.atrib.dev/v6`) and note the `--key-file PATH` alternative to `--keychain` for non-macOS operators. |

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
- **Log entry:** 90 bytes fixed: version(1) + record_hash(32) + creator_key(32) + context_id(16) + timestamp_ms(8) + event_type(1). See [§2.3.1](atrib-spec.md#231-entry-serialization). event_type byte mapping: 0x01 tool_call, 0x02 transaction, 0x03 observation, 0x04 directory_anchor ([D056](DECISIONS.md#d056-promote-directory_anchor-to-atrib-normative-event_type-byte-0x04)), 0x05-0xFE reserved per [D036](DECISIONS.md#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary), 0xFF extension URI.
- **Proof bundle caching:** keyed by `record_hash`, not `context_id`. See [§5.3.5](atrib-spec.md#535-log-submission).
- **C2SP tlog-tiles ecosystem.** Checkpoints, tiles, signed notes, witnessing. Not a custom log format. See [§2](atrib-spec.md#2-merkle-log-protocol).
- **Seven edge types, deterministic derivation.** CHAIN_PRECEDES, SESSION_PRECEDES, SESSION_PARALLEL, CONVERGES_ON, CROSS_SESSION, INFORMED_BY ([D041](DECISIONS.md#d041-informed_by-linking-primitive-and-informed_by-edge-type)), PROVENANCE_OF ([D044](DECISIONS.md#d044-provenance_token-field-for-cross-session-causal-anchoring)). Two implementations on identical input must produce identical edge sets. See [§3.2.4](atrib-spec.md#324-edge-derivation-rules).
- **Provenance_token is the genesis-record-only stricter subset of informed_by.** Single-valued, scoped to session ancestry, truncated to 16 bytes for cross-session API ergonomics. Multi-valued / per-record consultation references use informed_by with full hashes. See [D044](DECISIONS.md#d044-provenance_token-field-for-cross-session-causal-anchoring) + [§1.2.6](atrib-spec.md#126-provenance_token).
- **Transaction records require ≥2 signers ([D052](DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records), [§1.7.6](atrib-spec.md#176-cross-attestation-requirement-for-transaction-records)).** The `signers` array carries both agent and counterparty signatures over the same canonical bytes. Single-signer transaction records are flagged `cross_attestation_missing: true` by [D052](DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records)-aware verifiers.
- **Cross-log replication is OPTIONAL ([D050](DECISIONS.md#d050-cross-log-replication-for-equivocation-defense), [§2.11](atrib-spec.md#211-cross-log-replication)).** Single-log bundles remain valid; multi-log bundles use the `log_proofs` array form. Verifier threshold M ≥ 2 with a trusted set of independent logs gives equivocation-detection.
- **Capability declarations are OPTIONAL ([D051](DECISIONS.md#d051-capability-scoped-records-via-directory-published-envelopes), [§6.7](atrib-spec.md#67-capability-declarations)).** Identity claims gain a `capabilities` field; verifiers flag out-of-envelope records with `in_envelope: false` but do not invalidate them (signal not block).
- **Adversarial threat model lives at [§8.7](atrib-spec.md#87-adversarial-threat-model).** atrib does NOT certify truth, only signing. Trust assessment is a 10-layer stack (signature, identity, capability, revocation, cross-attestation, tool-side attestation, external evidence, witnessing, cross-log replication, structural anomaly detection). See [§8.7](atrib-spec.md#87-adversarial-threat-model) for the full enumeration.
- **Edge weight uses max(), not sum().** Because every node has CONVERGES_ON plus its primary edge. Sum would inflate all structural contributors equally. See [§4.2.2](atrib-spec.md#422-edge-weights).

## V2 deferrals (do not implement)

- Per-conversation key derivation (deferred D038)
- Policy versioning (immutable snapshots)
- Log federation across operators
- Settlement webhook format
- Dispute mechanism
- Multi-transaction session handling
- Agent-published policies (empirical weighting models)
- DIF/C2PA interoperability profiles (see [§1.8](atrib-spec.md#18-scope-boundaries) Interoperability Roadmap)
- Zero-knowledge commitment schemes for args/result (Pedersen, KZG; [D045](DECISIONS.md#d045-privacy-postures-normative-spec-section) leaves the [§8.3](atrib-spec.md#83-salted-commitment-posture) extensibility shape open)

## Implementation conventions

### Monorepo

This is a TypeScript monorepo with **seven workspace packages** (five public: `@atrib/mcp`, `@atrib/agent`, `@atrib/verify`, `@atrib/cli`, `@atrib/directory`; two private: `@atrib/log-dev`, `@atrib/integration`) plus a Rust crate (`atrib-directory-bridge`, source-only; built artifacts ship inside `@atrib/directory`). Uses pnpm workspaces and turborepo for the TypeScript builds; the Rust bridge is built once via `wasm-pack` and the resulting WASM artifacts are checked into `packages/directory/wasm/`. Three deployable services: `services/log-node`, `services/graph-node`, `services/directory-node`.

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

### Framework adapter pattern (established by D018, D021, D022, D023, D024)

When adding support for a new MCP framework, the integration shape is determined by **source-reading the host framework first**, not by guessing from the dependency graph. Five integrations have shipped (`@modelcontextprotocol/sdk` raw client, Claude Agent SDK Cases A and B, Cloudflare Agents, Vercel AI SDK, LangChain JS) and every one had a different correct integration point that the source revealed. The general approach holds: one `atrib()` interceptor + one adapter helper per framework + identical observable behavior. The adapter helper signature varies because the host framework's surface varies; that variation is forced, not invented.

Each adapter ships with:

1. Source file at `packages/agent/src/adapters/<framework>.ts`
2. Test file at `packages/agent/test/<framework>.test.ts` covering at minimum: passthrough, `_meta` injection, no caller mutation, response flow, idempotency, and [§5.8](atrib-spec.md#58-degradation-contract) degradation
3. Runnable example at `packages/integration/examples/<framework>/` with both `README.md` and `integration.ts`
4. Entry in the unified adapter table in `packages/agent/README.md`
5. A `Dxxx` entry in `DECISIONS.md` documenting the integration-shape choice and the alternatives rejected
6. Adapter export from `packages/agent/src/index.ts`

### Protocol adapter pattern (established by D027)

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
