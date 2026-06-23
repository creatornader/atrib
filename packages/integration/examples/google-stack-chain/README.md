# Google stack chain proof

This example composes the existing Google-origin proof surfaces into one local
proof chain:

- AP2 / Verifiable Intent receipt and evidence verification
- A2A signed Agent Card plus verifier-gated handoff evidence
- Google ADK Python decision-ledger signing before dispatch, followed by ADK Python
  tool-callback signing

Run:

```bash
pnpm --filter @atrib/integration google-stack-chain-proof
```

Open the visual workbench:

```bash
pnpm --filter @atrib/integration google-stack-chain-visual
```

Vite prints the local URL, usually `http://127.0.0.1:5173/`. The workbench also
supports direct file opening through
[`visual/index.html`](visual/index.html); the served path is better for normal
review, while the file path is useful for quick local inspection.

The workbench opens on the live runtime path first. The main proof chain stays
empty until the runtime returns records. The pinned five-record snapshot remains
available from the Reference view. When `runtime-config.js` or `?runtime=` is
set, the page asks the Google evidence runtime for live AP2 verifier state,
shows the AP2 -> A2A -> ADK decision -> ADK tool run as records arrive,
highlights matching BigQuery Agent Analytics-shaped rows, and keeps proof
boundaries visible.

The script prints a JSON summary with the AP2 transaction record hash, A2A
remote and receiver follow-up hashes, ADK Python allow-decision hash, and ADK Python
tool-callback record hash. It also prints a deterministic `snapshot` block. The
snapshot excludes the runtime `/tmp` artifact path and pins the stable A2A
evidence identifiers used for the signed record body.

Current snapshot record hashes:

- AP2 transaction:
  `sha256:e5f103d959cbb1e316e6d658b35fabc547b6b9b3bd530d0165cfbe48155cc6db`
- A2A remote evidence:
  `sha256:23e25fd31fc81cf8f6d668cf68454d05c6018451f3a7467fc15f2649277e42f9`
- A2A receiver follow-up:
  `sha256:1225fb6849cab06d9bec936abdf28f5ff1a4e2872ea8f5a87c1b469c54c18fb2`
- ADK Python allow decision:
  `sha256:f52b375c72747cb07a26fd9ed0038b12803a2beee2b8104bc2a34a43b65aa34f`
- ADK Python tool callback:
  `sha256:b68851adcf913713f2eba14e2dce27abd3212ebee7f52c87ad44ca77aed1f3af`

The script also writes a local AP2 artifact bundle under `/tmp`.

The ADK Python decision-ledger layer includes Google-style operational IDs as local
sidecar facts. The trace and span IDs are deterministic local projections for
this proof. The ADK invocation ID and function-call ID come from the local
`google-adk` Python run, so live runtime values can vary across runs.

The output also includes an `analytics_fixture` block shaped around the common
ADK BigQuery Agent Analytics columns (`timestamp`, `event_type`, `agent`,
`session_id`, `invocation_id`, `user_id`, `trace_id`, `span_id`,
`parent_span_id`, `status`, `error_message`, `is_truncated`). It adds
atrib-specific columns for record hash, parent record hashes, and protocol. This
static chain output is a local fixture for review. The runtime can write its
rows to BigQuery as an operator action with `BIGQUERY_WRITE_ENABLED=1`.

The visual snapshot lives at [`visual/proof-snapshot.json`](visual/proof-snapshot.json).
[`visual/proof-snapshot.js`](visual/proof-snapshot.js) is generated from the JSON
so the workbench can also run from `file://`. When the proof script's pinned
hashes change, update both files and rerun
`pnpm --filter @atrib/integration test -- google-stack-chain-visual` before using
the workbench as public proof material.

For a hosted preview, the visual can remain a static site while live verifier
state comes from a separately deployed runtime. Vercel or Cloudflare Pages is
enough for the visual. The Cloud Run runtime in [`runtime/`](runtime/) can be
configured locally with [`visual/runtime-config.js`](visual/runtime-config.js)
or with the `?runtime=` query parameter. Do not commit deployment-specific
preview URLs to this public example.

