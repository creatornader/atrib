# Proof Artifacts

This directory holds artifact-first proof runs for external MCP and tool
platform prospects.

| Proof                                                                 | Source example                                                           | Status                                                                                                                                                                                                                      |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Browserbase Stagehand](browserbase-stagehand/)                       | `packages/integration/examples/browserbase-stagehand/`                   | Live hosted Browserbase MCP path, WebMCP target app demo, Browserbase replay inspection, and public log inclusion. Fixture mode stays available for local tests.                                                            |
| [Firecrawl web ingestion](firecrawl-web-ingestion/)                   | `packages/integration/examples/firecrawl-web-ingestion/`                 | Live Firecrawl MCP path, fixed-input ingestion demo, and downstream policy decision artifact. Fixture mode stays available for local tests.                                                                                 |
| [Cloudflare x402 paid agent](cloudflare-x402-paid-agent/)             | `packages/integration/examples/cloudflare-agents/paid-x402-action-gate/` | Local Cloudflare Agents shaped paid MCP proof: Action Gate policy decision, outcome, and hash-only x402 lifecycle facts. Gateway beta access is not required.                                                               |
| [Cloudflare x402 Path B reference](cloudflare-x402-path-b-reference/) | `packages/integration/examples/cloudflare-agents/x402-path-b-reference/` | Local x402 v2 header flow: Action Gate decision, paid retry context propagation, `PAYMENT-RESPONSE` detection, agent-side Path B transaction emission, and counterparty attestation. No funds or Gateway beta API required. |
| [OpenETR transfer](openetr-transfer/)                                 | `packages/integration/examples/openetr-transfer/`                        | Source-backed OpenETR public-relay recognition path with public log inclusion, signed control records, title-authority evidence, legal/MLETR evidence, and an MLETR source checklist.                                       |
| [x401 open credential](x401-open-credential-e2e/)                     | `packages/integration/scripts/open-x401-credential-packet.ts`            | Current-spec x401 challenge, retry, result, local JWT VC / signed VP verifier, and signed atrib action chain. Sanitized offline-local packet, no Proof platform account required.                                           |
| [OpenInference private evidence](openinference-private-evidence/)     | `packages/integration/examples/openinference/`                           | Phoenix 19.3.0 receives an allowlisted trace without private tool bodies, deletes the trace, and leaves signed body commitments verifiable through a private mirror plus public log and archive records.                    |

Each artifact keeps public evidence narrow: tool names, hash disclosures, record
hashes, log indexes, and verifier output. Private upstream payloads stay out of
the public artifact and appear only as hashes in the redaction manifest.

## Proof and demo model

Browserbase and Firecrawl use these layers:

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
and the atrib action-gate receipts beside it. Live runs derive Browserbase Live
View from the MCP-returned session id through Browserbase's session debug API.
The run JSON carries a Live View hash and local redirect path, not the raw
upstream URL. Public records keep hashes. Hosted
Browserbase fresh runs can fail during temporary model-capacity spikes, so the
demo must show failed runs plainly and rate-limit retries.

Firecrawl has a deployed live demo at
`https://atrib-firecrawl-ingestion-demo.fly.dev/`. It stays fixed-input by
design: no arbitrary URL, query, crawl depth, or crawl limit. Its packet
includes `policy-decision.json`, which binds the signed ingestion records to a
signed review gate for sensitive downstream actions.

Cloudflare x402 has two local proof shapes. The paid-agent packet signs the
pre-payment policy decision and post-call outcome through `@atrib/action-gate`,
then binds a hash-only paid request lifecycle to those record hashes. The Path B
reference packet exercises the open x402 v2 header flow through
`@atrib/agent`: 402 challenge, `PAYMENT-SIGNATURE` retry, `PAYMENT-RESPONSE`
detection, agent-side transaction emission, and counterparty attestation. Both
leave an explicit slot for future Monetization Gateway lifecycle exports.

x401 uses a different proof shape. The committed packet is an offline-local
protocol artifact, not a live public-log run. It uses the released
`@proof.com/x401-node@0.3.0` wire SDK, then verifies a local JWT VC and signed
VP token so the public packet can show the x401 proof gate without requiring a
Proof platform account or publishing credential material.

## Explicit deferrals

- Shared durable run storage: both hosted demos run one warm Fly machine, so the
  in-memory active-run lock and rate limiter apply consistently. Shared storage
  is only needed if either demo scales past one machine.
- Firecrawl arbitrary-input crawling: the hosted demo stays fixed-input because
  arbitrary URL, query, depth, or limit input would introduce abuse and cost
  controls outside this proof packet.

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
