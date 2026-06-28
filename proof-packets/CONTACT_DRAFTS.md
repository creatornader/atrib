# MCP proof contact drafts

Draft only. Do not post, comment, direct message, or email without explicit
operator approval.

## Current proof refs

Browserbase Stagehand:

- Artifact: [`browserbase-stagehand/verifier-output.json`](browserbase-stagehand/verifier-output.json)
- Live demo: <https://atrib-browserbase-stagehand-demo.fly.dev/>
- Explorer: <https://explore.atrib.dev/action/sha256:535201b60e3660f1b2f5babcfdd85f09f3a1503f4ad73cfc419528285c696aae>
- Public log proof: <https://log.atrib.dev/v1/proof/535201b60e3660f1b2f5babcfdd85f09f3a1503f4ad73cfc419528285c696aae>
- Public log indexes: `65792`, `65793`, `65794`, `65795`, `65796`, `65797`
- Latest deployed demo run: `65957`, `65958`, `65959`, `65960`, `65961`, `65962`
- Tools signed: `start`, `navigate`, `observe`, `act`, `extract`, `end`

Firecrawl web ingestion:

- Artifact: [`firecrawl-web-ingestion/verifier-output.json`](firecrawl-web-ingestion/verifier-output.json)
- Policy decision: [`firecrawl-web-ingestion/policy-decision.json`](firecrawl-web-ingestion/policy-decision.json)
- Live demo code: [`../packages/integration/examples/firecrawl-web-ingestion/live-demo/README.md`](../packages/integration/examples/firecrawl-web-ingestion/live-demo/README.md)
- Explorer: <https://explore.atrib.dev/action/sha256:bc6424b393edac3a3c9e2b6c203006d0d514cd51b960ca20958d8da174a05434>
- Public log proof: <https://log.atrib.dev/v1/proof/bc6424b393edac3a3c9e2b6c203006d0d514cd51b960ca20958d8da174a05434>
- Public log indexes: `66265`, `66266`, `66267`, `66268`
- Policy decision hash: `sha256:3c186af0a83692a04146bc25b5ef0202c3b4c8901f71cc2ea4d269ddfa02d7c1`
- Tools signed: `firecrawl_search`, `firecrawl_scrape`, `firecrawl_extract`, `firecrawl_crawl`

## Target table

| Rank | Target                                                                                                      | Channel                                                             | Source-backed reason                                                                                                                                                                              | Draft status               |
| ---- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| 1    | Browserbase MCP maintainers, top repo contributors include `@Kylejeong2`, `@alexdphan`, `@filip-michalsky`  | New GitHub issue after approval                                     | Repo is active and public. Open issues discuss prompt injection through web content, cloud browser policy enforcement, and orphaned sessions: browserbase/mcp-server-browserbase#159, #176, #187. | Ready for approved issue   |
| 2    | Firecrawl MCP maintainers, top repo contributors include `@nickscamara`, `@vrknetha`, `@tomkosm`, `@mogery` | Comment on firecrawl/firecrawl-mcp-server#233 after approval        | Repo is active and public. Open issues discuss MCPSafe scan results, SSRF risk, and runaway crawl or credit burn: firecrawl/firecrawl-mcp-server#233, #194, #211.                                 | Ready for approved comment |
| 3    | Browserbase support                                                                                         | Email only after approval                                           | Browserbase MCP docs list support as a help path, but a GitHub issue keeps the proof and criticism public.                                                                                        | Hold                       |
| 4    | X or Discord                                                                                                | Only if a source-backed account or community link is selected later | No exact source-backed person or community target was added in this pass.                                                                                                                         | Hold                       |

## Browserbase draft: GitHub issue or comment

Subject:

```text
Verifiable Browserbase MCP run: signed start/navigate/observe/act/extract/end records
```

Body:

```markdown
I ran Atrib against the Browserbase MCP surface rather than writing a generic security suggestion.

I also built a proof console for fresh runs: https://atrib-browserbase-stagehand-demo.fly.dev/

Proof shape:

- Upstream: Browserbase hosted Streamable HTTP MCP at `https://mcp.browserbase.com/mcp`
- Flow: `start -> navigate -> observe -> act -> extract -> end`
- Wrapper: `@atrib/mcp-wrap`
- Public fields: tool names, `args_hash`, `result_hash`, record hashes, public log indexes
- Private fields: target URL, observe/act/extract instructions, Browserbase session or replay URL, selectors, page snapshot

Public proof:

- Explorer: https://explore.atrib.dev/action/sha256:535201b60e3660f1b2f5babcfdd85f09f3a1503f4ad73cfc419528285c696aae
- Log proof: https://log.atrib.dev/v1/proof/535201b60e3660f1b2f5babcfdd85f09f3a1503f4ad73cfc419528285c696aae
- Public log indexes: `65792`, `65793`, `65794`, `65795`, `65796`, `65797`
- Latest deployed demo run indexes: `65957`, `65958`, `65959`, `65960`, `65961`, `65962`

Live demo boundary:

- Starts one fixed Browserbase proof run per click.
- Queues the run immediately and returns a run id while the proof finishes.
- Shows step, record hash, public log index, verifier status, explorer link, and log-proof link.
- Keeps Browserbase session URL, replay URL, page snapshot, selectors, form values, and raw extraction payload out of the public output.

What I want criticism on:

