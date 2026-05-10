# @atrib/openinference-processor

OpenTelemetry SpanProcessor that consumes [OpenInference](https://github.com/Arize-ai/openinference)-shaped spans and emits signed atrib records.

This is **Pattern #4** of atrib's six runtime integration patterns ([atrib-spec §9](../../atrib-spec.md#9-runtime-integration-patterns)). One adapter transitively reaches every framework with OpenInference instrumentation: OpenAI Agents SDK, Claude Agent SDK, LangChain (and LangGraph), Vercel AI, CrewAI, LlamaIndex, DSPy, MCP, Microsoft Agent Framework, Bedrock AgentCore, smolagents, Pydantic AI, Agno, and 20+ more.

## Why this exists

OpenInference defines OpenTelemetry semantic conventions for LLM and agent telemetry. The conventions ship `OpenInferenceSimpleSpanProcessor` and `isOpenInferenceSpan` as their canonical entry points. atrib ships a sibling `AtribSpanProcessor` that reads the same spans and writes signed atrib records on a parallel pipeline.

Where existing observability platforms (Phoenix, Langfuse, AgentOps, Helicone) **capture** what the agent says it did, atrib **attests** to what the agent signed it did, with a Merkle log behind it. The two layers compose; they do not compete on capture.

## Install

```bash
pnpm add @atrib/openinference-processor
```

Peer dependencies (install if not already in your OTel pipeline):

```bash
pnpm add @opentelemetry/api @opentelemetry/sdk-trace-base
```

## Quick start

```ts
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import { AtribSpanProcessor } from '@atrib/openinference-processor'
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

v0.0.1 maps three of the ten OpenInference span kinds:

| Kind | atrib event_type | content_leaf |
|---|---|---|
| `TOOL` | `tool_call` | `tool.name` |
| `LLM` | `observation` | `llm:<llm.model_name>` |
| `AGENT` | `observation` | `agent:<agent.name OR span.name fallback>` |

All three derive `context_id` from `session.id` if present, else the OTel `trace_id`. Sidecar metadata captures `agent.name`, `input.value`, `output.value`, and -- for LLM spans whose output is a tool call -- `llm.output_messages.<i>.message.tool_calls.<j>.tool_call.id` (the empirical seed for future LLM->TOOL `informed_by` derivation).

EMBEDDING, RETRIEVER, CHAIN, RERANKER, GUARDRAIL, EVALUATOR, and PROMPT spans are recognized as OpenInference but skipped at v0.0.1. Each can be added incrementally as a separate event_type or routed to `observation` with kind-specific content shapes.

## Composition with other OTel pipelines

`AtribSpanProcessor` is additive. Add it to your tracer provider alongside any existing exporters (Langfuse OTLP receiver, Phoenix collector, Datadog, etc.). Each processor sees every span; atrib filters for OpenInference TOOL spans and signs them; other processors continue unaffected.

```ts
provider.addSpanProcessor(new SimpleSpanProcessor(otlpExporter)) // your existing pipeline
provider.addSpanProcessor(atribProcessor)                         // adds verifiable substrate
```

## §5.8 degradation contract

Per the atrib spec [§5.8 degradation contract](../../atrib-spec.md#58-degradation-contract): atrib failures must never affect the primary tool call or agent response. This processor honors that contract by catching every error from span mapping, signing, and submission. Errors are logged with the `atrib:openinference:` prefix when `debug: true`; otherwise silent.

## Status

`v0.0.1` -- TOOL + LLM + AGENT span mappings shipped with 22 tests (12 unit + 10 fixture-replay) + composition pilot validated end-to-end against real Vercel AI SDK v6 + NVIDIA NIM-served Qwen 3.5 + `@arizeai/openinference-vercel`'s reference SpanProcessor on a shared TracerProvider. Live pilot signs all 4 spans of a single tool-using `generateText` call (LLM + TOOL + LLM + AGENT) producing 2 distinct event_types (`observation` + `tool_call`). Attribute keys imported from `@arizeai/openinference-semantic-conventions` for canonical schema correctness. Runnable integration example at `packages/integration/examples/openinference/` (offline-runnable by default; live model-driven path enabled via `ATRIB_OPENINFERENCE_RUN_LIVE=1` + `NVIDIA_API_KEY`). Conformance fixtures in `test/fixtures/` capture four canonical span shapes (TOOL, two LLMs, AGENT) live-captured from a real run -- the fixture-replay test catches upstream attribute-schema drift before it reaches consumers. Not yet published to npm.

Roadmap (each item references concrete fixture data in `test/fixtures/`):

- **`informed_by` derivation** from `tool_call.id` shared between LLM-with-tool-calls span and TOOL span (sidecar surfaces it via `readLlmOutputToolCallId`; fixture-replay test asserts the empirical equality). Auto-wiring from sidecar -> record body lands in v0.1.0. Plus `graph.node.parent_id` for LangGraph.
- **Trace-level chain composition**: in v0.0.1, each Vercel AI SDK span signs into its own context_id (one per child span's traceId). v0.1.0 will follow `parentSpanContext.traceId` upward to fold all spans of a single agent run into one chain.
- **Batch variant** (`AtribBatchSpanProcessor`) mirroring `OpenInferenceBatchSpanProcessor`
- **Args/result hash extraction** per [§8.3](../../atrib-spec.md#83-salted-commitment-posture) salted-commitment posture
- **Remaining 7 OpenInference kinds** (EMBEDDING, RETRIEVER, CHAIN, RERANKER, GUARDRAIL, EVALUATOR, PROMPT) -- ship per use case; current behavior returns "kind X not yet mapped" skip
- **Spec-level conformance corpus** per [D071](../../DECISIONS.md#d071-spec-writing-conventions) convention 6 (current package-level fixtures are the empirical foundation; spec-level promotion lands when first downstream consumer requires it)

## License

Apache-2.0
