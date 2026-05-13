# `@atrib/mcp`

**MCP server middleware for atrib. One line of code wraps your existing MCP server and emits a signed, chain-linked record of every successful tool call. The tool's actions become independently verifiable; the agent gains a provable history; settlement is computable downstream when commerce closes a chain. Automatic, asynchronous, zero impact on the tool's primary response.**

This is the **server-side half** of the atrib protocol: the package tool creators install. If you're building an agent that _calls_ MCP tools, you want [`@atrib/agent`](https://github.com/creatornader/atrib/blob/main/packages/agent/README.md) instead.

## Quick start

```typescript
import { atrib } from '@atrib/mcp'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

const server = atrib(new McpServer({ name: 'my-tool', version: '1.0.0' }), {
  creatorKey: process.env.ATRIB_PRIVATE_KEY!, // Ed25519 seed, base64url, 32 bytes
  serverUrl: 'https://my-tool.example.com', // canonical URL for content_id derivation
  logEndpoint: process.env.ATRIB_LOG_ENDPOINT, // optional in dev. Use @atrib/log-dev locally
})

// Register your tools the normal way; the wrapper is fully transparent.
server.tool('search', { q: z.string() }, async ({ q }) => {
  const results = await mySearchImplementation(q)
  return { content: [{ type: 'text', text: JSON.stringify(results) }] }
})
```

That's the entire integration. Every successful `tools/call` your server handles now emits a signed atrib record carrying the spec [§1.2](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#12-the-attribution-record) record format, propagates W3C trace context to the response, and submits to your configured log endpoint asynchronously per spec [§5.3.5](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#535-log-submission).

## What the middleware does on every tool call

