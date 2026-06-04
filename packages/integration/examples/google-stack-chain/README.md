# Google stack chain proof

This example composes the existing Google-origin proof surfaces into one local
proof chain:

- AP2 / Verifiable Intent receipt and evidence verification
- A2A signed Agent Card plus verifier-gated handoff evidence
- Google ADK Python plugin callback signing

Run:

```bash
pnpm --filter @atrib/integration google-stack-chain-proof
```

Open the visual workbench:

```bash
pnpm --filter @atrib/integration google-stack-chain-visual
```

Vite prints the local URL. The workbench is a static UI over the current snapshot:
it shows the four proof stages, lets the operator select each record, highlights
the matching BigQuery Agent Analytics-shaped fixture row, and keeps the same
claim limits visible on screen.

The script prints a JSON summary with the AP2 transaction record hash, A2A
remote and receiver follow-up hashes, and ADK Python tool-callback record hash.
It also prints a deterministic `snapshot` block. The snapshot excludes the
runtime `/tmp` artifact path and pins the stable A2A evidence identifiers used
for the signed record body.

Current snapshot record hashes:

- AP2 transaction:
  `sha256:e5f103d959cbb1e316e6d658b35fabc547b6b9b3bd530d0165cfbe48155cc6db`
- A2A remote evidence:
  `sha256:23e25fd31fc81cf8f6d668cf68454d05c6018451f3a7467fc15f2649277e42f9`
- A2A receiver follow-up:
  `sha256:1225fb6849cab06d9bec936abdf28f5ff1a4e2872ea8f5a87c1b469c54c18fb2`
- ADK Python tool callback:
  `sha256:70d0bb2c3e38194b065a1872bbf96861b8f9f0802d323c837ede32609b548a79`

The script also writes a local AP2 artifact bundle under `/tmp`.

The ADK Python layer includes Google-style operational IDs as local sidecar
facts. The trace and span IDs are deterministic local projections for this
proof. The ADK invocation ID and function-call ID come from the local
`google-adk` run, so they can vary across runs.

The output also includes an `analytics_fixture` block shaped around the common
ADK BigQuery Agent Analytics columns (`timestamp`, `event_type`, `agent`,
`session_id`, `invocation_id`, `user_id`, `trace_id`, `span_id`,
`parent_span_id`, `status`, `error_message`, `is_truncated`). It adds
atrib-specific columns for record hash, parent record hashes, and protocol. This
is a local fixture for review, not a BigQuery Storage Write API export.

The visual snapshot lives at [`visual/proof-snapshot.json`](visual/proof-snapshot.json).
When the proof script's pinned hashes change, update that file and rerun
`pnpm --filter @atrib/integration test -- google-stack-chain-visual` before
using the workbench in an outreach packet.

## What it proves

- AP2 authorization and receipt evidence can produce a signed atrib transaction
  record with counterparty attestation over atrib transaction bytes.
- That AP2 transaction record can inform the remote A2A evidence record.
- A2A handoff evidence can be accepted before a receiving agent signs a
  verifier-resolved `informed_by` follow-up.
- Google ADK Python can sign a hash-only record from the plugin tool-callback
  boundary that informs by the A2A receiver follow-up while local sidecars keep
  the raw ADK payload inspectable.
- These surfaces can be presented as one verifier story for support, audit, or
  maintainer review.

## What it does not prove yet

This is a local explicit `informed_by` bridge, not a shared `context_id` across
AP2, A2A, and ADK. The AP2, A2A, and ADK records still use their existing local
proof contexts.

It is also not a deployed Google managed runtime proof, an A2A TCK result, a live
AP2 payment run, a Gemini Enterprise registration, a BigQuery Agent Analytics
export, or a Cloud Marketplace listing.
