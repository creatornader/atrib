# Brief dcbench evidence proof

This example targets Brief's public `brief-hq/dcbench` benchmark shape. It signs
three hash-only atrib records around one decision-compliance path:

1. read product-decision context for a dcbench task;
2. record the follow-up coding-agent action that cites that context;
3. record the decision-compliance score tied to the action.

Local sidecars keep the task prompt and rubric material. Public records expose
only `tool_name`, hashes, signatures, chain roots, and `informed_by`.

## Run it

```bash
pnpm --filter @atrib/integration brief-dcbench-evidence-smoke
```

To read task metadata from a local checkout of the public benchmark repo:

```bash
git clone https://github.com/brief-hq/dcbench.git /tmp/dcbench
DCBENCH_REPO=/tmp/dcbench \
  pnpm --filter @atrib/integration brief-dcbench-evidence-smoke
```

## What it proves

- A dcbench decision-compliance run can carry signed evidence for context
  lookup, agent action, and score.
- The action record cites the context lookup through `informed_by`.
- The score record cites the action through `informed_by`.
- Public atrib records stay hash-only.
- Local sidecars keep the prompt and rubric material needed to audit the score.
- The smoke can read `BENCHMARK_TASKS` from a local `brief-hq/dcbench` checkout
  when `DCBENCH_REPO` is set.

## What it does not prove yet

This proof does not call Brief CLI, Brief MCP, or a Brief workspace. It does not
run Claude Code or Brief over every dcbench task. It is the evidence-extension
shape that can sit around a real dcbench run once the operator has a Brief
workspace or approves a benchmark-only route.
