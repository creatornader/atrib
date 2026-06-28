# Browserbase Stagehand Proof

This example wraps a Browserbase MCP shaped stdio server with `@atrib/mcp-wrap`.
It signs the six-tool flow `start -> navigate -> observe -> act -> extract -> end`.

The default run uses `browserbase-fixture-mcp.ts`, not Browserbase cloud. The
fixture returns Browserbase-shaped private material: session id, replay URL,
page snapshot, selector, form value, and extracted page text. The public records
keep only tool names, `args_hash`, `result_hash`, record hashes, and local log
indexes.

Run the local fixture proof:

```bash
pnpm --filter @atrib/integration browserbase-stagehand-packet
```

Write the proof artifacts:

```bash
ATRIB_PACKET_WRITE_ARTIFACTS=1 pnpm --filter @atrib/integration browserbase-stagehand-packet
```

The checked artifact lands in `proof-packets/browserbase-stagehand/`. Live mode
can use either the hosted Browserbase Streamable HTTP MCP endpoint or the
self-hosted `npx @browserbasehq/mcp` STDIO server. Hosted mode needs only
`BROWSERBASE_API_KEY` and is the preferred path for fresh demos because
Browserbase owns the model runtime. The runner captures wrapper records locally
while the flow is running. After the full flow verifies, it submits the accepted
record set to `https://log.atrib.dev/v1/entries`, verifies inclusion, and writes
those public log indexes into the artifact.

Enable the Action Gate wrapper when the packet should prove pre-action control:

```bash
ATRIB_BROWSERBASE_ACTION_GATE=1 pnpm --filter @atrib/integration browserbase-stagehand-packet
```

With the gate on, `@atrib/action-gate` evaluates the `act` step before the
Browserbase MCP call runs. Browserbase and Stagehand still own browser
automation. Atrib signs separate decision and outcome extension records and
adds their hashes to the packet.

That is the product boundary the demo is meant to show. Browserbase makes the
browser action happen. Atrib makes the action trail portable across sessions,
agents, and teams: the next session can recall it, another agent can verify it
before continuing, and a reviewer can inspect the same decision and outcome
hashes without needing raw selectors or replay URLs in public records.

## Proof and demo boundary

This example has three runnable modes:

- Fixture proof: deterministic local MCP server, local capture log, no public
  log writes. This is the CI-safe integration example.
- Live public proof: real Browserbase MCP server, public log inclusion, and
  regenerated artifact output. The current public packet uses hosted Browserbase
  MCP through `@atrib/mcp-wrap`'s HTTP upstream support.
- Live demo: local or hosted proof console that starts fresh runs through the
  same packet runner and returns receipt rows with explorer and log-proof links.
  The demo enables Action Gate by default; set `ATRIB_BROWSERBASE_ACTION_GATE=0`
  only for a browser-receipts-only run.

The live demo is implemented in [`live-demo/`](live-demo/). Deployment is a
human gate. Do not publish a hosted URL until demo-only credentials and rate
limits are in place. The Fly config in `live-demo/fly.toml` enforces hosted
Browserbase mode, public-log publication, demo-only credential scope, and
bounded run limits before it accepts reviewer-triggered runs.

Current hosted demo: <https://atrib-browserbase-stagehand-demo.fly.dev/>.

Run the live public proof:

```bash
ATRIB_BROWSERBASE_STAGEHAND_LIVE=1 \
ATRIB_BROWSERBASE_UPSTREAM=hosted \
ATRIB_PACKET_PUBLIC_LOG=1 \
BROWSERBASE_API_KEY=... \
ATRIB_PACKET_WRITE_ARTIFACTS=1 \
  pnpm --filter @atrib/integration browserbase-stagehand-packet
```

For self-hosted STDIO, omit `ATRIB_BROWSERBASE_UPSTREAM=hosted` and set
`BROWSERBASE_PROJECT_ID` plus `GEMINI_API_KEY`. Self-hosted Browserbase MCP
defaults to `google/gemini-2.5-flash-lite` for Stagehand. If that model is
quota-bound, set `ATRIB_BROWSERBASE_MODEL_NAME` to a different
Stagehand-supported Gemini model. The runner still reads the model key from
`GEMINI_API_KEY`; it does not pass provider keys as command-line args.

Run the local proof console in fixture mode:

```bash
pnpm --filter @atrib/integration browserbase-stagehand-live-demo
```

Run the proof console against Browserbase:

```bash
ATRIB_BROWSERBASE_DEMO_MODE=live \
ATRIB_BROWSERBASE_UPSTREAM=hosted \
ATRIB_BROWSERBASE_DEMO_PUBLIC_LOG=1 \
ATRIB_BROWSERBASE_ACTION_GATE=1 \
BROWSERBASE_API_KEY=... \
  pnpm --filter @atrib/integration browserbase-stagehand-live-demo
```

Credentials should come from the operator's cache-first `.zshenv` path. The demo
server reads environment variables only; it does not call 1Password directly.
