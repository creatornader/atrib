# @atrib/openinference

OpenTelemetry SpanProcessor that consumes [OpenInference](https://github.com/Arize-ai/openinference)-shaped spans and emits signed atrib records.

This is **Pattern #4** of atrib's six runtime integration patterns ([atrib-spec §9](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#9-runtime-integration-patterns)). One adapter transitively reaches every framework with OpenInference instrumentation: OpenAI Agents SDK, Claude Agent SDK, LangChain (and LangGraph), Vercel AI, CrewAI, LlamaIndex, DSPy, MCP, Microsoft Agent Framework, Bedrock AgentCore, smolagents, Pydantic AI, Agno, and 20+ more.

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
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import { AtribSpanProcessor } from '@atrib/openinference'
import { base64urlEncode, getPublicKey } from '@atrib/mcp'

const privateKey = /* your 32-byte Ed25519 seed */
const creatorKey = base64urlEncode(await getPublicKey(privateKey))

const processor = new AtribSpanProcessor({
  privateKey,
  creatorKey,
  serverUrl: 'https://your-agent.example/atrib',
  submit: async (signed, sidecar) => {
    // Forward to the atrib log via @atrib/mcp's createSubmissionQueue,
    // a custom HTTP client, or any pipeline you control.
    await fetch('https://log.atrib.dev/v1/submit', {
      method: 'POST',
      body: JSON.stringify({ record: signed, sidecar }),
    })
  },
})

const provider = new BasicTracerProvider()
provider.addSpanProcessor(processor)

// Now any framework with OpenInference instrumentation that emits TOOL
// spans on this provider produces signed atrib records.
```

## What gets signed

v0.0.1 maps all ten OpenInference span kinds:

| Kind | atrib event_type | content_leaf |
|---|---|---|
| `TOOL` | `tool_call` | `tool.name` |
| `LLM` | `observation` | `llm:<llm.model_name>` |
| `AGENT` | `observation` | `agent:<agent.name OR span.name fallback>` |
| `EMBEDDING` | `observation` | `embedding:<embedding.model_name OR span.name>` |
| `RETRIEVER` | `observation` | `retriever:<retrieval.model_name OR span.name>` |
| `RERANKER` | `observation` | `reranker:<reranker.model_name OR span.name>` |
| `CHAIN` | `observation` | `chain:<span.name>` |
| `GUARDRAIL` | `observation` | `guardrail:<span.name>` |
| `EVALUATOR` | `observation` | `evaluator:<span.name>` |
| `PROMPT` | `observation` | `prompt:<span.name>` |

All kinds derive `context_id` from `session.id` if present, else the OTel `trace_id`. Sidecar metadata captures `agent.name`, `input.value`, `output.value`, and -- for LLM spans whose output is a tool call -- `llm.output_messages.<i>.message.tool_calls.<j>.tool_call.id` (the empirical seed for LLM->TOOL `informed_by` derivation).

## Simple vs batch

Two SpanProcessor variants ship in v0.0.1:

| Variant | When to use | Submit shape |
|---|---|---|
| `AtribSpanProcessor` | Low-throughput interactive agents. Lower latency between span end and record submission. | `submit(signed, sidecar)` per span |
| `AtribBatchSpanProcessor` | Production pipelines emitting many spans/sec. Reduces per-record HTTP overhead via queue + size/time-based flush. | `submit(batch: Array<{signed, sidecar}>)` per batch |

Batch buffer config knobs (all defaulted): `maxQueueSize` (2048), `maxExportBatchSize` (512), `scheduledDelayMillis` (5000), `exportTimeoutMillis` (30000). Per [§5.8](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#58-degradation-contract) degradation contract: when the queue overflows `maxQueueSize` the oldest record is dropped so the host pipeline never blocks; `getDroppedRecordCount()` exposes the counter for observability.

```ts
import { AtribBatchSpanProcessor } from '@atrib/openinference'

const processor = new AtribBatchSpanProcessor({
  privateKey, creatorKey, serverUrl,
  submit: async (batch) => {
    await fetch(logEndpoint, {
      method: 'POST',
      body: JSON.stringify({ records: batch.map((b) => b.signed) }),
    })
  },
  config: { maxExportBatchSize: 256, scheduledDelayMillis: 2000 },
})

// CRITICAL: drain on shutdown or records may be lost.
process.on('SIGTERM', async () => { await processor.shutdown() })
```

## Composition with other OTel pipelines

`AtribSpanProcessor` is additive. Add it to your tracer provider alongside any existing exporters (Langfuse OTLP receiver, Phoenix collector, Datadog, etc.). Each processor sees every span; atrib filters for OpenInference spans and signs them; other processors continue unaffected.

```ts
provider.addSpanProcessor(new SimpleSpanProcessor(otlpExporter)) // your existing pipeline
provider.addSpanProcessor(atribProcessor)                         // adds verifiable substrate
```

## Required: register an async context manager

For Node.js consumers using the bare `BasicTracerProvider`: register `AsyncHooksContextManager` BEFORE the tracer provider, otherwise Vercel AI SDK (and similar instrumented frameworks) emit each async-boundary-crossing span as its own root with a fresh trace_id. Atrib then signs each into its own context_id, breaking session chain composition.

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
import {
  AtribSpanProcessor,
  verifyOpenTelemetryContextPropagation,
} from '@atrib/openinference'

// At app startup, after configuring your TracerProvider:
await verifyOpenTelemetryContextPropagation()
// If this throws, you have a misconfiguration. Fix per error message.
```

Calling this is the difference between catching the bug at startup vs. silently emitting fragmented atrib chains in production. Strongly recommended for any deployment using `BasicTracerProvider` directly.

## §5.8 degradation contract

Per the atrib spec [§5.8 degradation contract](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#58-degradation-contract): atrib failures must never affect the primary tool call or agent response. This processor honors that contract by catching every error from span mapping, signing, and submission. Errors are logged with the `atrib:openinference:` prefix when `debug: true`; otherwise silent.

## What this does NOT do

- **No tool response capture.** Spans carry whatever the OpenInference instrumentation provided. atrib signs that span shape verbatim; it does not enrich tool outputs.
- **No log-inclusion verification.** Local signing produces a record; the configured `submit` callback is responsible for log commitment. Re-verification of log inclusion is the consumer's job ([§2.6.1](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#261-submit-entry) inclusion proof flow).
- **No re-instrumentation.** This package consumes OpenInference spans; it does not instrument frameworks. Use `@arizeai/openinference-*` instrumentations (or your framework's native OpenInference integration) to produce the spans.
- **No graph derivation.** Emits flat records. The atrib log + graph-node service derive the [§3.2.4](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#324-edge-derivation-rules) graph from the record set.

## Status

`v0.0.1` covers:

- All 10 OpenInference span kinds mapped: `TOOL` -> `tool_call`; `LLM` / `AGENT` / `EMBEDDING` / `RETRIEVER` / `RERANKER` / `CHAIN` / `GUARDRAIL` / `EVALUATOR` / `PROMPT` -> `observation`.
- Both Simple and Batch SpanProcessor variants.
- Auto `informed_by` derivation between LLM and TOOL records via shared `InformedByTracker`.
- Args/result hash extraction per spec [§8.3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#83-salted-commitment-posture) ([D045](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d045-privacy-postures-normative-spec-section) salted-commitment posture) with three modes: `none` / `plain` / `salted`.
- Preflight verification helper that catches misconfigured context propagation at startup.
- Attribute keys imported from `@arizeai/openinference-semantic-conventions` for canonical schema correctness.
- 62 unit tests + composition pilot validated end-to-end against real Vercel AI SDK v6 + NVIDIA NIM-served Qwen 3.5 + `@arizeai/openinference-vercel`'s reference SpanProcessor on a shared TracerProvider.
- Runnable integration example at `packages/integration/examples/openinference/` (offline by default; live model-driven path enabled via `ATRIB_OPENINFERENCE_RUN_LIVE=1` + `NVIDIA_API_KEY`).
- Conformance fixtures in `test/fixtures/` capture four canonical span shapes (TOOL, two LLMs, AGENT) live-captured from a real run. The fixture-replay test catches upstream attribute-schema drift before it reaches consumers.

Pilot evidence: a single tool-using `generateText` call produces 4 spans (LLM + TOOL + LLM + AGENT) that sign to 2 distinct event_types (`observation` + `tool_call`) under ONE shared `context_id`, given the required `AsyncHooksContextManager` is registered (see "Required: register an async context manager" above).

Roadmap:

- **LangGraph `graph.node.parent_id` informed_by derivation.** Multi-graph-node `informed_by` edges. The LLM->TOOL pair is already covered automatically via `tool_call.id` matching.
- **Spec-level conformance corpus** per [D071](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d071-spec-writing-conventions) convention 6. Current package-level fixtures at `test/fixtures/` are the empirical foundation; spec-level promotion lands when a first downstream consumer requires it.

## License

Apache-2.0
