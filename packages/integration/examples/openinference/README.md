# OpenInference + atrib integration example

Demonstrates the canonical Pattern #4 composition from atrib-spec [§9](../../../../atrib-spec.md#9-runtime-integration-patterns): one OpenTelemetry TracerProvider feeds two sibling SpanProcessors, one for capture (Arize / Phoenix / Langfuse / OTLP) and one for verifiable signing (atrib -> Merkle log).

## What this shows

- **`@atrib/openinference` composes alongside `@arizeai/openinference-vercel`**, the reference SpanProcessor for Vercel AI SDK's OpenInference instrumentation. They share one TracerProvider; each filters spans independently.
- **The atrib processor signs every OpenInference span** that carries the canonical `openinference.span.kind` attribute and required fields, producing an `AtribRecord` per span.
- **The Arize processor stays unaffected.** It continues exporting to whatever OTLP endpoint Phoenix / Langfuse / Datadog is listening on.
- **No code changes to the agent or Vercel AI SDK.** The integration is one `provider.addSpanProcessor` line away from any existing OpenInference pipeline.

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

To prove the cognitive side without a model provider or external collector:

```bash
pnpm --filter @atrib/integration openinference-cognitive-loop
```

That script emits synthetic OpenInference LLM and TOOL spans, signs them with `@atrib/openinference`, writes `{ record, _local }` envelopes to a temp local mirror, then checks that recall indexing sees prompt/model metadata, trace walks from TOOL back to LLM through `informed_by`, and summarize receives the normalized sidecar fields in its prompt input.

To prove the export boundary, run the dual-export smoke:

```bash
pnpm --filter @atrib/integration openinference-dual-export-smoke
```

By default it starts a local OTLP HTTP receiver, sends the span stream through `OTLPTraceExporter`, and sends the same spans through `AtribSpanProcessor`. It also verifies record signatures, LLM-to-TOOL `informed_by`, and `args_hash` / `result_hash` presence.

To run the same smoke against a local Phoenix collector:

```bash
docker run -p 6006:6006 -p 4317:4317 arizephoenix/phoenix:latest
ATRIB_OPENINFERENCE_OTLP_ENDPOINT=http://localhost:6006/v1/traces \
  pnpm --filter @atrib/integration openinference-dual-export-smoke
```

That proves the export path. To prove the backend receipt too, ask the script to poll Phoenix after export:

```bash
docker run -p 6006:6006 -p 4317:4317 arizephoenix/phoenix:latest
ATRIB_OPENINFERENCE_OTLP_ENDPOINT=http://localhost:6006/v1/traces \
ATRIB_OPENINFERENCE_VERIFY_BACKEND=phoenix \
PHOENIX_BASE_URL=http://localhost:6006 \
PHOENIX_PROJECT_NAME=default \
  pnpm --filter @atrib/integration openinference-dual-export-smoke
```

Backend verification checks that Phoenix returns the same trace id, span ids, and span names that atrib signed into local sidecars. The run marker is emitted as extra trace metadata and reported when the backend exposes it.

For Langfuse export, set `ATRIB_OPENINFERENCE_OTLP_ENDPOINT` to the full OTLP trace endpoint and pass auth through `ATRIB_OPENINFERENCE_OTLP_HEADERS` or `OTEL_EXPORTER_OTLP_HEADERS`. To prove Langfuse receipt, enable backend verification and provide Langfuse read credentials:

```bash
AUTH_STRING=$(printf "pk-lf-...:sk-lf-..." | base64)

ATRIB_OPENINFERENCE_OTLP_ENDPOINT=https://cloud.langfuse.com/api/public/otel/v1/traces \
ATRIB_OPENINFERENCE_OTLP_HEADERS="Authorization=Basic ${AUTH_STRING},x-langfuse-ingestion-version=4" \
ATRIB_OPENINFERENCE_VERIFY_BACKEND=langfuse \
LANGFUSE_BASE_URL=https://cloud.langfuse.com \
LANGFUSE_AUTH_STRING="${AUTH_STRING}" \
  pnpm --filter @atrib/integration openinference-dual-export-smoke
```

The script also accepts `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` instead of `LANGFUSE_AUTH_STRING`. Use `ATRIB_OPENINFERENCE_BACKEND_VERIFY_TIMEOUT_MS` and `ATRIB_OPENINFERENCE_BACKEND_VERIFY_INTERVAL_MS` to tune polling when the backend ingests slowly.

## Critical setup: the async-hooks context manager

The example registers `AsyncHooksContextManager` BEFORE creating the TracerProvider. Without it, Vercel AI SDK's child spans (LLM/TOOL/LLM/AGENT of a single `generateText` call) lose parent-context across async boundaries and each becomes its own root span with a fresh trace_id. atrib's adapter then signs each as its own context_id, breaking session chain composition.

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

For every `streamText` / `generateText` invocation that flows through OpenInference's Vercel AI SDK instrumentation, atrib captures:

- `event_type`: `tool_call` for TOOL spans; `observation` for LLM, AGENT, EMBEDDING, RETRIEVER, RERANKER, CHAIN, GUARDRAIL, EVALUATOR, and PROMPT spans
- `content_id`: derived from the runtime server URL plus the span-specific content leaf
- `context_id`: from `session.id` if present, otherwise the OTel trace_id
- `chain_root`: synthesized genesis (or supplied via `resolveChainRoot` for multi-record sessions)
- Sidecar metadata: span kind/name/id, `tool_name`, `agent.name`, model name, prompt metadata, usage, cost, score, `input.value`, and `output.value`

Parent-child span nesting remains correlation metadata. It does not create signed causal references by itself. The current automatic causal derivation is narrower: an LLM span that emits a `tool_call.id` can inform the matching TOOL span with the same id, and that `informed_by` edge is included before the TOOL record is signed.

## Reach

OpenInference covers 33 Python frameworks + 9 JS packages: OpenAI Agents SDK, Claude Agent SDK, LangChain (and LangGraph), Vercel AI, CrewAI, LlamaIndex, DSPy, MCP, Microsoft Agent Framework, Bedrock AgentCore, smolagents, Pydantic AI, Agno, and 20+ more. Wiring `AtribSpanProcessor` once gives verifiable-record coverage across all of them.
