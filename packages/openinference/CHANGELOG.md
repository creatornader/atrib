# @atrib/openinference

## 0.3.7

### Patch Changes

- Updated dependencies [ed766a4]
  - @atrib/mcp@0.17.2

## 0.3.6

### Patch Changes

- Updated dependencies [5ee04c5]
  - @atrib/mcp@0.17.1

## 0.3.5

### Patch Changes

- Updated dependencies [80310e7]
  - @atrib/mcp@0.17.0

## 0.3.4

### Patch Changes

- Updated dependencies [f790fa0]
  - @atrib/mcp@0.16.1

## 0.3.3

### Patch Changes

- Updated dependencies [114248a]
  - @atrib/mcp@0.16.0

## 0.3.2

### Patch Changes

- c2307da: Document backend-verified Phoenix and Langfuse dual-export smokes. The integration smoke can now poll the backend read API after export and compare returned trace and span identifiers against atrib sidecars.

## 0.3.1

### Patch Changes

- Updated dependencies [c2ea30d]
  - @atrib/mcp@0.15.1

## 0.3.0

### Minor Changes

- 8ad7158: Add OpenInference sidecar content for cognitive recall.

  `@atrib/openinference` now mirrors span payloads as local-only sidecar content for recall, trace, and summarize while signed records stay canonical. `@atrib/mcp` exposes shared sidecar normalization helpers, and the read primitives consume normalized wrapper and OpenInference content. The OpenInference processors now resolve custom chain roots against the actual signed `context_id`, including spans that use `session.id`.

  OpenInference args/result commitments now hash verifier-compatible JCS material: JSON strings are parsed before hashing, while non-JSON strings are hashed as JCS string values. This lets `@atrib/verify` replay `args_hash` and `result_hash` from supplied body material. Integration coverage now includes a dual-export OTLP smoke, body-commitment replay, richer recall queries over OpenInference sidecars, and a negative guard that generic OTel parent-child nesting does not create `informed_by`.

### Patch Changes

- Updated dependencies [8ad7158]
  - @atrib/mcp@0.15.0

## 0.2.9

### Patch Changes

- Updated dependencies [d19cb28]
- Updated dependencies [cd149be]
  - @atrib/mcp@0.14.0

## 0.2.8

### Patch Changes

- Updated dependencies [24c4331]
  - @atrib/mcp@0.13.0

## 0.2.7

### Patch Changes

- Updated dependencies [ee37209]
  - @atrib/mcp@0.12.0

## 0.2.6

### Patch Changes

- Updated dependencies [7658b17]
  - @atrib/mcp@0.11.1

## 0.2.5

### Patch Changes

- Updated dependencies [b263d91]
  - @atrib/mcp@0.11.0

## 0.2.4

### Patch Changes

- Updated dependencies [847852f]
  - @atrib/mcp@0.10.0

## 0.2.3

### Patch Changes

- Updated dependencies [64f3c86]
  - @atrib/mcp@0.9.1

## 0.2.2

### Patch Changes

- Updated dependencies [df7b3d3]
  - @atrib/mcp@0.9.0

## 0.2.1

### Patch Changes

- Updated dependencies [ec688d0]
  - @atrib/mcp@0.8.0

## 0.2.0

### Minor Changes

- b89d7b8: Upgrade major versions of four core deps: `@noble/ed25519` 2 → 3,
  `@noble/hashes` 1 → 2 (where applicable), `canonicalize` 2 → 3, and
  `@opentelemetry/sdk-trace-base` 1 → 2 (peer dep on `@atrib/openinference`).

  Atrib's own public APIs are unchanged, and signing-output, hash-output, and
  JCS-canonicalization-output remain byte-identical — verified by the signing
  corpus (spec [§1.4](../atrib-spec.md#14-signing-and-verification)) and the Wycheproof Ed25519 test vectors.

  The single user-visible break is `@atrib/openinference`'s peer dep: consumers
  of that package must now use `@opentelemetry/sdk-trace-base@^2.7.1` (instead
  of `^1.27.0`). The OTel SDK v2 also replaced `provider.addSpanProcessor(p)`
  with the `new BasicTracerProvider({ spanProcessors: [p] })` constructor form;
  the adapter and its tests have been migrated accordingly.

  The other deps' major-version changes were API-shape internal:
  `@noble/ed25519` v3 moved sha512 wiring from `etc.sha512Sync` to
  `hashes.sha512` and renamed `utils.randomPrivateKey` to `utils.randomSecretKey`;
  `@noble/hashes` v2 is ESM-only and requires `.js` extensions on import paths;
  `canonicalize` v3 is ESM-only (atrib was already ESM-only). None of these
  shifts touch atrib's exported surface.

### Patch Changes

- Updated dependencies [b89d7b8]
  - @atrib/mcp@0.7.0

## 0.1.0

### Minor Changes

- d102218: New package: `@atrib/openinference`. OpenTelemetry SpanProcessor that consumes [OpenInference](https://github.com/Arize-ai/openinference)-shaped spans and emits signed atrib records on a parallel pipeline.

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
