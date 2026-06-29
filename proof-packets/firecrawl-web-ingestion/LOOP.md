# Firecrawl ingestion policy packet loop

## Goal

Extend the Firecrawl proof packet and fixed-input demo so signed web-ingestion
evidence feeds a signed downstream policy decision before a sensitive action
runs.

## Loop shape

Closed packet. One bounded implementation pass with objective checks and a hard
stop before any public contact.

## Work chunks

### Packet 1: proof artifact shape

Scope: add a signed downstream policy decision and outcome to the Firecrawl
packet.

Allowed files or surfaces:

- `packages/integration/examples/firecrawl-web-ingestion/**`
- `packages/integration/test/mcp-platform-proof-packets.test.ts`
- `proof-packets/firecrawl-web-ingestion/**`

Expected artifact or diff:

- `policy-decision.json`
- Signed `policy_decision` and `policy_outcome` control records
- Updated verifier output with a policy decision summary
- Fixture test coverage that checks the decision artifact, signed control
  records, and redaction boundary

Objective checks:

- `pnpm --filter @atrib/integration test -- test/mcp-platform-proof-packets.test.ts`
- Fixture artifact inspection for private needles

Human gates:

- None.

### Packet 2: proof-packet and contact drafts

Scope: explain the ingestion-to-policy boundary and update draft-only contact
copy.

Allowed files or surfaces:

- `packages/integration/examples/firecrawl-web-ingestion/README.md`
- `proof-packets/README.md`
- `proof-packets/CONTACT_DRAFTS.md`
- `proof-packets/firecrawl-web-ingestion/README.md`
- `proof-packets/firecrawl-web-ingestion/LOOP.md`

Expected artifact or diff:

- Control-plane fit section in the Firecrawl artifact
- Draft contact copy that asks maintainers for criticism on the evidence shape

Objective checks:

- `pnpm doc-sync`
- prose scan for banned phrasing and em dashes

Human gates:

- Posting a GitHub comment or issue
- Sending a DM, email, Discord message, or X post

### Packet 3: live proof refresh

Scope: rerun Firecrawl against the live MCP server and refresh committed
artifacts with public log references.

Allowed files or surfaces:

- `proof-packets/firecrawl-web-ingestion/**`
- `proof-packets/CONTACT_DRAFTS.md`

Expected artifact or diff:

- Fresh `verifier-output.json`
- Fresh `redaction-manifest.json`
- Fresh `policy-decision.json`
- README links and log indexes that match the new live run

Objective checks:

- Live proof command with `ATRIB_FIRECRAWL_WEB_INGESTION_LIVE=1`
- HTTP 200 checks for explorer and log proof links

Human gates:

- None for the proof run. Public posting remains gated.

### Packet 4: fixed-input hosted demo

Scope: deploy the Firecrawl ingestion demo with fixed public inputs, rate
limits, demo-only secret scope, and public log publication.

Allowed files or surfaces:

- `packages/integration/examples/firecrawl-web-ingestion/live-demo/**`
- `proof-packets/README.md`
- `proof-packets/CONTACT_DRAFTS.md`
- Fly app `atrib-firecrawl-ingestion-demo`

Expected artifact or diff:

- Deployed demo URL
- Healthy `/health` and `/api/config`
- One accepted hosted run with tool record indexes and signed control indexes

Objective checks:

- `flyctl deploy -a atrib-firecrawl-ingestion-demo -c packages/integration/examples/firecrawl-web-ingestion/live-demo/fly.toml --remote-only --ha=false`
- `curl -fsS https://atrib-firecrawl-ingestion-demo.fly.dev/health`
- `curl -fsS https://atrib-firecrawl-ingestion-demo.fly.dev/api/config`
- `POST /api/runs` followed by polling `GET /api/runs/:runId`

Human gates:

- Changing the fixed public input set
- Increasing crawl depth or run limits
- Posting contact copy

## Feedback gate

Acceptance comes from generated artifacts, tests, live proof output, link
checks, `pnpm doc-sync`, Prettier, typo checks, and a focused secret scan.
Maker output alone is not enough.

## Stop rules

Stop on accepted checks, same failure twice, missing permission, unclear success
criteria, dirty or unsafe worktree, any public-send decision, or max two retry
passes for the same failing command.

## Anti-gaming rules

Do not loosen checks after failures. Do not edit success criteria after seeing
results. Do not skip required tests. Do not claim acceptance from generated JSON
without reading it. Do not hide unresolved blockers.

## Receipt log

