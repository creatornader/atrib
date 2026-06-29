# Firecrawl web ingestion live demo

This is the resettable demo layer for the Firecrawl proof packet. It serves a
small ingestion-gate console and calls the existing Firecrawl packet runner when
a reviewer presses **Run ingestion proof**.

The demo does not accept arbitrary URLs or crawl depths. It uses the fixed
public input from the proof packet:

```text
firecrawl_search -> firecrawl_scrape -> firecrawl_extract -> firecrawl_crawl
```

The crawl step stays capped to `maxDepth: 1` and `limit: 2`.

## Run locally

Fixture mode is the default. It creates local receipts only and needs no
Firecrawl credentials.

```bash
pnpm --filter @atrib/integration firecrawl-web-ingestion-live-demo
```

Open `http://127.0.0.1:8789/`, then press **Run ingestion proof**.

Hosted demo: <https://atrib-firecrawl-ingestion-demo.fly.dev/>.

If that port is busy, set `PORT` or let the OS choose one:

```bash
PORT=18789 pnpm --filter @atrib/integration firecrawl-web-ingestion-live-demo
PORT=0 pnpm --filter @atrib/integration firecrawl-web-ingestion-live-demo
```

Set `HOST=0.0.0.0` only for a deliberate hosted deployment.

## Live Firecrawl mode

Live mode expects credentials to already be present in the shell environment.
Use the operator's cache-first `.zshenv` pattern for 1Password-backed secrets;
do not call `op read` inside this demo server.

```bash
ATRIB_FIRECRAWL_DEMO_MODE=live \
ATRIB_FIRECRAWL_DEMO_PUBLIC_LOG=1 \
FIRECRAWL_API_KEY=... \
  pnpm --filter @atrib/integration firecrawl-web-ingestion-live-demo
```

Public output:

- tool name
- record hash
- public log index
- verifier status
- explorer link
- log proof link
- crawl cap
- policy decision hash
- signed policy decision record hash
- signed policy outcome record hash

Private or redacted:

- Firecrawl API key
- raw scraped content
- extracted page text
- crawl job id
- auth token

## API

- `GET /health`: service liveness.
- `GET /api/config`: mode, fixed input, redaction boundary, and crawl cap.
- `GET /api/runs`: recent in-memory runs.
- `POST /api/runs`: queues one fresh proof run and returns `202` with a run id.
- `GET /api/runs/:runId`: returns one run.

The server allows one active run at a time and keeps only recent run summaries in
memory. Clients poll `GET /api/runs/:runId` until the run is accepted or failed.
It does not persist raw Firecrawl content.

## Deploy boundary

A deployed instance refuses `POST /api/runs` unless these conditions are true:

- `ATRIB_FIRECRAWL_DEMO_MODE=live`
- `ATRIB_FIRECRAWL_DEMO_PUBLIC_LOG=1`
- `ATRIB_FIRECRAWL_DEMO_DEPLOYED=1`
- `ATRIB_FIRECRAWL_DEMO_CREDENTIAL_SCOPE=demo-only`
- `ATRIB_FIRECRAWL_DEMO_INPUT_SCOPE=fixed-public`
- `FIRECRAWL_API_KEY` or `FIRECRAWL_API_URL` is present.
- The query, URL, and extract prompt match the fixed public defaults.
- Rate limiting is enabled with positive limits.

The committed Fly config sets the nonsecret deployment policy. The Firecrawl API
key must be set as a Fly secret:

```bash
flyctl apps create atrib-firecrawl-ingestion-demo
flyctl secrets set -a atrib-firecrawl-ingestion-demo FIRECRAWL_API_KEY=...
flyctl deploy -c packages/integration/examples/firecrawl-web-ingestion/live-demo/fly.toml --remote-only --ha=false
flyctl scale count 1 -a atrib-firecrawl-ingestion-demo
```

Default rate limits are two runs per hour and eight runs per day for each client
key. Override them with:

```bash
ATRIB_FIRECRAWL_DEMO_RATE_LIMIT=1
ATRIB_FIRECRAWL_DEMO_RATE_LIMIT_WINDOW_MS=3600000
ATRIB_FIRECRAWL_DEMO_MAX_RUNS_PER_WINDOW=2
ATRIB_FIRECRAWL_DEMO_MAX_RUNS_PER_DAY=8
ATRIB_FIRECRAWL_DEMO_RUN_TIMEOUT_MS=90000
```

Keep the demo at one machine unless the rate limiter and active-run lock move to
shared storage. The current implementation keeps run state in process memory.
