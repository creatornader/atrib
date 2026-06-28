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
- Log proof: records were submitted to `https://log.atrib.dev/v1/entries` and inclusion was verified.

## Public record refs

| Tool | Record hash | Public log index |
| --- | --- | --- |
| firecrawl_search | sha256:bc165654e4b409217dfdb9ecba04ebf9aba89f36938aa6c177110ccffdd795e0 | 63586 |
| firecrawl_scrape | sha256:7764354606812378aa36c0f503717ecac3520f50ec598460cf9412d3d4dd69b1 | 63587 |
| firecrawl_extract | sha256:756d0f07589d858232571fb2bf771e2eec7f51a5917ce00763f19cbdfd61f7ea | 63588 |
| firecrawl_crawl | sha256:6567a3fc5d860fe6d9cbb152f8a87e383124fbded77c785fefae4a6e98e7442e | 63589 |

Representative public links:

- Explorer: <https://explore.atrib.dev/action/sha256:bc165654e4b409217dfdb9ecba04ebf9aba89f36938aa6c177110ccffdd795e0>
- Log proof: <https://log.atrib.dev/v1/proof/bc165654e4b409217dfdb9ecba04ebf9aba89f36938aa6c177110ccffdd795e0>

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
FIRECRAWL_API_KEY=... \
ATRIB_PACKET_WRITE_ARTIFACTS=1 \
  pnpm --filter @atrib/integration firecrawl-web-ingestion-packet
```
