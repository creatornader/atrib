# Proof Artifacts

This directory holds artifact-first proof runs for external MCP and tool
platform prospects.

| Proof                                               | Source example                                           | Status                                                                                                                                                                                |
| --------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Browserbase Stagehand](browserbase-stagehand/)     | `packages/integration/examples/browserbase-stagehand/`   | Live hosted Browserbase MCP path, WebMCP target app demo, Browserbase replay inspection, and public log inclusion. Fixture mode stays available for local tests.                      |
| [Firecrawl web ingestion](firecrawl-web-ingestion/) | `packages/integration/examples/firecrawl-web-ingestion/` | Live Firecrawl MCP path, fixed-input ingestion demo, and downstream policy decision artifact. Fixture mode stays available for local tests.                                           |
| [OpenETR transfer](openetr-transfer/)               | `packages/integration/examples/openetr-transfer/`        | Source-backed OpenETR public-relay recognition path with public log inclusion, signed control records, title-authority evidence, legal/MLETR evidence, and an MLETR source checklist. |

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
agent-ready WebMCP target app at `/target`, the Browserbase Stagehand workflow,
and the atrib action-gate receipts beside it. Hosted Browserbase fresh runs can
fail during temporary model-capacity spikes, so the demo must show failed runs
plainly and rate-limit retries.

Firecrawl has live demo code at
`packages/integration/examples/firecrawl-web-ingestion/live-demo/`. It stays
fixed-input by design: no arbitrary URL, query, crawl depth, or crawl limit.
Its packet includes `policy-decision.json`, which binds the signed ingestion
records to a candidate review gate for sensitive downstream actions.

OpenETR has two paths. The default packet signs an OpenETR-shaped issue,
transfer-initiate, transfer-accept, and state-query flow, then signs a
control-record policy decision that stops before recognized title transfer. The
source-backed public proof runs the pinned upstream Python implementation,
publishes exact OpenETR events to configured public relays, verifies public
event availability, verifies title-authority evidence, verifies legal/MLETR
evidence, writes an MLETR source checklist, executes the recognition action,
and submits accepted atrib records plus the control records to `log.atrib.dev`.
The title-authority evidence can be a configured external TTA Nostr event or an
operator-demo Nostr event. The legal/MLETR evidence can be an external signed
reviewer attestation or an operator-demo reviewer attestation.

## Contact drafts

Draft-only contact copy lives in [`CONTACT_DRAFTS.md`](CONTACT_DRAFTS.md).
Do not post issues, comments, direct messages, or email from that file without
explicit operator approval.
