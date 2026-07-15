# atrib

**Verifiable agent actions.** Every action becomes signed context for the next.

atrib signs agent actions as records that later agents, teams, and verifiers can
check. A record can describe a tool call, browser click, desktop action, policy
decision, handoff, transaction, or intentional note from the agent.

Agent work already crosses tools, memory, identity, authorization,
observability, evals, handoffs, and payment rails. atrib does not replace those
systems. It gives them a common record that carries the action, selected
evidence, and graph links across sessions, agents, teams, organizations, and
protocols.

Product teams can put atrib in the execution path. A harness can sign an allow,
block, or escalate decision before a high-impact browser click, desktop action,
support reply, admin change, deployment, or payment-impacting step. The outcome
then becomes signed context for later recall, review, handoff, or verification.

Browser and computer-use agents make the product concrete.
Follow-up work can cite the decision and outcome without exposing raw browser
state, desktop state, private tool payloads, or full runtime logs in public
records.

Shared memory and context systems still decide what an agent should remember.
Observability tools still inspect live runs. Authorization systems still issue
policy and credentials. atrib signs the action trail so those systems can carry
forward the same verifiable facts without trusting the runtime that stored them.

## What this enables

Everything below depends on one substrate property: an action is signed when it
happens and remains verifiable later.

| Surface                          | What atrib gives you                                                                                                                                                                                                                                                         | What it composes with                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Action control                   | A host can sign an allow, block, escalate, or approval decision before a selected action runs. The outcome cites the decision, so later review can see what was proposed and what actually happened.                                                                         | [`@atrib/action-gate`](packages/action-gate/README.md), policy engines, approvals  |
| Cross-session continuity         | Signed action hashes can travel with follow-up work. Later sessions and agents can cite accepted records instead of relying on a transcript, replay link, or runtime-local memory.                                                                                          | Memory systems, shared context layers, recall tools, agent runtimes                |
| Browser and desktop review       | Clicks, form fills, desktop actions, support replies, admin changes, and payment-impacting steps become decision/outcome pairs that can be recalled or verified later.                                                                                                      | Browserbase, browser-use, OpenAI Computer Use, support teams, admin teams          |
| Verified handoffs                | A receiving agent can verify incoming record hashes, body commitments, signer trust, context policy, freshness, and inclusion proofs before signing follow-up work through `informed_by`.                                                                                  | [`@atrib/verify`](packages/verify/README.md), [`@atrib/verify-mcp`](services/atrib-verify/README.md), [continuation packets](packages/verify/README.md#verifyhandoffclaimsclaims-options-promisehandoffverificationresult) |
| Investigations and audit         | Support, incident, billing, and RCA agents can sign ticket intake, scoped log reads, code-path checks, hypotheses, diagnostics, revisions, and human handoffs. A reviewer can verify the path without trusting the original runtime.                                       | Observability tools, logs, traces, support systems, SOC 2 evidence                 |
| Evals and repair loops           | A harness can link task setup, tool calls, verifier checks, diagnostic outcomes, and scorer output through `informed_by`, then publish evidence another team can replay.                                                                                                   | Eval harnesses, benchmark reports, inspection tools                                |
| Commerce settlement              | The same signed record set can feed a deterministic settlement document under an agreed policy. Any merchant or auditor can recompute the [payments profile §8](docs/payments-profile.md#8-the-calculation-algorithm) result.                                                                         | AP2, Verifiable Intent, x402, ACP, merchant policies                               |
| Private evidence by default      | The public log stores commitments, not private work product. Verifiers can check signatures, hashes, inclusion proofs, and selected evidence without dumping tool arguments, tool results, memory text, authorization material, or workflow context into the public payload. | Local mirrors, sidecars, opt-in archive evidence, private evidence stores          |

## Substrate vs harness

atrib is the substrate underneath the action layer. Consuming it well
(surfacing an agent's history at session start, exposing recall tools the agent
can call, persisting signed records locally for replay, and putting policy gates
around high-impact actions) is the job of an agent harness or runtime. atrib
does not prescribe a harness. The substrate is independently useful to any
harness (Claude Code, Cursor, custom agent products, in-house agent runtimes)
that wants to give agents and teams contextual awareness, coordination, control,
and proof over work the agent performs.

Hard boundary: the public Merkle log proves a commitment, but it is not enough context for a future agent to continue the work. A continuation agent needs Tier 2 and Tier 3 material: canonical record bodies or archive references, redacted evidence references, skill pack identities and hashes, the latest chain tail, parent dispatch anchors for subagent work, and provenance anchors. Without those, it can prove a record existed but still has to guess what happened.

One canonical harness pattern is signed diagnostic outcome + trace replay: sign the action, sign the diagnostic outcome that evaluates it with `informed_by` back to the action, then let the next repair step call `atrib-trace` from the diagnostic record. This keeps "what happened" and "what it supersedes" in one verifiable path without requiring a whole-session transcript dump.

Derived evidence products sit above the protocol. A harness can build a prior-work packet, suspect report, or eval summary from signed records, body commitments, verifier checks, and inclusion proofs. Those products can decide which records are useful for a task, which stale records to avoid, and which risks remain open. They do not change the record format, the graph derivation rules, or the seven cognitive primitives.

## Logs and traces

Logs and traces are primary integration inputs for atrib, but the word "trace"
can point at several different objects. The boundary matters.

| What you already have                                                                            | Use                                                                                                                                       | What atrib adds                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tool calls through MCP or an SDK callback                                                        | [`@atrib/mcp`](packages/mcp/README.md), [`@atrib/mcp-wrap`](packages/mcp-wrap/README.md), or [`@atrib/agent`](packages/agent/README.md)   | Signed action records with chain continuity and optional local sidecars.                                                                                         |
| Pre-action policy gates, approval hooks, or host lifecycle hooks                                 | [`@atrib/action-gate`](packages/action-gate/README.md), [`@atrib/mcp-wrap`](packages/mcp-wrap/README.md) `preCallTransform`, host-specific adapters, and [signer proxies](packages/integration/examples/signer-proxy/README.md) | Verifiable control points around high-impact actions. The host records the decision, execution result, outcome hash, and selected evidence.                      |
| OpenTelemetry or OpenInference spans                                                             | [`@atrib/openinference`](packages/openinference/README.md)                                                                                | Signed records and recall-readable sidecars from the span stream, while Langfuse, Phoenix, LangSmith, Braintrust, or another backend keeps the operations view.  |
| A host-owned run log, event stream, session history, checkpoint log, fork log, or compaction log | [`@atrib/runtime-log`](packages/runtime-log/README.md)                                                                                    | A `log_window_manifest` that commits to the bounded run window, roots, projections, receipts, and redaction policy without publishing raw log bodies by default. |
| A hosted runtime API that exports session events after the fact                                  | A future per-runtime adapter under [Pattern 5](ARCHITECTURE.md#runtime-integration-patterns)                                              | Consumer-side attestation over what the vendor reported, not a claim that the vendor's private runtime state is itself true.                                     |
| Application or service code with no MCP wrapper in the path                                     | [`@atrib/sdk`](packages/sdk/README.md) (TypeScript) or the [`atrib` Python SDK](python/README.md)                                          | One-import `attest()`/`recall()` client: daemon-first signed writes and mirror reads, byte-identical records across both languages, full [§1](atrib-spec.md#1-attribution-record-format) record layer re-exported.                                |
| A handoff, support investigation, or continuation packet                                         | [`@atrib/verify`](packages/verify/README.md), [`@atrib/verify-mcp`](services/atrib-verify/README.md), and [continuation packets](packages/verify/README.md#verifyhandoffclaimsclaims-options-promisehandoffverificationresult) | Verifier-accepted record hashes that the receiving agent can cite through `informed_by`.                                                                         |

The short rule: observability tools inspect and debug live traces; runtime
systems own logs that reconstruct or resume a run; atrib signs actions and
verifies claims over selected windows. Those layers compose, but they should not
collapse into one product.

## Frameworks and host runtimes

The "any agent framework" claim is about tool-call middleware, not every host
runtime feature. It covers SDK and MCP surfaces where application code owns the
agent loop: raw MCP SDK, Claude Agent SDK, Cloudflare Agents, Vercel AI SDK,
LangChain JS, and similar SDKs. Those integrations live in
[`@atrib/agent`](packages/agent/README.md),
[`@atrib/mcp`](packages/mcp/README.md), and
[`@atrib/mcp-wrap`](packages/mcp-wrap/README.md).

Host runtime adapters cover a different shell: Claude Code, Codex, OpenClaw,
Hermes, Cursor, Goose, hosted runtimes, or another harness that owns sessions,
lifecycle hooks, approvals, subagents, checkpoints, telemetry, and run logs.
Those adapters use [`@atrib/mcp-wrap`](packages/mcp-wrap/README.md) for MCP
tool calls, host-specific signing code for native tool hooks,
[`@atrib/openinference`](packages/openinference/README.md) for
OpenInference-shaped span intake,
[`@atrib/runtime-log`](packages/runtime-log/README.md) for bounded run windows,
[`@atrib/action-gate`](packages/action-gate/README.md) for pre-action policy
gates, [`@atrib/verify`](packages/verify/README.md) for accepted handoff claims,
and `atrib-attest-cli` (or the forwarded `atrib-emit-cli`) or the local substrate for hook-class observations.

The implementation rule: one host event has one signing owner. If an MCP wrapper
already signs a tool call, the host adapter should correlate ids and skip a
second `tool_call` record. The private integration package pins this rule in
[`packages/integration/src/host-runtime-proof.ts`](packages/integration/src/host-runtime-proof.ts)
so future OpenClaw, Hermes, and other host proofs share the same vocabulary.

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

- Sign tool calls your MCP server handles: [`@atrib/mcp`](packages/mcp/README.md) ([below](#sign-tool-calls-your-mcp-server))
- Sign tool calls your agent makes: [`@atrib/agent`](packages/agent/README.md) ([below](#sign-tool-calls-your-agent))
- Gate high-impact actions before they run: [`@atrib/action-gate`](packages/action-gate/README.md)
- Attach signed records to an existing OpenInference span stream: [`@atrib/openinference`](packages/openinference/README.md)
- Prove a bounded run window from a host-owned runtime log: [`@atrib/runtime-log`](packages/runtime-log/README.md)
- Verify records someone else produced: [`@atrib/verify`](packages/verify/README.md) ([below](#verify-records-any-third-party))

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

[`@atrib/agent`](packages/agent/README.md) exports one interceptor plus a helper
per framework. Some runtime examples use the host's native callback surface
while keeping the same hash-only record shape. Start with the row matching your
stack:

| Example                                 | Path                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vercel AI SDK + AI Gateway              | [`packages/integration/examples/vercel-ai-sdk/`](packages/integration/examples/vercel-ai-sdk/)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Claude Agent SDK (Case A + Case B)      | [`packages/integration/examples/claude-agent-sdk/`](packages/integration/examples/claude-agent-sdk/)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Cloudflare Agents                       | [`packages/integration/examples/cloudflare-agents/`](packages/integration/examples/cloudflare-agents/) including [`live-worker-proof`](packages/integration/examples/cloudflare-agents/live-worker-proof/), [`live-client-proof`](packages/integration/examples/cloudflare-agents/live-client-proof/), the interactive [`approval-trace`](packages/integration/examples/cloudflare-agents/approval-trace/) HITL example, the [`paid-x402-action-gate`](packages/integration/examples/cloudflare-agents/paid-x402-action-gate/) proof, the [`x402-path-b-reference`](packages/integration/examples/cloudflare-agents/x402-path-b-reference/) proof, and the [D111](DECISIONS.md#d111-host-owned-oauth-evidence-infrastructure) [`oauth-evidence-infra`](packages/integration/examples/cloudflare-agents/oauth-evidence-infra/) Worker reference |
| Cloudflare x402 paid agent proof        | [`packages/integration/examples/cloudflare-agents/paid-x402-action-gate/`](packages/integration/examples/cloudflare-agents/paid-x402-action-gate/) and [`proof-packets/cloudflare-x402-paid-agent/`](proof-packets/cloudflare-x402-paid-agent/) show a paid MCP request gated by `@atrib/action-gate`, with hash-only x402 lifecycle facts bound to the decision and outcome.                                                                                                                                                                                                                                           |
| LangChain JS                            | [`packages/integration/examples/langchain-js/`](packages/integration/examples/langchain-js/)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| LangGraph Store memory                  | [`packages/integration/examples/langgraph-store/`](packages/integration/examples/langgraph-store/)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| LangGraph Python checkpointing          | [`packages/integration/examples/langgraph-python-checkpointer/`](packages/integration/examples/langgraph-python-checkpointer/)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| LlamaIndex.TS memory                    | [`packages/integration/examples/llamaindex-memory/`](packages/integration/examples/llamaindex-memory/)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| LlamaIndex Python memory                | [`packages/integration/examples/llamaindex-python-memory/`](packages/integration/examples/llamaindex-python-memory/)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Letta memory                            | [`packages/integration/examples/letta-memory/`](packages/integration/examples/letta-memory/)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| A2A handoff evidence                    | [`packages/integration/examples/a2a-handoff/`](packages/integration/examples/a2a-handoff/) signs an A2A `AgentCard`, carries an atrib evidence packet in an A2A `DataPart`, verifies the packet, and signs the receiver follow-up through `informed_by`.                                                                                                                                                                                                                                                                                                                                                             |
| Google ADK TypeScript and Python proofs | [`packages/integration/examples/google-adk-typescript/`](packages/integration/examples/google-adk-typescript/) and [`packages/integration/examples/google-adk-python/`](packages/integration/examples/google-adk-python/) cover callback signing and decision-ledger signing for each runtime.                                                                                                                                                                                                                                                                                                                       |
| Google stack chain proof                | [`packages/integration/examples/google-stack-chain/`](packages/integration/examples/google-stack-chain/) links AP2 / VI receipt verification, A2A signed handoff evidence, a Google ADK Python allow decision, and the ADK Python tool outcome through verifier-resolved `informed_by` records, with a deterministic snapshot, BigQuery Agent Analytics-shaped local fixture, Cloud Run-backed runtime path, and a visual workbench.                                                                                                                                                                                 |
| OpenAI runtime receipts                 | [`packages/integration/examples/openai-agents-runtime/`](packages/integration/examples/openai-agents-runtime/) and [`packages/integration/examples/openai-responses/`](packages/integration/examples/openai-responses/)                                                                                                                                                                                                                                                                                                                                                                                              |
| Mastra runtime receipts                 | [`packages/integration/examples/mastra-runtime/`](packages/integration/examples/mastra-runtime/)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Action-control gate proof               | [`packages/integration/examples/action-control-gate/`](packages/integration/examples/action-control-gate/) lets one browser-shaped read run, blocks one payment-impacting write, escalates one customer message, and proves each decision-to-outcome binding with [`@atrib/action-gate`](packages/action-gate/README.md).                                                                                                                                                                                                                                                                                      |
| Cloudflare x402 Path B reference        | [`packages/integration/examples/cloudflare-agents/x402-path-b-reference/`](packages/integration/examples/cloudflare-agents/x402-path-b-reference/) and [`proof-packets/cloudflare-x402-path-b-reference/`](proof-packets/cloudflare-x402-path-b-reference/) show the local x402 v2 header flow through `@atrib/agent`: 402 challenge, paid retry context propagation, `PAYMENT-RESPONSE` detection, Path B transaction emission, and counterparty attestation.                                                                                                                                                    |
| Browser workflow receipt                | [`packages/integration/examples/browser-workflow/`](packages/integration/examples/browser-workflow/)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Browserbase Stagehand proof             | [`packages/integration/examples/browserbase-stagehand/`](packages/integration/examples/browserbase-stagehand/) and [`proof-packets/browserbase-stagehand/`](proof-packets/browserbase-stagehand/)                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Firecrawl web ingestion proof           | [`packages/integration/examples/firecrawl-web-ingestion/`](packages/integration/examples/firecrawl-web-ingestion/) and [`proof-packets/firecrawl-web-ingestion/`](proof-packets/firecrawl-web-ingestion/)                                                                                                                                                                                                                                                                                                                                                                                                            |
| OpenETR transfer proof                  | [`packages/integration/examples/openetr-transfer/`](packages/integration/examples/openetr-transfer/) and [`proof-packets/openetr-transfer/`](proof-packets/openetr-transfer/)                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ActiveGraph runtime-log proof           | [`packages/integration/examples/activegraph-runtime-log/`](packages/integration/examples/activegraph-runtime-log/)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Reference runtime-log source            | [`packages/integration/examples/reference-runtime-log/`](packages/integration/examples/reference-runtime-log/)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Dogfood runtime-log proof               | [`packages/integration/examples/dogfood-runtime-log/`](packages/integration/examples/dogfood-runtime-log/)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Secondary runtime-log adapter pair      | [`packages/integration/examples/secondary-runtime-log/`](packages/integration/examples/secondary-runtime-log/)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Runtime-log verifier UX                 | [`packages/integration/examples/runtime-log-verifier-ux/`](packages/integration/examples/runtime-log-verifier-ux/)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Brief dcbench evidence                  | [`packages/integration/examples/brief-dcbench/`](packages/integration/examples/brief-dcbench/)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Proof-log receipt                       | [`packages/integration/examples/proof-log-receipt/`](packages/integration/examples/proof-log-receipt/)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Trace repair suspect                    | [`packages/integration/examples/trace-repair-suspect/`](packages/integration/examples/trace-repair-suspect/)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| End-to-end demo                         | [`packages/integration/examples/end-to-end/`](packages/integration/examples/end-to-end/)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

### Verify records (any third party)

```typescript
import { AtribVerifier } from '@atrib/verify'

const verifier = new AtribVerifier({
  merchantKey: process.env.ATRIB_MERCHANT_KEY,
})

const result = await verifier.verify(recommendationDoc)
// { valid: true, signatureOk: true, calcMatch: true, distribution: {...} }
```

Verification re-runs the [payments profile §8](docs/payments-profile.md#8-the-calculation-algorithm) calculation locally and compares the result. No trust in any intermediary.

## What atrib certifies, what it does not

atrib certifies five verifiable axes of agent activity: who acted (identity),
what they did (event_type), when (timestamp), what came before what in the
chronology plane, and what the signer claimed informed, anchored, annotated, or
revised the action in the declared-relationship plane.

atrib does NOT certify that the agent's reasoning is truthful, that prior records actually influenced subsequent decisions, or that tool responses were real absent tool-side attestation. A signature proves who committed to a claim, never that the claim is true. The first two limits are intrinsic to signed claims. The third narrows when another party signs its own evidence: the tool signs its response, a counterparty co-signs a transaction, an evaluator signs a diagnostic, or a witness attests the outcome. Those signatures corroborate the action, not the agent's reasoning. The substrate is content-preserving (commitments, not content) and disclosure-configurable: harnesses pick how much each record reveals via the privacy postures in spec [§8](atrib-spec.md#8-privacy-postures).

This positioning keeps the claim honest. See spec [§3](atrib-spec.md#3-graph-query-interface) "What atrib chains, what it does not" for the detailed enumeration and spec [§7.6](atrib-spec.md#76-outcome-verification-patterns) for the outcome-verification patterns that close the tool-response gap.

## Framework support

This table covers framework tool-call middleware, not full host runtime
integration. Host runtime work has its own boundary in
[Architecture](ARCHITECTURE.md#agent-framework-vs-host-runtime-adapters) and in
the [OpenClaw/Hermes map](docs/concepts/15-openclaw-hermes-integration-map.md).

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

atrib detects transaction events from all six simultaneously. It does not move money or enforce transactions. The per-rail hooks are defined by the [atrib Payments Profile](docs/payments-profile.md), which versions independently of the core spec ([D147](DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core)); core keeps the `transaction` event type, the cross-attestation rule, and the evidence envelope.

| Protocol     | Sponsor             | Detection signal                             | Profile ref                                                         |
| ------------ | ------------------- | -------------------------------------------- | ------------------------------------------------------------------- |
| **ACP**      | Stripe / OpenAI     | `status === "completed"` + embedded `order`  | [§2.1](docs/payments-profile.md#21-acp-agentic-commerce-protocol)   |
| **UCP**      | Google / Shopify    | Same as ACP + `ucp.version` envelope         | [§2.2](docs/payments-profile.md#22-ucp-universal-commerce-protocol) |
| **x402**     | Coinbase            | `PAYMENT-RESPONSE` HTTP header               | [§2.3](docs/payments-profile.md#23-x402)                            |
| **MPP**      | Tempo Labs / Stripe | `Payment-Receipt` HTTP header                | [§2.4](docs/payments-profile.md#24-mpp-machine-payments-protocol)   |
| **AP2**      | Google              | Successful CheckoutReceipt or PaymentReceipt | [§2.5](docs/payments-profile.md#25-ap2-and-a2a-x402)                |
| **a2a-x402** | Google              | A2A task metadata `payment-completed`        | [§2.5](docs/payments-profile.md#25-ap2-and-a2a-x402)                |

x401 is intentionally not in this table. It is a `401` proof-requirement protocol for credential-gated HTTP routes, so [`@atrib/verify`](packages/verify/README.md) treats x401 artifacts as authorization evidence rather than transaction signals. The current Proof issue and PR map lives in [`docs/proof-x401-open-threads.md`](docs/proof-x401-open-threads.md).

## Packages

Current packages come first. The deprecated legacy packages follow: all are re-export shims (or, for summarize, a standalone server) whose tool names stay mounted as permanent aliases per [D164](DECISIONS.md#d164-attestrecall-verb-rename-and-primitive-surface-collapse). Private workspace packages that never publish close the list.

### Current packages

| Package                                                    | What it does                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`@atrib/sdk`](packages/sdk/README.md)                     | Consolidated client SDK: `attest()`/`recall()` verbs, daemon-first over the local primitives runtime with in-process fallback, full [§1](atrib-spec.md#1-attribution-record-format) record layer re-exported. Byte-identical Python sibling at [`python/`](python/README.md).                                             |
| [`@atrib/attest`](services/atrib-attest/README.md)         | The write verb: one `attest` tool signs observations, annotations (`ref.kind: "annotates"`), and revisions (`ref.kind: "revises"`), with the legacy `emit` / `atrib-annotate` / `atrib-revise` tool names mounted as permanent aliases over the same handler. |
| [`@atrib/recall`](services/atrib-recall/README.md)         | The read verb: one `recall` tool dispatches every read shape (history, walks with direction, content search, session chain, annotations, revisions, orphans, by-signer) plus a `verification` parameter, with the legacy `recall_*` / `trace` / `trace_forward` / `atrib-verify` names mounted as permanent aliases. |
| [`@atrib/daemon`](services/atribd/README.md)               | Stateless-native local daemon (binary `atribd`): serves the seventeen-tool alias-window union (fifteen legacy names plus the `attest` and `recall` verbs) over stateless Streamable HTTP, direct stdio, or a stdio-to-HTTP proxy shim, with per-context write serialization. The recommended local topology per [D148](DECISIONS.md#d148-atribd-is-the-public-stateless-native-local-daemon-for-the-primitive-runtime). |
| [`@atrib/mcp`](packages/mcp/README.md)                     | Server middleware. Wraps an MCP server, emits signed records.                                                                                                                                                                                                                                                            |
| [`@atrib/agent`](packages/agent/README.md)                 | Agent middleware. Interceptor + framework adapters.                                                                                                                                                                                                                                                                      |
| [`@atrib/action-gate`](packages/action-gate/README.md)     | Host-owned action gate. Signs policy decisions and outcomes before selected high-impact actions run.                                                                                                                                                                                                                     |
| [`@atrib/verify`](packages/verify/README.md)               | Merchant verification. Re-runs the calculation locally, checks AP2 / VI evidence, verifies authorization evidence such as MCP/OAuth, AAuth, and x401, and verifies Pattern 3 handoff claims.                                                                                                                             |
| [`@atrib/cli`](packages/cli/README.md)                     | CLI: keygen, Keychain key management, identity-claim ops, key rotation and revocation.                                                                                                                                                                                                                                   |
| [`@atrib/mcp-wrap`](packages/mcp-wrap/README.md)           | Generic config-driven MCP wrapper. Multiplies coverage to any MCP server at zero per-server code cost.                                                                                                                                                                                                                   |
| [`@atrib/directory`](packages/directory/README.md)         | AKD-backed identity-claim directory SDK. Bundles WASM artifacts from the Rust bridge.                                                                                                                                                                                                                                    |
| [`@atrib/openinference`](packages/openinference/README.md) | OpenTelemetry SpanProcessor consuming OpenInference-shaped spans and emitting signed atrib records plus recall-readable local sidecar content. Reference impl of spec [§9](atrib-spec.md#9-runtime-integration-patterns) Pattern #4; one adapter transitively covers every framework with OpenInference instrumentation. |
| [`@atrib/memory-tool`](packages/memory-tool/README.md)     | Anthropic Memory Tool handler wrapper. Signs memory commands as atrib records while the host keeps its own storage backend.                                                                                                                                                                                              |
| [`@atrib/runtime-log`](packages/runtime-log/README.md)     | Runtime-log proof helpers. Builds and verifies `log_window_manifest` objects for host-owned agent run windows.                                                                                                                                                                                                           |

### Deprecated legacy packages

All six are deprecated on npm and remain installable. Their tool names stay mounted as permanent aliases, so existing configurations keep working and signed records are byte-identical either way.

| Package                                                | What it was, and where it went                                                                                                                                                    |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@atrib/emit`](services/atrib-emit/README.md)         | Legacy home of the `emit` write primitive; re-export shim over `@atrib/attest`, binaries forward.                                                                                 |
| [`@atrib/annotate`](services/atrib-annotate/README.md) | Legacy home of `atrib-annotate` (marks past records' importance, topics, and summary); folds into `attest` and stays mounted as a permanent alias.                                |
| [`@atrib/revise`](services/atrib-revise/README.md)     | Legacy home of `atrib-revise` (supersedes a prior position with a stated reason); folds into `attest` and stays mounted as a permanent alias.                                     |
| [`@atrib/trace`](services/atrib-trace/README.md)       | Legacy home of `trace` / `trace_forward` (informed_by walks); re-export shim over `@atrib/recall`; the tools fold into `recall` shape `walk` with a direction.                    |
| [`@atrib/summarize`](services/atrib-summarize/README.md) | Cognitive-primitive MCP server: reads N records and synthesizes a narrative via an OpenAI-compatible LLM. No successor shape in the read verb; stays mounted through the alias window. |
| [`@atrib/verify-mcp`](services/atrib-verify/README.md) | Legacy home of `atrib-verify` (handoff-evidence acceptance); re-export shim over `@atrib/recall`; the tool folds into the `recall` verification parameter.                        |

### Private workspace packages

Fixtures, test harnesses, and superseded local runtimes. Marked `private: true`; never published.

| Package                                                            | What it does                                                                                                                                                                                             |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@atrib/primitives-runtime`](services/atrib-primitives/README.md) | Local MCP runtime: exposes the seventeen-tool alias-window union through one stdio or Streamable HTTP MCP server for dogfood harnesses that would otherwise spawn one process per primitive. Superseded as the recommended topology by `@atrib/daemon`. |
| [`@atrib/log-dev`](packages/log-dev/README.md)                     | Dev-only in-memory log stub. Not for production.                                                                                                                                                         |
| [`@atrib/integration`](packages/integration/README.md)             | Cross-package tests + runnable examples.                                                                                                                                                                 |

> The workspace ships tests across packages, services, apps, and examples. Twenty designed-public packages are in source: the six core packages (`@atrib/mcp`, `@atrib/agent`, `@atrib/verify`, `@atrib/cli`, `@atrib/mcp-wrap`, `@atrib/directory`), `@atrib/action-gate` for host-owned action control, `@atrib/sdk` (the consolidated `attest`/`recall` client SDK), the eight cognitive-primitive MCP packages (`@atrib/attest`, the write verb, and `@atrib/recall`, the read verb, plus the legacy `@atrib/emit`, `@atrib/annotate`, `@atrib/revise`, `@atrib/trace`, `@atrib/summarize`, `@atrib/verify-mcp`, kept as re-export shims and permanent tool aliases per [D164](DECISIONS.md#d164-attestrecall-verb-rename-and-primitive-surface-collapse); surface history per [D079](DECISIONS.md#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface) and [D106](DECISIONS.md#d106-verify-is-promoted-to-cognitive-primitive-7)), and three proof/intake packages: `@atrib/openinference`, the reference implementation of [§9](atrib-spec.md#9-runtime-integration-patterns) Pattern #4 with all 10 OpenInference span kinds mapped (TOOL / LLM / AGENT / EMBEDDING / RETRIEVER / RERANKER / CHAIN / GUARDRAIL / EVALUATOR / PROMPT), `@atrib/memory-tool`, the Anthropic Memory Tool wrapper, and `@atrib/runtime-log`, the [D121](DECISIONS.md#d121-runtime-log-proof-manifests-verify-host-owned-run-windows) runtime-log manifest helper package, plus `@atrib/daemon` (binary `atribd`), the [D148](DECISIONS.md#d148-atribd-is-the-public-stateless-native-local-daemon-for-the-primitive-runtime) stateless-native local daemon. `@atrib/action-gate` is published on npm with Trusted Publisher configured for later releases. Version 0.2.0 of `@atrib/runtime-log` was first-published manually, with Trusted Publisher configured for later releases. The [`python/`](python/README.md) directory ships the `atrib` Python SDK (unpublished; PyPI name verified available 2026-07-06), the first non-TypeScript implementation of the [§1](atrib-spec.md#1-attribution-record-format) record layer, held byte-identical to the TypeScript implementation by the shared conformance corpora and a cross-implementation determinism harness. Four services are deployed today: [`services/log-node/`](services/log-node/) (`https://log.atrib.dev/v1`), [`services/graph-node/`](services/graph-node/) (`https://graph.atrib.dev/v1`), [`services/directory-node/`](services/directory-node/) (`https://directory.atrib.dev/v6`), and [`services/archive-node/`](services/archive-node/) (`https://archive.atrib.dev/v1`). Archive-node is the deployed [§2.12](atrib-spec.md#212-record-body-archive-layer) reference service for public body and evidence retrieval. A reproducible end-to-end verifier with 13 gate assertions across 8 named categories (tree integrity, format conformance, checkpoint signature, pubkey-publication agreement, signer scope, attribution, record signature replay, chain integrity) ships at `services/log-node/scripts/verify-loop.mjs` and runs daily in CI against the deployed log. The public block explorer at [`https://explore.atrib.dev/`](https://explore.atrib.dev/) composes the log, graph, directory, and archive evidence APIs into seven views (overview, identity, session, action, demo, trace, anchoring), with Sigma.js-rendered DAGs for session, identity, trace, and demo views. Two verbs close the cognitive loop on the agent side: [`services/atrib-attest/`](services/atrib-attest/) signs the agent's own statements (observations by default; annotations and revisions via the declared `ref` relationship) and [`services/atrib-recall/`](services/atrib-recall/) reads them back (shape-dispatched lookups, informed_by walks in either direction, content search, and handoff verification via the `verification` parameter). The legacy services ([`services/atrib-emit/`](services/atrib-emit/), [`services/atrib-annotate/`](services/atrib-annotate/), [`services/atrib-revise/`](services/atrib-revise/), [`services/atrib-trace/`](services/atrib-trace/), [`services/atrib-verify/`](services/atrib-verify/)) are re-export shims whose binaries forward and whose tool names stay mounted as permanent aliases; [`services/atrib-summarize/`](services/atrib-summarize/) reads N records and synthesizes a narrative via an OpenAI-compatible LLM and stays mounted through the alias window. All remain public stdio binaries. [`services/atribd/`](services/atribd/) mounts the write home, the read home, and summarize in one process and serves the seventeen-tool alias-window union (fifteen legacy names plus the `attest` and `recall` verbs) over stateless Streamable HTTP, direct stdio, or a stdio-to-HTTP proxy shim; it is the recommended local topology per [D148](DECISIONS.md#d148-atribd-is-the-public-stateless-native-local-daemon-for-the-primitive-runtime), with signed records byte-identical to the standalone binaries. The private [`services/atrib-primitives/`](services/atrib-primitives/) runtime remains for compatibility and test coverage. All operator profiles run `@atrib/daemon`. The read primitives consume local mirror, archive body material, or caller-supplied evidence per spec [§5.9](atrib-spec.md#59-local-mirror-conventions), [§2.12](atrib-spec.md#212-record-body-archive-layer), and [§5.5.5](atrib-spec.md#555-handoff-claim-verification).

**Implemented and deployed:** Record signing ([§1](atrib-spec.md#1-attribution-record-format)) including `INFORMED_BY` ([D041](DECISIONS.md#d041-informed_by-linking-primitive-and-informed_by-edge-type)), `PROVENANCE_OF` ([D044](DECISIONS.md#d044-provenance_token-field-for-cross-session-causal-anchoring)), ANNOTATES ([D058](DECISIONS.md#d058-promote-annotation-to-atrib-normative-event_type-byte-0x05)), REVISES ([D059](DECISIONS.md#d059-promote-revision-to-atrib-normative-event_type-byte-0x06)), and `directory_anchor` ([D056](DECISIONS.md#d056-promote-directory_anchor-to-atrib-normative-event_type-byte-0x04)) event types. Parent-child producer threading now has a single same-session subagent env bundle: `ATRIB_CONTEXT_ID`, `ATRIB_CHAIN_TAIL_<context_id>`, and `ATRIB_PARENT_RECORD_HASH`, built by `@atrib/mcp` `buildSubagentProducerEnv()` when the parent dispatch hash is known before the child signs ([D104](DECISIONS.md#d104-parent-child-threading-uses-atrib_parent_record_hash), [D115](DECISIONS.md#d115-agent-to-subagent-handoff-uses-a-three-signal-producer-bundle)). Source-aware producer validation lets `@atrib/mcp-wrap` keep configured `informedByPaths` only when refs resolve through the wrapper mirror, local mirrors, or log lookup, while parent env seeds stay producer-owned ([D116](DECISIONS.md#d116-producer-side-informed_by-validation-is-source-aware)). Pattern 3 handoff claim acceptance lets a receiving agent verify another agent's `record_hash`, body commitment, inclusion proof, checkpoint signature, signer trust, context policy, and freshness before signing an `informed_by` follow-up; `@atrib/verify` provides the library helper and `@atrib/verify-mcp` exposes the `atrib-verify` primitive ([§5.5.5](atrib-spec.md#555-handoff-claim-verification), [D105](DECISIONS.md#d105-pattern-3-handoff-claims-use-verifier-side-claim-acceptance), [D106](DECISIONS.md#d106-verify-is-promoted-to-cognitive-primitive-7)). Sandboxed producer key isolation ([§1.4.6](atrib-spec.md#146-signing-key-isolation-for-sandboxed-execution), [D102](DECISIONS.md#d102-sandboxed-signer-proxy-keeps-keys-outside-sandbox)) keeps signing keys outside sandboxed execution via a tested host signer-proxy example. Transparency log ([§2](atrib-spec.md#2-merkle-log-protocol)) with persistent storage, C2SP-canonical signed-note checkpoints ([D031](DECISIONS.md#d031-reconcile-243-signed-note-divergence-from-c2sp)), and optional SSE / JSON Feed subscription surfaces ([§2.5.6](atrib-spec.md#256-log-subscription-surfaces-optional), [D103](DECISIONS.md#d103-log-subscriptions-use-sse-plus-json-feed-over-commitment-visible-fields)). Graph query interface ([§3](atrib-spec.md#3-graph-query-interface)) with full nine-edge [§3.2.4](atrib-spec.md#324-edge-derivation-rules), `/v1/trace/<record_hash>`, `/v1/chain/<record_hash>`, `/v1/creators/<key>/graph`, and an explorer primary trace path that composes trace plus chain without changing the protocol APIs ([D068](DECISIONS.md#d068-trace-operations-split-provenance-trace-vs-chronology-chain), [D118](DECISIONS.md#d118-primary-trace-path-is-a-presentation-rule-over-trace-and-chain)). Substrate-wide conformance corpora ([D101](DECISIONS.md#d101-substrate-wide-adversarial-conformance-corpus)) pin [§1.4](atrib-spec.md#14-signing-and-verification) adversarial signing vectors, [§3.2.4](atrib-spec.md#324-edge-derivation-rules) full edge derivation, [D067](DECISIONS.md#d067-multi-producer-chain-composition-precedence-contract) multi-producer race vectors, and [D052](DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records) creator-signer separation. Calculation algorithm ([payments profile §8](docs/payments-profile.md#8-the-calculation-algorithm)) with deterministic distribution and [payments profile §9](docs/payments-profile.md#9-settlement-recommendation-document) settlement document signing. AKD-backed public-key directory ([§6](atrib-spec.md#6-key-directory), [D034](DECISIONS.md#d034-public-key-directory-architecture-akd-unblinded-vrf-blinded-mode-available-for-downstream-consumers)) deployed at `https://directory.atrib.dev/v6` (unblinded mode for atrib's own use; VRF-blinded mode available for downstream consumers requiring privacy-preserving lookup). Per-operation directory anchoring back into the log ([§6.2.4](atrib-spec.md#624-anchor-cross-reference-into-the-tessera-log)). Key rotation and revocation ([§1.9](atrib-spec.md#19-key-rotation-and-revocation), [D033](DECISIONS.md#d033-key-rotation-and-revocation)): verifier honors revocations, `@atrib/cli` exposes `publish-claim` / `revoke` commands, conformance corpus generated. Capability declarations ([§6.7](atrib-spec.md#67-capability-declarations), [D051](DECISIONS.md#d051-capability-scoped-records-via-directory-published-envelopes)) surfaced by the verifier as soft signals per [§6.7.3](atrib-spec.md#673-signal-not-invalidation). Cross-attestation requirement on transaction records ([§1.7.6](atrib-spec.md#176-cross-attestation-requirement-for-transaction-records), [D052](DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records)) flagged by the verifier when fewer than two distinct signer keys verify, composing with a caller-supplied trust set so two untrusted co-signers surface as `sybil_suspected` rather than counting as authority ([D149](DECISIONS.md#d149-cross-attestation-composes-with-a-trust-set-for-sybil-resistance)); the same trusted-corroboration check generalizes off transactions to any signed target through the attestation extension ([§8.7.6](atrib-spec.md#876-attestation-corroboration-extension), [D150](DECISIONS.md#d150-attestation-is-corroboration-generalized-off-transactions-extension-first)), and `@atrib/action-gate` turns both into fail-closed policies. AP2 / Verifiable Intent evidence checks ([payments profile §11](docs/payments-profile.md#11-ap2--verifiable-intent-evidence-checks), [D089](DECISIONS.md#d089-ap2--verifiable-intent-evidence-checks-live-in-atribverify), [D090](DECISIONS.md#d090-ap2-receipt-jwt-verification-uses-jose-in-atribverify), [D091](DECISIONS.md#d091-ap2--vi-sd-jwt-conformance-uses-openwallet-sd-jwt-js), [D092](DECISIONS.md#d092-ap2--vi-mandate-constraints-are-typed-verifier-evidence), [D093](DECISIONS.md#d093-ap2--vi-fixtures-are-the-local-verifier-corpus), [D094](DECISIONS.md#d094-ap2--vi-evidence-attaches-to-verifier-results-as-a-tiered-block), [D096](DECISIONS.md#d096-ap2--vi-crypto-conformance-uses-a-pinned-offline-corpus), [D097](DECISIONS.md#d097-ap2-live-interop-uses-an-opt-in-reference-artifact-harness), [D098](DECISIONS.md#d098-ap2-receipts-stay-external-evidence-for-cross-attestation), [D107](DECISIONS.md#d107-ap2-counterparty-attestation-signs-atrib-transaction-bytes)) validate AP2 receipt references, signed receipt JWTs, VI SD-JWT / VC mandate chains, typed AP2 mandate constraints, offline JOSE / JWKS / SD-JWT crypto edge cases, opt-in AP2 reference artifacts, and AP2 transaction-record artifacts off the detector path. AP2 Path 2 transaction emission uses a stable receipt identity ladder when receipt or mandate identity is visible ([D095](DECISIONS.md#d095-ap2-path-2-content_id-uses-a-stable-receipt-identity-ladder)) and carries an agent `signers[]` entry over the [D052](DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records) canonical bytes; AP2 counterparties can add their own signer entry with `signTransactionAttestation()`. `verifyRecord()` and `AtribVerifier.verify()` attach supplied evidence as tiered `ap2_vi_evidence` without counting AP2 receipt JWTs as transaction signers. Privacy postures ([§8](atrib-spec.md#8-privacy-postures), [D045](DECISIONS.md#d045-privacy-postures-normative-spec-section)) with disclosure dials per record. Opt-in autoChain plus a cross-producer chain-tail handoff via `ATRIB_CHAIN_TAIL_<context_id>` env var for hosts that don't propagate atrib's outbound token.

`@atrib/verify` also exposes generic tiered authorization evidence blocks ([§5.5.6](atrib-spec.md#556-generic-authorization-evidence-blocks), [D109](DECISIONS.md#d109-mcpoauth-authorization-evidence-uses-generic-tiered-evidence-blocks), [D110](DECISIONS.md#d110-mcpoauth-evidence-capture-closes-the-producer-to-verifier-loop), [D111](DECISIONS.md#d111-host-owned-oauth-evidence-infrastructure), [D119](DECISIONS.md#d119-aauth-evidence-stays-verifier-side), [D132](DECISIONS.md#d132-x401-proof-evidence-stays-verifier-side-authorization-evidence), [D134](DECISIONS.md#d134-x401-producer-capture-and-propagation-stay-sanitized)). `verifyRecord()` can attach MCP/OAuth, AAuth, or x401 evidence under `evidence[]` and consume caller-supplied `resolvedFacts` for capability checks without changing base record validity. x401 evidence proves that a route-specific proof requirement was checked by a verifier; it does not prove payment completion. `@atrib/mcp` can capture validated MCP `authInfo`, AAuth callback evidence, and opt-in x401 proof headers into local-only sidecars, including DPoP proof material, HTTP signature facts, token hashes, proof hashes, proof-gate constraints, and caller-owned x401 origin, issuer-trust, and proof-payment binding outcomes without storing raw bearer tokens, raw AAuth JWTs, or private credential payloads by default. Hosts that need live OAuth introspection can use `introspectOAuthToken()` to produce caller-owned evidence, and AAuth or x401 callers supply trusted JWKS, verified claims, decoded claims, credential-verifier outcomes, or hashed external verifier references under an explicit verification policy.

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
- **[§1](atrib-spec.md#1-attribution-record-format):** Attribution record format, signing, propagation, transaction event boundary
- **[§1.9](atrib-spec.md#19-key-rotation-and-revocation):** Key rotation and revocation ([D033](DECISIONS.md#d033-key-rotation-and-revocation))
- **[§2](atrib-spec.md#2-merkle-log-protocol):** Merkle log protocol (C2SP tlog-tiles, proofs, witnessing)
- **[§3](atrib-spec.md#3-graph-query-interface):** Graph query interface (nine edge types)
- **[§4](atrib-spec.md#4-attribution-policy-format):** Position of the policy layer; the policy format, negotiation, and calculation live in the [payments profile](docs/payments-profile.md) ([D147](DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core))
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
