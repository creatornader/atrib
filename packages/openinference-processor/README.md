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

The first version maps `openinference.span.kind === 'TOOL'` spans to atrib `tool_call` records. The mapping reads:

- `tool.name` -> tool identity for `content_id` derivation
- `session.id` -> `context_id` (falls back to OTel trace_id)
- `agent.name`, `input.value`, `output.value` -> sidecar metadata

LLM, AGENT, EMBEDDING, RETRIEVER, CHAIN, RERANKER, GUARDRAIL, EVALUATOR, and PROMPT spans are recognized as OpenInference spans but not yet mapped to records. A future extension may emit them as `observation` event_type records when the operator wants agent-boundary visibility on the substrate.

## Composition with other OTel pipelines

`AtribSpanProcessor` is additive. Add it to your tracer provider alongside any existing exporters (Langfuse OTLP receiver, Phoenix collector, Datadog, etc.). Each processor sees every span; atrib filters for OpenInference TOOL spans and signs them; other processors continue unaffected.

```ts
provider.addSpanProcessor(new SimpleSpanProcessor(otlpExporter)) // your existing pipeline
provider.addSpanProcessor(atribProcessor)                         // adds verifiable substrate
```

## §5.8 degradation contract

Per the atrib spec [§5.8 degradation contract](../../atrib-spec.md#58-degradation-contract): atrib failures must never affect the primary tool call or agent response. This processor honors that contract by catching every error from span mapping, signing, and submission. Errors are logged with the `atrib:openinference:` prefix when `debug: true`; otherwise silent.

## Status

`v0.0.1` -- TOOL-span mapping shipped with 11 unit tests + composition pilot validated against `@arizeai/openinference-vercel`'s reference SpanProcessor on a shared TracerProvider. Attribute keys imported from `@arizeai/openinference-semantic-conventions` for canonical schema correctness. Runnable integration example at `packages/integration/examples/openinference/`. Not yet published to npm.

Roadmap:

- LLM-span mapping (sign LLM message exchanges as observations)
- AGENT-span mapping (emit observations at agent-boundary spans for multi-agent traces)
- Batch variant (`AtribBatchSpanProcessor`) mirroring `OpenInferenceBatchSpanProcessor`
- Args/result hash extraction per [§8.3](../../atrib-spec.md#83-salted-commitment-posture) salted-commitment posture
- `informed_by` derivation from `graph.node.parent_id` (LangGraph) and `tool_call_id` (OpenAI handoffs)
- Conformance corpus per [D071](../../DECISIONS.md#d071-spec-writing-conventions) convention 6 (current package-level test fixtures cover canonical TOOL/LLM/AGENT shapes; spec-level corpus lands when first downstream consumer requires it)

## License

Apache-2.0
