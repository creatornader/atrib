---
'@atrib/openinference-processor': minor
---

New package: `@atrib/openinference-processor`. OpenTelemetry SpanProcessor that consumes [OpenInference](https://github.com/Arize-ai/openinference)-shaped spans and emits signed atrib records.

This is the reference implementation of [atrib-spec §9](../atrib-spec.md#9-runtime-integration-patterns) Pattern #4 (OpenTelemetry SpanProcessor). One adapter transitively covers every framework with OpenInference instrumentation: OpenAI Agents SDK, Claude Agent SDK, LangChain, Vercel AI, CrewAI, LlamaIndex, DSPy, MCP, Microsoft Agent Framework, Bedrock AgentCore, smolagents, Pydantic AI, Agno, and 20+ more.

The package mirrors the public ergonomics of `@arizeai/openinference-vercel` so callers can compose `AtribSpanProcessor` alongside their existing OpenInference pipeline (Phoenix, Langfuse, AgentOps) without learning a new pattern. Where observability platforms capture what the agent says it did, atrib attests to what the agent signed it did, with a Merkle log behind it.

First version maps `openinference.span.kind === 'TOOL'` spans to atrib `tool_call` records. Mapping reads `tool.name`, `session.id`, `agent.name`, `input.value`, `output.value`. LLM-span mapping, batch variant, args/result hash extraction ([§8.3](../atrib-spec.md#83-salted-commitment-posture)), and `informed_by` derivation are roadmapped.

Honors [§5.8 degradation contract](../atrib-spec.md#58-degradation-contract): every failure caught and logged with `atrib:openinference:` prefix; the OTel pipeline is never affected.

Smoke tests cover: filter recognition (TOOL/LLM/PROMPT/etc.), TOOL-only mapping at this version, span-to-record content_id derivation, end-to-end signed-record verification, custom-filter override, submit-error containment, and shutdown semantics. 11/11 passing.

Peer dependencies on `@opentelemetry/api ^1.9.0` and `@opentelemetry/sdk-trace-base ^1.27.0` so callers share their existing OTel versions instead of pulling in a transitive copy.
