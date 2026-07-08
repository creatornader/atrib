# @atrib/openinference

OpenTelemetry SpanProcessor for atrib's verifiable action layer. It consumes [OpenInference](https://github.com/Arize-ai/openinference)-shaped spans and emits signed atrib records.

This is **Pattern #4** of atrib's seven runtime integration patterns ([atrib-spec §9](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#9-runtime-integration-patterns)). One adapter transitively reaches every framework with OpenInference instrumentation: OpenAI Agents SDK, Claude Agent SDK, LangChain (and LangGraph), Vercel AI, CrewAI, LlamaIndex, DSPy, MCP, Microsoft Agent Framework, Bedrock AgentCore, smolagents, Pydantic AI, Agno, and 20+ more.

## Why this exists

OpenInference defines OpenTelemetry semantic conventions for LLM and agent telemetry. The conventions ship `OpenInferenceSimpleSpanProcessor` and `isOpenInferenceSpan` as their canonical entry points. atrib ships a sibling `AtribSpanProcessor` that reads the same spans and writes signed atrib records on a parallel pipeline.

Where existing observability platforms (Phoenix, Langfuse, AgentOps, Helicone) **capture** what the agent says it did, atrib **attests** to what the agent signed it did, with a Merkle log behind it. The two layers compose; they do not compete on capture.

## Install

```bash
pnpm add @atrib/openinference
```

Peer dependencies (install if not already in your OTel pipeline):

```bash
pnpm add @opentelemetry/api @opentelemetry/sdk-trace-base
```

## Quick start

```ts
import { appendFile, mkdir } from 'node:fs/promises'
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import { AtribSpanProcessor } from '@atrib/openinference'
import { base64urlEncode, getPublicKey } from '@atrib/mcp'

const privateKey = /* your 32-byte Ed25519 seed */
const creatorKey = base64urlEncode(await getPublicKey(privateKey))
const mirrorDir = `${process.env.HOME}/.atrib/records`
const mirrorPath = `${mirrorDir}/openinference.jsonl`
await mkdir(mirrorDir, { recursive: true })

const processor = new AtribSpanProcessor({
  privateKey,
  creatorKey,
  serverUrl: 'https://your-agent.example/atrib',
  submit: async (signed, sidecar) => {
    // Submit only the signed record to the public log. Persist the sidecar
    // in your local mirror as `_local` if you want recall, trace, and
    // summarize to read the span payload later.
    await fetch('https://log.atrib.dev/v1/submit', {
      method: 'POST',
      body: JSON.stringify(signed),
    })
    await appendFile(
      mirrorPath,
      `${JSON.stringify({ record: signed, _local: sidecar, written_at: Date.now() })}\n`,
    )
  },
})

const provider = new BasicTracerProvider()
provider.addSpanProcessor(processor)

// Now any framework with OpenInference instrumentation that emits TOOL
// spans on this provider produces signed atrib records.
```

## What gets signed

The current release maps all ten OpenInference span kinds:

| Kind        | atrib event_type | content_leaf                                    |
| ----------- | ---------------- | ----------------------------------------------- |
| `TOOL`      | `tool_call`      | `tool.name`                                     |
| `LLM`       | `observation`    | `llm:<llm.model_name>`                          |
| `AGENT`     | `observation`    | `agent:<agent.name OR span.name fallback>`      |
| `EMBEDDING` | `observation`    | `embedding:<embedding.model_name OR span.name>` |
| `RETRIEVER` | `observation`    | `retriever:<retrieval.model_name OR span.name>` |
| `RERANKER`  | `observation`    | `reranker:<reranker.model_name OR span.name>`   |
| `CHAIN`     | `observation`    | `chain:<span.name>`                             |
| `GUARDRAIL` | `observation`    | `guardrail:<span.name>`                         |
| `EVALUATOR` | `observation`    | `evaluator:<span.name>`                         |
| `PROMPT`    | `observation`    | `prompt:<span.name>`                            |

