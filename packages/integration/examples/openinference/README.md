# OpenInference + atrib integration example

Demonstrates the canonical Pattern #4 composition from atrib-spec [§9](../../../../atrib-spec.md#9-runtime-integration-patterns): one OpenTelemetry TracerProvider feeds two sibling SpanProcessors, one for capture (Arize / Phoenix / Langfuse / OTLP) and one for verifiable signing (atrib -> Merkle log).

## What this shows

- **`@atrib/openinference-processor` composes alongside `@arizeai/openinference-vercel`**, the reference SpanProcessor for Vercel AI SDK's OpenInference instrumentation. They share one TracerProvider; each filters spans independently.
- **The atrib processor signs every TOOL span** that carries the canonical `openinference.span.kind` attribute (and friends), producing an `AtribRecord` per tool invocation.
- **The Arize processor stays unaffected** -- it continues exporting to whatever OTLP endpoint Phoenix / Langfuse / Datadog is listening on.
- **No code changes to the agent or Vercel AI SDK** -- the integration is one `provider.addSpanProcessor` line away from any existing OpenInference pipeline.

## Run it

```bash
ATRIB_PRIVATE_KEY=<base64url-32-bytes> \
  pnpm tsx integration.ts
```

The example uses a synthetic OpenInference span constructed manually so it runs offline without a model provider. For a real end-to-end run with Vercel AI SDK + a real model:

```bash
pnpm add ai @ai-sdk/openai-compatible @arizeai/openinference-vercel @opentelemetry/api @opentelemetry/sdk-trace-base
# then follow https://github.com/Arize-ai/openinference/tree/main/js/packages/openinference-vercel/examples
# and add `AtribSpanProcessor` to the same TracerProvider's `spanProcessors` array
```

## What the substrate sees

For every `streamText` / `generateText` tool invocation that flows through OpenInference's Vercel AI SDK instrumentation, atrib captures:

- `event_type`: `https://atrib.dev/v1/types/tool_call`
- `content_id`: derived from `(serverUrl, tool.name)`, stable per tool
- `context_id`: from `session.id` if present, otherwise the OTel trace_id
- `chain_root`: synthesized genesis (or supplied via `resolveChainRoot` for multi-record sessions)
- Sidecar metadata: `tool_name`, `agent.name`, `input.value`, `output.value`, full traceId / spanId

## Reach

OpenInference covers 33 Python frameworks + 9 JS packages: OpenAI Agents SDK, Claude Agent SDK, LangChain (and LangGraph), Vercel AI, CrewAI, LlamaIndex, DSPy, MCP, Microsoft Agent Framework, Bedrock AgentCore, smolagents, Pydantic AI, Agno, and 20+ more. Wiring `AtribSpanProcessor` once gives verifiable-record coverage across all of them.
