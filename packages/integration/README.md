# `@atrib/integration` _(private)_

**Cross-package end-to-end tests and runnable framework examples for Atrib's verifiable action layer. Not published to npm.**

This package exists for two purposes:

1. **Cross-package integration tests** that exercise `@atrib/mcp` + `@atrib/agent` + `@atrib/verify` + `@atrib/log-dev` together against real `@modelcontextprotocol/sdk` clients and servers; the kind of test that doesn't belong in any single public package because it would create circular dependencies or pull in dev-only deps.
2. **Runnable framework examples** showing how to wire atrib into every supported MCP host and runtime boundary: Claude Agent SDK, Cloudflare Agents, Vercel AI SDK, LangChain JS, LangGraph Store memory, LangGraph Python checkpointing, LlamaIndex.TS memory, LlamaIndex Python memory, Letta memory, A2A handoff evidence, Google ADK TypeScript and Python plugin callbacks, Google ADK Python and TypeScript decision-ledger proofs, Google stack chain proof plus visual workbench, OpenAI Agents runtime receipts, OpenAI Responses tool-call receipts, Mastra MCP and workflow runtime receipts, Microsoft Agent Framework workflow receipts, browser workflow receipts, Browserbase Stagehand and Firecrawl proof artifacts, ActiveGraph runtime-log proofs, the reference runtime-log JSONL source, the dogfood Agent Bridge runtime-log proof, the secondary runtime-log adapter pair, runtime-log verifier UX, Brief dcbench evidence, proof-log receipts, evidence-packet verification, trace repair suspect ranking, Graphiti, the signer-proxy sandbox pattern, action-control gate proofs, local x401 proof-gate propagation, plus the standalone end-to-end demo.

If you are evaluating how to plug atrib into a runtime, the examples here are
the runnable reference. If you are contributing to atrib, the tests here are how
the cross-package contract is enforced.

## Adapter family contract

Integration proofs now separate framework tool-call middleware from host runtime
adapters.

Framework middleware covers MCP and SDK call paths where application code owns
the agent loop. Host runtime adapters cover harness-owned events such as native
tool hooks, lifecycle hooks, approvals, subagents, span intake, runtime-log
windows, and hosted exports.

The shared helper for host proofs lives at
[`src/host-runtime-proof.ts`](src/host-runtime-proof.ts). It classifies a host
surface, creates a schema-pinned proof envelope, and checks that one host event
has only one `tool_call` signing owner. OpenClaw, Hermes, and future harness
proofs should use that vocabulary before they become package or upstream PR
candidates.

## Try the end-to-end demo

The fastest way to see atrib working end-to-end in a single process:

```bash
ATRIB_PRIVATE_KEY=$(node -e 'console.log(Buffer.from(crypto.randomBytes(32)).toString("base64url"))') \
  pnpm --filter @atrib/integration demo
```

In ~150 lines of TypeScript, the demo runs a fake MCP merchant tool server (with `@atrib/mcp`'s `atrib()` middleware), a fake agent client (with `@atrib/agent`'s `wrapMcpClient`), an in-process Merkle log stub (`@atrib/log-dev`), and a stubbed x402 payment that triggers the production transaction-detection logic. Output is colorized chain-by-chain in your terminal:

```
[demo] starting dev log...
[demo] dev log running at http://127.0.0.1:55013
[log]  +tool_call   ctx=73df4367… chain=sha256:d5a8f8996… idx=0
[log]  +tool_call   ctx=73df4367… chain=sha256:7e5ae4b5b… idx=1
[log]  +transaction ctx=73df4367… chain=sha256:cda3d448c… idx=2
[demo] 3 records in the log (2 tool_call, 1 transaction)
```

Every signature, every chain hash, and every transaction event in that output is **real production code**. The fakery is in the surrounding environment (hardcoded merchant responses, stubbed x402 header); not in the protocol layer. See [`examples/end-to-end/README.md`](examples/end-to-end/README.md) for the full walkthrough.

## Examples

