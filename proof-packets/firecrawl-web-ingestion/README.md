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
| firecrawl_search  | sha256:bc6424b393edac3a3c9e2b6c203006d0d514cd51b960ca20958d8da174a05434 | 66265            |
| firecrawl_scrape  | sha256:143f718228e0985156b30cf933ab749527d0f80cf6b586754f0c05d213472e73 | 66266            |
| firecrawl_extract | sha256:94582f5e78da4ab9be42e2b71db94b4687a8c9db878d23fc839737db5db5fe7a | 66267            |
| firecrawl_crawl   | sha256:4b58bcc5ce9931b5528cb41d9ca0c791baeee122f8ceaaa0270e3f84bfe092cc | 66268            |

Representative public links:

- Explorer: <https://explore.atrib.dev/action/sha256:bc6424b393edac3a3c9e2b6c203006d0d514cd51b960ca20958d8da174a05434>
- Log proof: <https://log.atrib.dev/v1/proof/bc6424b393edac3a3c9e2b6c203006d0d514cd51b960ca20958d8da174a05434>

## Redaction line

The wrapper saw private Firecrawl-shaped payloads: query, URL, scraped Markdown, HTML, extracted text, and crawl job id. The public artifact stores only hashes for those fields. See `redaction-manifest.json`.

## Control-plane fit

Firecrawl is the untrusted web-ingestion boundary, not the sensitive downstream
action. This packet is meant to sit before a customer email, account update,
refund or payment change, production code change, or vendor workflow that
depends on web-derived context.

A verifier can see which ingestion tools ran, that the crawl was capped, that
records landed in the log, and that raw web content stayed private.

## Policy decision artifact

`policy-decision.json` models the next gate after ingestion:
`escalate_before_customer_email`. It binds to the signed Firecrawl records, log
indexes, crawl cap, verifier result, and redaction boundary.

Allowed without review: `internal_research_summary`, `source_triage`.

Escalated before execution: `customer_email`, `account_update`, `refund_or_payment_change`, `production_code_change`, `vendor_procurement_action`.

Policy decision hash: `sha256:3c186af0a83692a04146bc25b5ef0202c3b4c8901f71cc2ea4d269ddfa02d7c1`.

The policy decision file is deterministic and hash-bound to the signed
ingestion records. It is not a signed atrib record yet. The signed evidence in
this packet is the wrapped Firecrawl tool-call chain.

## Loop receipt

The implementation loop contract and pass receipts live in `LOOP.md`.

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