| Pass | Changed                                                                                    | Command or check                                                                                                                                                                                                                 | Result                                                                                                                                                                                                                  | Remaining blocker | Next action                             |
| ---- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | --------------------------------------- |
| 1    | Started loop and selected packet-local receipt file.                                       | Read `agent-loop-operator` and checked worktree state.                                                                                                                                                                           | Fresh branch `codex/firecrawl-action-gate-20260628` created from `origin/main` at `3c1b335`.                                                                                                                            | None.             | Add policy decision artifact and tests. |
| 2    | Added `policy-decision.json` generation and fixture assertions.                            | `pnpm install`; `pnpm --filter @atrib/mcp build`; `pnpm --filter @atrib/mcp-wrap build`; `pnpm --filter @atrib/integration test -- test/mcp-platform-proof-packets.test.ts`                                                      | Accepted: 5 tests passed. Initial clean-worktree failures were missing `node_modules` and missing package `dist`, then a test file list mistake that put `policy-decision.json` under Browserbase instead of Firecrawl. | None.             | Refresh live Firecrawl artifacts.       |
| 3    | Regenerated live Firecrawl artifacts with public log inclusion.                            | Length-only Firecrawl env check; `ATRIB_FIRECRAWL_WEB_INGESTION_LIVE=1 ATRIB_PACKET_PUBLIC_LOG=1 ATRIB_PACKET_WRITE_ARTIFACTS=1 pnpm --filter @atrib/integration firecrawl-web-ingestion-packet`                                 | Accepted: 4 records verified and published at indexes `66265`, `66266`, `66267`, `66268`; `policy-decision.json` hash `sha256:3c186af0a83692a04146bc25b5ef0202c3b4c8901f71cc2ea4d269ddfa02d7c1`.                        | None.             | Run hygiene checks and link probes.     |
| 4    | Checked artifacts, proof links, formatting, doc sync, typos, prose, and secret boundaries. | Focused TypeScript compile; focused packet test; `pnpm doc-sync`; Prettier check; `pnpm exec typos ...`; `git diff --check`; policy hash recompute; explorer/log-proof HTTP checks; targeted live-input and secret-pattern scan. | Accepted: typecheck passed; 5 tests passed; `doc-sync` passed; proof links returned HTTP 200; policy hash recomputed; no live query, URL, API key pattern, bearer token, or auth header found in proof outputs.         | None.             | Commit and push.                        |
| 5    | Converted Firecrawl policy from a deterministic artifact only into signed control records. | Focused TypeScript compile; `pnpm --filter @atrib/integration exec vitest run test/firecrawl-web-ingestion-live-demo.test.ts test/mcp-platform-proof-packets.test.ts`.                                                           | Accepted: TypeScript passed. Vitest passed with 12 tests and 3 skipped optional tests. Fixture asserts stopped-before `customer_email`, signed decision, signed outcome, and no private content leakage.                | None.             | Refresh live artifacts.                 |
| 6    | Regenerated live Firecrawl artifacts with signed control records.                          | Cache-only Firecrawl secret check; `ATRIB_FIRECRAWL_WEB_INGESTION_LIVE=1 ATRIB_PACKET_PUBLIC_LOG=1 ATRIB_PACKET_WRITE_ARTIFACTS=1 pnpm --filter @atrib/integration firecrawl-web-ingestion-packet`.                              | Accepted: tool records published at indexes `67668`, `67669`, `67670`, `67671`; signed control records at `67672`, `67673`; policy hash `sha256:bf2395e835c18291a1bf05df24c95688a39d1260754f32d20e555fb72a912715`.      | None.             | Deploy fixed-input demo.                |
| 7    | Deployed the fixed-input Firecrawl demo to Fly and ran one hosted proof.                   | `flyctl apps create`; cache-backed `flyctl secrets set`; `flyctl deploy`; `/health`; `/api/config`; `POST /api/runs`; poll `GET /api/runs/fc-mqyn5g9h-c55uls`.                                                                   | Accepted: demo live at `https://atrib-firecrawl-ingestion-demo.fly.dev/`; config guard passed; hosted run accepted with tool indexes `67682` through `67685` and control indexes `67686`, `67687`.                      | None.             | Run final hygiene and merge.            |
| 8    | Ran final hygiene and live-surface checks.                                                 | `pnpm doc-sync`; targeted Prettier check; focused TypeScript compile; focused Vitest; `pnpm exec typos`; `git diff --check`; Firecrawl secret scan; Browserbase and Firecrawl health/config checks.                              | Accepted: all checks passed at the time. Browserbase and Firecrawl hosted demos were healthy. Browserbase Live View still needed later session-debug enrichment.                                                        | None.             | Commit and merge.                       |
