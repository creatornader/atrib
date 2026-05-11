---
'@atrib/openinference': minor
---

New package: `@atrib/openinference`. OpenTelemetry SpanProcessor that consumes [OpenInference](https://github.com/Arize-ai/openinference)-shaped spans and emits signed atrib records on a parallel pipeline.

Reference implementation of [atrib-spec §9](../atrib-spec.md#9-runtime-integration-patterns) Pattern #4. One adapter transitively reaches every framework with OpenInference instrumentation: OpenAI Agents SDK, Claude Agent SDK, LangChain (and LangGraph), Vercel AI, CrewAI, LlamaIndex, DSPy, MCP, Microsoft Agent Framework, Bedrock AgentCore, smolagents, Pydantic AI, Agno, and 20+ more.

The package mirrors the public ergonomics of `@arizeai/openinference-vercel` so callers compose `AtribSpanProcessor` alongside their existing OpenInference pipeline (Phoenix, Langfuse, AgentOps) without learning a new pattern. Where observability platforms capture what the agent says it did, atrib attests to what the agent signed it did, with a Merkle log behind it.

This first published version covers:

- All 10 OpenInference span kinds: `TOOL` -> `tool_call`; `LLM` / `AGENT` / `EMBEDDING` / `RETRIEVER` / `RERANKER` / `CHAIN` / `GUARDRAIL` / `EVALUATOR` / `PROMPT` -> `observation`.
- Both Simple and Batch SpanProcessor variants. Batch ships with configurable `maxQueueSize` / `maxExportBatchSize` / `scheduledDelayMillis` / `exportTimeoutMillis`; queue overflows drop oldest records per the [§5.8](../atrib-spec.md#58-degradation-contract) degradation contract so the host pipeline never blocks.
- Auto `informed_by` derivation between LLM and TOOL records via shared `InformedByTracker`.
- Args/result hash extraction per spec [§8.3](../atrib-spec.md#83-salted-commitment-posture) with three modes: `none` / `plain` / `salted`.
- `verifyOpenTelemetryContextPropagation()` preflight helper that catches misconfigured async-context managers at startup before fragmented chains land in production.
- Attribute keys imported from `@arizeai/openinference-semantic-conventions` for canonical schema correctness.
- Peer dependencies on `@opentelemetry/api ^1.9.0` and `@opentelemetry/sdk-trace-base ^1.27.0` so callers share their existing OTel versions instead of pulling in a transitive copy.

62 unit tests plus a composition pilot validated end-to-end against real Vercel AI SDK v6 + NVIDIA NIM-served Qwen 3.5 + `@arizeai/openinference-vercel`'s reference SpanProcessor on a shared TracerProvider. Conformance fixtures in `test/fixtures/` capture four canonical span shapes live-captured from a real run; the fixture-replay test catches upstream attribute-schema drift before it reaches consumers.

Honors [§5.8 degradation contract](../atrib-spec.md#58-degradation-contract): every failure from span mapping, signing, and submission is caught. Errors are logged with the `atrib:openinference:` prefix when `debug: true`; otherwise silent. The OTel pipeline is never affected by atrib failures.
