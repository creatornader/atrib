# OpenClaw and Hermes integration map

> A mechanics map for direct atrib integration with OpenClaw and Hermes. The goal is to know which host surface should produce which atrib proof, and which package belongs at that boundary.

**Status**: DRAFT (v1, 2026-06-19; evidence snapshot)
**Spec anchors**: [§9 Runtime Integration Patterns](../../atrib-spec.md#9-runtime-integration-patterns), [D069](../../DECISIONS.md#d069-runtime-integration-patterns--first-class-peers-no-canonical-path), [D108](../../DECISIONS.md#d108-openinference-span-trees-are-an-intake-layer-not-the-runtime-log), [D120](../../DECISIONS.md#d120-local-substrate-coordinator-keeps-startup-spawn-sidecars-wrapper-owned), [D121](../../DECISIONS.md#d121-runtime-log-proof-manifests-verify-host-owned-run-windows), [D122](../../DECISIONS.md#d122-host-runtime-adapters-stay-distinct-from-agent-framework-adapters)
**Builds on**: [Integration patterns](10-integration-patterns.md), [Local substrate coordinator](13-local-substrate-coordinator.md), [Delegation and capabilities](12-delegation-and-capabilities.md)
**Enables**: scoped OpenClaw and Hermes plugin proofs, upstream PR planning, and repeatable answers to "which atrib package fits this host surface?"

## Evidence snapshot

This map was checked on 2026-06-19.

Local versions:

- OpenClaw CLI: `OpenClaw 2026.6.6 (8c802aa)`. npm latest checked at `2026.6.8`.
- Hermes CLI: `Hermes Agent v0.16.0 (2026.6.5)`, local upstream `7b9dc7cd0`; GitHub `HEAD` checked at `cfb55de5ea49ef60268bf5a6924e25c1701943ec`.

Primary docs and source surfaces checked:

- OpenClaw plugin hooks: <https://docs.openclaw.ai/plugins/hooks>, cross-checked against the CLI package docs.
- OpenClaw OpenTelemetry export: <https://docs.openclaw.ai/gateway/opentelemetry>, cross-checked against the CLI package docs.
- OpenClaw trajectory bundles: <https://docs.openclaw.ai/tools/trajectory>, cross-checked against the CLI package docs.
- Hermes plugins: <https://hermes-agent.nousresearch.com/docs/user-guide/features/plugins>
- Hermes event hooks: <https://hermes-agent.nousresearch.com/docs/user-guide/features/hooks>
- Hermes observer contract: local Hermes agent docs checkout.
- Hermes middleware contract: local Hermes agent docs checkout.
- Hermes built-in Langfuse plugin: <https://hermes-agent.nousresearch.com/docs/user-guide/features/built-in-plugins>
- Hermes trajectory format: <https://hermes-agent.nousresearch.com/docs/developer-guide/trajectory-format>

The map is not a claim that atrib is merged into either upstream. It is a source-backed plan for where a plugin, package, or PR should attach.

## Adapter family boundary

OpenClaw and Hermes are host runtime integrations. They sit next to framework
tool-call adapters, but they are not `@atrib/agent` adapters unless a specific
surface is an SDK or MCP client/server callback that `@atrib/agent` already
owns.

The split:

| Adapter family                 | Fits                                                                                       | OpenClaw / Hermes implication                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Framework tool-call middleware | Application code owns the agent loop and calls MCP or SDK tools.                           | Use `@atrib/mcp-wrap` for third-party MCP servers and `@atrib/mcp` for atrib-owned MCP servers.     |
| Host runtime adapter           | The harness owns sessions, native tools, approvals, subagents, telemetry, and run history. | Build an external plugin proof first, then consider an upstream PR after behavior proof exists.     |
| Observability intake           | The host emits OpenInference-shaped spans or a clear OTLP contract.                        | Use spans for correlation unless no stronger direct tool hook exists.                               |
| Runtime-log proof              | The host exports a trajectory, transcript, session log, checkpoint log, or job window.     | Use `@atrib/runtime-log` to prove bounded windows without publishing raw runtime bodies by default. |

## Implementation implications

- Build `openclaw-atrib` and `hermes-atrib` as external plugin proofs before
  proposing upstream changes.
- Keep one signing owner per host event. A host hook that sees an
  `@atrib/mcp-wrap` call should correlate ids and skip a second `tool_call`
  record.
- Treat `@atrib/openinference` as span intake, not the default proof boundary,
  when direct pre/post tool hooks are available.
- Export runtime windows through `@atrib/runtime-log`; do not move raw
  trajectory or transcript bodies into atrib by default.
- Shape proposal packets around proof artifacts: plugin code, recorded proof output,
  fixture tests, privacy posture, and exact upstream surface touched.

## Product posture

OpenClaw and Hermes are runtimes. atrib should not try to replace either runtime, memory system, scheduler, tool registry, approval UI, or observability dashboard.

atrib's role is a verifiable action layer over selected runtime boundaries: control what runs when the host exposes a pre-action hook, coordinate what carries forward across sessions and agents, and prove what happened after execution or rejection.

The clean role split:

| Layer         | OpenClaw / Hermes role                                                              | atrib role                                                                                |
| ------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Agent runtime | Own prompt assembly, model calls, tool execution, sessions, approvals, and delivery | Wrap selected boundaries, record policy decisions, and verify action evidence             |
| MCP tools     | Host discovers and invokes external MCP servers                                     | `@atrib/mcp-wrap` signs third-party MCP calls; `@atrib/mcp` signs atrib-owned MCP servers |
| Native tools  | Host executes built-in and plugin tools                                             | Host adapter signs tool calls at hook or middleware boundary                              |
| Observability | Host emits diagnostics, spans, Langfuse traces, or local telemetry                  | Use spans as intake only when the span contract is explicit enough                        |
| Runtime log   | Host owns trajectory, transcript, session log, or job window                        | `@atrib/runtime-log` proves bounded windows without owning raw logs                       |
| Handoff       | Host passes work between agents or tools                                            | `@atrib/verify` accepts or rejects signed upstream claims before linking                  |

This keeps atrib as signed proof, lineage, and action-layer control points, not another always-on agent runtime.

## Package decision rules

| Host surface                                            | Use                                                                                      | Why                                                                                                                               | Do not use when                                                                       |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Third-party MCP server configured in OpenClaw or Hermes | `@atrib/mcp-wrap`                                                                        | The host already speaks MCP, so the wrapper signs at the protocol boundary without upstream tool changes.                         | The tool is host-native and never crosses MCP.                                        |
| atrib-owned MCP server or primitive                     | `@atrib/mcp`                                                                             | The server implementation can call atrib middleware directly.                                                                     | The upstream MCP server is not owned by atrib.                                        |
| Host-native tool hook                                   | Host-specific adapter code plus the host runtime proof envelope                          | The host exposes tool name, args, result, duration, session ids, and call ids. That is the right proof boundary for native tools. | A wrapped MCP server already signs the same call.                                     |
| SDK callback inside application code                    | `@atrib/agent`                                                                           | The app or SDK exposes outbound calls before the host runtime shell owns them.                                                    | The host owns the native tool execution event instead.                                |
| OpenTelemetry or OpenInference span stream              | `@atrib/openinference` only for OpenInference-shaped spans, or a new OTLP ingest adapter | Spans can produce signed records plus local sidecars when their schema is stable and close to the action.                         | The host already offers direct pre/post tool hooks with stronger payloads.            |
| Trajectory, transcript, session export, or run window   | `@atrib/runtime-log`                                                                     | The host already owns the raw run log. atrib should prove a bounded window and projections.                                       | You need per-tool action signing at execution time.                                   |
| Memory command surface                                  | `@atrib/memory-tool` only for Anthropic Memory Tool shaped handlers                      | That package signs Memory Tool commands while leaving storage host-owned.                                                         | Hermes memory providers are active. They are not the Anthropic Memory Tool API.       |
| Handoff or support packet                               | `@atrib/verify` or `@atrib/verify-mcp`                                                   | Receiving agents should verify upstream claims before adding `informed_by`.                                                       | The packet has no signed records, proof, trusted signer, or accepted body commitment. |
| Local long-lived route                                  | local substrate coordinator plus host adapter                                            | OpenClaw and Hermes can run as long-lived supervised agents without becoming MCP hosts.                                           | First-time users need a zero-daemon path.                                             |

## OpenClaw mechanics

OpenClaw has four mature surfaces that matter for atrib: typed plugin hooks, official diagnostics OpenTelemetry export, trajectory bundles, and MCP configuration.

### Surface map

| OpenClaw surface                          | Current mechanics                                                                                                                                                                                                                 | atrib fit                                                                                                                        | Primary proof claim                                                                |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Plugin hooks                              | Typed `api.on(...)` hooks cover agent turns, model calls, tool calls, messages, sessions, compaction, subagents, gateway lifecycle, cron, and install policy.                                                                     | Direct OpenClaw plugin adapter.                                                                                                  | "OpenClaw reported this native runtime event at this boundary."                    |
| `before_tool_call` / `after_tool_call`    | `before_tool_call` receives tool name, params, discriminators, derived paths, run id, tool call id, session and job context, and can rewrite, block, or require approval. `after_tool_call` observes result, error, and duration. | Sign host-native tool calls. Pre stores args and context, post signs args/result or error outcome.                               | Per-tool `tool_call` records for built-in and OpenClaw-owned tools.                |
| `resolve_exec_env`                        | Plugins can add env vars to `exec` invocations after base env is built.                                                                                                                                                           | Inject `ATRIB_CONTEXT_ID`, `ATRIB_PARENT_RECORD_HASH`, and chain-tail env for child producers.                                   | Child processes can sign into the parent session with explicit parent edge.        |
| `tool_result_persist`                     | Rewrites the assistant message produced from a tool result before OpenClaw-owned transcript persistence.                                                                                                                          | Optional receipt or sidecar marker path. Not the first signing surface.                                                          | Transcript can carry a pointer to a signed record without changing tool semantics. |
| `model_call_started` / `model_call_ended` | Observation hooks for sanitized provider/model metadata, timing, outcome, and bounded request-id hashes.                                                                                                                          | Optional `observation` records, or correlation metadata for runtime-log manifests.                                               | Model attempts are observable without prompt content by default.                   |
| `llm_input` / `llm_output`                | Conversation-content hooks behind explicit `allowConversationAccess` for non-bundled plugins.                                                                                                                                     | Optional local sidecar enrichment. Use with strict privacy defaults.                                                             | Prompt/output material can be committed locally or archived only when configured.  |
| Session and compaction hooks              | `session_start`, `session_end`, `before_compaction`, `after_compaction`, and `before_reset`.                                                                                                                                      | `@atrib/runtime-log` source and lifecycle observations.                                                                          | Bounded session windows and compaction events are provable.                        |
| Subagent hooks                            | `subagent_spawned` and `subagent_ended` observe child launch and completion.                                                                                                                                                      | Parent-child env bundle plus runtime-log window edges.                                                                           | Delegated work can link back to parent dispatch records.                           |
| `cron_changed`                            | Gateway-owned cron lifecycle changes include added, updated, removed, started, finished, and scheduled.                                                                                                                           | Runtime-log source and observations for scheduled work.                                                                          | Scheduled run windows can be tied to signed records.                               |
| `diagnostics-otel`                        | Official plugin exports OTLP/HTTP metrics, traces, and logs. Spans cover model usage, model calls, harness lifecycle, skill usage, tool execution, exec, webhook/message processing, context assembly, and tool loops.            | Observability intake, not primary proof. Use direct hooks first. Build an ingest adapter only if span-only deployment is needed. | Operations telemetry can correlate with signed records.                            |
| Trajectory bundles                        | OpenClaw writes per-session JSONL and exports bundles with ordered runtime and transcript timelines, metadata, artifacts, prompts, system prompt, and tools.                                                                      | `@atrib/runtime-log` source.                                                                                                     | A run window can be verified without publishing raw trajectory content.            |
| MCP config                                | OpenClaw can connect to MCP servers and list tools.                                                                                                                                                                               | `@atrib/mcp-wrap` for third-party MCP servers; `@atrib-primitives` for atrib primitive tools.                                    | External MCP calls sign once at the protocol boundary.                             |
| Agent harness                             | Low-level runtime surface for trusted bundled harnesses.                                                                                                                                                                          | Not v1. Use only if OpenClaw wants an atrib-aware native harness later.                                                          | Too invasive for the first upstreamable proof.                                     |

### OpenClaw recommended shape

Start with an `openclaw-atrib` plugin proof:

1. Register `before_tool_call` and `after_tool_call`.
2. Skip tools already signed by `@atrib/mcp-wrap`.
3. Sign host-native tool calls after execution with hashes for args and result.
4. Register `resolve_exec_env` to pass the same-session env bundle into `exec`.
5. Register session, compaction, subagent, and cron hooks as runtime-log events.
6. Export a `log_window_manifest` from OpenClaw trajectory files.
7. Add the atrib primitives as MCP tools, preferably through the local `atrib-primitives` runtime for dogfood profiles.

Do not make `diagnostics-otel` the v1 proof boundary. It is valuable for dashboards and correlation, but direct hooks are closer to the action and carry the host IDs needed for `context_id`, `tool_call_id`, `runId`, and job scoping.

Use OpenTelemetry/OpenInference for OpenClaw in one of three later shapes:

1. Side-by-side correlation: OpenClaw keeps `diagnostics-otel`; atrib signs via hooks and records trace ids in local sidecars.
2. Dedicated OTLP ingest: a future atrib adapter receives OpenClaw OTLP spans and maps them to signed observations or tool calls when no hook adapter is installed.
3. OpenInference export path: if OpenClaw emits OpenInference-shaped spans through an external bridge such as NeMo Relay, use `@atrib/openinference` only when the processor can attach at the span-producing path or a trusted ingest bridge preserves enough span fields.

## Hermes mechanics

Hermes has a plugin system for custom tools, hooks, commands, platforms, memory providers, context engines, model providers, and backend providers. The direct atrib path should use general plugins and observer hooks, not memory-provider replacement.

### Surface map

| Hermes surface                                               | Current mechanics                                                                                                                                                                                                                          | atrib fit                                                                                                   | Primary proof claim                                                                       |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| General plugins                                              | `ctx.register_tool`, `ctx.register_hook`, `ctx.register_command`, `ctx.dispatch_tool`, `ctx.register_cli_command`, `ctx.register_skill`, and related plugin APIs. User and project plugins are opt-in.                                     | `hermes-atrib` plugin.                                                                                      | "Hermes reported this runtime event through its plugin API."                              |
| Observer hooks                                               | Local contract `hermes.observer.v1`; hooks are read-only telemetry for trace, metrics, audit, replay, and export integrations.                                                                                                             | Primary direct proof surface for v1.                                                                        | Stable event families with correlation IDs and sanitized payloads.                        |
| `pre_tool_call` / `post_tool_call`                           | Fires before and after every tool execution, including built-in and plugin tools. Payloads include tool name, args, result, duration, task id, session id, turn id, API request id, tool call id, status, and error fields when available. | Sign host-native tool calls.                                                                                | Per-tool `tool_call` records with result commitments.                                     |
| `pre_api_request` / `post_api_request` / `api_request_error` | Request-scoped provider attempts with session, task, turn, API request id, provider, model, api mode, request/response summaries, usage, status, retry, and error metadata.                                                                | Optional `observation` records or local sidecar enrichment.                                                 | Provider attempts can be proven or correlated without treating every span as a tool call. |
| `pre_llm_call` / `post_llm_call`                             | Turn-scoped hooks before the tool loop and after the final response. `pre_llm_call` may inject context.                                                                                                                                    | Recall injection can stay separate from signing; post-turn observation is optional.                         | Turn-level context and final answer can be committed when configured.                     |
| Middleware                                                   | `llm_request`, `llm_execution`, `tool_request`, and `tool_execution` can rewrite or wrap execution while preserving Hermes flow.                                                                                                           | Use only for request-path features such as receipt injection, stricter policy, or exact execution wrapping. | Middleware can prove the effective request when observer hooks are not enough.            |
| `transform_tool_result`                                      | Runs after post-tool hook and before the result is appended to model context.                                                                                                                                                              | Optional receipt injection or redaction. Not the default signing surface.                                   | Model-visible result can carry signed-record pointers if configured.                      |
| Approval hooks                                               | `pre_approval_request` and `post_approval_response` observe dangerous-command approval prompts and decisions.                                                                                                                              | Evidence blocks or observations.                                                                            | User approval can be tied to a later tool record without becoming authorization issuance. |
| Subagent hooks                                               | `subagent_start` and `subagent_stop` describe delegated work with parent and child IDs.                                                                                                                                                    | Parent-child env bundle, verified handoff, runtime-log windows.                                             | Delegated child work links back to the parent session.                                    |
| Gateway hooks and shell hooks                                | `HOOK.yaml` gateway hooks and config shell hooks can log, alert, or inject context.                                                                                                                                                        | Secondary local operations path.                                                                            | Useful for deployment and alerts, weaker than plugin hooks for exact tool proof.          |
| Built-in Langfuse plugin                                     | Uses pre/post API and tool hooks to create one turn span, generation observations, and tool observations.                                                                                                                                  | Evidence that Hermes hook payloads are span-grade. Do not consume Langfuse as the proof source.             | Existing plugin pattern validates the shape for an atrib plugin.                          |
| MCP config                                                   | Hermes supports stdio, HTTP, and OAuth-authenticated MCP servers, with filtering.                                                                                                                                                          | `@atrib/mcp-wrap` for third-party MCP servers.                                                              | External MCP calls sign once at the protocol boundary.                                    |
| Trajectory JSONL                                             | Hermes saves ShareGPT-style trajectories for interactive and batch runs, with metadata, tool stats, and completion status.                                                                                                                 | `@atrib/runtime-log` source.                                                                                | Batch and eval windows can be committed without publishing raw trajectories.              |
| Memory providers                                             | Hermes supports Honcho, OpenViking, Mem0, Hindsight, Holographic, RetainDB, ByteRover, Supermemory, and provider plugins.                                                                                                                  | Do not replace memory. Sign memory actions only if a concrete provider boundary is needed.                  | Memory remains Hermes-owned or provider-owned.                                            |

### Hermes recommended shape

Start with a `hermes-atrib` general plugin proof:

1. Register observer hooks for `pre_tool_call`, `post_tool_call`, `pre_api_request`, `post_api_request`, `api_request_error`, session lifecycle, approvals, and subagents.
2. Sign host-native tool calls from post-tool payloads. Use pre-tool payloads only to preserve original args and context for later signing.
3. Skip tools already signed through `@atrib/mcp-wrap`.
4. Treat API hooks and turn hooks as optional `observation` records, not as replacements for tool records.
5. Use middleware only when proof needs the effective request before guardrails or when a result pointer must be inserted before the model sees it.
6. Produce `@atrib/runtime-log` manifests from trajectory JSONL or batch output.
7. Expose atrib primitives through Hermes MCP config.
8. Keep the memory provider system external. A future memory-provider integration can sign provider calls, but atrib should not be pitched as another memory backend.

Hermes is Python-first. Current `@atrib/openinference` is a TypeScript OpenTelemetry `SpanProcessor`, so a Hermes plugin cannot import it directly. A Hermes OpenInference path would need one of these:

1. A Python atrib OpenInference adapter.
2. A local substrate HTTP signing path from the Hermes plugin.
3. An OTLP/OpenInference ingest service that receives spans from Hermes or a bridge.

Until one exists, Hermes direct hooks are the stronger and simpler proof surface.

## OpenInference boundary

The corrected rule:

Use `@atrib/openinference` only when atrib is attached to the span-producing path and the spans are OpenInference-shaped, or when a dedicated ingest adapter preserves enough span fields to make the proof claim honest.

Do not use `@atrib/openinference` as a generic label for "the host has observability."

OpenClaw has official OpenTelemetry export. Hermes has observer hooks and a Langfuse plugin. Both facts matter, but neither automatically means `@atrib/openinference` is the right package. Direct hooks are closer to the runtime's action boundary. Spans are better for reach, correlation, metrics, and local sidecar enrichment.

The decision tree:

1. Does the host expose pre/post tool hooks with args, result, session id, and call id? Use a direct adapter.
2. Is the tool an external MCP server? Use `@atrib/mcp-wrap`.
3. Does the host only expose OpenInference-shaped spans? Use `@atrib/openinference` or its language equivalent.
4. Does the host expose generic OTLP spans but not OpenInference spans? Build a host-specific OTLP ingest adapter, or use runtime-log manifests if only run-window proof is needed.
5. Does the host expose only trajectories or session export? Use `@atrib/runtime-log` for the run window and Pattern 5 only if per-step events are structured enough to re-sign.

## Double-signing rules

Each action gets one producer.

| Event                                | Producer                                                               | Skip rule                                                                                                                                      |
| ------------------------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Third-party MCP tool call            | `@atrib/mcp-wrap`                                                      | Host plugin must skip MCP tools whose upstream is wrapper-fronted.                                                                             |
| atrib primitive call                 | `@atrib/mcp` inside the primitive server or `atrib-primitives` runtime | Host plugin must not sign the same primitive call as a native tool if the MCP wrapper already did.                                             |
| Host-native tool call                | OpenClaw or Hermes direct adapter                                      | Span processors must not emit another `tool_call` for the same tool id when direct signing is active.                                          |
| LLM/provider attempt                 | Optional host adapter observation or span adapter observation          | Do not create both an API-hook observation and a span observation for the same provider call unless one is explicitly marked correlation-only. |
| Session, trajectory, or batch window | `@atrib/runtime-log` manifest                                          | Do not expand the manifest into duplicate per-tool records unless using Pattern 5 with an explicit weaker trust label.                         |
| Approval decision                    | Evidence block or observation                                          | Do not treat approval evidence as proof that the tool was authorized by atrib. Host policy owns enforcement.                                   |
| Handoff claim                        | `@atrib/verify` on receiver side                                       | Do not add `informed_by` until verification accepts the upstream hash.                                                                         |

If a deployment uses both direct hooks and spans, direct hooks own `tool_call`. Spans can carry trace IDs, timing, model metadata, cost, and local sidecar content.

## Implementation sequence

OpenClaw is the better first implementation target because the typed hook
catalog already carries the surfaces atrib needs, and OpenClaw plugin packaging
is npm and ClawHub native.

Candidate OpenClaw implementation path:

1. Build external local plugin proof.
2. Verify with one host-native tool, one wrapped MCP server, one subagent or exec child, and one trajectory manifest.
3. Publish as an npm plugin or local example.
4. Propose docs or plugin-catalog inclusion.
5. Only ask for hook payload changes if the proof finds a missing stable field.

Hermes is also a strong target, but the first contribution should likely be a plugin, not a core PR.

Candidate Hermes upstream path:

1. Build `hermes-atrib` as a general plugin.
2. Use observer hooks first; add middleware only when exact request wrapping or result injection is required.
3. Verify plugin enablement, fail-open behavior, and no-memory-provider posture.
4. Propose a docs example or plugin listing.
5. Open a core PR only if an observer field is missing or if the middleware contract needs a small stable extension.

Do not start by adding new public packages. Start with examples or external plugins. Promote to `@atrib/openclaw` or `@atrib/hermes` only after repeated code proves that a package boundary reduces maintenance.

## Proof acceptance tests

A local OpenClaw proof should pass:

- Host-native tool call signs exactly one `tool_call` record.
- Wrapped MCP tool signs exactly one record through `@atrib/mcp-wrap`, and the host plugin skips it.
- `resolve_exec_env` injects context into a child command, and the child record links to the parent when a parent hash is available.
- Session or trajectory export produces a `log_window_manifest` that verifies with `@atrib/runtime-log`.
- OpenTelemetry export can run beside atrib without being required for signing.
- Disabling atrib leaves primary OpenClaw behavior unaffected.

A local Hermes proof should pass:

- `pre_tool_call` and `post_tool_call` payloads produce exactly one `tool_call` record for a built-in tool.
- Tool errors, blocked calls, and cancelled calls produce honest status fields or no signed success claim.
- Wrapped MCP tools sign through `@atrib/mcp-wrap`, and the Hermes plugin skips them.
- `pre_api_request` and `post_api_request` can produce optional observations or local sidecars without leaking prompt content by default.
- Trajectory JSONL produces a `log_window_manifest` that verifies with `@atrib/runtime-log`.
- The plugin is fail-open when keys, local substrate endpoint, or log submission are unavailable.

Shared acceptance:

- Signed records use existing event types. No new event type is introduced for "OpenClaw" or "Hermes."
- The public log receives signed commitments, not raw prompts, tool payloads, memory bodies, or trajectory bodies by default.
- Local sidecars carry host-specific details needed by recall, trace, and summarize.
- `@atrib/verify` gates any incoming cross-agent claims before a receiving agent links them through `informed_by`.
- The doc, plugin README, and example config state which producer owns each event.

## Open questions

- What exact field does each host use to mark MCP-originated tools in pre/post hooks? The first proof needs a reliable skip rule.
- Does OpenClaw `after_tool_call` expose enough structured result material for verifier-friendly hashing without relying on transcript persistence?
- Should OpenClaw trajectory manifests use the raw trajectory sidecar, the exported bundle, or both as the `RuntimeLogSource`?
- Should Hermes tool-call records sign the `result` after Hermes truncation/redaction or before transformation? The safe default is post-dispatch, pre-model-transform when that payload is available.
- Should Hermes API-hook observations be enabled by default? The likely default is off for public proof and on only for local sidecar enrichment.
- Does either upstream want an official plugin maintained outside the core repo, or a bundled optional plugin?

## See also

- [Integration patterns](10-integration-patterns.md)
- [Local substrate coordinator](13-local-substrate-coordinator.md)
- [Delegation and capabilities](12-delegation-and-capabilities.md)
- [`@atrib/openinference`](../../packages/openinference/README.md)
- [`@atrib/runtime-log`](../../packages/runtime-log/README.md)
- [`@atrib/mcp-wrap`](../../packages/mcp-wrap/README.md)
- [`@atrib/agent`](../../packages/agent/README.md)
