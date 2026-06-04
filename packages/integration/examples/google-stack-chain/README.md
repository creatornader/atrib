# Google stack chain proof

This example composes the existing Google-origin proof surfaces into one local
proof ladder:

- AP2 / Verifiable Intent receipt and evidence verification
- A2A signed Agent Card plus verifier-gated handoff evidence
- Google ADK Python plugin callback signing

Run:

```bash
pnpm --filter @atrib/integration google-stack-chain-proof
```

The script prints a JSON summary with the AP2 transaction record hash, A2A
remote and receiver follow-up hashes, and ADK Python tool-callback record hash.
It also writes a local AP2 artifact bundle under `/tmp`.

## What it proves

- AP2 authorization and receipt evidence can produce a signed atrib transaction
  record with counterparty attestation over atrib transaction bytes.
- A2A handoff evidence can be accepted before a receiving agent signs its own
  `informed_by` follow-up.
- Google ADK Python can sign a hash-only record from the plugin tool-callback
  boundary while local sidecars keep the raw ADK payload inspectable.
- These surfaces can be presented as one verifier story for support, audit, or
  maintainer review.

## What it does not prove yet

This is a composed proof ladder, not one continuous cross-layer chain. The AP2,
A2A, and ADK records still use their existing local proof contexts. The next
implementation chunk is to thread a shared `context_id` or explicit
`informed_by` bridge from AP2 to A2A to ADK.

It is also not a deployed Google managed runtime proof, an A2A TCK result, a live
AP2 payment run, a Gemini Enterprise registration, a BigQuery Agent Analytics
export, or a Cloud Marketplace listing.
