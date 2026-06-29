# Browserbase Stagehand live demo

This is the resettable demo layer for the Browserbase proof packet. It serves an
agent-ready target webapp at `/target` and a proof console at `/`. The target
page exposes first-party WebMCP tools for a fixed approval workflow. The console
starts the Browserbase Stagehand packet runner when a reviewer presses
**Run proof**.

The demo does not implement a second signing path. It calls the same Browserbase
Stagehand packet function used by `browserbase-stagehand-packet`, so the demo,
fixture proof, and public proof use the same `@atrib/mcp-wrap` runner. The
signed boundary is still the Browserbase MCP sequence and the atrib action gate
around `act`. The WebMCP target page is the thing Browserbase controls.

The target page registers tools through `document.modelContext` when the browser
exposes the native WebMCP API. It also publishes the same tool manifest in page
JSON for fallback inspection. That keeps the demo honest: atrib signs
Browserbase MCP records today, and the page is ready for Stagehand WebMCP tool
invocation as that API becomes available in the runtime path.

## Visual model

The console is a Browserbase observability surface first and an atrib evidence
surface second. A reviewer should see a remote browser session or replay, then
the signed atrib record that explains each critical step. The evidence rail is
not the demo's main object.

Live mode watches private Browserbase tool output during the run. If the MCP
result exposes a Browserbase session id, Live View URL, session URL, or replay
URL, the server turns that material into UI-only media state:

- raw session ids stay in private server memory
- session ids appear in API responses only as hashes
- replay playback uses a server proxy route so `BROWSERBASE_API_KEY` stays
  server-side
- raw Live View or direct replay URLs are rendered only as UI links, never as
  public atrib records

Fixture mode uses deterministic click playback because no Browserbase cloud
session exists in that mode. The playback cursor still follows `start ->
navigate -> observe -> policy_decision -> act -> policy_outcome -> extract ->
end`, and clicks the approval button only after an allow decision. Block and
escalate modes stop before `act`, show the blocked click target, and still sign
the policy outcome.

An operator can also supply static inspection refs for a demo run:

```bash
ATRIB_BROWSERBASE_DEMO_LIVE_VIEW_URL=https://... \
ATRIB_BROWSERBASE_DEMO_REPLAY_URL=https://... \
  pnpm --filter @atrib/integration browserbase-stagehand-live-demo
```

Those URLs are UI-only reviewer aids. They are not written into public atrib
records, verifier output, or proof-packet artifacts. The signed proof keeps
tool names, hashes, log indexes, and verifier status public while Browserbase
session ids, replay URLs, page pixels, selectors, and raw extraction payloads
stay private.

The demo enables `@atrib/action-gate` by default. Browserbase and Stagehand own
browser automation. Action Gate evaluates the `act` step before execution and
adds decision and outcome hashes to the run result. Set
`ATRIB_BROWSERBASE_ACTION_GATE=0` only when testing browser receipts without the
control layer.

Read the demo as a cross-session and cross-team proof, not only as a browser
replay. Browserbase shows the browser run. Atrib shows the decision and outcome
hashes that a later session, another agent, or a reviewer team can verify before
continuing from that action.

## Run locally

Fixture mode is the default. It creates local receipts only and needs no
Browserbase credentials.

```bash
pnpm --filter @atrib/integration browserbase-stagehand-live-demo
```

Open `http://127.0.0.1:8788/`, then press **Run proof**.
Open `http://127.0.0.1:8788/target` to inspect the agent-ready target page
directly.

The server binds to `127.0.0.1` by default so local smoke tests fail clearly
when a port is already in use. If that port is busy, set `PORT` or let the OS
choose one:

```bash
PORT=18788 pnpm --filter @atrib/integration browserbase-stagehand-live-demo
PORT=0 pnpm --filter @atrib/integration browserbase-stagehand-live-demo
```

Set `HOST=0.0.0.0` only for a deliberate hosted deployment.

## Live Browserbase mode

Live mode expects credentials to already be present in the shell environment.
Use the operator's cache-first `.zshenv` pattern for 1Password-backed secrets;
do not call `op read` inside this demo server.

```bash
ATRIB_BROWSERBASE_DEMO_MODE=live \
ATRIB_BROWSERBASE_UPSTREAM=hosted \
ATRIB_BROWSERBASE_DEMO_PUBLIC_LOG=1 \
ATRIB_BROWSERBASE_ACTION_GATE=1 \
ATRIB_BROWSERBASE_DEMO_PUBLIC_BASE_URL=https://atrib-browserbase-stagehand-demo.fly.dev \
BROWSERBASE_API_KEY=... \
  pnpm --filter @atrib/integration browserbase-stagehand-live-demo
```

Hosted mode wraps `https://mcp.browserbase.com/mcp` through `@atrib/mcp-wrap`'s
HTTP upstream support. For self-hosted STDIO, omit
`ATRIB_BROWSERBASE_UPSTREAM=hosted` and set `BROWSERBASE_PROJECT_ID` plus
`GEMINI_API_KEY`.

