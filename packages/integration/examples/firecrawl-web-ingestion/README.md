# Firecrawl Web Ingestion Proof

This example wraps a Firecrawl MCP shaped stdio server with `@atrib/mcp-wrap`.
It signs `firecrawl_search -> firecrawl_scrape -> firecrawl_extract ->
firecrawl_crawl`, with crawl capped to `maxDepth: 1` and `limit: 2`.

The default run uses `firecrawl-fixture-mcp.ts`, not the hosted Firecrawl API.
The fixture returns Firecrawl-shaped private material: query, source URL,
scraped Markdown, HTML, extracted text, and crawl job id. The public records
keep only selected tool names, `args_hash`, `result_hash`, record hashes, and
local log indexes.

Run the local fixture proof:

```bash
pnpm --filter @atrib/integration firecrawl-web-ingestion-packet
```

Write the proof artifacts:

```bash
ATRIB_PACKET_WRITE_ARTIFACTS=1 pnpm --filter @atrib/integration firecrawl-web-ingestion-packet
```

The checked artifact lands in `proof-packets/firecrawl-web-ingestion/`. A live API
run needs `FIRECRAWL_API_KEY` or a self-hosted `FIRECRAWL_API_URL` for
`npx -y firecrawl-mcp`. The demo reads credentials from the shell environment.
On the operator machine, `~/.zshenv` follows the cache-first 1Password pattern:
parent env, `~/.atrib/secrets/firecrawl-api-key`, then `op read` only in an
interactive shell if the cache is empty. The runner does not call `op read`.
Live mode follows the Cloudflare proof pattern: the runner captures wrapper
records locally while the flow is running. After the full flow verifies, it
submits the accepted record set to `https://log.atrib.dev/v1/entries`, verifies
inclusion, and writes those public log indexes into the artifact.

The artifact also writes `policy-decision.json`. That file models the next
gate after ingestion: allow internal research and source triage, but require
review before a customer email, account update, refund or payment change,
production code change, or vendor procurement action depends on web-derived
content. The policy decision is deterministic and hash-bound to the signed
Firecrawl records, but it is not a signed atrib record yet.

## Proof and demo boundary

This example has two runnable modes:

- Fixture proof: deterministic local MCP server, local capture log, no public
  log writes. This is the CI-safe integration example.
- Live public proof: real Firecrawl MCP server, public log inclusion, and
  regenerated artifact output.

It does not include a hosted interactive demo yet. A Google-workbench-style
runtime could let a reviewer submit a bounded URL or replay a fixed ingestion
target and inspect receipts, but that would be a separate demo surface.

Run the live public proof:

```bash
ATRIB_FIRECRAWL_WEB_INGESTION_LIVE=1 \
ATRIB_PACKET_PUBLIC_LOG=1 \
ATRIB_PACKET_WRITE_ARTIFACTS=1 \
  pnpm --filter @atrib/integration firecrawl-web-ingestion-packet
```
