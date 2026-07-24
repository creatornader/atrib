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

`verifyActionGateRun()` checks signatures, record hashes, canonical entry IDs,
event types, tool names, argument and result commitments, host identity,
context continuity, decision-to-outcome binding, action id consistency, and the
rule that blocked, escalated, and policy-error states did not execute.

`runGatedAction()` returns both signed records and local sidecars. If `onRecord`
throws while delivering a signed record to a mirror, log sink, or proof-packet
writer, the action result still returns a complete decision/outcome pair and
adds the callback failure to `record_delivery_errors`.

## Protected MCP execution

`createProtectedMcpExecutor()` puts permit enforcement at the MCP execution
boundary. It signs the policy decision first, issues a short-lived opaque
permit only for an allowed action, and atomically consumes that permit before
calling the upstream handler.

```ts
import { createProtectedMcpExecutor } from '@atrib/action-gate'

const executor = createProtectedMcpExecutor({
  privateKey,
  contextId,
  revokedKeys: () => loadCurrentRevokedKeys(),
  evaluate: ({ action }) => policy.evaluate(action),
  executeUpstream: ({ name, arguments: args }) => internalMcp.callTool(name, args),
})

const result = await executor.authorizeAndExecute({
  action: {
    run_id: 'refund-run-1042',
    action_id: 'refund-order',
    agent_id: 'support-agent',
    risk: ['external_write'],
    credential: {
      run_key: runCertificate.run_pubkey,
      principal_key: runCertificate.principal_key,
    },
  },
  request: {
    name: 'refund.order',
    arguments: { orderId: '1042', amount: '284.00' },
  },
})
```

The permit binds the run, action, agent, MCP surface, tool name, and canonical
argument digest. When `revokedKeys` is configured, the binding also carries the
declared run and principal credential. A missing credential, a revoked run or
principal, or a failed revocation-view read fails closed before policy
evaluation. The executor checks the view again at dispatch, closing a
policy-to-use rotation race before the upstream side effect. Missing, unknown,
mismatched, expired, and replayed permits also fail before that side effect. A
mismatched probe does not consume the valid permit.

The raw upstream handler must not remain separately reachable. Mount the
returned protected boundary at any raw-shaped internal route. If a public route
still reaches the original upstream server, that route remains a bypass outside
the adapter's control. Distributed hosts must replace the in-memory permit
store with a shared atomic `ProtectedMcpPermitStore`.

The allowed path emits the normal signed decision and outcome pair. A rejected
direct dispatch emits a separate blocked decision and outcome pair with
`direct_bypass` risk and the authorization failure reason. If evidence signing
fails, dispatch still rejects the action and returns `evidence_error`; proof
failure never opens the executor.

`revokedKeys` can be a current set or an async loader. Production hosts should
use a loader backed by their accepted log or profile view so a revocation takes
effect without restarting the executor. The adapter verifies enforcement over
the supplied view. It does not fetch the public log by itself.

## Split-phase and hash-only hosts

Some hosts decide first and receive an execution report later. They can build
and sign the decision and outcome separately:

```ts
import {
  buildActionGateDecisionEntry,
  buildActionGateOutcomeEntry,
  hashCanonical,
  signActionGateDecision,
  signActionGateOutcome,
  type ActionGateActionEnvelope,
} from '@atrib/action-gate'

const action = {
  run_id: 'refund-run-1042',
  action_id: 'refund-order',
  agent_id: 'support-agent',
  surface: 'support',
  tool_name: 'refund.order',
  args_digest: hashCanonical({
    orderId: '1042',
    amount: '284.00',
    currency: 'USD',
  }),
} satisfies ActionGateActionEnvelope

const decisionEntry = buildActionGateDecisionEntry({
  action,
  policy,
  timestamp: new Date().toISOString(),
})
const decision = await signActionGateDecision({
  entry: decisionEntry,
  action,
  privateKey,
  contextId,
  timestampMs: Date.now(),
})

const outcomeEntry = buildActionGateOutcomeEntry({
  status: 'executed',
  run_id: action.run_id,
  action_id: action.action_id,
  decision_id: decision.entry.decision_id,
  decision_record_hash: decision.record_hash,
  executed: true,
  result_digest: hashCanonical({
    executionState: 'executed',
    resultHash: hashCanonical({ status: 'accepted' }),
    outcomeHash: hashCanonical({ refundId: 're_1042' }),
  }),
  timestamp: new Date().toISOString(),
})
const outcome = await signActionGateOutcome({
  entry: outcomeEntry,
  action,
  privateKey,
  contextId,
  decisionRecordHash: decision.record_hash,
  chainTailHex: decision.record_hash.slice('sha256:'.length),
  timestampMs: Date.now(),
})
```

