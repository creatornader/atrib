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
- Live demo: <https://atrib-firecrawl-ingestion-demo.fly.dev/>
- Explorer: <https://explore.atrib.dev/action/sha256:cdbb6231c47eae72f8be703ebf9eca4a5ee0af45d0edcc2e97c40ca4e2587ea2>
- Public log proof: <https://log.atrib.dev/v1/proof/cdbb6231c47eae72f8be703ebf9eca4a5ee0af45d0edcc2e97c40ca4e2587ea2>
- Public proof log indexes: tool records `67668`, `67669`, `67670`, `67671`; control records `67672`, `67673`
- Latest deployed demo run: tool records `67682`, `67683`, `67684`, `67685`; control records `67686`, `67687`
- Policy decision hash: `sha256:bf2395e835c18291a1bf05df24c95688a39d1260754f32d20e555fb72a912715`
- Tools signed: `firecrawl_search`, `firecrawl_scrape`, `firecrawl_extract`, `firecrawl_crawl`
- Control signed: `policy_decision`, `policy_outcome` before `customer_email`

## Target table

| Rank | Target | Channel | Source-backed reason | Draft status |
| 1 | Browserbase MCP maintainers, top repo contributors include `@Kylejeong2`, `@alexdphan`, `@filip-michalsky` | New GitHub issue after approval | Repo is active and public. Open issues discuss prompt injection through web content, cloud browser policy enforcement, and orphaned sessions: browserbase/mcp-server-browserbase#159, #176, #187. | Ready for approved issue |
| 2 | Firecrawl MCP maintainers, top repo contributors include `@nickscamara`, `@vrknetha`, `@tomkosm`, `@mogery` | Comment on firecrawl/firecrawl-mcp-server#233 after approval | Repo is active and public. Open issues discuss MCPSafe scan results, SSRF risk, and runaway crawl or credit burn: firecrawl/firecrawl-mcp-server#233, #194, #211. | Ready for approved comment |
| 3 | Browserbase support | Email only after approval | Browserbase MCP docs list support as a help path, but a GitHub issue keeps the proof and criticism public. | Hold |
| 4 | X or Discord | Only if a source-backed account or community link is selected later | No exact source-backed person or community target was added in this pass. | Hold |

## Browserbase draft: GitHub issue or comment

Subject:

```text
Verifiable Browserbase MCP run: signed start/navigate/observe/act/extract/end records
```

Body:

```markdown
I ran atrib against the Browserbase MCP surface rather than writing a generic security suggestion.

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
- Shows an agent-ready WebMCP target app at `/target`.
- Queues the run immediately and returns a run id while the proof finishes.
- Shows the Browserbase Stagehand workflow, action-gate decision, record hashes, public log indexes, verifier status, explorer links, and log-proof links.
- Shows cursor and click playback so the browser action is visible next to the evidence. If Browserbase Live View or Replay refs are available, the console exposes them as UI-only links.
- Keeps Browserbase session URL, replay URL, page snapshot, selectors, form values, and raw extraction payload out of the public output.

What I want criticism on:

- Whether the signed record boundary belongs around every Stagehand tool call, or only around state-changing actions.
- Whether the hash-only treatment is enough for browser replay URLs, selectors, and extracted page text.
- Whether this would help with the policy and session lifecycle concerns in #159, #176, and #187, or whether it misses the real failure mode.

I have not opened a PR because I want sharp feedback on the proof boundary first.
```

## Browserbase draft: direct note

```text
I ran atrib against Browserbase MCP and produced a public proof run: start, navigate, observe, act, extract, and end were signed through @atrib/mcp-wrap and included in log.atrib.dev. The current accepted proof uses Browserbase hosted Streamable HTTP MCP. I also built a proof console for fresh runs against an agent-ready WebMCP target app, with cursor and click playback beside the evidence timeline: https://atrib-browserbase-stagehand-demo.fly.dev/

Explorer: https://explore.atrib.dev/action/sha256:535201b60e3660f1b2f5babcfdd85f09f3a1503f4ad73cfc419528285c696aae
Log proof: https://log.atrib.dev/v1/proof/535201b60e3660f1b2f5babcfdd85f09f3a1503f4ad73cfc419528285c696aae

The public record keeps tool names plus args/result hashes. It does not expose the Browserbase session URL, replay URL, selectors, page snapshot, or extracted page text. Browserbase Live View or Replay refs are UI-only when present. I am looking for criticism on whether this proof boundary is useful for cloud browser actions, especially around policy enforcement, WebMCP tool invocation, and session cleanup.
```

