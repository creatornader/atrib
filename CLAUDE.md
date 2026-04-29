# atrib: the protocol for verifiable agent actions

## What this is

atrib makes the actions an AI agent takes provable. Every MCP tool call becomes a signed, chain-linked record committed to a public Merkle log; downstream consumers (the agent itself, merchants, auditors, other agents) can independently verify what happened without trusting any operator. The substrate enables several use cases: provable recall by the agent, independent audit by third parties, settlement when commerce closes a chain, and verifiable causality across agent handoffs. atrib is the layer between identity (DIF/W3C) and payment rails (ACP/UCP/x402/MPP), but more fundamentally, it's the layer that makes any post-hoc claim about agent activity provable.

The canonical positioning used across the README, spec abstract, and per-package READMEs:

- **Headline:** Verifiable agent actions.
- **Sub-line:** Every tool call becomes signed context for the next.
- **Tagline:** Agents that reason from a past they can prove.

Use this language in any new docs or commit messages that need a one-line description of the project. Don't reword it without an accompanying change to the README and spec.

The complete protocol specification is in `atrib-spec.md` (§0-§7). The technical architecture overview is in `ARCHITECTURE.md`. Read the spec before making any implementation decisions.

## Repository structure

```
atrib/
  README.md                    # Public-facing project description (customer entry point)
  CLAUDE.md                    # THIS FILE: hub doc, conventions, invariants
  atrib-spec.md                # The single source of truth for the protocol
  DECISIONS.md                 # Architectural decision log (D001-D036+)
  ARCHITECTURE.md              # Technical architecture overview: trust model, protocol layers, design decisions
  PRIOR-ART.md                 # Prior art & standards map: every spec/protocol atrib builds on, organized by layer
  METRICS.md                   # Tiered metrics framework + lifecycle states + quarterly evolution review for the dogfood experiment
  metrics/                     # Dated JSON snapshots from `pnpm --filter @atrib/log-node metrics`
  packages/
    mcp/                       # @atrib/mcp: MCP server middleware (public)
    agent/                     # @atrib/agent: Agent middleware + framework adapters (public)
    verify/                    # @atrib/verify: Verifier library (record verification, §4.6 calc, settlement) (public)
    cli/                       # @atrib/cli: keygen + Keychain key management (public)
    log-dev/                   # @atrib/log-dev: in-memory dev Merkle log stub (PRIVATE, dev only)
    integration/               # @atrib/integration: cross-package tests + runnable framework examples (private)
      examples/
        end-to-end/            # Runnable demo for customer walkthroughs (`pnpm demo`)
        claude-agent-sdk/      # Case A + Case B examples
        cloudflare-agents/     # McpAgent + Agent examples
        vercel-ai-sdk/         # createMCPClient + AI Gateway example
        langchain-js/          # MultiServerMCPClient + loadMcpTools example
  policies/                     # Attribution policy templates and guide (6 templates + README)
  services/
    log/                       # FUTURE: Tessera-backed Merkle log (Go), placeholder README
    log-node/                  # Production Node.js Merkle log with real RFC 6962 proofs. Deployed at https://log.atrib.dev/v1 with persistent Fly volume + C2SP-canonical signed-note checkpoints. Includes scripts/verify-loop.mjs (13-gate dogfood verifier), scripts/chain-demo.mjs, scripts/multi-agent-demo.mjs, scripts/metrics.mjs.
    graph-node/                # Production Node.js graph query service. Implements §3.2.4 derivation. Deployed at https://graph.atrib.dev/v1.
  spec/
    conformance/
      1.4/                     # Signing conformance corpus (test vectors for §1.4)
      1.9/                     # Key rotation/revocation conformance corpus (test vectors for §1.9, D033). Skeleton; fixtures land in an upcoming implementation phase.
      2.6.1/                   # Submission API conformance corpus (consumed by @atrib/log-dev and log-node)
      4.6/                     # Calculation conformance corpus (test vectors for §4.6)
      6/                       # Public-key directory conformance corpus (test vectors for §6, D034). Skeleton; fixtures land alongside the directory implementation.
```

