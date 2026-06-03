# Trace repair suspect proof

This offline example turns a signed trace packet into a repair target. It creates
three current trace records, rejects a stale prior packet, ranks the failed tool
action as the likely suspect, and signs a diagnostic outcome that cites both the
failure and the suspect through `informed_by`.

Run it with:

```bash
pnpm --filter @atrib/integration trace-repair-suspect
```

The example proves:

- A current trace packet can be verified with signer, context, body-commitment,
  freshness, and log-inclusion checks before any follow-up work cites it.
- A stale prior packet is rejected before it can steer the repair.
- Suspect ranking stays derived analyzer output. The base records and graph edges
  remain structural.
- The diagnostic outcome is a signed atrib record with `informed_by` links to
  the failure record and the top suspect.

This is not an AgentTrace implementation and it is not a Tracebase memory
runtime. It is the atrib-side adapter shape: trace tools can keep their local UI,
ranking, and reports, while atrib supplies signed records and verifier-ready
handoff material.
