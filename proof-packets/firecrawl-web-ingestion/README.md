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
| firecrawl_search  | sha256:cdbb6231c47eae72f8be703ebf9eca4a5ee0af45d0edcc2e97c40ca4e2587ea2 | 67668            |
| firecrawl_scrape  | sha256:0745e948a860f9d0bed287df904db36b797aa066e27a37dc29e1291e9c43fdc0 | 67669            |
| firecrawl_extract | sha256:22b7e91b2a44c22cfafea66d161dabf8f3407eaec5ce5977b145bc998496da33 | 67670            |
| firecrawl_crawl   | sha256:e11a6a0f9974fe34533dc2d0aa897ab35fdd21e902ba49284e361f8d0e1767f4 | 67671            |

Representative public links:

- Explorer: <https://explore.atrib.dev/action/sha256:cdbb6231c47eae72f8be703ebf9eca4a5ee0af45d0edcc2e97c40ca4e2587ea2>
- Log proof: <https://log.atrib.dev/v1/proof/cdbb6231c47eae72f8be703ebf9eca4a5ee0af45d0edcc2e97c40ca4e2587ea2>

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

Policy decision hash: `sha256:bf2395e835c18291a1bf05df24c95688a39d1260754f32d20e555fb72a912715`.

Signed control records:

- Policy decision: `sha256:f7e3b35cb23e056e19ed6d327ce46a893032db89acc56513cd0fa30d10935930` at log index `67672`
- Policy outcome: `sha256:a208065d4866df7d5c0c6d914791b74d9d60d0ec72a6dccd886af69352dd1a0d` at log index `67673`

The policy decision file summarizes the signed atrib control decision. The
packet signs both the wrapped Firecrawl tool-call chain and the downstream
policy decision plus outcome records.

## Weakness

This proof run signs the wrapper path, record chain, hash-only disclosure, bounded crawl cap, public log inclusion, verifier path, and real Firecrawl MCP command path. Hosted Firecrawl content remains private.

## Demo boundary

This is a fixed proof artifact plus a rerunnable local command. The resettable
demo server lives in
`packages/integration/examples/firecrawl-web-ingestion/live-demo/`. The demo
is fixed-input by design: it lets a reviewer run the same bounded public target
and inspect fresh receipts without exposing arbitrary crawl capability.

The hosted page now presents the proof as a source-to-context pipeline:
discover a source, ground it with scrape, structure fields with extract, cap the
crawl, then stop before `customer_email` unless a reviewer accepts the policy
decision. This matches Firecrawl's public RAG, AI search, research, enrichment,
scrape, extract, and crawl examples better than a click-replay UI would.

Hosted demo: <https://atrib-firecrawl-ingestion-demo.fly.dev/>.

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
Live packet runs default to a 90-second timeout. Override it with
`ATRIB_FIRECRAWL_PACKET_TIMEOUT_MS` or `ATRIB_PACKET_TIMEOUT_MS`.
