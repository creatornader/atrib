# Cloudflare Code Mode approval trace

Interactive Cloudflare Agents example for atrib-signed Code Mode approval
traces.
The example is a native `@cloudflare/codemode` approval bridge wrapped in an
atrib-signed receipt envelope.

The app is a safe Cloudflare-shaped workflow:

```text
prior trigger -> autonomous triage -> Code Mode approval halt -> human decision -> runtime replay or rejection -> signed audit trace
```

The simulated target is a Durable Object SQLite table that looks like a
Cloudflare Workers issue-triage queue. No real Cloudflare account state is
mutated.

Code Mode is the problem context for the example: generated code can compress
many side effects behind one execution boundary. This demo keeps the boundary
explicit. The agent proposes an exact payload first. The generated code reaches a
`requiresApproval` write through `CodemodeRuntime`. The runtime pauses before the
side effect. The human signs approve, reject, or request changes. Approved
execution resumes through runtime replay. The proposal, decision, Code Mode
preview or execution, outcome, and handoff are signed as separate records.

Cloudflare's current Code Mode runtime owns the durable approval and replay
surface. This example does not replace that runtime. It adds a portable signed
receipt envelope around the same boundary: pending action, exact payload,
human decision, runtime approval or rejection, result, and audit handoff.

## What this shows

- A prior trigger starts the agent before the browser approval gate appears.
- Code Mode reaches the `requiresApproval` side effect before any human decision.
- A real browser approval or rejection resumes or closes the Code Mode workflow.
- The approval is bound to the proposed payload, not to a vague "continue"
  action.
- Agent, human reviewer, and Code Mode runtime records use distinct signing keys.
- The Code Mode execution record has explicit `informed_by` edges to the
  proposal and human approval records.
- The outcome and handoff records make the async work auditable after the fact.
- The UI keeps atrib details visible enough to explain the value without making
  the user read raw records first.

The important atrib differentiators are:

- **Autonomous trigger context:** the audit starts at the webhook or scheduled
  follow-up that woke the agent.
- **Decision context:** the reviewer sees exactly what the agent is asking to
  publish before approving.
- **Signed decision chain:** proposal, approval or rejection, Code Mode
  execution or rejection, outcome, and handoff link to each other as signed
  records.
- **Trustless audit:** a later reviewer can verify the trace outside the Worker,
  Durable Object database, or transcript.
- **Signer separation:** autonomous agent action, human decision, and execution
  surface are distinct identities.

## Run locally

```sh
pnpm install
pnpm --filter @atrib/cloudflare-approval-trace test
pnpm --filter @atrib/cloudflare-approval-trace test:browser
pnpm --filter @atrib/cloudflare-approval-trace proof:worker
```

The local test command uses Cloudflare's Workers Vitest pool with
`wrangler.test.jsonc`, deterministic fixture keys, isolated Durable Object
storage, and no public log writes. It drives the Worker API, checks signed
records, inspects Durable Object state directly, and verifies the observability
events exposed by the trace packet.

The browser test command starts local Wrangler with the same fixture config,
clicks the approval, rejection, and diagnostic-error paths in Chromium, and
asserts that the signed timeline records open the receipt/proof panel. It does
not submit records to the public log.

The proof script uses stable demo-only signing keys from
`~/.atrib/secrets/cloudflare-approval-trace.json`, syncs them into
`.tmp/secrets.json` for Wrangler, deploys the Worker, drives approved, rejected,
and diagnostic-error runs through the same HTTP endpoints the UI uses, and
verifies record hashes, signatures, public inclusion proofs, causal edges, and
graph-node derivation for the generated records. Set
`ATRIB_APPROVAL_TRACE_SECRETS_PATH` to point at another local secrets file.

The demo does not publish to the graph or directory services. It keeps the
runtime proof small: records are signed, submitted to the public log, persisted
in the demo's trace store, and then checked with the same graph derivation
function graph-node serves. Directory publication is the next layer when the demo
needs public capability envelopes for the agent, human approver, or action MCP
signers.

For local development:

```sh
pnpm --filter @atrib/cloudflare-approval-trace dev
```

The dev script prepares the stable demo signing keys, derives `.tmp/dev.vars`
from `.tmp/secrets.json`, and then starts Wrangler. The generated files stay
ignored and local.

## Optional model planner

By default the example uses a deterministic planner so anyone can run it. To use
an OpenAI-compatible planner, set these vars before deploying:

```sh
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-5.1
wrangler secret put OPENAI_API_KEY
```

The model must return JSON. If it fails, the app falls back to the deterministic
Cloudflare issue-triage plan and records `planner: fixture`.
