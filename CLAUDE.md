# atrib, Value Provenance Protocol

## What this is

atrib is value provenance infrastructure for the agent economy. It makes the economic relationships between AI agents, tools, content creators, and merchants verifiable without surveillance, the missing infrastructure layer between identity (DIF/W3C) and payment rails (ACP/UCP/x402/MPP).

The complete protocol specification is in `atrib-spec.md`. The implementation guide is in `internal planning doc`. The technical architecture overview is in `ARCHITECTURE.md`. Read the spec before making any implementation decisions.

## Repository structure

```
atrib/
  README.md                    # Public-facing project description (customer entry point)
  CLAUDE.md                    # THIS FILE, hub doc, conventions, invariants
  atrib-spec.md                # The single source of truth for the protocol
  internal planning doc    # Implementation guide with build order and package details
  DECISIONS.md                 # Architectural decision log (D001-D025+)
  ARCHITECTURE.md              # Technical architecture overview, trust model, protocol layers, design decisions
  PRIOR-ART.md                 # Prior art & standards map, every spec/protocol atrib builds on, organized by layer
  packages/
    mcp/                       # @atrib/mcp, MCP server middleware (public)
    agent/                     # @atrib/agent, Agent middleware + framework adapters (public)
    verify/                    # @atrib/verify, Merchant verification library (public)
    log-dev/                   # @atrib/log-dev, in-memory dev Merkle log stub (PRIVATE, dev only)
    integration/               # @atrib/integration, cross-package tests + runnable framework examples (private)
      examples/
        end-to-end/            # Runnable demo for customer walkthroughs (`pnpm demo`)
        claude-agent-sdk/      # Case A + Case B examples
        cloudflare-agents/     # McpAgent + Agent examples
        vercel-ai-sdk/         # createMCPClient + AI Gateway example
        langchain-js/          # MultiServerMCPClient + loadMcpTools example
  services/
    log/                       # FUTURE, Tessera-backed Merkle log (Go), placeholder README
    log-node/                  # Production Node.js Merkle log with real RFC 6962 proofs (private, not published)
  spec/
    conformance/
      2.6.1/                   # Shared §2.6.1 submission API conformance corpus (consumed by @atrib/log-dev today; future Go log tomorrow)
```

Public packages are intended for npm publication. Private packages (`log-dev`, `integration`) live in the workspace as fixtures and demos and have `private: true` in their `package.json` so they cannot be accidentally published.

## Hub doc

CLAUDE.md is the navigational center. The spec (`atrib-spec.md`) is the authoritative technical reference.

## Authoritative docs

| Doc                         | Responsible for                                                                                       |
| --------------------------- | ----------------------------------------------------------------------------------------------------- |
| `atrib-spec.md`             | Complete protocol specification, record format, Merkle log, graph model, policy format, SDK contract |
| `CLAUDE.md`                 | Project conventions, invariants, implementation guidance                                              |
| `ARCHITECTURE.md`           | Technical architecture overview, trust model, protocol layers, payment integration, design decisions |
| `internal planning doc` | Implementation guide, build order, package details, testing strategy, what not to build              |
| `DECISIONS.md`              | Architectural decision log, what was decided, why, what alternatives were considered                 |
| `PRIOR-ART.md`              | Every standard and protocol atrib builds on, extends, or hooks into, organized by layer              |

## Sync triggers

| Event                                 | Update                                                                                                                                                                                                           |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Protocol decision changed             | `atrib-spec.md` first, then `internal planning doc` if build guidance affected                                                                                                                               |
| Architectural decision made           | `DECISIONS.md`, new entry with date, context, decision, alternatives                                                                                                                                            |
| New package created                   | This file (repository structure) AND `README.md` (packages table)                                                                                                                                                |
| New framework adapter shipped         | `packages/agent/README.md` (adapter table + side-by-side quick-starts) AND `README.md` (top-level adapter table) AND `DECISIONS.md` (a Dxxx entry with the integration shape decision and rejected alternatives) |
| New runnable example added            | `packages/integration/README.md` AND a `README.md` inside the example directory                                                                                                                                  |
| Implementation convention established | This file (conventions section)                                                                                                                                                                                  |
| Wire-format or wire-protocol change   | `atrib-spec.md` (if normative), this file's "Key technical decisions" section, AND DECISIONS.md                                                                                                                  |
| §2.6.1 validation rule changed        | Regenerate `spec/conformance/2.6.1/` corpus via `pnpm --filter @atrib/log-dev corpus`, update `spec/conformance/2.6.1/README.md` if the format changed                                                           |
| Prior art landscape changed           | Update `PRIOR-ART.md` with new entries                                                                                                                                                                           |
| Test count changed materially         | `internal planning doc` build status table                                                                                                                                                                   |

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
- **JCS canonicalization (RFC 8785).** Lexicographic key ordering. No whitespace. `session_token` slots between `event_type` and `spec_version` alphabetically. See §1.3.
- **Token format:** `base64url(sha256(jcs(signed_record))) + "." + base64url(creator_key_bytes)`, 87 chars max, fits W3C tracestate limit. See §1.5.2.
- **Genesis chain_root:** `"sha256:" + hex(SHA-256(UTF-8(context_id)))`, not null, not random. See §1.2.3.
- **Log entry:** 90 bytes fixed, version(1) + record_hash(32) + creator_key(32) + context_id(16) + timestamp_ms(8) + event_type(1). See §2.3.1.
- **Proof bundle caching:** keyed by `record_hash`, not `context_id`. See §5.3.5.
- **C2SP tlog-tiles ecosystem.** Checkpoints, tiles, signed notes, witnessing. Not a custom log format. See §2.
- **Five edge types, deterministic derivation.** CHAIN_PRECEDES, SESSION_PRECEDES, SESSION_PARALLEL, CONVERGES_ON, CROSS_SESSION. Two implementations on identical input must produce identical edge sets. See §3.2.4.
- **Edge weight uses max(), not sum().** Because every node has CONVERGES_ON plus its primary edge. Sum would inflate all structural contributors equally. See §4.2.2.

