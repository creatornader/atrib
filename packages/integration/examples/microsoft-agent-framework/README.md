# Microsoft Agent Framework workflow receipt example

This example imports `agent-framework-core==1.7.0`, runs a real Python
`WorkflowBuilder` graph with two `Executor` nodes, then signs hash-only atrib
records for each emitted `WorkflowEvent`.

It uses `agent-framework-core` rather than the full `agent-framework`
meta-package because the full package currently pulls every optional integration
extra. In this environment that resolution path fails on pre-release Azure
Search dependencies. The smaller core package gives the workflow API without
turning a local workflow proof into an Azure integration install test.

## Run It

```bash
pnpm --filter @atrib/integration microsoft-agent-framework-workflow-smoke
```

The smoke runs Python through `uv` with:

```bash
uv run --quiet --with agent-framework-core==1.7.0 \
  python microsoft-agent-framework-proof.py
```

To include the smoke in the integration test runner, opt in explicitly:

```bash
ATRIB_RUN_MICROSOFT_AGENT_FRAMEWORK_SMOKE=1 pnpm --filter @atrib/integration test \
  test/microsoft-agent-framework.test.ts
```

## What It Proves

- The proof imports the published `agent-framework-core` Python package.
- `WorkflowBuilder` builds a directed graph from `ProposalExecutor` to
  `ApprovalExecutor`.
- `workflow.run(...)` emits the actual Microsoft Agent Framework
  `WorkflowEvent` sequence.
- Each workflow event becomes one signed atrib `tool_call` record with
  `tool_name`, `args_hash`, and `result_hash`.
- Records chain in one `context_id` and each non-genesis record also names the
  prior record in `informed_by`.
- Public records stay hash-only. The private workflow note stays in local
  sidecars.

## What It Does Not Prove Yet

This is a local Python workflow proof, not Azure AI Foundry Agent Service, a
hosted Microsoft control plane, a C# workflow, Durable Task hosting, model
provider execution, an MCP server, memory persistence, or production
deployment. Those remain separate build gates before any managed-cloud outreach
claim.