## Firecrawl draft: GitHub issue or comment

Subject:

```text
Verifiable Firecrawl MCP run: signed search/scrape/extract/bounded-crawl records
```

Body:

```markdown
I ran atrib against Firecrawl MCP and built a proof artifact for the ingestion boundary.

Proof shape:

- Upstream: `npx -y firecrawl-mcp`
- Flow: `firecrawl_search -> firecrawl_scrape -> firecrawl_extract -> firecrawl_crawl`
- Crawl cap used in the proof: `maxDepth: 1`, `limit: 2`
- Wrapper: `@atrib/mcp-wrap`
- Public fields: tool names, `args_hash`, `result_hash`, record hashes, public log indexes
- Private fields: query, URL, scraped content, extracted text, crawl job id
- Policy artifact: `policy-decision.json` summarizes signed `policy_decision` and `policy_outcome` records before `customer_email`
- Fixed-input live demo: https://atrib-firecrawl-ingestion-demo.fly.dev/

Public proof:

- Explorer: https://explore.atrib.dev/action/sha256:cdbb6231c47eae72f8be703ebf9eca4a5ee0af45d0edcc2e97c40ca4e2587ea2
- Log proof: https://log.atrib.dev/v1/proof/cdbb6231c47eae72f8be703ebf9eca4a5ee0af45d0edcc2e97c40ca4e2587ea2
- Tool record indexes: `67668`, `67669`, `67670`, `67671`
- Signed control record indexes: `67672`, `67673`
- Policy decision hash: `sha256:bf2395e835c18291a1bf05df24c95688a39d1260754f32d20e555fb72a912715`
- Latest deployed demo run: tool indexes `67682`, `67683`, `67684`, `67685`; control indexes `67686`, `67687`

Policy shape:

- Allow internal research and source triage.
- Sign an escalation decision before a customer email, account update, refund or payment change, production code change, or vendor workflow depends on the ingested web content.
- Sign an outcome record proving `customer_email` did not execute.
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
I ran atrib against Firecrawl MCP and produced a public proof run for search, scrape, extract, and bounded crawl. I also added a signed policy decision and outcome that allow internal research but escalate before web-ingested content feeds a customer email, account update, refund or payment change, production code change, or vendor workflow.

Demo: https://atrib-firecrawl-ingestion-demo.fly.dev/
Explorer: https://explore.atrib.dev/action/sha256:cdbb6231c47eae72f8be703ebf9eca4a5ee0af45d0edcc2e97c40ca4e2587ea2
Log proof: https://log.atrib.dev/v1/proof/cdbb6231c47eae72f8be703ebf9eca4a5ee0af45d0edcc2e97c40ca4e2587ea2
Policy decision hash: sha256:bf2395e835c18291a1bf05df24c95688a39d1260754f32d20e555fb72a912715

The public record keeps tool names plus args/result hashes. It does not expose the query, URL, scraped content, extracted text, or crawl job id. The signed outcome proves the downstream customer-email action did not run. I am looking for criticism on whether this is the right evidence shape before a downstream agent uses web-ingested content for a sensitive action, and what fields are missing for policy, trust, or incident review.
```

## Remaining demo scope

Browserbase now has live demo code in
`packages/integration/examples/browserbase-stagehand/live-demo/` and a deployed
demo at <https://atrib-browserbase-stagehand-demo.fly.dev/>. The deployed demo
serves an agent-ready WebMCP target app at `/target`, uses hosted Browserbase
MCP, publishes to the public log after verification, applies a 120-second
proof-run timeout, starts runs without blocking the request, and keeps a single
warm Fly machine so the in-memory active run lock and rate limiter apply
consistently. The console now shows visible cursor and click playback next to
the signed evidence. Browserbase Live View and Replay refs can be attached as
UI-only links when the runtime provides them.

Hosted Browserbase fresh runs can still return temporary model-capacity errors.
The demo shows failed runs plainly and rate-limits retries.

Firecrawl now has a deployed fixed-input demo at
<https://atrib-firecrawl-ingestion-demo.fly.dev/>. It publishes fresh public log
records, signs the downstream policy decision and outcome, and refuses
arbitrary crawl targets or crawl depths.

Public-write guard: hosted demos should use demo-only keys and explicit run
limits so reviewers can create fresh records without creating unbounded public
log noise.