## V2 deferrals (do not implement)

- Key rotation mechanism
- Policy versioning (immutable snapshots)
- Cross-session attribution via recommendation_token
- Log federation across operators
- Settlement webhook format
- Dispute mechanism
- Multi-transaction session handling
- Agent-published policies (empirical weighting models)
- DIF/C2PA interoperability profiles (see §1.8 Interoperability Roadmap)

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

The `@atrib/integration` package additionally has an `examples/` directory containing one runnable example per supported framework (excluded from `tsconfig` so examples typecheck against user-installed dependency versions, not the workspace build). New framework support always ships with both a unit test in `packages/agent/test/` and a runnable example in `packages/integration/examples/`.

### Framework adapter pattern (established by D018, D021, D022, D023, D024)

When adding support for a new MCP framework, the integration shape is determined by **source-reading the host framework first**, not by guessing from the dependency graph. Five integrations have shipped (`@modelcontextprotocol/sdk` raw client, Claude Agent SDK Cases A and B, Cloudflare Agents, Vercel AI SDK, LangChain JS) and every one had a different correct integration point that the source revealed. The general approach holds: one `atrib()` interceptor + one adapter helper per framework + identical observable behavior. The adapter helper signature varies because the host framework's surface varies, that variation is forced, not invented.

Each adapter ships with:

1. Source file at `packages/agent/src/adapters/<framework>.ts`
2. Test file at `packages/agent/test/<framework>.test.ts` covering at minimum: passthrough, `_meta` injection, no caller mutation, response flow, idempotency, and §5.8 degradation
3. Runnable example at `packages/integration/examples/<framework>/` with both `README.md` and `integration.ts`
4. Entry in the unified adapter table in `packages/agent/README.md`
5. A `Dxxx` entry in `DECISIONS.md` documenting the integration-shape choice and the alternatives rejected
6. Adapter export from `packages/agent/src/index.ts`

### Dependencies

- **Ed25519:** Use `@noble/ed25519`, pure JS, no native deps, audited.
- **JCS:** Use `canonicalize` npm package (RFC 8785 implementation).
- **SHA-256:** Use `@noble/hashes/sha2.js` (`sha256` named export). The earlier convention of "Web Crypto API with Node fallback" was simplified, `@noble/hashes` works in both runtimes without a fallback path and is already a dep.
- **MCP SDK:** `@modelcontextprotocol/sdk`, the official MCP TypeScript SDK. Note that `@ai-sdk/mcp` (Vercel) and the LangChain `MultiServerMCPClient` ship their own JSON-RPC implementations and are NOT structurally compatible with this SDK at the Client level, see D023 and D024 for the integration implications.
- **Framework dependencies (Vercel AI SDK, LangChain, Cloudflare Agents, Claude Agent SDK):** Never imported as hard dependencies of `@atrib/agent`. Adapters use structural typing against the host framework's public shape so users only pay the dependency cost of frameworks they actually use.

### Testing

Every normative MUST in the spec must have a corresponding test. The spec's test vectors (§1.4.4 Wycheproof) are mandatory. The calculation algorithm (§4.6) must have determinism tests, two runs on identical input must produce identical output.

### Code style

- TypeScript strict mode.
- No `any` types. The spec defines exact shapes, use them.
- Error handling follows the degradation contract (§5.8): catch everything, log with `atrib:` prefix, never throw to caller.