All kinds derive `context_id` from `session.id` if present, else the OTel `trace_id`. The signed record stays canonical and lean. Sidecar metadata captures the recall-readable payload: span identity, `agent.name`, model name, input/output values, prompt metadata, usage, cost, score, metadata, and for LLM spans whose output is a tool call, `llm.output_messages.<i>.message.tool_calls.<j>.tool_call.id` (the empirical seed for LLM-to-TOOL `informed_by` derivation).

## Sidecar-first observability metadata

Langfuse, Phoenix, Datadog, and similar systems should remain the trace viewer, latency dashboard, cost dashboard, prompt-management surface, and eval surface. `@atrib/openinference` uses the same span tree as intake, then writes a different product shape:

- public log: the signed `AtribRecord` and 90-byte commitment
- local mirror: `{ record, _local: sidecar }`
- cognitive consumers: recall, trace, and summarize read `_local.content`

`sidecar.content` is intentionally local-only. It includes fields such as `source`, `span_kind`, `span_name`, `trace_id`, `span_id`, `what`, `topics`, `tool_name`, `args`, `result`, `input`, `output`, `agent_name`, `model_name`, prompt fields, `usage_details`, `cost_details`, `score_details`, and `metadata`. These fields are not signed record fields. If you need verifier-grade replay for input or output bytes, enable `argsResultHashPosture: 'plain'` or `'salted'` so the signed record carries `args_hash` and `result_hash`. The hash input is verifier-compatible: JSON strings are parsed and JCS-canonicalized before hashing, and non-JSON strings are hashed as JCS string values.

This is the intended overlap with Langfuse: send the same spans to Langfuse for operations, and to atrib for signed evidence plus local cognitive recall.

## Simple vs batch

Two SpanProcessor variants ship:

| Variant                   | When to use                                                                                                       | Submit shape                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `AtribSpanProcessor`      | Low-throughput interactive agents. Lower latency between span end and record submission.                          | `submit(signed, sidecar)` per span                  |
| `AtribBatchSpanProcessor` | Production pipelines emitting many spans/sec. Reduces per-record HTTP overhead via queue + size/time-based flush. | `submit(batch: Array<{signed, sidecar}>)` per batch |

