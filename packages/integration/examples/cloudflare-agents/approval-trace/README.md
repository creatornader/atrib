# Cloudflare Code Mode approval trace

Interactive Cloudflare Agents example for atrib-signed Code Mode approval and
execution receipts.
The example is a native `@cloudflare/codemode` approval bridge wrapped in an
atrib-signed receipt envelope. It keeps Cloudflare's runtime in charge of the
pause and resume path, then signs the state a later reviewer needs to check:
the pending action, exact payload, human decision, resumed execution, result,
and handoff.

The app is a safe Cloudflare-shaped workflow:

```text
prior trigger -> autonomous triage -> Code Mode approval halt -> human decision -> approved execution or rejection -> signed receipt head
```

The simulated target is a Durable Object SQLite table that looks like a
Cloudflare Workers checkout incident workspace. No real Cloudflare account state
is mutated.

Code Mode is the problem context for the example: generated code can compress
many writes or API actions behind one execution boundary. This demo keeps the
boundary explicit. The agent proposes an exact payload first. The generated code
reaches a `requiresApproval` repository write through `CodemodeRuntime`. The
runtime pauses before it mutates storage. The human signs approve, reject, or
request changes. On approval, the runtime continues the paused run and executes
the approved write. The proposal, decision, Code Mode preview or execution,
outcome, and handoff are signed as separate records.

This uses the lower-level runtime surface exported by
`@cloudflare/codemode@0.4.1`: `CodemodeRuntime`, `createCodemodeRuntime`,
`pending()`, `approve()`, `reject()`, and `rollback()`. Cloudflare's public
`createCodeTool` guide still says AI SDK tools with `needsApproval` are excluded
from the simple Codemode tool path. This example is therefore a runtime-boundary
proof, not a claim that approval-gated `createCodeTool` usage is the documented
happy path.

Cloudflare's current Code Mode runtime owns durable approvals, execution
history, and rollback. This example does not replace that runtime. It adds a
portable signed receipt envelope around the same boundary: pending action,
exact payload, human decision, runtime approval or rejection, result, and audit
handoff.

The receipt state is deliberately machine-readable. Proposal, approval,
execution, runtime rejection, outcome, and handoff records carry the same
approval policy id and Code Mode continuation id. Before the Worker resumes a
paused run, it verifies the proposal and human decision records. Before it
hands the run off, it verifies proposal, approval, execution, and outcome
records again and signs a `codemode_decision_receipt_head`. The repository
write also has an exact-once fence keyed by the signed decision record, so a
replayed approval cannot apply the same write twice.

The Worker also exposes `GET /api/runs/:runId/recovery-gate`. That endpoint
rebuilds a compact receipt head from persisted Durable Object SQLite rows,
verifies the signed records up to the current head, and reports the next allowed
step. This is a deterministic restart-shaped fixture. It proves the gate can be
reconstructed from persisted state, but it does not force Cloudflare to evict or
restart the Durable Object. The boundary follows Cloudflare's Durable Object
guidance: persist state incrementally, then recover from storage when the object
starts again.

## What this shows

- A prior trigger starts the agent before the browser approval gate appears.
- Code Mode reaches the `requiresApproval` repository write before any human
  decision.
- A real browser approval or rejection resumes or closes the Code Mode workflow.
- The approval is bound to the proposed payload, not to a vague "continue"
  action.
- The approval is also bound to the Code Mode pending action through a signed
  continuation id (`executionId:seq`).
- Agent, human reviewer, and Code Mode runtime records use distinct signing keys.
- The Code Mode execution record has explicit `informed_by` edges to the
  proposal and human approval records.
- The outcome and handoff records make the async work auditable after the run
  finishes.
- The handoff record carries a receipt head that names the proposal, decision,
  execution, outcome, policy, continuation, and verification result.
- The recovery-gate endpoint reconstructs the current approval or handoff gate
  from persisted signed records instead of in-memory state.
- The UI keeps atrib details visible enough to explain the value without making
  the user read raw records first.

The important atrib differentiators are:

- **Autonomous trigger context:** the audit starts at the Workers Observability
  alert, Browser Run evidence, and incident workspace that woke the agent.
- **Decision context:** the human sees exactly what the agent is asking to write
  before approving.
- **Signed decision chain:** proposal, approval or rejection, Code Mode
  execution or rejection, outcome, and handoff link to each other as signed
  records.
- **Receipt state for the next step:** a later runtime or debug view can verify
  which proposal, human decision, pending action, and result belong together.
- **Trustless audit:** a later audit can verify the trace outside the Worker,
  Durable Object database, or transcript.
- **Signer separation:** autonomous agent action, human decision, and execution
  surface are distinct identities.

## Live proof

The current hosted Worker is `https://atrib-cloudflare.nagala.workers.dev/`.

Latest verified proof: run `pnpm --filter @atrib/cloudflare-approval-trace
proof:worker` from the repo root. The proof deploys the Worker, drives approved,
rejected, request-changes, revised-approve, revised-reject, and diagnostic-error
paths, then checks signatures, public inclusion proofs, causal graph edges,
receipt-state continuity, recovery-gate reconstruction, and exact-once decision
fencing. Each run writes an ignored JSON artifact under `runs/` for local review.

Open the hosted Worker, start a run, then approve, reject, or request changes.
When a run finishes, the UI exposes receipt details, trace JSON, and public log
context links. It uses demo-only signing keys and a simulated checkout incident.
It does not mutate a real Cloudflare account or create real Artifacts resources.

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
request-changes, revised-approve, revised-reject, and diagnostic-error runs
through the same HTTP endpoints the UI uses, and verifies record hashes,
signatures, public inclusion proofs, causal edges, graph-node derivation,
receipt-state continuity, recovery-gate reconstruction, and exact-once decision
fencing for the generated records. Set `ATRIB_APPROVAL_TRACE_SECRETS_PATH` to
point at another local secrets file.

The demo does not publish to the graph or directory services. It keeps the
runtime proof small: records are signed, submitted to the public log, persisted
in the demo's trace store, and then checked with the same graph derivation
function graph-node serves. Directory publication is the next layer when the demo
needs public capability envelopes for the agent, human approver, or Code Mode
runtime signers.

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
Cloudflare checkout incident plan and records `planner: fixture`.
