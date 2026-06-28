# Proof Artifacts

This directory holds artifact-first proof runs for external MCP and tool
platform prospects.

| Proof                                               | Source example                                           | Status                                                                                                                                      |
| --------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| [Browserbase Stagehand](browserbase-stagehand/)     | `packages/integration/examples/browserbase-stagehand/`   | Live hosted Browserbase MCP path, Browserbase-shaped demo, and public log inclusion. Fixture mode stays available for local tests.          |
| [Firecrawl web ingestion](firecrawl-web-ingestion/) | `packages/integration/examples/firecrawl-web-ingestion/` | Live Firecrawl MCP path, fixed-input ingestion demo, and downstream policy decision artifact. Fixture mode stays available for local tests. |

Each artifact keeps public evidence narrow: tool names, hash disclosures, record
hashes, log indexes, and verifier output. Private upstream payloads stay out of
the public artifact and appear only as hashes in the redaction manifest.

## Proof and demo model

The Browserbase and Firecrawl surfaces use these layers:

- Fixture integration example: deterministic local MCP server, local capture
  log, no public log writes. This is the CI-safe proof path.
- Fixed public proof artifact: committed verifier output and redaction manifest
  from a live upstream run. These records are already in `log.atrib.dev`.
- Rerunnable live proof command: credentialed local run that can create fresh
  public log records again.
- Live demo layer: a UI or runtime where a reviewer can start fresh runs and
  inspect receipt rows.

Browserbase has a deployed live demo at
`https://atrib-browserbase-stagehand-demo.fly.dev/`. The page shows the
Browserbase session shape and Stagehand `observe`, `act`, and `extract`
workflow beside the Atrib receipt table. Hosted Browserbase fresh runs can fail
during temporary model-capacity spikes, so the demo must show failed runs plainly
and rate-limit retries.

Firecrawl has live demo code at
`packages/integration/examples/firecrawl-web-ingestion/live-demo/`. It stays
fixed-input by design: no arbitrary URL, query, crawl depth, or crawl limit.
Its packet includes `policy-decision.json`, which binds the signed ingestion
records to a candidate review gate for sensitive downstream actions.

## Contact drafts

Draft-only contact copy lives in [`CONTACT_DRAFTS.md`](CONTACT_DRAFTS.md).
Do not post issues, comments, direct messages, or email from that file without
explicit operator approval.
