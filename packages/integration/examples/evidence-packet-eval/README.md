# Evidence Packet Eval

This example is a small eval-shaped packet verifier for the Pattern 3 handoff surface.
It builds five arms:

- `packet_on`: a current signed packet with body material and a log inclusion proof.
- `stale_packet`: a signed packet that is too old for the receiver's policy.
- `wrong_signer`: a current packet signed by a key outside the trust set.
- `tampered_body`: a current packet whose supplied body no longer matches the signed body hash.
- `packet_off`: no packet material, only a required hash.

Run it from the repo root:

```bash
pnpm --filter @atrib/integration evidence-packet-eval
```

The script starts an in-process dev log, signs the producer records, verifies the packet with `@atrib/verify`, and signs an Agent B follow-up only for the accepted arm. The output is a JSON summary of which arms passed the expected verifier decision.

It does not try to be a full behavior benchmark. The fixture is for one evidence gate: a receiver can accept current signed evidence and reject stale, wrong-signer, tampered, or missing packets before linking follow-up work through `informed_by`.