Public packages are intended for npm publication. Private packages (`log-dev`, `integration`) live in the workspace as fixtures and demos and have `private: true` in their `package.json` so they cannot be accidentally published.

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
| §2.6.1 validation rule changed        | Regenerate `spec/conformance/2.6.1/` corpus via `pnpm --filter @atrib/log-dev corpus`, update `spec/conformance/2.6.1/README.md` if the format changed                                                           |
| §1.9 rotation/revocation logic touched | Update `spec/conformance/1.9/` corpus if generated, update `spec/conformance/1.9/README.md` case list if added/removed, regression-test in `@atrib/verify` and `services/graph-node`                              |
| §6 directory operation added           | Update `spec/conformance/6/` corpus if generated, update `spec/conformance/6/README.md` case list, ensure unblinded mode (atrib's primary use) still passes, refresh `@atrib/directory` SDK docs                  |
| Positioning / framing change           | The canonical positioning at the top of this file is the reference. If it changes, update the top of `README.md`, the abstract of `atrib-spec.md`, the lead paragraph of every per-package README, and the GitHub repo description in lockstep. |
| Prior art landscape changed           | Update `PRIOR-ART.md` with new entries                                                                                                                                                                           |
| Test count changed materially         | `README.md` and `CONTRIBUTING.md` test count references                                                                                                                                                          |
| Metric added/removed/promoted/demoted | `METRICS.md` (table entry + lifecycle status) AND `services/log-node/scripts/metrics.mjs` (`METRICS` array: `name`, `tier`, `status`, `decisionSupported`, `run`). Both must agree.                              |
| New deployed service                  | This file (repository structure) AND `README.md` (deployed-service URL note) AND `ARCHITECTURE.md` (operator footprint) AND `services/<name>/fly.toml` if Fly-deployed                                            |
| `informed_by` field semantics changed (D041) | Update `spec/conformance/3.2.4/informed-by/` corpus, regenerate INFORMED_BY edge derivation tests, refresh `@atrib/verify` informed_by_resolution surfacing                                                  |
| `provenance_token` field semantics changed (D044) | Update `spec/conformance/3.2.4/provenance/` corpus, regenerate PROVENANCE_OF edge derivation tests, refresh `@atrib/verify` provenance_chain surfacing, audit the `provenance_token` derivation invariant (`base64url(sha256(jcs(U))[:16]) == T`) |
| Privacy posture spec section §8 changed (D045) | Update `spec/conformance/8/` corpus per posture, refresh `@atrib/verify` posture detection logic, update §7.5 posture-selection guidance |
| Edge type added/removed (§3.2.3 + §3.2.4)     | Update §3 lead-in count, update §3.2.1 participation matrix, update CLAUDE.md "Key technical decisions" edge type list, update `services/graph-node` derivation, update `@atrib/verify` calculation if contributing-set affected |
| Adapter conformance contract changed (D048) | Refresh `packages/agent/test/conformance.test.ts`, update `packages/agent/README.md` adapter table, update `packages/agent/CONTRIBUTING.md` adapter authoring guide |
| Layered leak defense updated (D049)            | Update prose style guide, refresh `scripts/check-leaks.mjs` and `scripts/check-leaks-semantic.mjs`, update cloud audit routine with new patterns |
| Cross-log replication semantics changed (D050, §2.11) | Update `spec/conformance/2.11/` corpus, refresh `@atrib/verify` cross-log proof verification, update §2.8 proof bundle format if multi-log shape changes, ensure backwards compatibility with single-log bundles |
| Capability declarations changed (D051, §6.7)  | Update `spec/conformance/6.7/` corpus, refresh `@atrib/cli publish-claim` to support `--capabilities`, update `@atrib/verify` envelope-check output, update directory-node to serve capabilities in lookup |
| Cross-attestation requirement changed (D052, §1.7.6) | Update `spec/conformance/1.7.6/` corpus, refresh `@atrib/mcp` transaction signing path to emit `signers` array, update payment-protocol adapters in `@atrib/agent` to coordinate counterparty signature collection, update `@atrib/verify` multi-signature path |
| Adversarial threat model changed (§8.7) | Update §8.7 trust-assessment stack table, refresh README + ARCHITECTURE positioning if framing changes, update `@atrib/verify` to surface new annotations from any new trust layer |
| Inclusion-proof aggregation formally added (D053 → real ADR) | The placeholder D053 entry is informative; once a formal ADR is written, replace D053 with the new ADR (preserving the number for cross-reference history), update §2.11 or new §2.12 with normative content, write conformance corpus, refresh `@atrib/verify` |

## Critical invariants (never violate)

These are non-negotiable. They come from the founding conversation and are the load-bearing design decisions.

1. **atrib failures must never affect the primary tool call or agent response.** All exceptions caught. All network failures silent with retry. Pass-through mode if no key. This is §5.8 of the spec. No exceptions.

2. **The graph records structure, not causality.** Never add edge types based on semantic interpretation of tool names or response content. Edges are derived from observable record structure only. This is §3.1 of the spec.

3. **The calculation algorithm is a pure function.** Graph + policy = distribution. No network calls during calculation. No timestamps beyond those in the records. No randomness. Any party with the same inputs must get the same result. This is §4.6 of the spec.

4. **Transaction records are non-blocking.** Never `await` log submission before returning a response. Priority queue yes, synchronous no. This is §5.3.5 of the spec.

5. **session_token is optional and omitted (not null) when absent.** Its presence/absence changes the JCS canonical form and therefore the signature. This is §1.3 of the spec.

6. **Fact/policy separation is absolute.** The graph (§3) is a pure fact layer. The policy (§4) is where weights and distribution decisions live. Graph endpoints must never return weighted data. This is §3.6 of the spec.

7. **The protocol has no thumb on the scale.** atrib does not decide what contributions are worth. Merchants and creators publish machine-readable policy documents. Agents negotiate them. The protocol provides the schema; the parties provide the values. This is §4.1 of the spec.

## Key technical decisions (preserve exactly)

- **Ed25519, 32-byte seed.** Not 64-byte NaCl format. Not DIDs. Simple, fast, no PKI. See §1.4.1.
- **JCS canonicalization (RFC 8785).** Lexicographic key ordering. No whitespace. New optional fields slot lexicographically: `informed_by` after `event_type` (i > e), `provenance_token` after `informed_by` (p > i) and before `session_token` (p < s). Presence/absence of any optional field affects the signature. See §1.3 + D041 + D044.
- **Token format:** `base64url(sha256(jcs(signed_record))) + "." + base64url(creator_key_bytes)`. 87 chars max, fits W3C tracestate limit. See §1.5.2.
- **Genesis chain_root:** `"sha256:" + hex(SHA-256(UTF-8(context_id)))`. Not null, not random. See §1.2.3.
- **Log entry:** 90 bytes fixed: version(1) + record_hash(32) + creator_key(32) + context_id(16) + timestamp_ms(8) + event_type(1). See §2.3.1.
- **Proof bundle caching:** keyed by `record_hash`, not `context_id`. See §5.3.5.
- **C2SP tlog-tiles ecosystem.** Checkpoints, tiles, signed notes, witnessing. Not a custom log format. See §2.
- **Seven edge types, deterministic derivation.** CHAIN_PRECEDES, SESSION_PRECEDES, SESSION_PARALLEL, CONVERGES_ON, CROSS_SESSION, INFORMED_BY (D041), PROVENANCE_OF (D044). Two implementations on identical input must produce identical edge sets. See §3.2.4.
- **Provenance_token is the genesis-record-only stricter subset of informed_by.** Single-valued, scoped to session ancestry, truncated to 16 bytes for cross-session API ergonomics. Multi-valued / per-record consultation references use informed_by with full hashes. See D044 + §1.2.6.
- **Transaction records require ≥2 signers (D052, §1.7.6).** The `signers` array carries both agent and counterparty signatures over the same canonical bytes. Single-signer transaction records are flagged `cross_attestation_missing: true` by D052-aware verifiers.
- **Cross-log replication is OPTIONAL (D050, §2.11).** Single-log bundles remain valid; multi-log bundles use the `log_proofs` array form. Verifier threshold M ≥ 2 with a trusted set of independent logs gives equivocation-detection.
- **Capability declarations are OPTIONAL (D051, §6.7).** Identity claims gain a `capabilities` field; verifiers flag out-of-envelope records with `in_envelope: false` but do not invalidate them (signal not block).
- **Adversarial threat model lives at §8.7.** atrib does NOT certify truth, only signing. Trust assessment is a 10-layer stack (signature, identity, capability, revocation, cross-attestation, tool-side attestation, external evidence, witnessing, cross-log replication, structural anomaly detection). See §8.7 for the full enumeration.
- **Edge weight uses max(), not sum().** Because every node has CONVERGES_ON plus its primary edge. Sum would inflate all structural contributors equally. See §4.2.2.

## V2 deferrals (do not implement)

- Per-conversation key derivation (deferred D038)
- Policy versioning (immutable snapshots)
- Log federation across operators
- Settlement webhook format
- Dispute mechanism
- Multi-transaction session handling
- Agent-published policies (empirical weighting models)
- DIF/C2PA interoperability profiles (see §1.8 Interoperability Roadmap)
- Zero-knowledge commitment schemes for args/result (Pedersen, KZG; D045 leaves the §8.3 extensibility shape open)

## Implementation conventions

### Monorepo

This is a TypeScript monorepo with **five workspace packages** (three public, two private). Uses pnpm workspaces and turborepo for builds.

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
2. Test file at `packages/agent/test/<framework>.test.ts` covering at minimum: passthrough, `_meta` injection, no caller mutation, response flow, idempotency, and §5.8 degradation
3. Runnable example at `packages/integration/examples/<framework>/` with both `README.md` and `integration.ts`
4. Entry in the unified adapter table in `packages/agent/README.md`
5. A `Dxxx` entry in `DECISIONS.md` documenting the integration-shape choice and the alternatives rejected
6. Adapter export from `packages/agent/src/index.ts`

### Protocol adapter pattern (established by D027)

Distinct from (and orthogonal to) framework adapters. Framework adapters hook atrib INTO a host agent framework at runtime (`@atrib/agent` + host). Protocol adapters provide observability FOR a specific payment protocol's ecosystem, independent of any single agent session.

Each protocol adapter has three canonical layers: **registry** (versioned source of truth for the protocol's on-chain actors), **scanner** (ecosystem-level volume aggregation via Dune / HyperSync / RPC), and **attribution** (maps scanned senders to registry actors, surfaces unattributed residual). The spec stays protocol-agnostic; protocol-specific attribution rationale lives in the adapter's docs per §3.6 fact/policy separation.

Two observation surfaces compose cleanly per protocol: runtime (via `@atrib/agent` + framework adapter) and retrospective (via protocol adapter scanner). A complete per-protocol artifact demonstrates both: Path A (retrospective, exercises §3 + §4) plus Path B (a reference agent using `@atrib/agent` to make real payments with signed receipts flowing through the log to merchant-side verify, exercises §1, §2.6.1, §5).

Protocol-adapter implementations do not live in this repo yet. The first (`x402`) is being validated outside the public tree and will move to `packages/x402/` or `services/x402-scanner/` on public release. See ARCHITECTURE.md "Protocol adapters" section and D027 for the architectural rationale.

Future protocol adapters (ACP, UCP, AP2, MPP) follow the same template.

### Dependencies

- **Ed25519:** Use `@noble/ed25519`. Pure JS, no native deps, audited.
- **JCS:** Use `canonicalize` npm package (RFC 8785 implementation).
- **SHA-256:** Use `@noble/hashes/sha2.js` (`sha256` named export). The earlier convention of "Web Crypto API with Node fallback" was simplified; `@noble/hashes` works in both runtimes without a fallback path and is already a dep.
- **MCP SDK:** `@modelcontextprotocol/sdk`, the official MCP TypeScript SDK. Note that `@ai-sdk/mcp` (Vercel) and the LangChain `MultiServerMCPClient` ship their own JSON-RPC implementations and are NOT structurally compatible with this SDK at the Client level; see D023 and D024 for the integration implications.
- **Framework dependencies (Vercel AI SDK, LangChain, Cloudflare Agents, Claude Agent SDK):** Never imported as hard dependencies of `@atrib/agent`. Adapters use structural typing against the host framework's public shape so users only pay the dependency cost of frameworks they actually use.

### Testing

Every normative MUST in the spec must have a corresponding test. The spec's test vectors (§1.4.4 Wycheproof) are mandatory. The calculation algorithm (§4.6) must have determinism tests: two runs on identical input must produce identical output.

### Code style

- TypeScript strict mode.
- No `any` types. The spec defines exact shapes; use them.
- Error handling follows the degradation contract (§5.8): catch everything, log with `atrib:` prefix, never throw to caller.
