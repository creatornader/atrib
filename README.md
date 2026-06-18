# atrib

**Verifiable agent actions.** Every action becomes signed context for the next.

Agent work moves through tools, memory, identity, authorization, observability,
evals, handoffs, and payments. Those layers should stay specialized. atrib gives
them a common record to verify: signed actions, attached evidence, and graph
structure that can cross agents, organizations, and protocols.

Shared memory and context systems decide what an agent should remember or
retrieve. atrib signs the agent's action trail, then lets memory systems,
auditors, payment rails, and other agents cite that same verifiable record
without trusting the runtime that stored it.

The graph is one graph with two reading planes. The chronology plane preserves
event history and continuity. The declared-relationship plane preserves signed
claims about which records informed, anchored, annotated, or revised other
records. The explorer's primary trace path gives readers one first path through
that graph without flattening the graph itself.

## What this enables

Everything below depends on one substrate property: an action is signed when it
happens and remains verifiable later.

| Surface                                 | What atrib gives you                                                                                                                                                                                                                                                         | What it composes with                                                              |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Verifiable agent work                   | A signed trail of the actions, evidence, handoffs, revisions, outputs, and verifier results behind a task. atrib proves the action history; other layers decide whether the work was authorized, correct, payable, or compliant.                                             | Tools, memory, identity, authorization, observability, evals, commerce, governance |
| Provable cognition                      | An agent can read prior records and re-verify them locally. Its continuity can survive platform, model, and harness changes because the cryptography is independent.                                                                                                         | Memory systems, shared context layers, recall tools                                |
| Privacy-preserving evidence             | The public log stores commitments, not private work product. Verifiers can check signatures, hashes, inclusion proofs, and selected evidence without dumping tool arguments, tool results, memory text, authorization material, or workflow context into the public payload. | Local mirrors, sidecars, opt-in archive evidence, private evidence stores          |
| Independent audit                       | A third party can verify what an agent did, in what order, and with what signed structure without trusting the agent operator, platform, or intermediary.                                                                                                                    | Audit trails, SOC 2 evidence, AI governance tooling, incident review               |
| Verifiable evals                        | A harness can link task setup, tool calls, verifier checks, diagnostic outcomes, and scorer output through `informed_by`, then publish the result as evidence another team can replay.                                                                                       | Eval harnesses, benchmark reports, inspection tools                                |
| Cross-agent provenance                  | Agents that hand off work to subagents carry session scope, chain tail, and parent dispatch refs together. Receiving agents can verify the handoff before signing follow-up work.                                                                                            | A2A, agent bridges, orchestrators, subagent runtimes                               |
| Verifiable investigations               | Support, incident, billing, and RCA agents can sign the investigation trail: ticket intake, tenant-scoped log queries, code-path reads, hypotheses, diagnostics, revisions, and human handoffs.                                                                              | Observability tools, logs, traces, support systems                                 |
| Settlement when commerce closes a chain | The same signed record set can feed a deterministic settlement document under an agreed policy. Any merchant or auditor can recompute the [§4.6](atrib-spec.md#46-the-calculation-algorithm) result.                                                                         | AP2, Verifiable Intent, x402, ACP, merchant policies                               |

## Substrate vs harness

atrib is the substrate. Consuming it well (surfacing an agent's history at session start, exposing recall tools the agent can call, persisting signed records locally for replay) is the job of an agent harness or runtime. atrib does not prescribe a harness. The substrate is independently useful to any harness (Claude Code, Cursor, custom agent products, in-house agent runtimes) that wants to give its agent the contextual awareness verifiable history makes possible.

Hard boundary: the public Merkle log proves a commitment, but it is not enough context for a future agent to continue the work. A continuation agent needs Tier 2 and Tier 3 material: canonical record bodies or archive references, redacted evidence references, skill pack identities and hashes, the latest chain tail, parent dispatch anchors for subagent work, and provenance anchors. Without those, it can prove a record existed but still has to guess what happened.

One canonical harness pattern is signed diagnostic outcome + trace replay: sign the action, sign the diagnostic outcome that evaluates it with `informed_by` back to the action, then let the next repair step call `atrib-trace` from the diagnostic record. This keeps "what happened" and "what it supersedes" in one verifiable path without requiring a whole-session transcript dump.

Derived evidence products sit above the protocol. A harness can build a prior-work packet, suspect report, or eval summary from signed records, body commitments, verifier checks, and inclusion proofs. Those products can decide which records are useful for a task, which stale records to avoid, and which risks remain open. They do not change the record format, the graph derivation rules, or the seven cognitive primitives.

## How it works

- Each record is signed by the actor's Ed25519 key and JCS-canonicalized
- A Merkle log stores commitments (hashes, not content) with RFC 6962 inclusion proofs and C2SP-canonical signed-note checkpoints
- Nine deterministic edge types connect actions into one graph with two reading
  planes: chronology edges (`CHAIN_PRECEDES`, `SESSION_PRECEDES`,
  `SESSION_PARALLEL`, `CROSS_SESSION`, `CONVERGES_ON`) and
  declared-relationship edges (`INFORMED_BY`, `PROVENANCE_OF`, `ANNOTATES`,
  `REVISES`)
- The explorer's primary trace path composes `/v1/trace` and `/v1/chain` for
  readability without adding a new graph edge, validity rule, or settlement
  input ([D118](DECISIONS.md#d118-primary-trace-path-is-a-presentation-rule-over-trace-and-chain))
- A pure-function calculation maps graph + policy to value distribution when commerce closes
- A public-key directory ([§6](atrib-spec.md#6-key-directory)) resolves opaque keys to identity claims; rotation and revocation are normative ([§1.9](atrib-spec.md#19-key-rotation-and-revocation)); identity claims may declare capability envelopes ([§6.7](atrib-spec.md#67-capability-declarations)) that verifiers check records against
- Transaction records require cross-attestation: at least 2 distinct verified signer keys (agent + counterparty) per [§1.7.6](atrib-spec.md#176-cross-attestation-requirement-for-transaction-records)
- Cross-log replication ([§2.11](atrib-spec.md#211-cross-log-replication)) lets consumers submit records to multiple independent logs and detect equivocation
- Privacy is configurable per record ([§8](atrib-spec.md#8-privacy-postures) privacy postures): tool_name forms (verbatim, opaque, hashed), commitment schemes (plain, salted-sha256, hmac-sha256), timestamp granularity (ms through day)
- Adversarial threat model ([§8.7](atrib-spec.md#87-adversarial-threat-model)) enumerates the 10-layer trust assessment stack the substrate provides

No custom cryptography. No content exposure unless the harness opts in. No trust required.

## Try the demo

One command, no setup beyond cloning. Generates a fresh key, spins up an in-process Merkle log, fake merchant, and fake agent, runs two tool calls plus one transaction, and prints what landed in the log.

```bash
ATRIB_PRIVATE_KEY=$(node -e 'console.log(Buffer.from(crypto.randomBytes(32)).toString("base64url"))') \
  pnpm --filter @atrib/integration demo
```

Expected output:

```
[demo] starting dev log...
[demo] dev log running at http://127.0.0.1:58958
[demo] starting merchant tool server (fake search API)...
[demo] starting agent client...
[demo] agent connected to merchant

[demo] step 1: agent calls 'search' for the first time (genesis)
[log] +tool_call   ctx=7f71199d… chain=sha256:064692c27… idx=0

[demo] step 2: agent calls 'search' again (chained from step 1)
[log] +tool_call   ctx=7f71199d… chain=sha256:381c22ac6… idx=1

[demo] step 3: agent observes a fake x402 payment receipt
[log] +transaction ctx=7f71199d… chain=sha256:96ac3e962… idx=2

[demo] final state
[demo] 3 records in the log
[demo]   2 tool_call records
[demo]   1 transaction record
[demo] chain length: 3
[demo] done.
```

The signatures, chain hashes, and transaction detection are production code. Only the surrounding environment (merchant, agent, network) is stubbed.

## Quick start

Now that you've seen the demo, pick the install path that matches what you're doing:

- Sign tool calls your MCP server handles: `@atrib/mcp` ([below](#sign-tool-calls-your-mcp-server))
- Sign tool calls your agent makes: `@atrib/agent` ([below](#sign-tool-calls-your-agent))
- Verify records someone else produced: `@atrib/verify` ([below](#verify-records-any-third-party))

### Sign tool calls (your MCP server)

```typescript
import { atrib } from '@atrib/mcp'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

const server = atrib(new McpServer({ name: 'my-tool', version: '1.0.0' }), {
  creatorKey: process.env.ATRIB_PRIVATE_KEY,
  serverUrl: 'https://my-tool.example.com',
})
```

One line. Every successful tool call emits a signed attribution record, propagates W3C trace context, and submits to the log asynchronously.

### Sign tool calls (your agent)

`@atrib/agent` exports one interceptor plus a helper per framework. Some runtime
examples use the host's native callback surface while keeping the same
hash-only record shape. Start with the row matching your stack:

| Example                            | Path                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vercel AI SDK + AI Gateway         | [`packages/integration/examples/vercel-ai-sdk/`](packages/integration/examples/vercel-ai-sdk/)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Claude Agent SDK (Case A + Case B) | [`packages/integration/examples/claude-agent-sdk/`](packages/integration/examples/claude-agent-sdk/)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Cloudflare Agents                  | [`packages/integration/examples/cloudflare-agents/`](packages/integration/examples/cloudflare-agents/) including [`live-worker-proof`](packages/integration/examples/cloudflare-agents/live-worker-proof/), [`live-client-proof`](packages/integration/examples/cloudflare-agents/live-client-proof/), the interactive [`approval-trace`](packages/integration/examples/cloudflare-agents/approval-trace/) HITL example, and the [D111](DECISIONS.md#d111-host-owned-oauth-evidence-infrastructure) [`oauth-evidence-infra`](packages/integration/examples/cloudflare-agents/oauth-evidence-infra/) Worker reference |
| LangChain JS                       | [`packages/integration/examples/langchain-js/`](packages/integration/examples/langchain-js/)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| LangGraph Store memory             | [`packages/integration/examples/langgraph-store/`](packages/integration/examples/langgraph-store/)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| LangGraph Python checkpointing     | [`packages/integration/examples/langgraph-python-checkpointer/`](packages/integration/examples/langgraph-python-checkpointer/)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| LlamaIndex.TS memory               | [`packages/integration/examples/llamaindex-memory/`](packages/integration/examples/llamaindex-memory/)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| LlamaIndex Python memory           | [`packages/integration/examples/llamaindex-python-memory/`](packages/integration/examples/llamaindex-python-memory/)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Letta memory                       | [`packages/integration/examples/letta-memory/`](packages/integration/examples/letta-memory/)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| A2A handoff evidence               | [`packages/integration/examples/a2a-handoff/`](packages/integration/examples/a2a-handoff/) signs an A2A `AgentCard`, carries an atrib evidence packet in an A2A `DataPart`, verifies the packet, and signs the receiver follow-up through `informed_by`.                                                                                                                                                                                                                                                                                                                                                             |
| Google ADK plugin                  | [`packages/integration/examples/google-adk/`](packages/integration/examples/google-adk/) and [`packages/integration/examples/google-adk-python/`](packages/integration/examples/google-adk-python/)                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Google stack chain proof           | [`packages/integration/examples/google-stack-chain/`](packages/integration/examples/google-stack-chain/) links AP2 / VI receipt verification, A2A signed handoff evidence, and Google ADK Python plugin signing through verifier-resolved `informed_by` records, with a deterministic snapshot, BigQuery Agent Analytics-shaped local fixture, and a local visual workbench.                                                                                                                                                                                                                                         |
| OpenAI runtime receipts            | [`packages/integration/examples/openai-agents-runtime/`](packages/integration/examples/openai-agents-runtime/) and [`packages/integration/examples/openai-responses/`](packages/integration/examples/openai-responses/)                                                                                                                                                                                                                                                                                                                                                                                              |
| Mastra runtime receipts            | [`packages/integration/examples/mastra-runtime/`](packages/integration/examples/mastra-runtime/)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Browser workflow receipt           | [`packages/integration/examples/browser-workflow/`](packages/integration/examples/browser-workflow/)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ActiveGraph runtime-log proof      | [`packages/integration/examples/activegraph-runtime-log/`](packages/integration/examples/activegraph-runtime-log/)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Reference runtime-log source       | [`packages/integration/examples/reference-runtime-log/`](packages/integration/examples/reference-runtime-log/)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Dogfood runtime-log proof          | [`packages/integration/examples/dogfood-runtime-log/`](packages/integration/examples/dogfood-runtime-log/)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Secondary runtime-log adapter pair | [`packages/integration/examples/secondary-runtime-log/`](packages/integration/examples/secondary-runtime-log/)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Runtime-log verifier UX            | [`packages/integration/examples/runtime-log-verifier-ux/`](packages/integration/examples/runtime-log-verifier-ux/)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Brief dcbench evidence             | [`packages/integration/examples/brief-dcbench/`](packages/integration/examples/brief-dcbench/)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Proof-log receipt                  | [`packages/integration/examples/proof-log-receipt/`](packages/integration/examples/proof-log-receipt/)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Trace repair suspect               | [`packages/integration/examples/trace-repair-suspect/`](packages/integration/examples/trace-repair-suspect/)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| End-to-end demo                    | [`packages/integration/examples/end-to-end/`](packages/integration/examples/end-to-end/)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

### Verify records (any third party)

```typescript
import { AtribVerifier } from '@atrib/verify'

const verifier = new AtribVerifier({
  merchantKey: process.env.ATRIB_MERCHANT_KEY,
})

const result = await verifier.verify(recommendationDoc)
// { valid: true, signatureOk: true, calcMatch: true, distribution: {...} }
```

Verification re-runs the [§4.6](atrib-spec.md#46-the-calculation-algorithm) calculation locally and compares the result. No trust in any intermediary.

## What atrib certifies, what it does not

atrib certifies five verifiable axes of agent activity: who acted (identity),
what they did (event_type), when (timestamp), what came before what in the
chronology plane, and what the signer claimed informed, anchored, annotated, or
revised the action in the declared-relationship plane.

atrib does NOT certify that the agent's reasoning is truthful, that prior records actually influenced subsequent decisions, or that tool responses were real absent tool-side attestation. The substrate is content-preserving (commitments, not content) and disclosure-configurable: harnesses pick how much each record reveals via the privacy postures in spec [§8](atrib-spec.md#8-privacy-postures).

This positioning keeps the claim honest. See spec [§3](atrib-spec.md#3-graph-query-interface) "What atrib chains, what it does not" for the detailed enumeration and spec [§7.6](atrib-spec.md#76-outcome-verification-patterns) for the outcome-verification patterns that close the tool-response gap.

## Framework support

| Framework                                  | Adapter                                                           | Status     |
| ------------------------------------------ | ----------------------------------------------------------------- | ---------- |
| **Raw `@modelcontextprotocol/sdk`**        | `wrapMcpClient(client, interceptor, { serverUrl? })`              | ✅ Shipped |
| **Claude Agent SDK** (in-process, Case A)  | Wrap `McpServer` with `atrib()` directly                          | ✅ Shipped |
| **Claude Agent SDK** (third-party, Case B) | `createAtribProxy({ upstream, interceptor })`                     | ✅ Shipped |
| **Cloudflare Agents**                      | `attributeCloudflareAgentMcp(agent, { interceptor, serverUrls })` | ✅ Shipped |
| **Vercel AI SDK MCP**                      | `attributeVercelAiSdkMcp(mcpClient, { interceptor, serverUrl })`  | ✅ Shipped |
| **LangChain JS MCP**                       | `attributeLangchainMcp(multiClient, { interceptor, serverUrls })` | ✅ Shipped |
| OpenAI Agents SDK                          | Planned (different transport architecture)                        | ⏳         |
| Mastra                                     | Receipt proof for `@mastra/mcp`; adapter planned                  | 🧪 Proof   |

Side-by-side quick-starts for each framework: [`packages/agent/README.md`](packages/agent/README.md).

## Payment protocol detection

atrib detects transaction events from all six simultaneously. It does not move money or enforce transactions.

| Protocol     | Sponsor             | Detection signal                             | Spec ref                                                    |
| ------------ | ------------------- | -------------------------------------------- | ----------------------------------------------------------- |
| **ACP**      | Stripe / OpenAI     | `status === "completed"` + embedded `order`  | [§1.7.1](atrib-spec.md#171-acp-agentic-commerce-protocol)   |
| **UCP**      | Google / Shopify    | Same as ACP + `ucp.version` envelope         | [§1.7.2](atrib-spec.md#172-ucp-universal-commerce-protocol) |
| **x402**     | Coinbase            | `PAYMENT-RESPONSE` HTTP header               | [§1.7.3](atrib-spec.md#173-x402)                            |
| **MPP**      | Tempo Labs / Stripe | `Payment-Receipt` HTTP header                | [§1.7.4](atrib-spec.md#174-mpp-machine-payments-protocol)   |
| **AP2**      | Google              | Successful CheckoutReceipt or PaymentReceipt | [§1.7.5](atrib-spec.md#175-ap2-and-a2a-x402)                |
| **a2a-x402** | Google              | A2A task metadata `payment-completed`        | [§1.7.5](atrib-spec.md#175-ap2-and-a2a-x402)                |

## Packages

| Package                                                            | What it does                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`@atrib/mcp`](packages/mcp/README.md)                             | Server middleware. Wraps an MCP server, emits signed records.                                                                                                                                                                                                                                                            |
| [`@atrib/agent`](packages/agent/README.md)                         | Agent middleware. Interceptor + framework adapters.                                                                                                                                                                                                                                                                      |
| [`@atrib/verify`](packages/verify/README.md)                       | Merchant verification. Re-runs the calculation locally, checks AP2 / VI evidence, verifies authorization evidence such as MCP/OAuth and AAuth, and verifies Pattern 3 handoff claims.                                                                                                                                    |
| [`@atrib/cli`](packages/cli/README.md)                             | CLI: keygen, Keychain key management, identity-claim ops, key rotation and revocation.                                                                                                                                                                                                                                   |
| [`@atrib/mcp-wrap`](packages/mcp-wrap/README.md)                   | Generic config-driven MCP wrapper. Multiplies coverage to any MCP server at zero per-server code cost.                                                                                                                                                                                                                   |
| [`@atrib/directory`](packages/directory/README.md)                 | AKD-backed identity-claim directory SDK. Bundles WASM artifacts from the Rust bridge.                                                                                                                                                                                                                                    |
| [`@atrib/openinference`](packages/openinference/README.md)         | OpenTelemetry SpanProcessor consuming OpenInference-shaped spans and emitting signed atrib records plus recall-readable local sidecar content. Reference impl of spec [§9](atrib-spec.md#9-runtime-integration-patterns) Pattern #4; one adapter transitively covers every framework with OpenInference instrumentation. |
| [`@atrib/memory-tool`](packages/memory-tool/README.md)             | Anthropic Memory Tool handler wrapper. Signs memory commands as atrib records while the host keeps its own storage backend.                                                                                                                                                                                              |
| [`@atrib/runtime-log`](packages/runtime-log/README.md)             | Runtime-log proof helpers. Builds and verifies `log_window_manifest` objects for host-owned agent run windows.                                                                                                                                   |
| [`@atrib/emit`](services/atrib-emit/README.md)                     | Cognitive-primitive MCP server: signs observations, annotations, revisions the wrapper doesn't auto-capture.                                                                                                                                                                                                             |
| [`@atrib/annotate`](services/atrib-annotate/README.md)             | Cognitive-primitive MCP server: marks past records' importance, topics, and summary.                                                                                                                                                                                                                                     |
| [`@atrib/revise`](services/atrib-revise/README.md)                 | Cognitive-primitive MCP server: supersedes a prior position with a stated reason.                                                                                                                                                                                                                                        |
| [`@atrib/recall`](services/atrib-recall/README.md)                 | Cognitive-primitive MCP server: queries the local mirror for an agent's own past records.                                                                                                                                                                                                                                |
| [`@atrib/trace`](services/atrib-trace/README.md)                   | Cognitive-primitive MCP server: walks `informed_by` / `annotates` / `revises` edges backward to reconstruct declared relationship traces.                                                                                                                                                                                |
| [`@atrib/summarize`](services/atrib-summarize/README.md)           | Cognitive-primitive MCP server: reads N records and synthesizes a narrative via an OpenAI-compatible LLM.                                                                                                                                                                                                                |
| [`@atrib/verify-mcp`](services/atrib-verify/README.md)             | Cognitive-primitive MCP server: verifies counterparty handoff evidence before an agent links follow-up work through `informed_by`.                                                                                                                                                                                       |
| [`@atrib/primitives-runtime`](services/atrib-primitives/README.md) | Private local MCP runtime: exposes all seven primitive packages through one stdio or Streamable HTTP MCP server for dogfood harnesses that would otherwise spawn one process per primitive.                                                                                                                              |
| [`@atrib/log-dev`](packages/log-dev/README.md)                     | Dev-only in-memory log stub. Not for production.                                                                                                                                                                                                                                                                         |
| [`@atrib/integration`](packages/integration/README.md)             | Cross-package tests + runnable examples.                                                                                                                                                                                                                                                                                 |

> The workspace ships tests across packages, services, apps, and examples. Sixteen designed-public packages are live on npm: the six core packages (`@atrib/mcp`, `@atrib/agent`, `@atrib/verify`, `@atrib/cli`, `@atrib/mcp-wrap`, `@atrib/directory`), the seven cognitive-primitive MCP servers (`@atrib/emit`, `@atrib/annotate`, `@atrib/revise`, `@atrib/recall`, `@atrib/trace`, `@atrib/summarize`, `@atrib/verify-mcp` per [D079](DECISIONS.md#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface) and [D106](DECISIONS.md#d106-verify-is-promoted-to-cognitive-primitive-7)), and two proof/intake packages: `@atrib/openinference`, the reference implementation of [§9](atrib-spec.md#9-runtime-integration-patterns) Pattern #4 with all 10 OpenInference span kinds mapped (TOOL / LLM / AGENT / EMBEDDING / RETRIEVER / RERANKER / CHAIN / GUARDRAIL / EVALUATOR / PROMPT), and `@atrib/memory-tool`, the Anthropic Memory Tool wrapper. `@atrib/runtime-log` is the [D121](DECISIONS.md#d121-runtime-log-proof-manifests-verify-host-owned-run-windows) runtime-log manifest helper package. Version 0.2.0 was first-published manually, with Trusted Publisher configured for later releases. Four services are deployed today: [`services/log-node/`](services/log-node/) (`https://log.atrib.dev/v1`), [`services/graph-node/`](services/graph-node/) (`https://graph.atrib.dev/v1`), [`services/directory-node/`](services/directory-node/) (`https://directory.atrib.dev/v6`), and [`services/archive-node/`](services/archive-node/) (`https://archive.atrib.dev/v1`). Archive-node is the deployed [§2.12](atrib-spec.md#212-record-body-archive-layer) reference service for public body and evidence retrieval. A reproducible end-to-end verifier with 13 gate assertions across 8 named categories (tree integrity, format conformance, checkpoint signature, pubkey-publication agreement, signer scope, attribution, record signature replay, chain integrity) ships at `services/log-node/scripts/verify-loop.mjs` and runs daily in CI against the deployed log. The public block explorer at [`https://explore.atrib.dev/`](https://explore.atrib.dev/) composes the log, graph, directory, and archive evidence APIs into seven views (overview, identity, session, action, demo, trace, anchoring), with Sigma.js-rendered DAGs for session, identity, trace, and demo views. Seven standalone in-process MCP services close the cognitive loop on the agent side: [`services/atrib-emit/`](services/atrib-emit/) signs observations the wrapper doesn't auto-capture; [`services/atrib-annotate/`](services/atrib-annotate/) marks past records' importance and meaning; [`services/atrib-revise/`](services/atrib-revise/) supersedes a prior position with a stated reason; [`services/atrib-recall/`](services/atrib-recall/) queries the local mirror for an agent's own past records; [`services/atrib-trace/`](services/atrib-trace/) walks `informed_by` / `annotates` / `revises` edges backward through the local mirror to reconstruct declared relationship traces; [`services/atrib-summarize/`](services/atrib-summarize/) reads N records and synthesizes a narrative via an OpenAI-compatible LLM; [`services/atrib-verify/`](services/atrib-verify/) verifies counterparty handoff evidence before linking follow-up work. All seven remain public stdio binaries. The private [`services/atrib-primitives/`](services/atrib-primitives/) runtime mounts those packages in one process and exposes their 15 physical MCP tools through stdio or a loopback Streamable HTTP host for local dogfood configs. The read primitives consume local mirror, archive body material, or caller-supplied evidence per spec [§5.9](atrib-spec.md#59-local-mirror-conventions), [§2.12](atrib-spec.md#212-record-body-archive-layer), and [§5.5.5](atrib-spec.md#555-handoff-claim-verification).

**Implemented and deployed:** Record signing ([§1](atrib-spec.md#1-attribution-record-format)) including `INFORMED_BY` ([D041](DECISIONS.md#d041-informed_by-linking-primitive-and-informed_by-edge-type)), `PROVENANCE_OF` ([D044](DECISIONS.md#d044-provenance_token-field-for-cross-session-causal-anchoring)), ANNOTATES ([D058](DECISIONS.md#d058-promote-annotation-to-atrib-normative-event_type-byte-0x05)), REVISES ([D059](DECISIONS.md#d059-promote-revision-to-atrib-normative-event_type-byte-0x06)), and `directory_anchor` ([D056](DECISIONS.md#d056-promote-directory_anchor-to-atrib-normative-event_type-byte-0x04)) event types. Parent-child producer threading now has a single same-session subagent env bundle: `ATRIB_CONTEXT_ID`, `ATRIB_CHAIN_TAIL_<context_id>`, and `ATRIB_PARENT_RECORD_HASH`, built by `@atrib/mcp` `buildSubagentProducerEnv()` when the parent dispatch hash is known before the child signs ([D104](DECISIONS.md#d104-parent-child-threading-uses-atrib_parent_record_hash), [D115](DECISIONS.md#d115-agent-to-subagent-handoff-uses-a-three-signal-producer-bundle)). Source-aware producer validation lets `@atrib/mcp-wrap` keep configured `informedByPaths` only when refs resolve through the wrapper mirror, local mirrors, or log lookup, while parent env seeds stay producer-owned ([D116](DECISIONS.md#d116-producer-side-informed_by-validation-is-source-aware)). Pattern 3 handoff claim acceptance lets a receiving agent verify another agent's `record_hash`, body commitment, inclusion proof, checkpoint signature, signer trust, context policy, and freshness before signing an `informed_by` follow-up; `@atrib/verify` provides the library helper and `@atrib/verify-mcp` exposes the `atrib-verify` primitive ([§5.5.5](atrib-spec.md#555-handoff-claim-verification), [D105](DECISIONS.md#d105-pattern-3-handoff-claims-use-verifier-side-claim-acceptance), [D106](DECISIONS.md#d106-verify-is-promoted-to-cognitive-primitive-7)). Sandboxed producer key isolation ([§1.4.6](atrib-spec.md#146-signing-key-isolation-for-sandboxed-execution), [D102](DECISIONS.md#d102-sandboxed-signer-proxy-keeps-keys-outside-sandbox)) keeps signing keys outside sandboxed execution via a tested host signer-proxy example. Transparency log ([§2](atrib-spec.md#2-merkle-log-protocol)) with persistent storage, C2SP-canonical signed-note checkpoints ([D031](DECISIONS.md#d031-reconcile-243-signed-note-divergence-from-c2sp)), and optional SSE / JSON Feed subscription surfaces ([§2.5.6](atrib-spec.md#256-log-subscription-surfaces-optional), [D103](DECISIONS.md#d103-log-subscriptions-use-sse-plus-json-feed-over-commitment-visible-fields)). Graph query interface ([§3](atrib-spec.md#3-graph-query-interface)) with full nine-edge [§3.2.4](atrib-spec.md#324-edge-derivation-rules), `/v1/trace/<record_hash>`, `/v1/chain/<record_hash>`, `/v1/creators/<key>/graph`, and an explorer primary trace path that composes trace plus chain without changing the protocol APIs ([D068](DECISIONS.md#d068-trace-operations-split-provenance-trace-vs-chronology-chain), [D118](DECISIONS.md#d118-primary-trace-path-is-a-presentation-rule-over-trace-and-chain)). Substrate-wide conformance corpora ([D101](DECISIONS.md#d101-substrate-wide-adversarial-conformance-corpus)) pin [§1.4](atrib-spec.md#14-signing-and-verification) adversarial signing vectors, [§3.2.4](atrib-spec.md#324-edge-derivation-rules) full edge derivation, [D067](DECISIONS.md#d067-multi-producer-chain-composition-precedence-contract) multi-producer race vectors, and [D052](DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records) creator-signer separation. Calculation algorithm ([§4.6](atrib-spec.md#46-the-calculation-algorithm)) with deterministic distribution and [§4.7](atrib-spec.md#47-settlement-recommendation-document) settlement document signing. AKD-backed public-key directory ([§6](atrib-spec.md#6-key-directory), [D034](DECISIONS.md#d034-public-key-directory-architecture-akd-unblinded-vrf-blinded-mode-available-for-downstream-consumers)) deployed at `https://directory.atrib.dev/v6` (unblinded mode for atrib's own use; VRF-blinded mode available for downstream consumers requiring privacy-preserving lookup). Per-operation directory anchoring back into the log ([§6.2.4](atrib-spec.md#624-anchor-cross-reference-into-the-tessera-log)). Key rotation and revocation ([§1.9](atrib-spec.md#19-key-rotation-and-revocation), [D033](DECISIONS.md#d033-key-rotation-and-revocation)): verifier honors revocations, `@atrib/cli` exposes `publish-claim` / `revoke` commands, conformance corpus generated. Capability declarations ([§6.7](atrib-spec.md#67-capability-declarations), [D051](DECISIONS.md#d051-capability-scoped-records-via-directory-published-envelopes)) surfaced by the verifier as soft signals per [§6.7.3](atrib-spec.md#673-signal-not-invalidation). Cross-attestation requirement on transaction records ([§1.7.6](atrib-spec.md#176-cross-attestation-requirement-for-transaction-records), [D052](DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records)) flagged by the verifier when fewer than two distinct signer keys verify. AP2 / Verifiable Intent evidence checks ([§5.5.4](atrib-spec.md#554-ap2--verifiable-intent-evidence-checks), [D089](DECISIONS.md#d089-ap2--verifiable-intent-evidence-checks-live-in-atribverify), [D090](DECISIONS.md#d090-ap2-receipt-jwt-verification-uses-jose-in-atribverify), [D091](DECISIONS.md#d091-ap2--vi-sd-jwt-conformance-uses-openwallet-sd-jwt-js), [D092](DECISIONS.md#d092-ap2--vi-mandate-constraints-are-typed-verifier-evidence), [D093](DECISIONS.md#d093-ap2--vi-fixtures-are-the-local-verifier-corpus), [D094](DECISIONS.md#d094-ap2--vi-evidence-attaches-to-verifier-results-as-a-tiered-block), [D096](DECISIONS.md#d096-ap2--vi-crypto-conformance-uses-a-pinned-offline-corpus), [D097](DECISIONS.md#d097-ap2-live-interop-uses-an-opt-in-reference-artifact-harness), [D098](DECISIONS.md#d098-ap2-receipts-stay-external-evidence-for-cross-attestation), [D107](DECISIONS.md#d107-ap2-counterparty-attestation-signs-atrib-transaction-bytes)) validate AP2 receipt references, signed receipt JWTs, VI SD-JWT / VC mandate chains, typed AP2 mandate constraints, offline JOSE / JWKS / SD-JWT crypto edge cases, opt-in AP2 reference artifacts, and AP2 transaction-record artifacts off the detector path. AP2 Path 2 transaction emission uses a stable receipt identity ladder when receipt or mandate identity is visible ([D095](DECISIONS.md#d095-ap2-path-2-content_id-uses-a-stable-receipt-identity-ladder)) and carries an agent `signers[]` entry over the [D052](DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records) canonical bytes; AP2 counterparties can add their own signer entry with `signTransactionAttestation()`. `verifyRecord()` and `AtribVerifier.verify()` attach supplied evidence as tiered `ap2_vi_evidence` without counting AP2 receipt JWTs as transaction signers. Privacy postures ([§8](atrib-spec.md#8-privacy-postures), [D045](DECISIONS.md#d045-privacy-postures-normative-spec-section)) with disclosure dials per record. Opt-in autoChain plus a cross-producer chain-tail handoff via `ATRIB_CHAIN_TAIL_<context_id>` env var for hosts that don't propagate atrib's outbound token.

`@atrib/verify` also exposes generic tiered authorization evidence blocks ([§5.5.6](atrib-spec.md#556-generic-authorization-evidence-blocks), [D109](DECISIONS.md#d109-mcpoauth-authorization-evidence-uses-generic-tiered-evidence-blocks), [D110](DECISIONS.md#d110-mcpoauth-evidence-capture-closes-the-producer-to-verifier-loop), [D111](DECISIONS.md#d111-host-owned-oauth-evidence-infrastructure), [D119](DECISIONS.md#d119-aauth-evidence-stays-verifier-side)). `verifyRecord()` can attach MCP/OAuth or AAuth evidence under `evidence[]` and consume caller-supplied `resolvedFacts` for capability checks without changing base record validity. `@atrib/mcp` can capture validated MCP `authInfo` and AAuth callback evidence into local-only sidecars, including DPoP proof material, HTTP signature facts, and token hashes without storing raw bearer tokens or raw AAuth JWTs by default. Hosts that need live OAuth introspection can use `introspectOAuthToken()` to produce caller-owned evidence, and AAuth callers supply trusted JWKS, verified claims, or decoded claims under an explicit signature policy.

For the delegation and capability-system boundary, see [Delegation and capabilities](docs/concepts/12-delegation-and-capabilities.md): atrib verifies external authorization evidence, but the issuing and enforcement layers remain outside the protocol.

**Spec-defined but not implemented:** Witnessing ([§2.9](atrib-spec.md#29-witnessing-and-cosignatures), [D032](DECISIONS.md#d032-witnessing-posture-for-v1-spec-defined-no-implementation); first implementation deferred until an independent verifier exists). Cross-log replication ([§2.11](atrib-spec.md#211-cross-log-replication), [D050](DECISIONS.md#d050-cross-log-replication-for-equivocation-defense); spec-defined; second log-node deployment + verifier multi-log proof bundles forthcoming). [§6.3](atrib-spec.md#63-verifier-consultation-algorithm) verifier consultation steps 1, 3, 4, 5, 7 (anchor + lookup-proof + append-only + emergency-key paths; AKD WASM bridge upstream gating).

**Developer CLI for the public log surface:** [`atrib-log-pp-cli`](https://github.com/creatornader/atrib-log-pp-cli) is a [Printing-Press](https://github.com/mvanhorn/cli-printing-press)-generated Go CLI that wraps `log.atrib.dev` directly (signed checkpoint, recent entries, lookup by hash, by context, by creator, Merkle tile retrieval) with a local SQLite mirror + FTS5 + compound workflow commands. It is _complementary_ to the `@atrib/*` MCP cognitive primitives, not a replacement: use the MCP primitives for agent cognitive work; use this CLI for human or script interaction with the public log API.

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
- **[§9](atrib-spec.md#9-runtime-integration-patterns):** Runtime integration patterns (informative; seven peer patterns per [D069](DECISIONS.md#d069-runtime-integration-patterns--first-class-peers-no-canonical-path) and [D102](DECISIONS.md#d102-sandboxed-signer-proxy-keeps-keys-outside-sandbox))

## Design principles

1. **Provenance travels with the artifact.** Embedded at creation, not inferred later.
2. **Accountability without content exposure.** The log stores hashes, not content.
3. **Settlement is separate from attribution.** The protocol records what happened. It does not move money.
4. **No central arbiter of value.** Trust from math and open spec, not from trusting atrib.
5. **The protocol is open. The product is commercial.** Spec, signing libraries, calculation algorithm, and log software are open. Anyone can self-host. atrib operates a hosted service as a commercial product built on the open protocol.

## Product design

[`DESIGN.md`](DESIGN.md) is the source of truth for atrib's public product surfaces: website, explorer, docs, package README patterns, share images, and user-facing reliability states. It records the current state, target direction, tokens, components, writing rules, and remaining design backlog.

## More

- [Policy templates and guide](policies/README.md)
- [Product design system](DESIGN.md)
- [Architecture and trust model](ARCHITECTURE.md)
- [Prior art and standards map](PRIOR-ART.md)
- [Decision log](DECISIONS.md)
- [Contributing](CONTRIBUTING.md)

## License

Apache 2.0
