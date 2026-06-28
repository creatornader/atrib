# @atrib/action-gate

`@atrib/action-gate` signs policy decisions and outcomes around high-impact
agent actions.

Use it when a host already knows where a risky action boundary is: browser
automation, computer use, support tooling, payment workflows, admin changes, or
production writes. The host owns policy, identity, approval UI, and execution.
Atrib records what the host decided and what happened next.

The core use case is a high-impact action that must outlive the session that
proposed it. One browser or computer-use run can sign the proposed action,
decision, and outcome. A later session, a different agent, or a reviewer team
can accept those hashes as verifiable context before continuing work.

## Install

Inside the monorepo, depend on the workspace package:

```json
"@atrib/action-gate": "workspace:*"
```

After the first npm release:

```bash
pnpm add @atrib/action-gate
```

## Basic use

```ts
import { runGatedAction } from '@atrib/action-gate'

const result = await runGatedAction({
  privateKey,
  contextId: '5f9a8a2b68f94a5cb7f9361b2c8d4e10',
  action: {
    run_id: 'browser-run-42',
    action_id: 'act-3',
    agent_id: 'support-agent',
    surface: 'browser',
    tool_name: 'browser.act',
    args: { instruction: 'send customer email' },
    risk: ['external_write', 'customer_message'],
  },
  evaluate: ({ action }) => ({
    outcome: action.risk?.includes('external_write') ? 'escalate' : 'allow',
    policy_id: 'browser-write-policy',
    policy_version: '2026-06-28.1',
    reason: 'browser writes that send customer messages need approval',
  }),
  execute: async () => ({ status: 'sent' }),
})

console.log(result.decision.record_hash)
console.log(result.outcome.record_hash)
```

## Contract

The package has four gate states:

| State | Runtime behavior | Proof behavior |
| --- | --- | --- |
| `allowed` | Runs the action body. | Signs a decision, then signs an outcome with `informed_by` pointing at the decision. |
| `blocked` | Does not run the action body. | Signs the closed decision and blocked outcome. |
| `escalated` | Does not run until the host approval path resolves. | Signs the escalation decision and outcome. |
| `policy_error` | Does not run the action body. | Signs that the policy evaluator failed closed. |

`verifyActionGateRun()` checks signatures, record hashes, decision-to-outcome
binding, action id consistency, and the rule that blocked, escalated, and
policy-error states did not execute.

## Boundary

This package does not issue authorization, run a browser, store raw session
data, or replace a host policy engine. It gives hosts a small control/proof
contract:

1. propose an action;
2. evaluate policy before execution;
3. run only when allowed;
4. sign the decision and outcome;
5. pass the accepted record hashes to a later session, another agent, a reviewer
   team, or a proof packet.

Browserbase, Stagehand, browser-use, Playwright, OpenAI Computer Use, hosted
desktop runtimes, and support tools can keep their own automation layer while
using this package for the gate.