Per spec [§5.3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#53-atribmcp-mcp-server-middleware), on every inbound `tools/call`:

1. **Reads inbound attribution context** from `params._meta.atrib`, `tracestate`, and `X-atrib-Chain` (in priority order). If the calling agent is wrapped with `@atrib/agent`, the previous record's hash and creator key are extracted from this token to set the next record's `chain_root`.
2. **Reads `session_token` from baggage** if present, for cross-trace session continuity.

After the tool's own handler returns successfully (`isError: false`), **before** returning the response to the caller:

3. **Constructs the attribution record** with `content_id` derived from `serverUrl` + tool name ([§1.2.2](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#122-content_id-derivation)), `chain_root` from inbound context or genesis ([§1.2.3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#123-chain_root-for-genesis-records)), `event_type` from the optional `transactionTools` set in your options.
4. **Signs it with Ed25519** using the configured `creatorKey`.
5. **Computes the propagation token** (sha256 of the signed record + creator public key), 87 chars max, fitting the W3C tracestate value limit.
6. **Writes the token to the response** at `response._meta.atrib`, `tracestate`, and `X-atrib-Chain` so the calling agent can chain the next call to it.

After the response is sent (non-blocking; see invariant #4 below):

7. **Submits the signed record to the log endpoint** with retry (exponential backoff, max 3 attempts, 30s window).
8. **Caches the proof bundle on success**, or caches the signed record for `flush()` retry on failure.

## Critical behaviors (degradation contract per spec [§5.8](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#58-degradation-contract))

The middleware is built around one absolute invariant: **atrib failures must never affect the primary tool call or agent response.** Concretely:

- If `ATRIB_PRIVATE_KEY` (or `creatorKey`) is unset → pass-through mode with one console warning per process. Tools work normally; no records are emitted.
- All exceptions inside the middleware are caught, logged with the `atrib:` prefix, and never propagated to the caller.
- Log submission failures are silent and retried. Records that fail repeatedly are cached locally and given one final retry on `flush()`, drained in priority order (high before normal; see "How priority works on the wire" below).
- If a tool handler returns `isError: true`, **no record is emitted** per [§5.3.3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#533-record-construction-and-signing) and no context is written to the response. Errors do not contribute to attribution chains.

## Wire format (spec [§2.6.1](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#261-submit-entry))

The submission queue POSTs each signed record as a **bare attribution record** to your log endpoint:

```http
POST https://your-log.example.com/v1/entries
Content-Type: application/json
X-atrib-Priority: high

{
  "spec_version": "atrib/1.0",
  "content_id":   "sha256:...",
  "creator_key":  "...",
  "chain_root":   "sha256:...",
  "event_type":   "https://atrib.dev/v1/types/tool_call",
  "context_id":   "...",
  "timestamp":    1743850000000,
  "signature":    "..."
}
```

The body is the bare record per spec [§2.6.1](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#261-submit-entry); there is no wrapper object. The example above shows the minimal required fields; records MAY also carry optional fields per spec [§1.2](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#12-the-attribution-record): `session_token` ([§1.5.5](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#155-cross-trace-session-continuity)), `informed_by` ([§1.2.5](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#125-informed_by)), `provenance_token` ([§1.2.6](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#126-provenance_token)), `timestamp_granularity` ([§8.4](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#84-coarsened-timing-posture)), and `signers` array on transaction records ([§1.7.6](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#176-cross-attestation-requirement-for-transaction-records)). The `X-atrib-Priority` header is a non-conflicting HTTP-level extension to the spec used by the dev log's admission queue and by the `flush()` retry ordering inside this package. See the `submission.ts` file header for the full rationale on the two real consumers of priority.

The expected response is a proof bundle per [§2.6.2](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#262-inclusion-proof-response) (snake_case fields):

```json
{
  "log_index": 4821936,
  "checkpoint": "log.atrib.dev/v1\n4821937\n...",
  "inclusion_proof": ["...", "...", "..."],
  "leaf_hash": "..."
}
```

## API reference

### `atrib(server, options): AtribServer`

Wraps an `McpServer` instance in place. The wrapper is idempotent and can be called before or after `server.tool()` registration (the middleware retroactively wraps a pre-existing `tools/call` dispatcher if needed).

**`server`**; an `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`. The package supports both `server.tool()` (deprecated low-level) and `server.registerTool()` (current high-level) registration paths.

**`options`**; `AtribOptions`:

| Field              | Type             | Required                | Description                                                                                                                                                      |
| ------------------ | ---------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `creatorKey`       | `string`         | yes (else pass-through) | Base64url-encoded Ed25519 seed (32 bytes). If absent, the middleware enters pass-through mode with one console warning.                                          |
| `serverUrl`        | `string`         | recommended             | Canonical URL for `content_id` derivation per [§1.2.2](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#122-content_id-derivation). Required for stdio transports where no host header is available.                                           |
| `logEndpoint`      | `string`         | optional in dev         | Where to POST signed records. Defaults to `https://log.atrib.dev/v1/entries`. Use `@atrib/log-dev`'s submission endpoint for local development.                   |
| `policy`           | `PolicyDocument` | optional                | Policy document to serve at `/.well-known/atrib-policy.json` (for HTTP transports) and embed in `serverInfo` (for stdio).                                        |
| `transactionTools` | `string[]`       | optional                | Tool names that should emit a transaction record (`event_type: https://atrib.dev/v1/types/transaction`) instead of a tool_call record. The middleware emits one of three atrib normative `event_type` URIs (tool_call, transaction, observation) per [§1.2.4](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#124-event_type-values); consumers may also mint extension URIs in their own namespaces. Defaults to a built-in heuristic for common checkout/payment tool names. |
| `preCallTransform` | `PreCallTransform` | optional             | Pre-call hook for cross-tool causal embedding. When set, the middleware signs the record BEFORE forwarding to the upstream handler and invokes the callback with `{ toolName, args, receiptId, recordHash, contextId }`. The host returns mutated args to inject the receipt_id (or record_hash) into the upstream call. Use case: a wrapper around a database-writing tool that wants the tool to record its own atrib receipt at insert time, letting downstream consumers anchor `informed_by` references to the row. Errors thrown from the callback degrade silently to the standard post-call signing path ([§5.8](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#58-degradation-contract)). Tools without `preCallTransform` set retain the default post-call signing semantics. |
| `disclosure`       | `{ tool_name?: 'omit'\|'verbatim'\|'hashed'; args?: 'omit'\|'plain-sha256'\|'salted-sha256'; result?: 'omit'\|'plain-sha256'\|'salted-sha256' }` | optional | Opt-in disclosure dials per [§8 / D061](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d061-add-tool_name-args_hash-result_hash-fields-to-§121). All three default to `'omit'`, preserving the [§8.1](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#81-default-posture) default posture (existing behavior; record bytes unchanged for callers that don't opt in). `tool_name: 'verbatim'` writes the raw tool name; `'hashed'` writes `sha256:<hex>` of it. `args` and `result` use the same scheme: `'plain-sha256'` writes `<field>_hash = sha256(JCS(payload))`; `'salted-sha256'` generates a 16-byte random salt per record and writes both the salt field and `<field>_hash = sha256(salt ‖ JCS(payload))`. The result is hashed BEFORE atrib mutates `result._meta` with its own propagation token, so the commitment covers exactly what the upstream handler returned. **Compatibility**: `disclosure.result` requires the post-call signing path and is INCOMPATIBLE with `preCallTransform` (which signs pre-call when no result is available); when both are set, `result` disclosure is silently inactive on the pre-call path and an init-time warning fires so the conflict is visible at config time. |

Returns a `SubmissionQueue`-aware wrapper exposing:

- `flush()`: drain pending submissions before shutdown (idempotent)
- `getProof(recordHash)`: retrieve a cached proof bundle by record hash

### `createAtribProxy(options): Promise<AtribProxy>`

In-process surrogate `McpServer` that forwards every tool call to an upstream MCP server and attributes them at the proxy layer. Used by the Claude Agent SDK adapter (Case B) and any host that accepts a real `McpServer` instance but where the actual tools live in a third-party MCP server. See `packages/integration/examples/claude-agent-sdk/case-b-third-party-mcp.ts` for the full pattern.

### Lower-level primitives

For advanced use cases (custom transports, manual signing, recommendation calculation), the package also exports the cryptographic and serialization primitives directly: `signRecord`, `verifyRecord`, `canonicalRecord`, `computeContentId`, `genesisChainRoot`, `chainRoot`, `encodeToken`, `decodeToken`, `base64urlEncode`, `base64urlDecode`, `sha256`, `hexEncode`, `hexDecode`, plus the W3C trace-context helpers (`readInboundContext`, `writeOutboundContext`, `parseTracestateAtrib`, `parseBaggageAtribSession`, `extractTraceId`, `mergeTracestate`, `mergeBaggageAtribSession`) and the submission queue itself (`createSubmissionQueue`).

## Serving well-known endpoints ([§5.3.5](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#535-log-submission), [§5.3.6](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#536-policy-exposure))

For HTTP transports, the spec requires serving the policy document at `/.well-known/atrib-policy.json` and cached inclusion proofs at `/.well-known/atrib-proof/{record_hash}`. Two helpers make this easy.

### Web-standard handler (Hono, Deno, Bun, Cloudflare Workers)

`createAtribHttpHandler()` returns a function that accepts a `Request` and returns a `Response` for matched routes, or `null` for unmatched routes.

```typescript
import { atrib, createAtribHttpHandler } from '@atrib/mcp'
import { Hono } from 'hono'

const mcpServer = atrib(new McpServer({ name: 'my-tool', version: '1.0.0' }), {
  creatorKey: process.env.ATRIB_PRIVATE_KEY!,
  serverUrl: 'https://my-tool.example.com',
  policy: myPolicyDocument, // optional: your attribution policy (§4.2)
})

const app = new Hono()
const atribHandler = createAtribHttpHandler(mcpServer)

// Mount before your other routes
app.all('/.well-known/*', (c) => {
  const response = atribHandler(c.req.raw)
  return response ?? c.notFound()
})
```

### Framework-agnostic handler (Express, Fastify, or custom)

`handleAtribRequest()` returns a plain `{ status, headers, body }` object. Adapt it to your framework.

```typescript
import { atrib, handleAtribRequest } from '@atrib/mcp'
import express from 'express'

const mcpServer = atrib(new McpServer({ name: 'my-tool', version: '1.0.0' }), {
  creatorKey: process.env.ATRIB_PRIVATE_KEY!,
  serverUrl: 'https://my-tool.example.com',
  policy: myPolicyDocument,
})

const app = express()

app.use((req, res, next) => {
  const result = handleAtribRequest(mcpServer, req.method, req.path)
  if (!result) return next()
  res.status(result.status).set(result.headers).send(result.body)
})
```

### Endpoints served

| Route | Method | Behavior |
|-------|--------|----------|
| `GET /.well-known/atrib-policy.json` | GET, HEAD | Returns policy with `Cache-Control: max-age=300`, or 404 if no policy configured |
| `GET /.well-known/atrib-proof/{hash}` | GET, HEAD | Returns cached inclusion proof (content-addressed, immutable), or 404 if not cached |

Both handlers return `null` (or pass through) for any other path, so they compose safely with your existing routes. Non-GET/HEAD requests to matched paths return 405 with an `Allow` header.

For stdio transports where no HTTP server is available, the policy is embedded in the MCP `serverInfo` field during the `initialize` handshake. No HTTP handler is needed.

## Local development with `@atrib/log-dev`

Until the production Tessera-backed log at `log.atrib.dev/v1` is deployed, you can run a faithful in-memory log stub for local development:

```typescript
import { startDevLog } from '@atrib/log-dev'
import { atrib } from '@atrib/mcp'

const log = await startDevLog({ port: 0 })
console.log(`dev log at ${log.url}`)

const server = atrib(myMcpServer, {
  creatorKey: process.env.ATRIB_PRIVATE_KEY!,
  serverUrl: 'https://my-tool.example.com',
  logEndpoint: log.submissionEndpoint,
})

// Subscribe to record admissions for visibility
log.onSubmit((entry) => {
  console.log('record stored:', entry.record.event_type, entry.logIndex)
})

// On shutdown:
await server.flush()
await log.close()
```

`@atrib/log-dev` implements spec [§2.6.1](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#261-submit-entry) wire format conformance exactly; anything that flows through it would also be accepted by a real Tessera log. It uses placeholder Merkle hashes and is **not for production use**. See [`packages/log-dev/README.md`](https://github.com/creatornader/atrib/blob/main/packages/log-dev/README.md) for the full warning and the package's purpose.

## Test coverage

376 tests across 25 test files covering:

- Wire-format conformance to spec [§2.6.1](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#261-submit-entry) + [§2.6.2](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#262-inclusion-proof-response)
- Wycheproof Ed25519 test vectors (signing/verification)
- JCS canonicalization edge cases (RFC 8785)
- Token encoding/decoding round-trips
- Chain integrity across multiple sequential records
- W3C Trace Context propagation (traceparent, tracestate, baggage)
- The `setRequestHandler` monkey-patch shape regression test against `@modelcontextprotocol/sdk@1.29.0`
- The retroactive register-then-wrap path
- `createAtribProxy` end-to-end with real upstream MCP servers
- [§5.8](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#58-degradation-contract) degradation contract; every failure mode caught, never propagated
- Submission queue retry, backoff, and `flush()` priority ordering

Run them with `pnpm --filter @atrib/mcp test`.

## Spec references

| Spec section | What this package implements                                               |
| ------------ | -------------------------------------------------------------------------- |
| [§1.2](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#12-the-attribution-record)         | Attribution record format                                                  |
| [§1.3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#13-canonical-serialization)         | JCS canonicalization (RFC 8785)                                            |
| [§1.4](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#14-signing-and-verification)         | Ed25519 signing and verification                                           |
| [§1.5](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#15-context-propagation)         | Context propagation via `params._meta`, tracestate, baggage, X-atrib-Chain |
| [§2.6.1](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#261-submit-entry)       | Submission API client (POST a bare signed record)                          |
| [§2.6.2](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#262-inclusion-proof-response)       | Proof bundle response shape                                                |
| [§5.3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#53-atribmcp-mcp-server-middleware)         | Server-side middleware behavior                                            |
| [§5.3.3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#533-record-construction-and-signing)       | No emission for `isError: true`                                            |
| [§5.3.5](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#535-log-submission)       | Non-blocking submission queue, proof cache, HTTP proof endpoint             |
| [§5.3.6](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#536-policy-exposure)       | Policy exposure via HTTP endpoint and stdio serverInfo                      |
| [§2.8](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#28-proof-bundle-format)         | Proof bundle text format (C2SP tlog-proof serialization and parsing)        |
| [§5.6.3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#563-key-storage-requirements)       | Key storage: memory zeroing via `zeroize()` and `destroy()` on AtribServer |
| [§5.8](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#58-degradation-contract)         | Degradation contract; failures never break the host                       |

The full protocol spec is at [`atrib-spec.md`](https://github.com/creatornader/atrib/blob/main/atrib-spec.md).

## See also

- [`@atrib/agent`](https://github.com/creatornader/atrib/blob/main/packages/agent/README.md), the client-side counterpart for agents calling MCP tools
- [`@atrib/verify`](https://github.com/creatornader/atrib/blob/main/packages/verify/README.md), independent verification of settlement recommendations
- [`@atrib/log-dev`](https://github.com/creatornader/atrib/blob/main/packages/log-dev/README.md), development-mode Merkle log stub for local testing
- [`packages/integration/examples/end-to-end/`](https://github.com/creatornader/atrib/blob/main/packages/integration/examples/end-to-end/), runnable demo wiring everything together
- [`DECISIONS.md`](https://github.com/creatornader/atrib/blob/main/DECISIONS.md), architectural decision log

---

> **A note on documentation links.** The atrib protocol repository is currently private (in-progress public preparation). Links in this README to the spec and sister packages (`atrib-spec.md`, `packages/agent/README.md`, etc.) point at `github.com/creatornader/atrib/blob/main/...` URLs that will resolve once the repository goes public. Until then, see [`atrib.dev`](https://atrib.dev) for the protocol overview.
