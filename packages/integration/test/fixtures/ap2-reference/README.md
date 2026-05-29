# AP2 reference artifact fixtures

This directory contains opt-in AP2 reference artifacts generated from the
official `google-agentic-commerce/AP2` Python SDK. The fixtures give atrib a
real AP2 SDK receipt-JWT path without making default CI start the full AP2
sample stack or require Google credentials.

## Files

- `ap2-reference-result.json`: AP2 sample-style result envelope with compact
  `payment_receipt` and `checkout_receipt` JWT fields.
- `ap2-reference-evidence.json`: AP2 / VI evidence bundle for
  `verifyAp2ViEvidenceAsync()`. It uses the AP2 SDK receipt JWTs and atrib's
  deterministic VI credential fixture chain.
- `ap2-reference-metadata.json`: source repository, AP2 commit, source paths,
  issuer key id, and generation notes.

## Regeneration

Clone the AP2 reference repo, then run:

```bash
uv run --project /tmp/google-ap2-reference \
  python packages/integration/scripts/generate-ap2-reference-receipts.py \
  --ap2-repo /tmp/google-ap2-reference
```

The script imports AP2 SDK modules from `code/sdk/python`, creates and verifies
signed receipt JWTs with `ap2.sdk.receipt_wrapper.ReceiptClient`, then writes
the fixture JSON files here.

The full AP2 scenario samples remain separate. They launch multiple agents and
need external credentials. Use `ATRIB_AP2_INTEROP_COMMAND` with the live harness
when those scenario runs can emit artifact files.
