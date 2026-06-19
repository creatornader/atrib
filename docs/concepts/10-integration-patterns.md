# Integration patterns (runtime adapters)

> atrib's SDK can attach to an agent runtime in six structurally distinct ways. Each has different trust/observability trade-offs. Knowing which pattern your runtime supports tells you exactly what kind of atrib integration is available.

**Status**: STUB
**Spec anchors**: [§9 Harness Integration Patterns](../../atrib-spec.md#9-harness-integration-patterns) · [D069](../../DECISIONS.md)
**Builds on**: every prior concept (this is how anything else gets wired in)
**Enables**: real-world deployment

## What this teaches

The six-pattern integration taxonomy (per [D069](../../DECISIONS.md)) — what each pattern looks like, where the signing happens, what it observes, and which agent frameworks each pattern fits.

## What to cover when this gets written

The six patterns, briefly:
- **Pattern 1: MCP middleware** (the `@atrib/mcp-wrap` and `@atrib/mcp` packages). Wraps an MCP server; signs every tool call at the protocol layer; agent doesn't know atrib exists.
- **Pattern 2: Host-side framework adapter** (the `@atrib/agent` package). Wraps the agent's MCP client at the framework boundary; signs from the caller's side.
- **Pattern 3: Callback / hook adapter**. Framework provides a tool-execution hook; atrib's adapter is registered and signs each call.
- **Pattern 4: OpenInference SpanProcessor** (the `@atrib/openinference` package). Consumes OpenInference-shaped OpenTelemetry spans; emits signed records. Transitively reaches 20+ agent frameworks via OTel.
- **Pattern 5: Post-hoc replay**. Replay a recorded trace through atrib's signing pipeline after the fact. For systems where in-line signing isn't feasible.
- **Pattern 6: Streaming**. The signing pipeline operates on a streaming event source from the agent runtime.
- For each pattern: which agent frameworks fit (Claude Agent SDK, Cloudflare Agents, Vercel AI SDK, LangChain JS, etc.)
- The six-pattern decision tree: how to pick the right pattern for a given runtime
- The trust trade-offs: where signing happens determines what kinds of compromise atrib defends against
- Worked example: take one runtime (say, Claude Agent SDK in Case A) and trace which pattern its `@atrib/agent` adapter implements and why

## See also

- Spec: [§9](../../atrib-spec.md#9-harness-integration-patterns)
- Decisions: [D069 Six runtime integration patterns](../../DECISIONS.md), [D021-D024](../../DECISIONS.md) (specific framework adapter decisions)
- Concepts: [Records & signing](01-records-and-signing.md) (what atrib does once it has the call)
- Concepts: [OpenClaw and Hermes integration map](15-openclaw-hermes-integration-map.md) (worked mechanics map for two long-lived agent hosts)
- Packages: `packages/mcp`, `packages/mcp-wrap`, `packages/agent`, `packages/openinference`
