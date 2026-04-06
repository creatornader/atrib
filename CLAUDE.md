# Atrib, Value Provenance Protocol

## What this is

Atrib is value provenance infrastructure for the agent economy. It makes the economic relationships between AI agents, tools, content creators, and merchants verifiable without surveillance, the missing infrastructure layer between identity (DIF/W3C) and payment rails (ACP/UCP/x402/MPP).

The complete protocol specification is in `atrib-spec.md`. The implementation guide is in `internal planning doc`. The founding design conversation is in `atrib-design-conversation.md`. Read the spec before making any implementation decisions.

## Repository structure

```
atrib/
  atrib-spec.md                # The single source of truth for the protocol
  internal planning doc    # Implementation guide with build order and package details
  atrib-design-conversation.md # Founding conversation (context, not authority)
  atrib-foundation.html        # Original §0 (HTML archive)
  atrib-section-[1-5].html     # Original §1-§5 (HTML archive)
  atrib-current-art-map.html   # Prior art research (HTML archive)
  packages/
    mcp/                       # @atrib/mcp, MCP server middleware
    agent/                     # @atrib/agent, Agent/MCP client middleware
    verify/                    # @atrib/verify, Merchant verification library
    integration/               # @atrib/integration, private cross-package end-to-end tests
```

## Hub doc

CLAUDE.md is the navigational center. The spec (`atrib-spec.md`) is the authoritative technical reference.

## Authoritative docs

| Doc | Responsible for |
|-----|----------------|
| `atrib-spec.md` | Complete protocol specification, record format, Merkle log, graph model, policy format, SDK contract |
| `CLAUDE.md` | Project conventions, invariants, implementation guidance |
| `internal planning doc` | Implementation guide, build order, package details, testing strategy, what not to build |
| `DECISIONS.md` | Architectural decision log, what was decided, why, what alternatives were considered |

## Sync triggers

| Event | Update |
|-------|--------|
| Protocol decision changed | `atrib-spec.md` first, then `internal planning doc` if build guidance affected |
| Architectural decision made | `DECISIONS.md`, new entry with date, context, decision, alternatives |
| New package created | This file (repository structure) |
| Implementation convention established | This file (conventions section) |

## Critical invariants (never violate)

These are non-negotiable. They come from the founding conversation and are the load-bearing design decisions.

1. **Atrib failures must never affect the primary tool call or agent response.** All exceptions caught. All network failures silent with retry. Pass-through mode if no key. This is §5.8 of the spec. No exceptions.

2. **The graph records structure, not causality.** Never add edge types based on semantic interpretation of tool names or response content. Edges are derived from observable record structure only. This is §3.1 of the spec.

3. **The calculation algorithm is a pure function.** Graph + policy = distribution. No network calls during calculation. No timestamps beyond those in the records. No randomness. Any party with the same inputs must get the same result. This is §4.6 of the spec.

4. **Transaction records are non-blocking.** Never `await` log submission before returning a response. Priority queue yes, synchronous no. This is §5.3.5 of the spec.

5. **session_token is optional and omitted (not null) when absent.** Its presence/absence changes the JCS canonical form and therefore the signature. This is §1.3 of the spec.

6. **Fact/policy separation is absolute.** The graph (§3) is a pure fact layer. The policy (§4) is where weights and distribution decisions live. Graph endpoints must never return weighted data. This is §3.6 of the spec.

7. **The protocol has no thumb on the scale.** Atrib does not decide what contributions are worth. Merchants and creators publish machine-readable policy documents. Agents negotiate them. The protocol provides the schema; the parties provide the values. This is §4.1 of the spec.

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

This is a TypeScript monorepo with three packages. Use pnpm workspaces and turborepo for builds.

### Package structure

Each package under `packages/` follows:
```
packages/<name>/
  src/
    index.ts          # Public API surface
  test/
    *.test.ts         # Tests
  package.json
  tsconfig.json
```

### Dependencies

- **Ed25519:** Use `@noble/ed25519`, pure JS, no native deps, audited.
- **JCS:** Use `canonicalize` npm package (RFC 8785 implementation).
- **SHA-256:** Use Web Crypto API (`crypto.subtle.digest`) with Node.js `crypto` fallback.
- **MCP SDK:** `@modelcontextprotocol/sdk`, the official MCP TypeScript SDK.

### Testing

Every normative MUST in the spec must have a corresponding test. The spec's test vectors (§1.4.4 Wycheproof) are mandatory. The calculation algorithm (§4.6) must have determinism tests, two runs on identical input must produce identical output.

### Code style

- TypeScript strict mode.
- No `any` types. The spec defines exact shapes, use them.
- Error handling follows the degradation contract (§5.8): catch everything, log with `atrib:` prefix, never throw to caller.
