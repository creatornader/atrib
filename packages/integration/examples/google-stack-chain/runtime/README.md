# Google evidence runtime

This runtime is the optional API behind the Google stack visual workbench. It
turns an AP2 result plus AP2 / Verifiable Intent evidence into a verifier-gated
decision:

```text
verify AP2 packet -> accept atrib transaction record -> allow next action
```

Run locally:

```bash
pnpm --filter @atrib/integration google-evidence-runtime
curl http://127.0.0.1:8080/v1/runtime-state
curl -X POST http://127.0.0.1:8080/api/runs \
  -H 'content-type: application/json' \
  -d '{"mode":"replay","prompt":"Continue only after AP2 verification."}'
```

The default replay uses the committed AP2 / VI reference fixture. Point the
runtime at a captured official Google AP2 sample packet with:

```bash
ATRIB_AP2_INTEROP_RESULT_JSON=/tmp/google-ap2-live/atrib-packet/ap2-result.json \
ATRIB_AP2_INTEROP_EVIDENCE_JSON=/tmp/google-ap2-live/atrib-packet/ap2-vi-evidence.json \
ATRIB_AP2_INTEROP_TRANSACTION_RECORD_JSON=/tmp/google-ap2-live/atrib-packet/atrib-transaction-record.json \
pnpm --filter @atrib/integration google-evidence-runtime
```

Endpoints:

- `GET /health`: service liveness.
- `GET /api/runs`: recent active runtime runs, held in memory.
- `POST /api/runs`: creates one verifier-gated AP2 -> A2A -> ADK JS run.
- `GET /api/runs/:runId`: returns one active run.
- `GET /v1/runtime-state`: replay verifier state for the visual workbench.
- `POST /v1/replay/google-ap2-sample`: explicit replay trigger.
- `POST /v1/verify-ap2`: accepts inline AP2 `result`, `evidence`, and
  `transactionRecord` JSON, or `{ "mode": "replay" }`.
- `POST /v1/analytics/write`: writes the current gate row to BigQuery only when
  `BIGQUERY_WRITE_ENABLED=1`.
- `GET /v1/merchant-adapter`: minimal packet contract for a merchant or payment
  participant.

Operator BigQuery write:

```bash
GOOGLE_CLOUD_PROJECT=<project> \
BIGQUERY_DATASET=<dataset> \
BIGQUERY_TABLE=<table> \
BIGQUERY_WRITE_ENABLED=1 \
pnpm --filter @atrib/integration google-evidence-runtime

curl -X POST http://127.0.0.1:8080/v1/analytics/write \
  -H 'content-type: application/json' \
  -d '{"mode":"replay"}'
```

Public deployments should leave `BIGQUERY_WRITE_ENABLED` unset. The runtime can
show live verifier state and active run rows without exposing a public BigQuery
write endpoint.

Deploy:

```bash
gcloud artifacts repositories create <repo> \
  --project=<project> \
  --location=<region> \
  --repository-format=docker

gcloud builds submit . \
  --project=<project> \
  --config=packages/integration/examples/google-stack-chain/runtime/cloudbuild.yaml \
  --substitutions=_TAG=$(date +%Y%m%d%H%M%S),_IMAGE=<image>

gcloud run deploy atrib-google-evidence-runtime \
  --project=<project> \
  --region=<region> \
  --image=<region>-docker.pkg.dev/<project>/<repo>/<image>:latest \
  --allow-unauthenticated \
  --memory=1Gi \
  --cpu=1 \
  --set-env-vars=GOOGLE_CLOUD_PROJECT=<project>,BIGQUERY_DATASET=<dataset>,BIGQUERY_TABLE=<table>
```

The deploy command prints the runtime URL. Keep deployment-specific URLs out of
committed public docs and pass them with `?runtime=` or local config when
needed.