Batch buffer config knobs (all defaulted): `maxQueueSize` (2048), `maxExportBatchSize` (512), `scheduledDelayMillis` (5000), `exportTimeoutMillis` (30000). Per [§5.8](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#58-degradation-contract) degradation contract: when the queue overflows `maxQueueSize` the oldest record is dropped so the host pipeline never blocks; `getDroppedRecordCount()` exposes the counter for observability.

```ts
import { AtribBatchSpanProcessor } from '@atrib/openinference'

const processor = new AtribBatchSpanProcessor({
  privateKey,
  creatorKey,
  serverUrl,
  submit: async (batch) => {
    await fetch(logEndpoint, {
      method: 'POST',
      body: JSON.stringify({ records: batch.map((b) => b.signed) }),
    })
  },
  config: { maxExportBatchSize: 256, scheduledDelayMillis: 2000 },
})

// CRITICAL: drain on shutdown or records may be lost.
process.on('SIGTERM', async () => {
  await processor.shutdown()
})
```

## Composition with other OTel pipelines

`AtribSpanProcessor` is additive. Add it to your tracer provider alongside any existing exporters (Langfuse OTLP receiver, Phoenix collector, Datadog, etc.). Each processor sees every span; atrib filters for OpenInference spans and signs them; other processors continue unaffected.

```ts
provider.addSpanProcessor(new SimpleSpanProcessor(otlpExporter)) // your existing pipeline
provider.addSpanProcessor(atribProcessor) // adds verifiable substrate
```

The integration package includes a smoke script that uses a real OTLP HTTP exporter and the atrib processor on the same provider:

```bash
pnpm --filter @atrib/integration openinference-dual-export-smoke
```

By default it starts a local OTLP HTTP receiver. To run against Phoenix, start Phoenix locally and point the script at its trace endpoint:

```bash
docker run -p 6006:6006 -p 4317:4317 arizephoenix/phoenix:latest
ATRIB_OPENINFERENCE_OTLP_ENDPOINT=http://localhost:6006/v1/traces \
  pnpm --filter @atrib/integration openinference-dual-export-smoke
```

For a backend-verified run, set `ATRIB_OPENINFERENCE_VERIFY_BACKEND=phoenix` or `langfuse`. The smoke then polls the backend read API after export and checks that the returned payload contains the same trace id, span ids, and span names that atrib signed into local sidecars. It also reports whether the backend exposes the run marker emitted as trace metadata.

```bash
ATRIB_OPENINFERENCE_OTLP_ENDPOINT=http://localhost:6006/v1/traces \
ATRIB_OPENINFERENCE_VERIFY_BACKEND=phoenix \
PHOENIX_BASE_URL=http://localhost:6006 \
PHOENIX_PROJECT_NAME=default \
  pnpm --filter @atrib/integration openinference-dual-export-smoke
```

For Langfuse, point the OTLP exporter at `/api/public/otel/v1/traces`, pass Basic auth on export, and provide the same credentials for the observations API:

```bash
AUTH_STRING=$(printf "pk-lf-...:sk-lf-..." | base64)

ATRIB_OPENINFERENCE_OTLP_ENDPOINT=https://cloud.langfuse.com/api/public/otel/v1/traces \
ATRIB_OPENINFERENCE_OTLP_HEADERS="Authorization=Basic ${AUTH_STRING},x-langfuse-ingestion-version=4" \
ATRIB_OPENINFERENCE_VERIFY_BACKEND=langfuse \
LANGFUSE_BASE_URL=https://cloud.langfuse.com \
LANGFUSE_AUTH_STRING="${AUTH_STRING}" \
  pnpm --filter @atrib/integration openinference-dual-export-smoke
```

## Required: register an async context manager

For Node.js consumers using the bare `BasicTracerProvider`: register `AsyncHooksContextManager` BEFORE the tracer provider, otherwise Vercel AI SDK (and similar instrumented frameworks) emit each async-boundary-crossing span as its own root with a fresh trace_id. atrib then signs each into its own context_id, breaking session chain composition.

```ts
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks'
import { context } from '@opentelemetry/api'

const ctxManager = new AsyncHooksContextManager()
ctxManager.enable()
context.setGlobalContextManager(ctxManager)
// ... then construct your TracerProvider + processors
```

Pipelines using `NodeSDK` from `@opentelemetry/sdk-node` already register a context manager by default; this only applies to bare `BasicTracerProvider` setups. Empirically: a single `generateText` Vercel AI SDK call with this manager produces 1 trace_id across all 4 spans (LLM/TOOL/LLM/AGENT); without it, 4 distinct trace_ids.

### Preflight verification (recommended)

The package exports `verifyOpenTelemetryContextPropagation()` -- a deterministic startup test that opens a root span, crosses an async boundary, opens a child span inside the root's context, and verifies the child shares the root's `trace_id`. If propagation is broken, it throws `ContextPropagationError` with actionable fix instructions BEFORE any production work runs.

```ts
import { AtribSpanProcessor, verifyOpenTelemetryContextPropagation } from '@atrib/openinference'

// At app startup, after configuring your TracerProvider:
await verifyOpenTelemetryContextPropagation()
// If this throws, you have a misconfiguration. Fix per error message.
```

Calling this is the difference between catching the bug at startup vs. silently emitting fragmented atrib chains in production. Strongly recommended for any deployment using `BasicTracerProvider` directly.

## §5.8 degradation contract

Per the atrib spec [§5.8 degradation contract](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#58-degradation-contract): atrib failures must never affect the primary tool call or agent response. This processor honors that contract by catching every error from span mapping, signing, and submission. Errors are logged with the `atrib:openinference:` prefix when `debug: true`; otherwise silent.

## What this does NOT do

- **No tool response capture.** Spans carry whatever the OpenInference instrumentation provided. atrib signs that span shape verbatim; it does not enrich tool outputs.
- **No public prompt/output storage.** Prompts, outputs, usage, cost, scores, and metadata stay in the local sidecar unless the caller separately commits to them with `args_hash` / `result_hash` or publishes a body through another privacy posture.
- **No log-inclusion verification.** Local signing produces a record; the configured `submit` callback is responsible for log commitment. Re-verification of log inclusion is the consumer's job ([§2.6.1](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#261-submit-entry) inclusion proof flow).
- **No re-instrumentation.** This package consumes OpenInference spans; it does not instrument frameworks. Use `@arizeai/openinference-*` instrumentations (or your framework's native OpenInference integration) to produce the spans.
- **No generic parent-child causality.** OTel parent-child nesting is correlation metadata. It does not become `informed_by` by itself. The current explicit derivation is LLM `tool_call.id` to matching TOOL `tool_call.id`, and it is applied before signing.
- **No semantic graph derivation.** The atrib log + graph-node service derive the [§3.2.4](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#324-edge-derivation-rules) graph from signed record structure, not from span names or trace-viewer nesting.

## Status

Current coverage:

- All 10 OpenInference span kinds mapped: `TOOL` -> `tool_call`; `LLM` / `AGENT` / `EMBEDDING` / `RETRIEVER` / `RERANKER` / `CHAIN` / `GUARDRAIL` / `EVALUATOR` / `PROMPT` -> `observation`.
- Both Simple and Batch SpanProcessor variants.
- Auto `informed_by` derivation between LLM and TOOL records via shared `InformedByTracker`.
- Args/result hash extraction per spec [§8.3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#83-salted-commitment-posture) ([D045](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d045-privacy-postures-normative-spec-section) salted-commitment posture) with three modes: `none` / `plain` / `salted`.
- Preflight verification helper that catches misconfigured context propagation at startup.
- Attribute keys imported from `@arizeai/openinference-semantic-conventions` for canonical schema correctness.
- Recall-readable local sidecar content for span identity, prompts, outputs, usage, cost, scores, metadata, and LLM-to-tool linkage.
- 67 unit tests + composition pilot validated end-to-end against real Vercel AI SDK v6 + NVIDIA NIM-served Qwen 3.5 + `@arizeai/openinference-vercel`'s reference SpanProcessor on a shared TracerProvider.
- Runnable integration example at `packages/integration/examples/openinference/` (offline by default; live model-driven path enabled via `ATRIB_OPENINFERENCE_RUN_LIVE=1` + `NVIDIA_API_KEY`).
- Dual-export smoke at `packages/integration/examples/openinference/dual-export-smoke.ts`, with local OTLP HTTP receiver by default and Phoenix/Langfuse-compatible endpoint override via `ATRIB_OPENINFERENCE_OTLP_ENDPOINT`.
- Conformance fixtures in `test/fixtures/` capture four canonical span shapes (TOOL, two LLMs, AGENT) live-captured from a real run. The fixture-replay test catches upstream attribute-schema drift before it reaches consumers.

Pilot evidence: a single tool-using `generateText` call produces 4 spans (LLM + TOOL + LLM + AGENT) that sign to 2 distinct event_types (`observation` + `tool_call`) under ONE shared `context_id`, given the required `AsyncHooksContextManager` is registered (see "Required: register an async context manager" above).

Roadmap:

- **LangGraph `graph.node.parent_id` informed_by derivation.** Multi-graph-node `informed_by` edges. The LLM->TOOL pair is already covered automatically via `tool_call.id` matching.
- **Spec-level conformance corpus** per [D071](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d071-spec-writing-conventions) convention 6. Current package-level fixtures at `test/fixtures/` are the empirical foundation; spec-level promotion lands when a first downstream consumer requires it.

## License

Apache-2.0
