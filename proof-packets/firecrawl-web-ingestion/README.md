# Firecrawl web ingestion proof artifact

This proof signs a Firecrawl MCP shaped ingestion flow through `@atrib/mcp-wrap`.

## Action path

`firecrawl_search -> firecrawl_scrape -> firecrawl_extract -> firecrawl_crawl`

The crawl step is capped to `maxDepth: 1` and `limit: 2`.

## What ran

- Upstream surface: Firecrawl MCP server launched with `npx -y firecrawl-mcp`.
- Atrib path: `@atrib/mcp-wrap` around an MCP stdio server.
- Record policy: public records keep selected tool names plus `args_hash` and `result_hash`.
- Verification: `@atrib/mcp` verifies each Ed25519 record signature after the wrapper writes its mirror.
- Log proof: accepted records were submitted to `https://log.atrib.dev/v1/entries` after full-flow verification; inclusion was verified.
- Publish policy: `accepted-run-after-verification`

## Public record refs

| Tool              | Record hash                                                             | Public log index |
| ----------------- | ----------------------------------------------------------------------- | ---------------- |
| firecrawl_search  | sha256:1facfd8797d2ea0b69797c8aa56bed257981d3342b654bd5c55079148318d71c | 66074            |
| firecrawl_scrape  | sha256:4d0aaf74833ff6ad966c600edf5a1d83bcceaf2c73b80380159b8dc4d68c50a8 | 66075            |
| firecrawl_extract | sha256:1793215346ec2d2272f070b6388abe8e45fe410d0d63afaf607ddbc9e7a697bb | 66076            |
| firecrawl_crawl   | sha256:ae435980fe28e7f9992948bae8748a04f2c990d83a9fc843045d7a8d378e5ceb | 66077            |

Representative public links:

- Explorer: <https://explore.atrib.dev/action/sha256:1facfd8797d2ea0b69797c8aa56bed257981d3342b654bd5c55079148318d71c>
- Log proof: <https://log.atrib.dev/v1/proof/1facfd8797d2ea0b69797c8aa56bed257981d3342b654bd5c55079148318d71c>

## Redaction line

The wrapper saw private Firecrawl-shaped payloads: query, URL, scraped Markdown, HTML, extracted text, and crawl job id. The public artifact stores only hashes for those fields. See `redaction-manifest.json`.

## Weakness

This proof run signs the wrapper path, record chain, hash-only disclosure, bounded crawl cap, public log inclusion, verifier path, and real Firecrawl MCP command path. Hosted Firecrawl content remains private.

## Demo boundary

This is a fixed proof artifact plus a rerunnable local command. It is not a
hosted interactive demo yet. A hosted ingestion demo would let a reviewer run a
bounded URL or replay a fixed target and inspect receipts without local
credential setup.

## Regenerate

```bash
ATRIB_PACKET_WRITE_ARTIFACTS=1 pnpm --filter @atrib/integration firecrawl-web-ingestion-packet
```

## Live upstream run

```bash
ATRIB_FIRECRAWL_WEB_INGESTION_LIVE=1 \
ATRIB_PACKET_PUBLIC_LOG=1 \
ATRIB_PACKET_WRITE_ARTIFACTS=1 \
  pnpm --filter @atrib/integration firecrawl-web-ingestion-packet
```

Live mode expects `FIRECRAWL_API_KEY` in the shell environment. On the operator
machine, `~/.zshenv` seeds it from `~/.atrib/secrets/firecrawl-api-key`
first, then asks 1Password only in an interactive shell if the cache is empty.
The runner does not call `op read`.
