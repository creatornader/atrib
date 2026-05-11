# atrib

**Verifiable agent actions.** Every action becomes signed context for the next.

atrib is the substrate behind agents that reason from a past they can prove. Every MCP tool call gets an Ed25519-signed record at the moment of action, committed to a public Merkle log, chained into the next call, independently verifiable by anyone. The agent gains a provable history; downstream consumers (merchants, auditors, other agents) gain a verifiable trail. One line of code to integrate.

## What this enables

The substrate is the load-bearing piece. The four uses below are downstream consequences, ordered by how directly each depends on the substrate's core property: signed-at-the-moment, verifiable-thereafter.

- **Provable cognition.** An agent reads its own prior records and reasons from them. Each record is a signed claim that re-verifies locally; the agent's continuity of self survives platform changes, model changes, and harness changes because the cryptography is independent of all of them. This is the dogfood thesis: agents that reason from a past they can prove.
- **Independent audit.** Any third party can verify what an agent did, in what order, with what causal structure. No trust in the agent operator, the platform, or any intermediary required. Compliance-coded products (audit trail, SOC 2, AI governance tooling) approximate this without the substrate; the substrate does it correctly.
- **Cross-agent provenance.** Tool calls chain forward through W3C trace context. Agents that hand off work to other agents carry verifiable causality across the handoff. The chain is the trust.
- **Settlement when commerce closes a chain.** A side effect of the substrate: the same signed record set is what a settlement document is computed from. The [§4.6](atrib-spec.md#46-the-calculation-algorithm) algorithm runs deterministically; any merchant or auditor can recompute and verify. This is real attribution-economy infrastructure, and it follows from the substrate rather than being its purpose.

## Substrate vs harness

atrib is the substrate. Consuming it well (surfacing an agent's history at session start, exposing recall tools the agent can call, persisting signed records locally for replay) is the job of an agent harness or runtime. atrib does not prescribe a harness. The substrate is independently useful to any harness (Claude Code, Cursor, custom agent products, in-house agent runtimes) that wants to give its agent the contextual awareness verifiable history makes possible.

## How it works

- Each record is signed by the actor's Ed25519 key and JCS-canonicalized
- A Merkle log stores commitments (hashes, not content) with RFC 6962 inclusion proofs and C2SP-canonical signed-note checkpoints
- Nine edge types connect actions into a graph: chain, session, parallel, convergence, cross-session sameness (session_token), agent-claimed informed_by ([D041](DECISIONS.md#d041-informed_by-linking-primitive-and-informed_by-edge-type)), cross-session causal anchor (provenance_token via PROVENANCE_OF, [D044](DECISIONS.md#d044-provenance_token-field-for-cross-session-causal-anchoring)), forward-pointing commentary on prior records (ANNOTATES, [D058](DECISIONS.md#d058-promote-annotation-to-atrib-normative-event_type-byte-0x05)), supersedure of a prior stance (REVISES, [D059](DECISIONS.md#d059-promote-revision-to-atrib-normative-event_type-byte-0x06))
- A pure-function calculation maps graph + policy to value distribution when commerce closes
- A public-key directory ([§6](atrib-spec.md#6-key-directory)) resolves opaque keys to identity claims; rotation and revocation are normative ([§1.9](atrib-spec.md#19-key-rotation-and-revocation)); identity claims may declare capability envelopes ([§6.7](atrib-spec.md#67-capability-declarations)) that verifiers check records against
- Transaction records require cross-attestation: at least 2 signers (agent + counterparty) per [§1.7.6](atrib-spec.md#176-cross-attestation-requirement-for-transaction-records)
- Cross-log replication ([§2.11](atrib-spec.md#211-cross-log-replication)) lets consumers submit records to multiple independent logs and detect equivocation
- Privacy is configurable per record ([§8](atrib-spec.md#8-privacy-postures) privacy postures): tool_name forms (verbatim, opaque, hashed), commitment schemes (plain, salted-sha256, hmac-sha256), timestamp granularity (ms through day)
- Adversarial threat model ([§8.7](atrib-spec.md#87-adversarial-threat-model)) enumerates the 10-layer trust assessment stack the substrate provides

No custom cryptography. No content exposure unless the harness opts in. No trust required.

## What atrib certifies, what it does not

atrib certifies five structural axes of agent activity: who acted (identity), what they did (event_type), when (timestamp), in what order (chain ordering), and what the agent claims informed each action (the `informed_by` and `provenance_token` fields, surfaced as INFORMED_BY and PROVENANCE_OF graph edges).

atrib does NOT certify that the agent's reasoning is truthful, that prior records actually influenced subsequent decisions, or that tool responses were real absent tool-side attestation. The substrate is content-preserving (commitments, not content) and disclosure-configurable: harnesses pick how much each record reveals via the privacy postures in spec [§8](atrib-spec.md#8-privacy-postures).

This positioning is load-bearing. See spec [§3](atrib-spec.md#3-graph-query-interface) "What atrib chains, what it does not" for the detailed enumeration and spec [§7.6](atrib-spec.md#76-outcome-verification-patterns) for the outcome-verification patterns that close the tool-response gap.

## Framework support

| Framework | Adapter | Status |
| --- | --- | --- |
| **Raw `@modelcontextprotocol/sdk`** | `wrapMcpClient(client, interceptor, { serverUrl? })` | ✅ Shipped |
| **Claude Agent SDK** (in-process, Case A) | Wrap `McpServer` with `atrib()` directly | ✅ Shipped |
| **Claude Agent SDK** (third-party, Case B) | `createAtribProxy({ upstream, interceptor })` | ✅ Shipped |
| **Cloudflare Agents** | `attributeCloudflareAgentMcp(agent, { interceptor, serverUrls })` | ✅ Shipped |
| **Vercel AI SDK MCP** | `attributeVercelAiSdkMcp(mcpClient, { interceptor, serverUrl })` | ✅ Shipped |
| **LangChain JS MCP** | `attributeLangchainMcp(multiClient, { interceptor, serverUrls })` | ✅ Shipped |
| OpenAI Agents SDK | Planned (different transport architecture) | ⏳ |
| Mastra | Planned (needs source verification) | ⏳ |

Side-by-side quick-starts for each framework: [`packages/agent/README.md`](packages/agent/README.md).

## Payment protocol detection

atrib detects transaction events from all six simultaneously. It does not move money or enforce transactions.

| Protocol | Sponsor | Detection signal | Spec ref |
| --- | --- | --- | --- |
| **ACP** | Stripe / OpenAI | `status === "completed"` + embedded `order` | [§1.7.1](atrib-spec.md#171-acp-agentic-commerce-protocol) |
| **UCP** | Google / Shopify | Same as ACP + `ucp.version` envelope | [§1.7.2](atrib-spec.md#172-ucp-universal-commerce-protocol) |
| **x402** | Coinbase | `PAYMENT-RESPONSE` HTTP header | [§1.7.3](atrib-spec.md#173-x402) |
| **MPP** | Tempo Labs / Stripe | `Payment-Receipt` HTTP header | [§1.7.4](atrib-spec.md#174-mpp-machine-payments-protocol) |
| **AP2** | Google | A2A DataPart with `PaymentMandate` | [§1.7.5](atrib-spec.md#175-ap2-and-a2a-x402) |
| **a2a-x402** | Google | A2A task metadata `payment-completed` | [§1.7.5](atrib-spec.md#175-ap2-and-a2a-x402) |

## Quick start

### Server side (tool creator)

```typescript
import { atrib } from '@atrib/mcp'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

const server = atrib(new McpServer({ name: 'my-tool', version: '1.0.0' }), {
  creatorKey: process.env.ATRIB_PRIVATE_KEY,
  serverUrl: 'https://my-tool.example.com',
})
```

One line. Every successful tool call emits a signed attribution record, propagates W3C trace context, and submits to the log asynchronously.

### Agent side (framework adapter)

`@atrib/agent` exports one interceptor plus a helper per framework. Setup is the same across all of them:

| Example | Path |
| --- | --- |
| Vercel AI SDK + AI Gateway | [`packages/integration/examples/vercel-ai-sdk/`](packages/integration/examples/vercel-ai-sdk/) |
| Claude Agent SDK (Case A + Case B) | [`packages/integration/examples/claude-agent-sdk/`](packages/integration/examples/claude-agent-sdk/) |
| Cloudflare Agents | [`packages/integration/examples/cloudflare-agents/`](packages/integration/examples/cloudflare-agents/) |
| LangChain JS | [`packages/integration/examples/langchain-js/`](packages/integration/examples/langchain-js/) |
| End-to-end demo | [`packages/integration/examples/end-to-end/`](packages/integration/examples/end-to-end/) |

### Merchant side (verification)

```typescript
import { AtribVerifier } from '@atrib/verify'

const verifier = new AtribVerifier({
  merchantKey: process.env.ATRIB_MERCHANT_KEY,
})

const result = await verifier.verify(recommendationDoc)
// { valid: true, signatureOk: true, calcMatch: true, distribution: {...} }
```

Verification re-runs the [§4.6](atrib-spec.md#46-the-calculation-algorithm) calculation locally and compares the result. No trust in any intermediary.

## Try the demo

```bash
ATRIB_PRIVATE_KEY=$(node -e 'console.log(Buffer.from(crypto.randomBytes(32)).toString("base64url"))') \
  pnpm --filter @atrib/integration demo
```

Runs a fake merchant, a fake agent, and a real Merkle log in a single process. The signatures, chain hashes, and transaction detection are production code. Only the surrounding environment is stubbed.

## Packages

| Package | What it does |
| --- | --- |
| [`@atrib/mcp`](packages/mcp/README.md) | Server middleware. Wraps an MCP server, emits signed records. |
| [`@atrib/agent`](packages/agent/README.md) | Agent middleware. Interceptor + framework adapters. |
| [`@atrib/verify`](packages/verify/README.md) | Merchant verification. Re-runs the calculation locally. |
| [`@atrib/cli`](packages/cli/README.md) | CLI: keygen, Keychain key management, identity-claim ops, key rotation and revocation. |
| [`@atrib/mcp-wrap`](packages/mcp-wrap/README.md) | Generic config-driven MCP wrapper. Multiplies coverage to any MCP server at zero per-server code cost. |
| [`@atrib/directory`](packages/directory/README.md) | AKD-backed identity-claim directory SDK. Bundles WASM artifacts from the Rust bridge. |
| [`@atrib/openinference`](packages/openinference/README.md) | OpenTelemetry SpanProcessor consuming OpenInference-shaped spans and emitting signed atrib records. Reference impl of spec [§9](atrib-spec.md#9-runtime-integration-patterns) Pattern #4; one adapter transitively covers every framework with OpenInference instrumentation. Not yet published to npm. |
| [`@atrib/emit`](services/atrib-emit/README.md) | Cognitive-primitive MCP server: signs observations, annotations, revisions the wrapper doesn't auto-capture. |
| [`@atrib/recall`](services/atrib-recall/README.md) | Cognitive-primitive MCP server: queries the local mirror for an agent's own past records. |
| [`@atrib/trace`](services/atrib-trace/README.md) | Cognitive-primitive MCP server: walks `informed_by` / `annotates` / `revises` edges backward to reconstruct causal chains. |
| [`@atrib/summarize`](services/atrib-summarize/README.md) | Cognitive-primitive MCP server: reads N records and synthesizes a narrative via an OpenAI-compatible LLM. |
| [`@atrib/log-dev`](packages/log-dev/README.md) | Dev-only in-memory log stub. Not for production. |
| [`@atrib/integration`](packages/integration/README.md) | Cross-package tests + runnable examples. |

> 1588 tests across all packages and services. Eleven designed-public packages: ten currently published to npm via Trusted Publishing OIDC (the six core packages `@atrib/mcp`, `@atrib/agent`, `@atrib/verify`, `@atrib/cli`, `@atrib/mcp-wrap`, `@atrib/directory` plus the four cognitive-primitive MCP servers `@atrib/emit`, `@atrib/recall`, `@atrib/trace`, `@atrib/summarize`); the eleventh, `@atrib/openinference`, is included in this repository as the reference implementation of [§9](atrib-spec.md#9-runtime-integration-patterns) Pattern #4 with all 10 OpenInference span kinds mapped (TOOL / LLM / AGENT / EMBEDDING / RETRIEVER / RERANKER / CHAIN / GUARDRAIL / EVALUATOR / PROMPT) and a composition pilot validated end-to-end against Vercel AI SDK v6 + NIM Qwen 3.5. Three production services: [`services/log-node/`](services/log-node/) (`https://log.atrib.dev/v1`), [`services/graph-node/`](services/graph-node/) (`https://graph.atrib.dev/v1`), [`services/directory-node/`](services/directory-node/) (`https://directory.atrib.dev/v6`). A reproducible end-to-end verifier with 13 gate assertions across 8 named categories (tree integrity, format conformance, checkpoint signature, pubkey-publication agreement, signer scope, attribution, record signature replay, chain integrity) ships at `services/log-node/scripts/verify-loop.mjs` and runs daily in CI against the deployed log. The public block explorer at [`https://explore.atrib.dev/`](https://explore.atrib.dev/) composes all three services into six views (overview, identity, session, action, trace, anchoring) - including a Sigma.js-rendered DAG for session and trace views. Four standalone in-process MCP services close the cognitive loop on the agent side: [`services/atrib-emit/`](services/atrib-emit/) signs observations/annotations/revisions the wrapper doesn't auto-capture; [`services/atrib-recall/`](services/atrib-recall/) queries the local mirror for an agent's own past records; [`services/atrib-trace/`](services/atrib-trace/) walks `informed_by` / `annotates` / `revises` edges backward through the local mirror to reconstruct causal chains; [`services/atrib-summarize/`](services/atrib-summarize/) reads N records and synthesizes a narrative via an OpenAI-compatible LLM. All four are stdio binaries that run in the agent's process and read the local mirror per spec [§5.9](atrib-spec.md#59-local-mirror-conventions).

**Implemented and deployed:** Record signing ([§1](atrib-spec.md#1-attribution-record-format)) including INFORMED_BY ([D041](DECISIONS.md#d041-informed_by-linking-primitive-and-informed_by-edge-type)), PROVENANCE_OF ([D044](DECISIONS.md#d044-provenance_token-field-for-cross-session-causal-anchoring)), ANNOTATES ([D058](DECISIONS.md#d058-promote-annotation-to-atrib-normative-event_type-byte-0x05)), REVISES ([D059](DECISIONS.md#d059-promote-revision-to-atrib-normative-event_type-byte-0x06)), and `directory_anchor` ([D056](DECISIONS.md#d056-promote-directory_anchor-to-atrib-normative-event_type-byte-0x04)) event types. Transparency log ([§2](atrib-spec.md#2-merkle-log-protocol)) with persistent storage and C2SP-canonical signed-note checkpoints ([D031](DECISIONS.md#d031-reconcile-243-signed-note-divergence-from-c2sp)). Graph query interface ([§3](atrib-spec.md#3-graph-query-interface)) with full nine-edge [§3.2.4](atrib-spec.md#324-edge-derivation-rules) derivation, plus the `/v1/trace/<record_hash>` and `/v1/creators/<key>/graph` query endpoints. Calculation algorithm ([§4.6](atrib-spec.md#46-the-calculation-algorithm)) with deterministic distribution and [§4.7](atrib-spec.md#47-settlement-recommendation-document) settlement document signing. AKD-backed public-key directory ([§6](atrib-spec.md#6-key-directory), [D034](DECISIONS.md#d034-public-key-directory-architecture-akd-unblinded-vrf-blinded-mode-available-for-downstream-consumers)) deployed at `https://directory.atrib.dev/v6` (unblinded mode for atrib's own use; VRF-blinded mode available for downstream consumers requiring privacy-preserving lookup). Per-operation directory anchoring back into the log ([§6.2.4](atrib-spec.md#624-anchor-cross-reference-into-the-tessera-log)). Key rotation and revocation ([§1.9](atrib-spec.md#19-key-rotation-and-revocation), [D033](DECISIONS.md#d033-key-rotation-and-revocation)): verifier honors revocations, `@atrib/cli` exposes `publish-claim` / `revoke` commands, conformance corpus generated. Capability declarations ([§6.7](atrib-spec.md#67-capability-declarations), [D051](DECISIONS.md#d051-capability-scoped-records-via-directory-published-envelopes)) surfaced by the verifier as soft signals per [§6.7.3](atrib-spec.md#673-signal-not-invalidation). Cross-attestation requirement on transaction records ([§1.7.6](atrib-spec.md#176-cross-attestation-requirement-for-transaction-records), [D052](DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records)) flagged by the verifier when missing. Privacy postures ([§8](atrib-spec.md#8-privacy-postures), [D045](DECISIONS.md#d045-privacy-postures-normative-spec-section)) with disclosure dials per record. Opt-in autoChain plus a cross-producer chain-tail handoff via `ATRIB_CHAIN_TAIL_<context_id>` env var for hosts that don't propagate atrib's outbound token.

**Spec-defined but not implemented:** Witnessing ([§2.9](atrib-spec.md#29-witnessing-and-cosignatures), [D032](DECISIONS.md#d032-witnessing-posture-for-v1-spec-defined-no-implementation); first implementation deferred until an independent verifier exists). Cross-log replication ([§2.11](atrib-spec.md#211-cross-log-replication), [D050](DECISIONS.md#d050-cross-log-replication-for-equivocation-defense); spec-defined; second log-node deployment + verifier multi-log proof bundles forthcoming). [§6.3](atrib-spec.md#63-verifier-consultation-algorithm) verifier consultation steps 1, 3, 4, 5, 7 (anchor + lookup-proof + append-only + emergency-key paths; AKD WASM bridge upstream gating).

## Key generation

```bash
node -e 'console.log(Buffer.from(crypto.randomBytes(32)).toString("base64url"))'
```

Store the output as `ATRIB_PRIVATE_KEY`. The public key is derived at runtime.

## Specification

[`atrib-spec.md`](./atrib-spec.md) covers:

- **[§0](atrib-spec.md#0-foundations):** Foundations
- **[§1](atrib-spec.md#1-attribution-record-format):** Attribution record format, signing, propagation, payment protocol hooks
- **[§1.9](atrib-spec.md#19-key-rotation-and-revocation):** Key rotation and revocation ([D033](DECISIONS.md#d033-key-rotation-and-revocation))
- **[§2](atrib-spec.md#2-merkle-log-protocol):** Merkle log protocol (C2SP tlog-tiles, proofs, witnessing)
- **[§3](atrib-spec.md#3-graph-query-interface):** Graph query interface (nine edge types)
- **[§4](atrib-spec.md#4-attribution-policy-format):** Policy format, negotiation, calculation algorithm
- **[§5](atrib-spec.md#5-sdk-specification):** SDK contract, automation, degradation guarantees
- **[§6](atrib-spec.md#6-key-directory):** Public-key directory (AKD-based; [D034](DECISIONS.md#d034-public-key-directory-architecture-akd-unblinded-vrf-blinded-mode-available-for-downstream-consumers))
- **[§7](atrib-spec.md#7-harness-integration-patterns):** Harness integration patterns (informative)
- **[§8](atrib-spec.md#8-privacy-postures):** Privacy postures ([D045](DECISIONS.md#d045-privacy-postures-normative-spec-section); per-record disclosure dials)
- **[§9](atrib-spec.md#9-runtime-integration-patterns):** Runtime integration patterns (informative; six first-class peer patterns per [D069](DECISIONS.md#d069-runtime-integration-patterns--first-class-peers-no-canonical-path))

## Design principles

1. **Provenance travels with the artifact.** Embedded at creation, not inferred later.
2. **Accountability without content exposure.** The log stores hashes, not content.
3. **Settlement is separate from attribution.** The protocol records what happened. It does not move money.
4. **No central arbiter of value.** Trust from math and open spec, not from trusting atrib.
5. **The protocol is open. The product is commercial.** Spec, signing libraries, calculation algorithm, and log software are open. Anyone can self-host. atrib operates a hosted service as a commercial product built on the open protocol.

## More

- [Policy templates and guide](policies/README.md)
- [Architecture and trust model](ARCHITECTURE.md)
- [Prior art and standards map](PRIOR-ART.md)
- [Decision log](DECISIONS.md)
- [Contributing](CONTRIBUTING.md)

## License

Apache 2.0
