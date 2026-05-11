# OpenInference + atrib integration example

Demonstrates the canonical Pattern #4 composition from atrib-spec [§9](../../../../atrib-spec.md#9-runtime-integration-patterns): one OpenTelemetry TracerProvider feeds two sibling SpanProcessors, one for capture (Arize / Phoenix / Langfuse / OTLP) and one for verifiable signing (atrib -> Merkle log).

## What this shows

- **`@atrib/openinference` composes alongside `@arizeai/openinference-vercel`**, the reference SpanProcessor for Vercel AI SDK's OpenInference instrumentation. They share one TracerProvider; each filters spans independently.
- **The atrib processor signs every TOOL span** that carries the canonical `openinference.span.kind` attribute (and friends), producing an `AtribRecord` per tool invocation.
- **The Arize processor stays unaffected** -- it continues exporting to whatever OTLP endpoint Phoenix / Langfuse / Datadog is listening on.
- **No code changes to the agent or Vercel AI SDK** -- the integration is one `provider.addSpanProcessor` line away from any existing OpenInference pipeline.

## Run it

```bash
ATRIB_PRIVATE_KEY=<base64url-32-bytes> \
  pnpm tsx integration.ts
```

For a real model-driven run against NVIDIA NIM-served Qwen 3.5:

```bash
ATRIB_PRIVATE_KEY=<base64url-32-bytes> \
  ATRIB_OPENINFERENCE_RUN_LIVE=1 \
  NVIDIA_API_KEY=<your-key> \
  pnpm tsx integration.ts
```

## Critical setup: the async-hooks context manager

The example registers `AsyncHooksContextManager` BEFORE creating the TracerProvider. Without it, Vercel AI SDK's child spans (LLM/TOOL/LLM/AGENT of a single `generateText` call) lose parent-context across async boundaries and each becomes its own root span with a fresh trace_id. Atrib's adapter then signs each as its own context_id -- breaking session chain composition.

Empirical observation: without `AsyncHooksContextManager`, a single `generateText` call produces 4 distinct trace_ids (one per child span). With it, all 4 spans share one trace_id and therefore one atrib context_id. The change is one block at the top of the script:

```ts
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks'
import { context } from '@opentelemetry/api'

const ctxManager = new AsyncHooksContextManager()
ctxManager.enable()
context.setGlobalContextManager(ctxManager)
```

Any production pipeline using Node's OpenTelemetry SDK should already be doing this (it's the default in `NodeSDK` from `@opentelemetry/sdk-node`); this caveat applies to bare `BasicTracerProvider` setups.

## What the substrate sees

For every `streamText` / `generateText` tool invocation that flows through OpenInference's Vercel AI SDK instrumentation, atrib captures:

- `event_type`: `https://atrib.dev/v1/types/tool_call`
- `content_id`: derived from `(serverUrl, tool.name)`, stable per tool
- `context_id`: from `session.id` if present, otherwise the OTel trace_id
- `chain_root`: synthesized genesis (or supplied via `resolveChainRoot` for multi-record sessions)
- Sidecar metadata: `tool_name`, `agent.name`, `input.value`, `output.value`, full traceId / spanId

## Reach

OpenInference covers 33 Python frameworks + 9 JS packages: OpenAI Agents SDK, Claude Agent SDK, LangChain (and LangGraph), Vercel AI, CrewAI, LlamaIndex, DSPy, MCP, Microsoft Agent Framework, Bedrock AgentCore, smolagents, Pydantic AI, Agno, and 20+ more. Wiring `AtribSpanProcessor` once gives verifiable-record coverage across all of them.