| Example                           | Path                                                                                 | What it shows                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **End-to-end demo**               | [`examples/end-to-end/`](examples/end-to-end/)                                       | All moving parts in a single process: dev log + merchant + agent + payment + visualizer. Run with `pnpm demo`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Claude Agent SDK**              | [`examples/claude-agent-sdk/`](examples/claude-agent-sdk/)                           | Both Case A (in-process tools. wrap the SDK's `McpServer` with `atrib()`) and Case B (third-party MCP servers; proxy via `createAtribProxy`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Cloudflare Agents**             | [`examples/cloudflare-agents/`](examples/cloudflare-agents/)                         | Both surfaces: server-side `McpAgent` (Surface 1) and client-side `Agent` calling upstream MCP servers (Surface 2), with live Worker proofs, an interactive HITL approval-trace example, and a [D111](../../DECISIONS.md#d111-host-owned-oauth-evidence-infrastructure) OAuth evidence infrastructure Worker reference.                                                                                                                                                                                                                                                                                                                                                                                |
| **Vercel AI SDK + AI Gateway**    | [`examples/vercel-ai-sdk/`](examples/vercel-ai-sdk/)                                 | Vercel AI SDK with MCP tools, routed through the AI Gateway (recommended pattern for model fallback + observability).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **LangChain JS**                  | [`examples/langchain-js/`](examples/langchain-js/)                                   | `MultiServerMCPClient` patched in-place by `attributeLangchainMcp` so every server it manages emits attributed records. including forked clients used for per-call header workflows.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **LangGraph Store memory**        | [`examples/langgraph-store/`](examples/langgraph-store/)                             | A real `@langchain/langgraph` `entrypoint` receives an attributed `InMemoryStore`. LangGraph routes workflow memory calls through `BaseStore.batch`, public records stay hash-only, and local sidecars keep the underlying put/get/search payloads.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **LangGraph Python checkpoint**   | [`examples/langgraph-python-checkpointer/`](examples/langgraph-python-checkpointer/) | A real Python `langgraph==1.2.4` `StateGraph` runs with `compile(checkpointer=InMemorySaver())`; the smoke signs `get_tuple`, `put`, and `put_writes` events as hash-only records while local sidecars keep checkpoint state and writes.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **LlamaIndex.TS memory**          | [`examples/llamaindex-memory/`](examples/llamaindex-memory/)                         | A real `llamaindex` `createMemory()` instance is wrapped at the memory object boundary. App code still calls `add`, `get`, `getLLM`, and `snapshot`; public records stay hash-only, and raw memory text stays in local sidecars.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **LlamaIndex Python memory**      | [`examples/llamaindex-python-memory/`](examples/llamaindex-python-memory/)           | A real Python `llama-index==0.14.22` `Memory` instance runs `put`, `put_messages`, `get`, `get_all`, `set`, and `reset` with a `StaticMemoryBlock`; the smoke signs each command as a hash-only record while local sidecars keep raw memory text.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Letta memory**                  | [`examples/letta-memory/`](examples/letta-memory/)                                   | A real `letta==0.16.8` package import runs `LettaCoreToolExecutor.execute` for core and archival memory tools plus `ExternalMCPToolExecutor.execute` tag parsing. Fake managers own side effects, public records stay hash-only, and raw memory text stays in local sidecars.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **A2A handoff evidence**          | [`examples/a2a-handoff/`](examples/a2a-handoff/)                                     | A real `@a2a-js/sdk` AgentCard, JSON-RPC client, and request handler carry a signed Agent Card plus atrib evidence packet in an A2A `DataPart`; the receiver verifies it before signing a follow-up with `informed_by`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Google ADK TypeScript proof**   | [`examples/google-adk-typescript/`](examples/google-adk-typescript/)                 | A real `@google/adk@1.2.0` `InMemoryRunner`, `BasePlugin`, and `FunctionTool` path signs callback records from `afterToolCallback`, signs allow, refuse, and policy-error decisions from `beforeToolCallback`, and keeps raw payloads plus raw principals in local sidecars.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Google ADK Python proof**       | [`examples/google-adk-python/`](examples/google-adk-python/)                         | A real Python `google-adk==2.3.0` `InMemoryRunner`, `BasePlugin`, and `FunctionTool` path signs callback records from `after_tool_callback`, signs allow, refuse, and policy-error decisions from `before_tool_callback`, and keeps raw tool payloads plus raw principals in local sidecars.                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Google stack chain proof**      | [`examples/google-stack-chain/`](examples/google-stack-chain/)                       | A local proof chain that links AP2 / VI receipt verification, A2A signed handoff evidence, a Google ADK Python allow decision, and the ADK Python tool outcome through verifier-resolved `informed_by` records, with a deterministic snapshot, BigQuery Agent Analytics-shaped local fixture, Cloud Run-backed runtime path, and live-first visual workbench.                                                                                                                                                                                                                                                                                                                                          |
| **OpenAI Agents runtime**         | [`examples/openai-agents-runtime/`](examples/openai-agents-runtime/)                 | Real `@openai/agents` `Agent` instances, a `run()` loop, a local `tool()` function, and a real `handoff()` emit signed hash-only atrib records from the SDK `agent_tool_end` and `agent_handoff` lifecycle events while a scripted model keeps the proof local and credential-free.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **OpenAI Responses tool call**    | [`examples/openai-responses/`](examples/openai-responses/)                           | Real `openai` Node SDK `responses.create` calls run against a local OpenAI-shaped fixture: the first returns a `function_call`, the second sends `function_call_output`, and atrib signs one hash-only tool-call record while local sidecars keep raw arguments and result material.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Mastra runtime receipts**       | [`examples/mastra-runtime/`](examples/mastra-runtime/)                               | Real Mastra runtime proofs for MCP tool execution and workflow suspend/resume: the MCP smoke signs one hash-only tool-call record over `MCPClient` plus `MCPServer`, and the workflow smoke signs start, suspend, resume, and result records through `createWorkflow()`, `createStep()`, `Run.start()`, `Run.resume()`, and `InMemoryStore`.                                                                                                                                                                                                                                                                                                                                                           |
| **Microsoft Agent Framework**     | [`examples/microsoft-agent-framework/`](examples/microsoft-agent-framework/)         | A real Python `agent-framework-core==1.7.0` `WorkflowBuilder` graph with two `Executor` nodes emits `WorkflowEvent`s; the smoke signs each event as a hash-only atrib record while local sidecars keep workflow data.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Action-control gate proof**     | [`examples/action-control-gate/`](examples/action-control-gate/)                     | A credential-free browser-shaped fixture uses `@atrib/action-gate` to allow one read action, block one external write, and escalate one customer-message action. The proof signs decision and outcome records, verifies the binding, and proves blocked or escalated action bodies did not run.                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Browser workflow receipt**      | [`examples/browser-workflow/`](examples/browser-workflow/)                           | Deterministic, browser-use-hosted, and Stagehand local-session smokes sign observe, click, fill, and submit as hash-only atrib records while local sidecars keep page, selector, form, and result material. The browser-use smoke uses a real `BrowserSession`; the Stagehand smoke uses a real local `@browserbasehq/stagehand` session with pre-resolved `act` actions.                                                                                                                                                                                                                                                                                                                              |
| **Browserbase Stagehand proof**   | [`examples/browserbase-stagehand/`](examples/browserbase-stagehand/)                 | Browserbase MCP shaped `start`, `navigate`, `observe`, `act`, `extract`, and `end` calls through `@atrib/mcp-wrap`. Fixture mode stays local for tests. Live mode can wrap hosted Browserbase Streamable HTTP MCP or self-hosted STDIO, submits narrow records to the public log, and writes `proof-packets/browserbase-stagehand/` while keeping session replay, selectors, snapshots, and form values hash-only. Optional `@atrib/action-gate` support gates the `act` step before Browserbase execution and adds decision/outcome hashes that a later session, another agent, or a reviewer team can verify. The live demo serves a proof console from `examples/browserbase-stagehand/live-demo/`. |
| **Firecrawl web ingestion proof** | [`examples/firecrawl-web-ingestion/`](examples/firecrawl-web-ingestion/)             | Firecrawl MCP shaped `firecrawl_search`, `firecrawl_scrape`, `firecrawl_extract`, and bounded `firecrawl_crawl` calls through `@atrib/mcp-wrap`. Fixture mode stays local for tests. Live mode submits narrow records to the public log and writes `proof-packets/firecrawl-web-ingestion/` while keeping query, URL, scraped content, extracted text, and crawl job id hash-only.                                                                                                                                                                                                                                                                                                                     |
| **ActiveGraph runtime log**       | [`examples/activegraph-runtime-log/`](examples/activegraph-runtime-log/)             | ActiveGraph `v1.1.0` `export-trace` JSONL fixture converted into a `log_window_manifest`, with approval-gate receipts over `approval.proposed`, `approval.granted`, and the resulting `object.created` events. ActiveGraph owns the runtime log; atrib verifies the bounded exported claim.                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Reference runtime log**         | [`examples/reference-runtime-log/`](examples/reference-runtime-log/)                 | Local append-only JSONL runtime-log source that exercises `append`, `exportWindow`, event-kind projections, fork bindings, compaction bindings, and side-effect receipt refs without storing raw event bodies in the manifest.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Dogfood runtime log**           | [`examples/dogfood-runtime-log/`](examples/dogfood-runtime-log/)                     | Sanitized Agent Bridge job-window proof from a real runtime-log proof-kit loop. It binds status, result record refs, annotation refs, Agent Bridge receipt ids, and signed refs while omitting raw bridge content and private note bodies.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Secondary runtime log**         | [`examples/secondary-runtime-log/`](examples/secondary-runtime-log/)                 | LangGraph-checkpointer-shaped runtime source plus OpenInference span-tree projection. It proves the source/projection distinction by accepting LangGraph resume and fork semantics while rejecting any OpenInference projection that claims runtime-log completeness.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Runtime-log verifier UX**       | [`examples/runtime-log-verifier-ux/`](examples/runtime-log-verifier-ux/)             | File-backed static proof packets rendered from ActiveGraph, reference JSONL, dogfood Agent Bridge, LangGraph checkpoint, and OpenInference projection manifests. The smoke proves valid packets show reviewer fields and an invalid packet surfaces named issue codes.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Brief dcbench evidence**        | [`examples/brief-dcbench/`](examples/brief-dcbench/)                                 | A dcbench-shaped proof that signs context lookup, agent action, and score as hash-only records linked through `informed_by`, while local sidecars keep the task prompt and rubric material. It can read `BENCHMARK_TASKS` from a local `brief-hq/dcbench` checkout through `DCBENCH_REPO`.                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Proof-log receipt**             | [`examples/proof-log-receipt/`](examples/proof-log-receipt/)                         | A single-hash receipt that verifies checkpoint signature, inclusion proof, archive body retrieval, archive evidence projection, and `@atrib/verify` output for one signed record.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Evidence packet eval**          | [`examples/evidence-packet-eval/`](examples/evidence-packet-eval/)                   | A five-arm verifier fixture for current packet, stale packet, wrong signer, tampered body, and packet-off cases. The accepted arm signs an Agent B follow-up with `informed_by`; the control arms are rejected before follow-up work can cite them. The same fixture also has an Inspect-shaped scorer proof.                                                                                                                                                                                                                                                                                                                                                                                          |
| **Trace repair suspect**          | [`examples/trace-repair-suspect/`](examples/trace-repair-suspect/)                   | An offline trace-repair fixture that verifies a signed trace packet, rejects stale prior evidence, ranks the failed tool action as the likely repair target, and signs a diagnostic outcome linked to the failure and suspect through `informed_by`.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **OpenInference**                 | [`examples/openinference/`](examples/openinference/)                                 | OpenTelemetry span composition: one OpenInference stream can feed Langfuse/Phoenix/OTLP for ops and atrib for signed evidence plus recall, trace, and summarize.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **mem0 boundary**                 | [`examples/mem0/`](examples/mem0/)                                                   | `Memory.add()` and `Memory.search()` boundary wrapper plus real `mem0ai/oss` failure and success smokes, a real `MemoryClient` local-API smoke, and a Python OSS `Memory` host-signing smoke. It preserves mem0-shaped values, signs hash-only records, and keeps raw memory bodies in local sidecars.                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Graphiti**                      | [`examples/graphiti/`](examples/graphiti/)                                           | Graphiti MCP-shaped `add_memory`, `search_memory_facts`, and `get_episodes` smoke through `@atrib/mcp-wrap`, plus an optional real `Graphiti.add_episode(...)` core smoke against FalkorDB and local Ollama. Both preserve Graphiti-shaped results, sign hash-only records, and keep raw episode bodies out of public records.                                                                                                                                                                                                                                                                                                                                                                         |
| **Signer proxy**                  | [`examples/signer-proxy/`](examples/signer-proxy/)                                   | Sandboxed-execution composition: sandbox code requests a signature, while the host signer keeps the Ed25519 key outside the sandbox and owns signer-controlled fields.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

Every example has a `README.md` next to it explaining what is wired up and which
lines an integrator would copy.

Browserbase now has a live demo layer in addition to fixture and public proof
artifact paths. Deployment remains a human gate. Hosted Browserbase fresh runs
can return temporary model-capacity errors, so the deployed demo must show
failed runs plainly and rate-limit retries. Firecrawl intentionally stays at
fixture plus fixed public proof artifact until a maintainer asks for a hosted
crawl surface, because hosted crawling needs stricter abuse and cost controls.

## Demo Record Treatment

Example-generated records fall into three classes. Keep these classes separate
when reading the public log, writing examples, or turning demo output into a
public proof artifact.

| Class                       | Examples                                                                                                                                       | Treatment                                                                                                                                                                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Offline and local demos** | `pnpm demo`, Google ADK smokes, Google stack chain proof, framework memory smokes, graph/conformance tests                                     | Sign real records, but keep them in local process memory, local sidecars, local dev logs, or fixture files. These records prove the integration boundary without writing to `log.atrib.dev` or `archive.atrib.dev`.                           |
| **Public proof generators** | Cloudflare live Worker proofs, Browserbase Stagehand live proof, Firecrawl web ingestion live proof, proof-log receipt, live MCP/OAuth archive | Intentionally submit narrow, inspectable records to the public log and, when needed, the archive service. Treat those records as public proof artifacts tied to a run, not as operator memory or default recall context.                      |
| **Live capture artifacts**  | AP2 Google live capture, upstream AP2 sample extraction, local participant artifacts                                                           | Capture upstream events and write signed artifacts for verifier replay. They should only become public log records when an explicit proof script says so. External protocol signatures remain verifier evidence, not atrib signer identities. |

The machine-readable source for current surfaces is
[`demo-record-surfaces.json`](demo-record-surfaces.json). It tracks both the
record class and the endpoint posture because those are different axes. For
example, `calc-demo` may read the public checkpoint while still using only local
input records, so it is an offline/local record surface with public-read endpoint
posture. Public proof generators are the only class that should use
public-write endpoint posture.

`pnpm doc-sync` runs
[`scripts/check-demo-record-surfaces.mjs`](scripts/check-demo-record-surfaces.mjs)
so new integration package commands and top-level example directories must have
a class before CI passes.

The default Vitest suite must not contact production atrib services. The
integration test setup rejects fetches to `log.atrib.dev`, `archive.atrib.dev`,
`graph.atrib.dev`, `directory.atrib.dev`, and `explore.atrib.dev`. Tests should
use localhost endpoints, in-process dev logs, or a fully mocked fetch. Public
proof commands run outside Vitest and must state in their README or command docs
when they publish public records.

When a new demo writes to the public log, store or print enough run metadata to
separate it from dogfood memory later: the command name, example path,
`context_id`, record hashes, signer role, endpoint, and caveats. Public demo
records are valid protocol evidence, but they should not be counted as evidence
that the operator's daily cognitive-primitive loop is healthy unless the query is
explicitly scoped to that demo signer or context.

## AP2 Live Interop

`@atrib/integration` includes an opt-in AP2 reference artifact harness for runs produced by `google-agentic-commerce/AP2` samples or a compatible AP2 participant.

Full upstream AP2 scenario launches require Google model auth or Vertex ADC and stay outside default CI. Do not commit `.env` files or API keys. A successful upstream run should be exported into the JSON artifact contract below, then checked through the same harness as local fixtures.

The harness does not start AP2 services in default CI. Instead, it reads AP2 result and evidence artifacts, then runs the production atrib detector and verifier:

```bash
ATRIB_AP2_INTEROP_RESULT_JSON=/path/to/ap2-result.json \
ATRIB_AP2_INTEROP_EVIDENCE_JSON=/path/to/ap2-vi-evidence.json \
ATRIB_AP2_INTEROP_TRANSACTION_RECORD_JSON=/path/to/atrib-transaction-record.json \
ATRIB_AP2_INTEROP_REQUIRE_COUNTERPARTY_ATTESTATION=1 \
ATRIB_AP2_INTEROP_NOW_SECONDS=1779840000 \
  pnpm --filter @atrib/integration ap2-live-interop
```

If a local command should create the artifacts first, pass it with `ATRIB_AP2_INTEROP_COMMAND`. Detection-only smoke checks may set `ATRIB_AP2_INTEROP_ALLOW_DETECTION_ONLY=1`, but full AP2 interop should include the evidence bundle so `verifyAp2ViEvidenceAsync()` runs off the detector path.

The transaction-record artifact is optional unless `ATRIB_AP2_INTEROP_REQUIRE_COUNTERPARTY_ATTESTATION=1` is set. When present, the harness runs `verifyRecord()`, checks the record `content_id` against the detected AP2 receipt identity, and requires `cross_attestation.missing: false`.

To create a local AP2 participant artifact set from an AP2 result and AP2 / VI evidence bundle, run:

```bash
pnpm --filter @atrib/integration ap2-local-participant \
  --result-json test/fixtures/ap2-vi-reference/ap2-vi-reference-result.json \
  --evidence-json test/fixtures/ap2-vi-reference/ap2-vi-reference-evidence.json \
  --out-dir /tmp/atrib-ap2-local-participant
```

The local participant generator rehydrates split JWT fixtures when needed, normalizes full AP2 delegated mandate chains to their closed mandate JWT reference material, derives the AP2 transaction `content_id` through `detectTransaction()`, and writes `ap2-result.json`, `ap2-vi-evidence.json`, and `atrib-transaction-record.json`. The transaction record carries both an agent signer and a local counterparty signer over atrib's canonical transaction bytes. It is not a substitute for a real merchant/PISP signature, but it exercises the same `signers[]` path a real AP2 participant must use.

To convert the official Google AP2 human-not-present card sample output without manual JWT segment surgery, run:

```bash
pnpm --filter @atrib/integration ap2-google-sample-extract \
  --events-json /tmp/google-ap2-card-events.json \
  --temp-db-dir /tmp/google-ap2-reference/code/samples/python/scenarios/a2a/human-not-present/cards/.temp-db \
  --out-dir /tmp/atrib-ap2-google-sample
```

The extractor reads captured A2A function-response events, finds `complete_checkout`, `create_checkout_presentation`, and `create_payment_presentation`, reads the full delegated mandate chains from the sample `.temp-db`, adds the sample merchant public JWK as the trusted AP2 receipt key, and then calls the local participant generator. If `--now-seconds` is omitted, it uses the checkout receipt JWT `iat`.

The extractor accepts the official raw `.temp-db` mandate-chain files. The committed Google sample fixture stores the same public sample JWT and SD-JWT material in split form, then rejoins it at runtime so secret scanners do not treat presentation artifacts as credentials.

The boundary is intentional: the AP2 merchant ES256 receipt signature remains verifier evidence. The generated atrib transaction record still uses local Ed25519 agent and counterparty signers unless a real AP2 participant supplies an atrib signer for the same transaction bytes.

To capture a fresh official Google AP2 human-not-present card run, first start the upstream sample from a local `google-agentic-commerce/AP2` checkout. This works with either `GOOGLE_API_KEY` or Vertex ADC:

```bash
cd /tmp/google-ap2-reference
GOOGLE_GENAI_USE_VERTEXAI=true \
GOOGLE_CLOUD_PROJECT=atrib-ap2-demo \
GOOGLE_CLOUD_LOCATION=global \
  bash code/samples/python/scenarios/a2a/human-not-present/cards/run.sh
```

With those services running, drive the AP2 A2A flow and emit the atrib packet:

```bash
pnpm --filter @atrib/integration ap2-google-live-capture \
  --out-dir /tmp/google-ap2-live-capture \
  --temp-db-dir /tmp/google-ap2-reference/code/samples/python/scenarios/a2a/human-not-present/cards/.temp-db \
  --context-id google-ap2-live-vertex-20260609
```

The capture script sends the delegated-drop request, approves the mandate, triggers the merchant price-drop endpoint, waits for `purchase_complete`, writes `events.json` and `transcript.json`, then runs the same extractor and interop verifier with counterparty attestation required. If `--temp-db-dir` is omitted, it writes only the captured A2A events and transcript so the operator can inspect them before extraction.

The fixture directory [`test/fixtures/ap2-reference/`](test/fixtures/ap2-reference/) contains compact AP2 receipt JWT artifacts generated from the official `google-agentic-commerce/AP2` Python SDK. Regenerate them from a local AP2 checkout with:

```bash
uv run --project /tmp/google-ap2-reference \
  python packages/integration/scripts/generate-ap2-reference-receipts.py \
  --ap2-repo /tmp/google-ap2-reference
```

Those fixtures exercise the AP2 SDK receipt-JWT path in default CI while keeping full AP2 scenario launches opt-in.

The fixture directory [`test/fixtures/ap2-vi-reference/`](test/fixtures/ap2-vi-reference/) combines the official AP2 Python SDK with the public `agent-intent/verifiable-intent` reference implementation. Regenerate it from local upstream checkouts with:

```bash
uv run --with cryptography --with jwcrypto --with pydantic \
  python packages/integration/scripts/generate-ap2-vi-reference-evidence.py \
  --ap2-repo /tmp/google-ap2-reference \
  --vi-repo /tmp/verifiable-intent-reference
```

That fixture creates L1, L2, and split L3 VI credentials through the VI reference library, verifies them with the upstream VI verifier, mints compact AP2 receipt JWTs through the AP2 SDK, and then feeds the combined artifact through atrib's live interop harness.

## MCP/OAuth Evidence Harness

`@atrib/integration` includes a local MCP/OAuth evidence harness that exercises the producer-to-verifier path without contacting an authorization server:

```bash
pnpm --filter @atrib/integration mcp-oauth-evidence
```

The harness wraps a mock MCP server with `@atrib/mcp`, passes validated `authInfo` plus DPoP request metadata through a tool call, captures the local-only `authorizationEvidence` sidecar, and then verifies the signed record with `@atrib/verify`. It proves the raw bearer token stays out of the sidecar, the DPoP proof binds to the access-token hash and `cnf.jkt`, and `resolvedFacts.tool_name` lets capability checks use local body facts without changing record validity.

To create a public archived OAuth evidence fixture for explorer QA, run:

```bash
pnpm --filter @atrib/integration mcp-oauth-live-archive
```

The live archive script uses the same fixture MCP authorization environment, signs request and result commitments, submits the record to `log.atrib.dev`, archives the record body and selected evidence at `archive.atrib.dev`, fetches the evidence projection, checks that the raw bearer token did not publish, and prints the public explorer action URL. Override endpoints with `ATRIB_LIVE_OAUTH_LOG_ENDPOINT`, `ATRIB_LIVE_OAUTH_ARCHIVE_ENDPOINT`, and `ATRIB_LIVE_OAUTH_EXPLORER_ORIGIN` when testing against local or staging services.

For deployments that need shared DPoP replay state or controlled opaque-token introspection, [`examples/cloudflare-agents/oauth-evidence-infra/`](examples/cloudflare-agents/oauth-evidence-infra/) provides a Cloudflare Worker and Durable Object reference for the `@atrib/verify` HTTP replay-cache and introspection helpers.

## x401 Proof Gate Harness

`src/x401-proof-gate.ts` is the local current-spec x401 E2E harness. It starts a protected HTTP endpoint, returns `401` with `PROOF-REQUEST`, rejects a wrong request id, rejects a stale nonce, accepts a successful `PROOF-RESPONSE`, signs the attempted action, signs the successful action with `informed_by` pointing at the attempt, verifies the x401 evidence through `@atrib/verify`, and returns a public packet with proof hashes and payment separation.

The same module also runs a two-endpoint propagation harness. Each endpoint gets its own request id, nonce, proof evidence, attempted action, and successful action in the same `context_id`. The second successful action links to both its own attempt and the first successful action through `informed_by`. This covers the atrib side of multi-endpoint propagation without inventing a combined x401 request format before Proof settles that upstream shape.

The composition harness verifies x401 and AAuth evidence on the same successful action, while a separate x402 detector records payment completion. This proves the intended relationship: x401 is the proof gate, AAuth is agent/resource authorization, and x402, AP2 / VI, MPP, ACP, UCP, or a2a-x402 remain the payment or transaction rails.

The harness is intentionally local. It proves atrib's capture, signing, verification, archive, and Explorer path against current x401 semantics. It is not a Proof SDK interop claim until a synced Proof implementation is pinned in a fixture.

Check the live `@proof.com/x401-node` package before changing that claim:

```bash
pnpm --filter @atrib/integration x401-proof-sdk-compat
```

The command reads npm metadata and reports whether the SDK docs expose current `PROOF-REQUEST`, `PROOF-RESPONSE`, `PROOF-RESULT`, `credential_requirements`, and result-artifact names without legacy header names. Use `-- --require-compatible` when a release gate should fail until the SDK catches up.

Check the broader Proof repo surface from local clones or an explicit live clone:

```bash
pnpm --filter @atrib/integration proof-repo-interop -- --repo-root /tmp/proof-repos-x401-map
```

The report classifies `proof/x401`, `proof/x401-node`, `proof/proof-vc-common`, `proof/proof-vc-web`, and `proof/verifier-vcp-demo` separately. Only a current-spec x401 wire SDK is allowed as a runtime dependency. Proof credential verifier packages and browser components stay opt-in fixture helpers until a pinned E2E run proves the verifier output maps into caller-owned x401 evidence.

## Tests

Run with `pnpm --filter @atrib/integration test`. Focused cross-package tests include:

- **`test/end-to-end.test.ts`** (3 tests), full attribution chain across the public packages: agent calls a tool, server emits a signed record, the record's chain hash links to the previous step, the verifier re-runs the calculation against the resulting graph.
- **`test/ap2-vi-e2e.test.ts`** (3 tests), AP2 v0.2 receipt detection plus async `@atrib/verify` AP2 / Verifiable Intent evidence checking for immediate and autonomous flows. This protects the detector/verifier boundary: successful receipts close the transaction, VI mandates remain verifier-side authorization evidence with SD-JWT / VC conformance and mandate constraints checked off the detector path, AP2 Path 2 detection returns a receipt-derived `contentId` instead of the generic server URL fallback when stable receipt identity is present, and a real counterparty signer over atrib transaction bytes satisfies cross-attestation without treating AP2 receipt JWTs as signers.
- **`test/ap2-live-interop.test.ts`** (6 tests), opt-in AP2 reference artifact harness coverage. It proves AP2 reference-style result JSON plus AP2 / VI evidence JSON pass through `detectTransaction()` and `verifyAp2ViEvidenceAsync()`, transaction-record artifacts pass through `verifyRecord()` with counterparty attestation, mandates alone do not pass the transaction gate, and environment configuration fails early when malformed.
- **`test/ap2-local-participant.test.ts`** (3 tests), local AP2 participant artifact generation. It proves an AP2 result plus AP2 / VI evidence bundle can be rehydrated into live interop artifacts and paired with a counterparty-signed atrib transaction record, including upstream AP2 full-chain mandate normalization.
- **`test/google-ap2-sample-extract.test.ts`** (2 tests), official Google AP2 sample extraction. It proves captured A2A function-response events plus the sample `.temp-db` full mandate chains can be converted into the live interop contract and verified with counterparty transaction attestation.
- **`test/x401-evidence-e2e.test.ts`** (4 tests), x401 authorization evidence propagation. It proves x401 remains separate from payment detection, runs the local proof-gate harness through archive projection without exposing private credential payloads, composes x401 with AAuth plus separate x402 payment detection, and runs a two-endpoint proof-gate propagation chain with separate request ids and signed action records.
- **`test/proof-x401-sdk-compat.test.ts`** (2 tests), Proof SDK compatibility guard. It rejects old `x401-node` header semantics and accepts the current x401 header/result-artifact shape.
- **`test/proof-repo-interop.test.ts`** (5 tests), Proof organization interop guard. It classifies `proof/x401-node`, `proof/proof-vc-common`, `proof/proof-vc-web`, and `proof/verifier-vcp-demo` so atrib does not confuse a spec source, credential verifier helper, browser UI component, or legacy demo with a current x401 wire SDK.
- **`test/ap2-reference-artifacts.test.ts`** (1 test), official AP2 Python SDK receipt artifacts. It proves compact receipt JWTs generated by `ap2.sdk.receipt_wrapper.ReceiptClient` and `ap2.sdk.jwt_helper.create_jwt` pass through the live interop harness, verify against caller-supplied JWKS roots, and compose with a counterparty-signed atrib transaction record.
- **`test/ap2-vi-reference-artifacts.test.ts`** (1 test), upstream AP2 plus VI reference artifacts. It proves VI credentials generated and verified by `agent-intent/verifiable-intent` compose with AP2 receipt JWTs generated and verified by the official AP2 SDK, including `cart.items[].sku` checkout payloads, `mandate.payment.reference`, SD-JWT core conformance, and counterparty-signed atrib transaction bytes.
- **`test/mcp-oauth-evidence.test.ts`** (1 test), producer-to-verifier MCP/OAuth evidence coverage. It proves `@atrib/mcp` captures local-only authorization evidence from validated MCP auth metadata, omits raw bearer tokens, preserves DPoP proof material, and feeds `verifyRecord()` generic `evidence[]` without changing the signed record validity bit.
- **`test/mcp-oauth-archive-e2e.test.ts`** (2 tests), archive-backed MCP/OAuth evidence coverage. It proves producer-captured evidence and host-owned introspection evidence can be archived as explorer-ready public evidence projections without storing raw bearer tokens.
- **`test/mcp-oauth-live-archive.test.ts`** (1 test), local coverage for the opt-in public fixture helper. It proves the same helper can submit to a log, archive selected OAuth evidence, fetch the evidence projection, and return a stable explorer action URL.
- **`test/langgraph-store-attribution.test.ts`** (6 tests), LangGraph Store memory coverage. It proves direct `InMemoryStore` put/get/search/delete/list calls preserve store values, emit signed hash-only records, keep raw memory text in local sidecars, and chain records in one context.
- **`test/langgraph-python-checkpointer.test.ts`** (opt-in), LangGraph Python checkpointer coverage. When `ATRIB_RUN_LANGGRAPH_PYTHON_CHECKPOINTER_SMOKE=1` is set, it imports `langgraph==1.2.4` through `uv`, runs a real Python `StateGraph` with `InMemorySaver`, then verifies nine hash-only atrib records for `get_tuple`, `put`, and `put_writes` checkpointer events.
- **`test/llamaindex-memory-attribution.test.ts`** (6 tests), LlamaIndex.TS memory coverage. It proves real `createMemory()` add/get/getLLM/snapshot calls preserve memory values, emit signed hash-only records, keep raw memory text in local sidecars, and chain records in one context.
- **`test/llamaindex-python-memory.test.ts`** (opt-in), LlamaIndex Python memory coverage. When `ATRIB_RUN_LLAMAINDEX_PYTHON_MEMORY_SMOKE=1` is set, it imports `llama-index==0.14.22` through `uv`, runs a real Python `Memory` instance with a `StaticMemoryBlock`, then verifies eight hash-only atrib records for `put`, `put_messages`, `get`, `get_all`, `set`, and `reset`.
- **`test/letta-memory.test.ts`** (opt-in), Letta memory coverage. When `ATRIB_RUN_LETTA_MEMORY_SMOKE=1` is set, it imports `letta==0.16.8` through `uv`, runs real `LettaCoreToolExecutor.execute` dispatch for core and archival memory tools, runs `ExternalMCPToolExecutor.execute` tag parsing against a fake MCP manager, then verifies six hash-only atrib records. The opt-in gate keeps default CI from depending on a large transient Python install.
- **`test/a2a-handoff.test.ts`** (1 test), A2A handoff evidence coverage. It proves a real `@a2a-js/sdk` JSON-RPC client and request handler can carry a signed Agent Card plus atrib handoff packet in an A2A `DataPart`, then the receiver verifies Agent Card signature, signer, context, body commitment, freshness, and log inclusion before signing an `informed_by` follow-up.
- **`test/google-adk-typescript-attribution.test.ts`** (1 test), Google ADK TypeScript plugin coverage. It proves a real `@google/adk` `InMemoryRunner`, public `BasePlugin`, and `FunctionTool` lifecycle can sign a hash-only atrib record while local sidecars retain the ADK runtime context and tool payload.
- **`test/google-adk-typescript-decision-ledger.test.ts`** (2 tests), Google ADK TypeScript decision-ledger coverage. It proves a real `@google/adk` `beforeToolCallback` can sign allow and refuse decisions before dispatch, the allowed outcome cites the decision record, refused calls do not execute the tool body, and stale confirmation bindings fail closed.
- **`test/google-adk-python-attribution.test.ts`** (opt-in), Google ADK Python plugin coverage. When `ATRIB_RUN_GOOGLE_ADK_PYTHON_SMOKE=1` is set, it imports `google-adk==2.3.0` through `uv`, runs a real Python `InMemoryRunner` with `BasePlugin` and `FunctionTool`, then verifies one hash-only atrib record for the Python tool callback.
- **`test/google-adk-python-decision-ledger.test.ts`** (opt-in), Google ADK Python decision-ledger coverage. When `ATRIB_RUN_GOOGLE_ADK_PYTHON_DECISION_LEDGER=1` is set, it imports `google-adk==2.3.0` through `uv`, signs allowed, refused, and policy-error decisions before dispatch, signs the allowed tool outcome, and proves confirmation bindings fail closed on stale or mismatched execution.
- **`test/google-stack-chain.test.ts`** (opt-in), Google stack chain proof coverage. When `ATRIB_RUN_GOOGLE_STACK_CHAIN_PROOF=1` is set, it links AP2 / VI live interop, A2A handoff evidence, an ADK Python allow decision, and the ADK Python tool outcome through verifier-resolved `informed_by`, pins the deterministic snapshot hashes, and keeps the proof boundaries explicit.
- **`test/google-stack-chain-visual.test.ts`** (5 tests), Google stack chain visual coverage. It serves the workbench, verifies the live chain starts empty, opens the reference snapshot, starts a mocked active runtime run, checks mobile sizing, and keeps the JSON and JS snapshots pinned together.
- **`test/openai-agents-runtime-receipt.test.ts`** (2 tests), OpenAI Agents runtime receipt coverage. It proves real `@openai/agents` `Agent` instances, a `run()` loop, a local `tool()` function, and a real `handoff()` can sign hash-only atrib records from the SDK `agent_tool_end` and `agent_handoff` lifecycle events while local sidecars keep the tool payload and handoff target.
- **`test/openai-responses-tool-call-receipt.test.ts`** (2 tests), OpenAI Responses tool-call coverage. It proves the real OpenAI Node SDK can call `responses.create` against a local OpenAI-shaped fixture, mirror a `function_call` plus `function_call_output` cycle, sign one hash-only atrib record, and keep raw tool payloads in local sidecars.
- **`test/mastra-runtime-receipt.test.ts`** (3 tests), Mastra runtime receipt coverage. It proves a real `@mastra/mcp` `MCPClient` can execute a Mastra `MCPServer` tool over stdio, sign a hash-only atrib record, and keep raw tool payloads in local sidecars. It also proves a real `@mastra/core` workflow can suspend at an approval step, resume through `Run.resume()` against an `InMemoryStore` snapshot, and sign start, suspend, resume, and result records linked through `informed_by`.
- **`test/action-control-gate.test.ts`** (1 test), action-control gate proof coverage. It proves `@atrib/action-gate` can allow, block, and escalate browser-shaped actions before execution, while signed outcome records cite the decision records and blocked or escalated action bodies do not run.
- **`test/browser-workflow-receipt.test.ts`** (4 tests), browser workflow receipt coverage. It proves observe, click, fill, and submit actions sign hash-only records in one chain while local sidecars retain private page and form material, including real browser-use `BrowserSession` and Stagehand local-session smokes.
- **`test/mcp-platform-proof-packets.test.ts`** (6 tests), Browserbase Stagehand and Firecrawl proof coverage. It proves fixture runs go through `@atrib/mcp-wrap`, verifies gated Browserbase Action Gate packet output, blocks public-log publication until packet checks pass, times out stalled upstream calls, writes proof artifacts, and keeps private session, selector, query, URL, content, and crawl job material out of public outputs.
- **`test/browserbase-stagehand-live-demo.test.ts`** (9 tests), Browserbase proof console coverage. It checks proof-runner output parsing, Action Gate config defaults, receipt link shaping, deployment guard behavior, and the HTTP config plus run API using a fixture runner.
- **`test/activegraph-runtime-log.test.ts`** (5 tests), ActiveGraph runtime-log proof coverage. It proves the `v1.1.0` approval-gate fixture verifies, event tampering fails, session-definition mismatch fails, and approval omission fails when approval proof is requested.
- **`test/reference-runtime-log.test.ts`** (5 tests), reference runtime-log source coverage. It proves identical JSONL inputs produce identical manifests, fork parent mismatches fail, compaction event tampering fails, side-effect receipt bodies stay local, and the smoke prints a bounded verifier summary.
- **`test/dogfood-runtime-log.test.ts`** (4 tests), dogfood Agent Bridge runtime-log proof coverage. It proves the sanitized RL-007 job window verifies, stale result refs fail against the original manifest, private bodies stay omitted, and the smoke prints a bounded verifier summary.
- **`test/secondary-runtime-log.test.ts`** (5 tests), secondary adapter-family coverage. It proves a LangGraph checkpoint runtime source can bind a fork, an OpenInference span-tree projection stays projection-only, and projection claims of runtime completeness fail.
- **`test/runtime-log-verifier-ux.test.ts`** (1 test), runtime-log verifier UX coverage. It proves the static HTML packet renderer handles runtime sources, projection sources, and invalid evidence with named issue codes.
- **`test/brief-dcbench-evidence.test.ts`** (2 tests), Brief dcbench evidence coverage. It proves context lookup, agent action, and score records chain through `informed_by`, stay hash-only publicly, and keep prompt plus rubric material in local sidecars.
- **`test/proof-log-receipt.test.ts`** (1 test), proof-log receipt coverage. It proves a single signed record can be submitted, included in a checkpointed Merkle log, archived with selected evidence, retrieved by hash, and verified without publishing the raw fixture token.
- **`examples/cloudflare-agents/oauth-evidence-infra/test/oauth-evidence-infra.worker.test.ts`** (4 tests), Cloudflare Worker coverage for the [D111](../../DECISIONS.md#d111-host-owned-oauth-evidence-infrastructure) support endpoints. It proves `createFetchDpopReplayCache()` calls a Durable Object-backed atomic replay cache, replayed DPoP keys are rejected, `introspectOAuthToken()` can call the Worker proxy, and raw opaque tokens do not appear in returned evidence.
- **`test/cloudflare-agent-packet.test.ts`** (1 test), Cloudflare Agent transaction packet coverage. It proves the replay-promotable Cloudflare packet can be verified as a Pattern 3-style handoff artifact before follow-up work cites it.
- **`test/evidence-packet-eval.test.ts`** (1 test), evidence packet eval coverage. It proves a current signed packet can be accepted while stale, wrong-signer, tampered-body, and packet-off controls are rejected before follow-up work cites them.
- **`test/trace-repair-suspect.test.ts`** (1 test), trace repair suspect coverage. It proves a current trace packet can be accepted, stale prior evidence can be rejected, the failed tool action is ranked first, and the signed diagnostic outcome resolves its `informed_by` links.
- **`test/pattern3-handoff.test.ts`** (9 tests), Pattern 3 receiving-side verification. It covers private continuation packets, body commitment checks, stale packet rejection, context mismatch handling, and transaction-packet verification through the `@atrib/verify` handoff surface.
- **`test/real-mcp-sdk.test.ts`** (2 tests), exercises both the wrapped MCP client and wrapped MCP server against a real `@modelcontextprotocol/sdk@1.29.0` transport, including the [§6](../../atrib-spec.md#6-key-directory) retroactive dispatcher wrap path and the `wrapMcpClient` adapter.
- **`test/full-chain.test.ts`** (3 tests), the wrapper → mirror → log → verify path with a real signed record set.
- **`test/resolve-identity-step7.test.ts`** (3 tests), real directory lookup plus verifier step 7 behavior around anchored identity evidence.
- **`test/conformance-3.2.4.test.ts`** (11 tests), demo-vs-production drift guard. The integration package's `src/graph-builder.ts` is the in-process graph builder used by `pnpm demo`, the calc-demo script, and the in-process end-to-end test. If it silently drifts from `services/graph-node`'s production derivation, the demo's chain-hash output misrepresents what production atrib infrastructure actually emits. This test runs every record fixture through BOTH implementations and asserts normalized edge sets, node sets, and per-node `verification_state` values match exactly. The 9-edge regression case at the bottom of the file is the assertion that protects the four producer-claim edges (INFORMED_BY, PROVENANCE_OF, ANNOTATES, REVISES, [D041](../../DECISIONS.md#d041-informed_by-linking-primitive-and-informed_by-edge-type), [D044](../../DECISIONS.md#d044-provenance_token-field-for-cross-session-causal-anchoring), [D058](../../DECISIONS.md#d058-promote-annotation-to-atrib-normative-event_type-byte-0x05), [D059](../../DECISIONS.md#d059-promote-revision-to-atrib-normative-event_type-byte-0x06)); if any of those edges silently drifts between the two implementations, the demo would start misrepresenting cognitive-primitive behavior, the surface developers and verifiers inspect most directly (atrib-emit, atrib-recall, atrib-trace, atrib-summarize).
- **`test/signer-proxy.test.ts`** (4 tests), [D102](../../DECISIONS.md#d102-sandboxed-signer-proxy-keeps-keys-outside-sandbox) sandbox signer-proxy example coverage. It proves sandbox code can request a tool-call signature without holding a private key, host signer policy runs before signing, signer-controlled fields supplied by the sandbox are rejected, and optional submission failure stays off the signing path.

**Honest framing on `conformance-3.2.4.test.ts`.** Both implementations are TypeScript, share `@atrib/mcp.canonicalRecord` for JCS, `@noble/hashes/sha2` for SHA-256, and `@atrib/mcp.verifyRecord` for Ed25519. Calling them "two independent implementations" in the spec's strongest sense would overstate the test's coverage; it catches algorithm-port errors and future drift between the two files, but it does not validate the spec against an independent reading of the prose or against an independent set of cryptographic primitives. Cross-language conformance against the `spec/conformance/3.4.1/` and `spec/conformance/3.4.5,6,7/` corpora is a separate later effort that lands when an external integrator writes a non-TS implementation and validates against the corpus without help from this codebase.

These tests are deliberately small in number; most behavior is covered by the per-package unit tests (391 total across the workspace). The integration tests are the **cross-package contract** layer: they catch the kind of bug that happens when one package's wire format quietly drifts from another's expectations.

## Why this package is private

`@atrib/integration` will never be published to npm because:

- It depends on `@atrib/log-dev`, which is also private and intentionally never published.
- It pulls in every public atrib package as a workspace dependency, plus `@modelcontextprotocol/sdk`, plus framework SDKs as dev deps. None of that should ship as an application dependency.
- The examples are reference material, not a library; downstream applications should copy the patterns into their own code, not depend on this package.

The `"private": true` in `package.json` enforces this; `pnpm publish` will refuse to publish it.

## How to use this package for walkthroughs

When a developer wants to see how atrib works:

1. Run `pnpm --filter @atrib/integration demo`.
2. Watch the colored chain hashes scroll past.
3. Walk through which lines of code belong on the merchant side, roughly three
   lines: import, wrap, set log endpoint.
4. Walk through which lines belong on the agent side, roughly two lines: import
   and wrap with `wrapMcpClient` or the framework adapter.
5. Open the example matching the target stack and show the integration point.
6. Switch to the production answer: "the dev log is for local development; the
   production log is `log.atrib.dev/v1`, Tessera-backed per spec
   [§2](../../atrib-spec.md#2-merkle-log-protocol); same wire format, no client
   changes needed when it ships."

The examples make the abstract protocol concrete in a way that the spec and the package READMEs cannot.

## See also

- [`@atrib/mcp`](../mcp/README.md), server-side middleware
- [`@atrib/agent`](../agent/README.md), agent-side interceptor + all framework adapters
- [`@atrib/verify`](../verify/README.md), merchant verification
- [`@atrib/log-dev`](../log-dev/README.md), in-memory dev Merkle log stub used by the demo
- [`atrib-spec.md`](../../atrib-spec.md), the protocol specification
- [`DECISIONS.md`](../../DECISIONS.md), architectural decision log
