# @atrib/action-gate

`@atrib/action-gate` signs policy decisions and outcomes for actions a host
needs to check before execution.

Use it when a host already knows where an action boundary is: browser
automation, computer use, support tooling, payment workflows, admin changes, or
production writes. The host owns policy, identity, approval UI, and execution.
atrib records what the host decided and what happened next.

Use the signed hashes when follow-up work needs a stable reference to the same
action. A browser click, desktop action, support reply, admin change, or
payment-impacting step can move through recall, handoff, review, or verifier
workflows without exposing raw runtime payloads in public records.

## Install

```bash
pnpm add @atrib/action-gate
```

## Basic use

```ts
import { runGatedAction } from '@atrib/action-gate'

const result = await runGatedAction({
  privateKey, // base64url Ed25519 32-byte seed, from ATRIB_PRIVATE_KEY, @atrib/cli, or the OS keychain
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
console.log(result.verification.valid)
```

## Contract

The package has four gate states:

| State          | Runtime behavior                                    | Proof behavior                                                                       |
| -------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `allowed`      | Runs the action body.                               | Signs a decision, then signs an outcome with `informed_by` pointing at the decision. |
| `blocked`      | Does not run the action body.                       | Signs the closed decision and blocked outcome.                                       |
| `escalated`    | Does not run until the host approval path resolves. | Signs the escalation decision and outcome.                                           |
| `policy_error` | Does not run the action body.                       | Signs that the policy evaluator failed closed.                                       |

`verifyActionGateRun()` checks signatures, record hashes, decision-to-outcome
binding, action id consistency, and the rule that blocked, escalated, and
policy-error states did not execute.

`runGatedAction()` returns both signed records and local sidecars. If `onRecord`
throws while delivering a signed record to a mirror, log sink, or proof-packet
writer, the action result still returns a complete decision/outcome pair and
adds the callback failure to `record_delivery_errors`.

## Privacy and degradation

Signed records carry canonical hashes of the action arguments and outcome
material. Raw action arguments and results stay in local sidecars returned to
the host. The package does not submit records to the public log by itself.
Hosts choose whether `onRecord` writes a local mirror, submits to a log, writes
a proof packet, or does nothing.

Policy failures fail closed. If the policy evaluator throws, the package signs a
`policy_error` decision and a `policy_error` outcome, and the action body does
not run. If an allowed action body throws, the package signs an
`execution_error` outcome tied to the decision record.

## Boundary

This package does not issue authorization, run a browser, store raw session
data, or replace a host policy engine. It gives hosts a small action-gate
contract:

1. propose an action;
2. evaluate policy before execution;
3. run only when allowed;
4. sign the decision and outcome;
5. pass the accepted record hashes into recall, handoff, review, verifier, or
   proof-packet workflows.

Browserbase, Stagehand, browser-use, Playwright, OpenAI Computer Use, hosted
desktop runtimes, and support tools can keep their own automation layer while
using this package for the gate.

## Local verification

```bash
npx -y pnpm@9.15.4 --filter @atrib/action-gate typecheck
npx -y pnpm@9.15.4 --filter @atrib/action-gate test
npx -y pnpm@9.15.4 --filter @atrib/action-gate build
npx -y pnpm@9.15.4 --filter @atrib/integration action-control-gate-smoke
```

## Part of atrib

atrib is an open protocol for verifiable agent actions. Every action becomes a signed, chain-linked record that anyone can verify against a public Merkle log, with no operator to trust. This package is one entrypoint. See the [full package family](https://github.com/creatornader/atrib#packages) and the [protocol spec](https://github.com/creatornader/atrib/blob/main/atrib-spec.md).