Live mode runs this fixed flow:

```text
start -> navigate -> observe -> act -> extract -> end
```

The default target URL is `${ATRIB_BROWSERBASE_DEMO_PUBLIC_BASE_URL}/target`
when `ATRIB_BROWSERBASE_DEMO_URL` is not set. Use `ATRIB_BROWSERBASE_DEMO_URL`
only when the target page is hosted somewhere else.

Public output:

- step name
- record hash
- public log index
- verifier status
- explorer link
- log proof link
- Action Gate decision and outcome hashes

Private or redacted:

- Browserbase API key
- Browserbase project id
- session URL
- replay URL
- page snapshot
- selectors
- form values
- raw extraction payload

Self-hosted Browserbase MCP defaults to `google/gemini-2.5-flash-lite` for
Stagehand. If that model is quota-bound, set `ATRIB_BROWSERBASE_MODEL_NAME` to a
different Stagehand-supported Gemini model before starting the demo. The demo
keeps provider keys in environment variables and does not pass them as
command-line args.

Hosted Browserbase MCP can still return temporary model-capacity errors. The
packet runner retries transient upstream tool errors up to three times by
default. Set `ATRIB_BROWSERBASE_LIVE_MAX_ATTEMPTS` to a value from `1` to `5`
to change that bound. The runner also calls `end` best-effort after a failed
live run once `start` has completed. Public log publication starts only after
the runner has verified the full six-step flow, so failed Browserbase runs
should not create partial public proof rows.

## API

- `GET /health`: service liveness.
- `GET /target`: agent-ready target webapp with WebMCP tool registration.
- `GET /api/config`: mode, redaction boundary, and fixed flow.
- `GET /api/runs`: recent in-memory runs.
- `POST /api/runs`: queues one fresh proof run and returns `202` with a run id.
- `GET /api/runs/:runId`: returns one run.
- `GET /api/runs/:runId/browserbase/replays`: server-side Browserbase replay
  metadata proxy when a private session id exists.
- `GET /api/runs/:runId/browserbase/replays/:pageId`: server-side HLS playlist
  proxy for one replay page.

The server allows one active run at a time and keeps only recent run summaries in
memory. Clients poll `GET /api/runs/:runId` until the run is accepted or failed.
It does not persist raw Browserbase material.

The returned run summary includes `visual`, a UI schema that describes media
availability, playback steps, cursor positions, and the privacy boundary. Treat
it as presentation state, not as a protocol record.

## Deploy boundary

The code is ready for a hosted Node runtime, but deployment remains a human
gate. A deployed instance refuses `POST /api/runs` unless these conditions are
true:

- `ATRIB_BROWSERBASE_DEMO_MODE=live`
- `ATRIB_BROWSERBASE_UPSTREAM=hosted`
- `ATRIB_BROWSERBASE_DEMO_PUBLIC_LOG=1`
- `ATRIB_BROWSERBASE_ACTION_GATE` is not `0`
- `ATRIB_BROWSERBASE_DEMO_DEPLOYED=1`
- `ATRIB_BROWSERBASE_DEMO_CREDENTIAL_SCOPE=demo-only`
- `ATRIB_BROWSERBASE_DEMO_URL` or `ATRIB_BROWSERBASE_DEMO_PUBLIC_BASE_URL` is
  set.
- `BROWSERBASE_API_KEY` is present.
- Rate limiting is enabled with positive limits.

The committed Fly config sets the nonsecret deployment policy. The Browserbase
API key must be set as a Fly secret:

```bash
flyctl apps create atrib-browserbase-stagehand-demo
flyctl secrets set -a atrib-browserbase-stagehand-demo BROWSERBASE_API_KEY=...
flyctl deploy -c packages/integration/examples/browserbase-stagehand/live-demo/fly.toml --remote-only --ha=false
flyctl scale count 1 -a atrib-browserbase-stagehand-demo
```

Default rate limits are two runs per hour and eight runs per day for each client
key. Override them with:

```bash
ATRIB_BROWSERBASE_DEMO_RATE_LIMIT=1
ATRIB_BROWSERBASE_DEMO_RATE_LIMIT_WINDOW_MS=3600000
ATRIB_BROWSERBASE_DEMO_MAX_RUNS_PER_WINDOW=2
ATRIB_BROWSERBASE_DEMO_MAX_RUNS_PER_DAY=8
ATRIB_BROWSERBASE_DEMO_RUN_TIMEOUT_MS=120000
```

Keep the demo at one machine unless the rate limiter and active-run lock move to
shared storage. The current implementation keeps run state in process memory.
The committed Fly config keeps that one machine warm for external review so
reviewer-triggered runs do not pay a Fly cold start or reset the in-memory rate
window between visits.

The Docker build skips package postinstall scripts and rebuilds only `esbuild`.
The hosted Browserbase path does not use local Playwright browsers, so the image
should not download Chromium during deployment.

Current hosted demo: <https://atrib-browserbase-stagehand-demo.fly.dev/>.