- Whether the signed record boundary belongs around every Stagehand tool call, or only around state-changing actions.
- Whether the hash-only treatment is enough for browser replay URLs, selectors, and extracted page text.
- Whether this would help with the policy and session lifecycle concerns in #159, #176, and #187, or whether it misses the real failure mode.

I have not opened a PR because I want sharp feedback on the proof boundary first.
```

## Browserbase draft: direct note

```text
I ran Atrib against Browserbase MCP and produced a public proof run: start, navigate, observe, act, extract, and end were signed through @atrib/mcp-wrap and included in log.atrib.dev. The current accepted proof uses Browserbase hosted Streamable HTTP MCP. I also built a proof console for fresh runs: https://atrib-browserbase-stagehand-demo.fly.dev/

Explorer: https://explore.atrib.dev/action/sha256:535201b60e3660f1b2f5babcfdd85f09f3a1503f4ad73cfc419528285c696aae
Log proof: https://log.atrib.dev/v1/proof/535201b60e3660f1b2f5babcfdd85f09f3a1503f4ad73cfc419528285c696aae

The public record keeps tool names plus args/result hashes. It does not expose the Browserbase session URL, replay URL, selectors, or page snapshot. I am looking for criticism on whether this proof boundary is useful for cloud browser actions, especially around policy enforcement and session cleanup.
```

## Firecrawl draft: GitHub issue or comment

Subject:

```text
Verifiable Firecrawl MCP run: signed search/scrape/extract/bounded-crawl records
```

Body:

```markdown
I ran Atrib against Firecrawl MCP and built a proof artifact for the ingestion boundary.

Proof shape:

- Upstream: `npx -y firecrawl-mcp`
- Flow: `firecrawl_search -> firecrawl_scrape -> firecrawl_extract -> firecrawl_crawl`
- Crawl cap used in the proof: `maxDepth: 1`, `limit: 2`
- Wrapper: `@atrib/mcp-wrap`
- Public fields: tool names, `args_hash`, `result_hash`, record hashes, public log indexes
- Private fields: query, URL, scraped content, extracted text, crawl job id
- Policy artifact: `policy-decision.json` models `escalate_before_customer_email`

Public proof:

- Explorer: https://explore.atrib.dev/action/sha256:bc6424b393edac3a3c9e2b6c203006d0d514cd51b960ca20958d8da174a05434
- Log proof: https://log.atrib.dev/v1/proof/bc6424b393edac3a3c9e2b6c203006d0d514cd51b960ca20958d8da174a05434
- Public log indexes: `66265`, `66266`, `66267`, `66268`
- Policy decision hash: `sha256:3c186af0a83692a04146bc25b5ef0202c3b4c8901f71cc2ea4d269ddfa02d7c1`

Policy shape:

- Allow internal research and source triage.
- Escalate before a customer email, account update, refund or payment change, production code change, or vendor workflow depends on the ingested web content.
- Keep raw web content private while making the ingestion record hashes and verifier output public.

What I want criticism on:

- Whether this is the right evidence shape before a downstream agent uses web-ingested content for a sensitive action.
- Which fields are missing for policy, trust, or incident review.
- Whether `search`, `scrape`, `extract`, and `crawl` should all be signed, or whether the right boundary is only recursive or credit-consuming actions.
- Whether the bounded-crawl receipt helps with the concerns in #233, #194, and #211, or whether enforcement needs to happen somewhere else.

I have not opened a PR because I want maintainer feedback on the record boundary before changing code.
```

## Firecrawl draft: direct note

```text
I ran Atrib against Firecrawl MCP and produced a public proof run for search, scrape, extract, and bounded crawl. I also added a small policy decision artifact that allows internal research but escalates before web-ingested content feeds a customer email, account update, refund or payment change, production code change, or vendor workflow.

Explorer: https://explore.atrib.dev/action/sha256:bc6424b393edac3a3c9e2b6c203006d0d514cd51b960ca20958d8da174a05434
Log proof: https://log.atrib.dev/v1/proof/bc6424b393edac3a3c9e2b6c203006d0d514cd51b960ca20958d8da174a05434
Policy decision hash: sha256:3c186af0a83692a04146bc25b5ef0202c3b4c8901f71cc2ea4d269ddfa02d7c1

The public record keeps tool names plus args/result hashes. It does not expose the query, URL, scraped content, extracted text, or crawl job id. I am looking for criticism on whether this is the right evidence shape before a downstream agent uses web-ingested content for a sensitive action, and what fields are missing for policy, trust, or incident review.
```

## Remaining demo scope

Browserbase now has live demo code in
`packages/integration/examples/browserbase-stagehand/live-demo/` and a deployed
demo at <https://atrib-browserbase-stagehand-demo.fly.dev/>. The deployed demo
uses hosted Browserbase MCP, public-log publication after verification, a
120-second proof-run timeout, nonblocking run creation, and a single warm Fly
machine so the in-memory active run lock and rate limiter apply consistently.

Hosted Browserbase fresh runs can still return temporary model-capacity errors.
The demo shows failed runs plainly and rate-limits retries.

Firecrawl is ready as a fixed proof artifact plus rerunnable command. A hosted
Firecrawl demo should use the fixed-input ingestion-gate code in
`packages/integration/examples/firecrawl-web-ingestion/live-demo/`. It must not
accept arbitrary crawl targets or crawl depths.

Public-write guard: hosted demos should use demo-only keys and explicit run
limits so reviewers can create fresh records without creating unbounded public
log noise.
