# Cloudflare approval trace

Interactive Cloudflare Agents example for atrib-signed human approval traces.

The app is a safe Cloudflare-shaped workflow:

```text
prior trigger -> autonomous triage -> human approval halt -> MCP execution resumes -> signed outcome -> audit trace
```

The simulated target is a Durable Object SQLite table that looks like a
Cloudflare Workers issue-triage queue. No real Cloudflare account state is
mutated.

## What this shows

- A prior trigger starts the agent before the browser approval gate appears.
- A real browser approval or rejection halts or resumes the workflow.
- Agent, human reviewer, and action MCP records use distinct signing keys.
- The action MCP record has an explicit `informed_by` edge to the human
  approval record.
- The outcome and handoff records make the async work auditable after the fact.
- The UI keeps atrib details visible enough to explain the value without making
  the user read raw records first.

The important atrib differentiators are:

- **Autonomous trigger context:** the audit starts at the webhook or scheduled
  follow-up that woke the agent.
- **Decision context:** the reviewer sees exactly what the agent is asking to
  publish before approving.
- **Semantic causal chain:** proposal, approval, execution, outcome, and handoff
  link to each other as signed records.
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

The proof script creates `.tmp/secrets.json` with demo-only signing keys, deploys
the Worker, drives approved, rejected, and diagnostic-error runs through the same
HTTP endpoints the UI uses, and verifies record hashes, signatures, public
inclusion proofs, causal edges, and graph-node derivation for the generated
records.

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

The dev script derives `.tmp/dev.vars` from `.tmp/secrets.json` before starting
Wrangler. The generated file stays ignored and local.

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