## Active runtime

The Cloud Run runtime lives in [`runtime/`](runtime/) and serves:

- `GET /v1/runtime-state`: live AP2 replay verifier state for the visual.
- `GET /api/runs`: recent active runtime runs, held in memory.
- `POST /api/runs`: verifier-gated AP2 -> A2A -> ADK Python run creation.
- `GET /api/runs/:runId`: one active run with timeline and analytics rows.
- `POST /v1/verify-ap2`: inline AP2 packet verification for a merchant or
  payment participant.
- `POST /v1/analytics/write`: operator-only BigQuery row write when
  `BIGQUERY_WRITE_ENABLED=1`.
- `GET /v1/merchant-adapter`: the packet contract for "bring your AP2
  merchant" integration.

Public deployments leave `BIGQUERY_WRITE_ENABLED` unset, so the workbench can
show live verifier state without exposing a public write endpoint.

To run the same gate from official Google AP2 sample output, capture the sample
packet and point the runtime at the generated files:

```bash
pnpm --filter @atrib/integration ap2-google-live-capture \
  --out-dir /tmp/google-ap2-live \
  --temp-db-dir /path/to/google-agentic-commerce/AP2/code/samples/python/scenarios/a2a/human-not-present/cards/.temp-db \
  --context-id google-ap2-live-demo

ATRIB_AP2_INTEROP_RESULT_JSON=/tmp/google-ap2-live/atrib-packet/ap2-result.json \
ATRIB_AP2_INTEROP_EVIDENCE_JSON=/tmp/google-ap2-live/atrib-packet/ap2-vi-evidence.json \
ATRIB_AP2_INTEROP_TRANSACTION_RECORD_JSON=/tmp/google-ap2-live/atrib-packet/atrib-transaction-record.json \
pnpm --filter @atrib/integration google-evidence-runtime
```

Bring-your-AP2-merchant shape:

```json
{
  "result": "AP2 result JSON",
  "evidence": "AP2 / Verifiable Intent evidence bundle",
  "transactionRecord": "atrib transaction record with counterparty signer",
  "nowSeconds": 1779840000
}
```

The runtime returns `allow_next_action` only after AP2 detection, AP2 / VI
evidence verification, atrib record verification, and counterparty attestation
all pass.

The active `/api/runs` path uses that gate as the first decision, then runs the
local A2A handoff proof with the accepted AP2 record as parent evidence. It then
runs the Python ADK decision-ledger proof through `google-adk` Python, signs an
allow decision with the A2A follow-up as parent evidence, and signs the tool
callback with that decision as parent evidence. The visual workbench calls this
endpoint to show the current run state instead of only replaying the pinned
snapshot.

## What it proves

- AP2 authorization and receipt evidence can produce a signed atrib transaction
  record with counterparty attestation over atrib transaction bytes.
- That AP2 transaction record can inform the remote A2A evidence record.
- A2A handoff evidence can be accepted before a receiving agent signs a
  verifier-resolved `informed_by` follow-up.
- Google ADK Python can sign a hash-only allow decision before tool dispatch, then
  sign the tool outcome with the decision record in `informed_by` while local
  sidecars keep the raw ADK payload inspectable.
- The Cloud Run runtime can make the next-action decision from verified AP2
  evidence, run the A2A and ADK Python follow-up, and produce BigQuery-shaped rows
  tied to atrib record hashes.
- These surfaces can be presented as one verifier story for support, audit, or
  external review.

## What it does not prove yet

This is a local explicit `informed_by` bridge, not a shared `context_id` across
AP2, A2A, and ADK. The AP2, A2A, and ADK records still use their existing local
proof contexts.

It is also not an Agent Platform Runtime proof, an A2A TCK result, a live AP2
payment run, a Gemini Enterprise registration, or a Cloud Marketplace listing.
The AP2 runtime is deployed on Cloud Run and uses official-sample replay or
provided packet JSON; it is not a real external AP2 merchant or payment service.
