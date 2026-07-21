# OpenInference private evidence across Phoenix retention

This packet shows one OpenInference span stream crossing two storage boundaries. Phoenix receives an allowlisted observability copy. atrib signs commitments to the original synthetic tool input and output, while those bodies stay in a mode-0600 local mirror.

The recorded run used Phoenix 19.3.0. It confirmed that Phoenix received the trace and span identifiers without either private body, deleted the trace through the Phoenix REST API, and no longer returned it. The atrib verifier then rechecked both signatures and replayed both private body commitments from the local mirror.

The live-proof mode also submitted the two hash-only records to `log.atrib.dev` and their record bodies to `archive.atrib.dev`. It verified each Merkle leaf against the exact record, checked inclusion against the returned checkpoint root, verified the checkpoint signature and key id, and fetched the matching archive record. The private mirror was never submitted.

## Files

- `verifier-output.json`: sanitized output from the Phoenix 19.3.0 and public-log run.
- `redaction-manifest.json`: fields withheld from Phoenix, the public log, the archive, and this packet.

## Run

```bash
docker run --rm -p 6006:6006 arizephoenix/phoenix:19.3.0
pnpm --filter @atrib/integration openinference-phoenix-private-evidence
```

Run `pnpm --filter @atrib/integration openinference-phoenix-private-evidence-live` to create fresh synthetic public-log and archive records. The default command stays local.

## Boundary

The signed `context_id` carries the OpenTelemetry trace id. Exact span ids stay in the private mirror and are not signed into the public record. Phoenix retention and deletion remain Phoenix concerns. atrib preserves a separate action-evidence receipt; it does not replace the trace, reconstruct deleted observability data, or prove that the exporter captured fields it never received.