Use `args_digest` or `result_digest` when the signing process has the canonical
SHA-256 commitment but must not receive the raw payload. Each value must use the
`sha256:<64 lowercase hex>` form.

An allowed action that never ran can use `status: 'not_executed'` with
`executed: false`. This records the difference between policy permission and
runtime execution without treating the runtime decision as an error.

## Trusted-transaction policy

`requireTrustedTransaction()` is a ready-made `evaluate` policy for transaction
actions. It is where [§1.7.6](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#176-cross-attestation-requirement-for-transaction-records)
trusted signer composition ([D149](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d149-cross-attestation-composes-with-a-trust-set-for-sybil-resistance))
becomes a requirement rather than a signal: `verifyRecord` only surfaces the trust posture,
so a consumer reading `signers_valid >= 2` can still be Sybil-fooled by two
untrusted co-signers. This policy returns `allow` only when the transaction
record is trusted-cross-attested (`isTrustedCrossAttested`: at least two distinct
verified signer keys drawn from the supplied `trustedCreatorKeys`). Every other
case fails closed: no trust set, a non-transaction record, an invalid signature,
or a merely-verified (untrusted or Sybil) signer set all return `block` by
default, or `escalate` when `onUntrusted: 'escalate'`. The signed decision's
`evidence` carries `signers_valid`, `signers_trusted`, `sybil_suspected`, and
`trust_evaluated`, so the proof records why authority was granted or withheld.

```ts
import { runGatedAction, requireTrustedTransaction } from '@atrib/action-gate'

const result = await runGatedAction({
  action: {/* ...transaction action envelope... */},
  evaluate: () => requireTrustedTransaction({ record, trustedCreatorKeys }),
  execute: () => settlePayment(),
})
```

## Corroboration policy

`requireCorroborated()` is the same fail-closed shape applied to any record, not
only transactions. It is where [§8.7.6](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#876-attestation-corroboration-extension)
attestation corroboration ([D150](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d150-attestation-is-corroboration-generalized-off-transactions-extension-first))
becomes a requirement rather than a signal. It resolves the distinct verified
attestors of a target record through `@atrib/verify` `resolveAttestationCorroboration`,
reuses the [D149](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d149-cross-attestation-composes-with-a-trust-set-for-sybil-resistance)
trust-set model, and returns `allow` only when the target is corroborated
(`isCorroborated`: at least two distinct verified attestors drawn from the
supplied `trustedCreatorKeys`, default threshold two). Every other case fails
closed: no trust set, verified-but-untrusted attestors, self-attestation,
annotation records masquerading as attestations, or a tampered commitment all
return `block` by default, or `escalate` when `onUncorroborated: 'escalate'`. The
signed decision's `evidence` carries `attestors_valid`, `attestors_trusted`, and
`trust_evaluated`, so the proof records why the target was trusted or withheld.

```ts
import { runGatedAction, requireCorroborated } from '@atrib/action-gate'

const result = await runGatedAction({
  action: {/* ...action that depends on a corroborated target... */},
  evaluate: () =>
    requireCorroborated({ targetRecordHash, targetCreatorKey, attestations, trustedCreatorKeys }),
  execute: () => actOnCorroboratedTarget(),
})
```

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
