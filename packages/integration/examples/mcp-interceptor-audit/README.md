# MCP verifiable audit interceptor

This example implements the current Interceptors WG draft through a real
`@modelcontextprotocol/sdk` client and server. It advertises the
`io.modelcontextprotocol/interceptors` capability, responds to
`interceptors/list`, and handles request and response phases through
`interceptor/invoke`.

The interceptor keeps the request body private until the matching response
arrives. It then signs one atrib `tool_call` record with request and result
commitments and returns a `dev.atrib/attribution` receipt in
`ValidationResult.info`. The full payloads stay in a local sidecar.

```bash
pnpm --filter @atrib/integration mcp-interceptor-audit
```

The smoke also sends a response without `spanId`. The draft exposes optional
`traceId` and `spanId` fields, but it does not require a stable operation
identity across phases. The interceptor reports that response as unpaired and
does not emit a receipt. This avoids claiming a request-to-outcome relationship
that the invoker did not identify.

This example is implementation feedback for the experimental interceptor
surface. It is not a claim that SEP-2624 has been accepted. The choice to carry
the receipt under `ValidationResult.info["dev.atrib/attribution"]` is also a
candidate integration point, not an MCP standard.
