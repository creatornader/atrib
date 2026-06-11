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
8. **Caches the proof bundle on success**: or caches the signed record for `flush()` retry on failure.

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

| Field               | Type                                                                                                                                             | Required                | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `creatorKey`        | `string`                                                                                                                                         | yes (else pass-through) | Base64url-encoded Ed25519 seed (32 bytes). If absent, the middleware enters pass-through mode with one console warning.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `serverUrl`         | `string`                                                                                                                                         | recommended             | Canonical URL for `content_id` derivation per [§1.2.2](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#122-content_id-derivation). Required for stdio transports where no host header is available.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `logEndpoint`       | `string`                                                                                                                                         | optional in dev         | Where to POST signed records. Defaults to `https://log.atrib.dev/v1/entries`. Use `@atrib/log-dev`'s submission endpoint for local development.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `logSubmission`     | `'enabled'\|'disabled'`                                                                                                                          | optional                | Set to `'disabled'` for offline tests and local-mirror-only hosts that should sign records and run `onRecord` without POSTing to a log. Defaults to `'enabled'`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `archiveSubmission` | `{ endpoint: string; timeoutMs?: number }`                                                                                                       | optional                | Opt-in Record Body Archive submission. The middleware submits the signed record body and selected verifier evidence only after the log returns an inclusion proof. Raw sidecar args and results stay local-only. Accepts either an archive base URL such as `https://archive.atrib.dev/v1` or the full `.../v1/records` endpoint.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `policy`            | `PolicyDocument`                                                                                                                                 | optional                | Policy document to serve at `/.well-known/atrib-policy.json` (for HTTP transports) and embed in `serverInfo` (for stdio).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `transactionTools`  | `string[]`                                                                                                                                       | optional                | Tool names that should emit a transaction record (`event_type: https://atrib.dev/v1/types/transaction`) instead of a tool_call record. This middleware emits `tool_call` or `transaction` records per [§1.2.4](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#124-event_type-values); sibling atrib producers cover `observation`, `directory_anchor`, `annotation`, and `revision`, and consumers may also mint extension URIs in their own namespaces. Defaults to a built-in heuristic for common checkout/payment tool names.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `autoChain`         | `boolean`                                                                                                                                        | optional                | Synthesizes chain context for hosts that do not propagate atrib's outbound `_meta.atrib` token. Defaults to false for raw middleware callers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `contextIdResolver` | `() => string \| undefined`                                                                                                                      | optional                | Per-call fallback for host session discovery when inbound atrib metadata and traceparent are absent. Invalid values are ignored and callback errors degrade silently.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `autoChainFallback` | `'stable-process'\|'fresh'`                                                                                                                      | optional                | Controls no-context autoChain behavior. `stable-process` keeps the historical process-wide context. `fresh` gives no-context calls separate genesis contexts while preserving chain tails when a context is resolved.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `preCallTransform`  | `PreCallTransform`                                                                                                                               | optional                | Pre-call hook for cross-tool causal embedding. When set, the middleware signs the record BEFORE forwarding to the upstream handler and invokes the callback with `{ toolName, args, receiptId, recordHash, contextId }`. The host returns mutated args to inject the receipt_id (or record_hash) into the upstream call. Use case: a wrapper around a database-writing tool that wants the tool to record its own atrib receipt at insert time, letting downstream consumers anchor `informed_by` references to the row. Errors thrown from the callback degrade silently to the standard post-call signing path ([§5.8](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#58-degradation-contract)). Tools without `preCallTransform` set retain the default post-call signing semantics.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `disclosure`        | `{ tool_name?: 'omit'\|'verbatim'\|'hashed'; args?: 'omit'\|'plain-sha256'\|'salted-sha256'; result?: 'omit'\|'plain-sha256'\|'salted-sha256' }` | optional                | Opt-in disclosure dials per [§8 / D061](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d061-add-tool_name-args_hash-result_hash-fields-to-§121). All three default to `'omit'`, preserving the [§8.1](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#81-default-posture) default posture (existing behavior; record bytes unchanged for callers that don't opt in). `tool_name: 'verbatim'` writes the raw tool name; `'hashed'` writes `sha256:<hex>` of it. `args` and `result` use the same scheme: `'plain-sha256'` writes `<field>_hash = sha256(JCS(payload))`; `'salted-sha256'` generates a 16-byte random salt per record and writes both the salt field and `<field>_hash = sha256(salt ‖ JCS(payload))`. The result is hashed BEFORE atrib mutates `result._meta` with its own propagation token, so the commitment covers exactly what the upstream handler returned. **Compatibility**: `disclosure.result` requires the post-call signing path and is INCOMPATIBLE with `preCallTransform` (which signs pre-call when no result is available); when both are set, `result` disclosure is silently inactive on the pre-call path and an init-time warning fires so the conflict is visible at config time. |

### Producer-side MCP/OAuth evidence capture

Set `authorizationEvidence` when an MCP HTTP transport has already validated `extra.authInfo` and you want the local mirror to preserve verifier-ready evidence for later `@atrib/verify` checks:

```typescript
atrib(server, {
  creatorKey: '<base64url-encoded-32-byte-seed>',
  serverUrl: 'https://mcp.example.com/mcp',
  authorizationEvidence: {
    claimSource: 'extraClaims',
    requiredScopes: ['files:read'],
    protectedResourceMetadata: {
      resource: 'https://mcp.example.com/mcp',
      authorization_servers: ['https://auth.example.com'],
    },
    includeDpopProof: true,
  },
})
```

The middleware stores this evidence only in the local sidecar passed to `onRecord` or mirror writers. It does not add OAuth claims to the signed `AtribRecord`, and it does not submit them to the public log. The sidecar contains verified claims from `authInfo`, a one-way `token_hash` when a bearer token is present, optional DPoP proof material, and configured constraints. It does not store the raw bearer token by default.

The same sidecar also includes `resolvedFacts: { tool_name }` for tool calls. Verifiers can pass those facts to `verifyRecord(record, { resolvedFacts })` so capability envelopes that constrain `tool_names` can be evaluated from local body material instead of surfacing as unresolved.

### Optional archive submission

Set `archiveSubmission` when a producer wants public body retrieval for records whose privacy posture allows it:

```typescript
atrib(server, {
  creatorKey: '<base64url-encoded-32-byte-seed>',
  serverUrl: 'https://mcp.example.com/mcp',
  logEndpoint: 'https://log.atrib.dev/v1/entries',
  archiveSubmission: { endpoint: 'https://archive.atrib.dev/v1' },
})
```

The archive path is best-effort and non-blocking. It runs after log submission succeeds and uses the returned proof bundle, so the archive can reject uncommitted bodies. When OAuth evidence capture is enabled, only `authorizationEvidence` and `resolvedFacts` are sent with the archive submission. The middleware does not send local sidecar `args` or `result` fields to the archive.

### Parent-child threading

Per [D115](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d115-agent-to-subagent-handoff-uses-a-three-signal-producer-bundle), a parent producer that has already signed the spawn record for a child should pass the same-session subagent env bundle:

```typescript
import { buildSubagentProducerEnv } from '@atrib/mcp'

const childEnv = buildSubagentProducerEnv({
  contextId: parentContextId,
  parentRecordHash: parentDispatchRecordHash,
  baseEnv: process.env,
})
```

The helper sets `ATRIB_CONTEXT_ID=<parent-context-id>`, `ATRIB_CHAIN_TAIL_<parent-context-id>=<latest-tail-record-hash>`, and `ATRIB_PARENT_RECORD_HASH=<parent-dispatch-record-hash>` when the inputs are canonical. Pass `chainTailRecordHash` when the latest tail differs from the parent dispatch hash. Shape validation is not existence lookup: pass a parent hash the caller just signed or verified, not a temp proof label or output commitment. `atrib()` reads `ATRIB_PARENT_RECORD_HASH` at middleware initialization. If the value is valid, the first successful wrapper-signed record adds it to `informed_by`. Failed tool calls do not consume the seed. The seed merges with `informedBy` and `autoDetectInformedByFromArgs`, dedupes, and signs in lexicographic order. Invalid values are ignored.

### Source-aware `informed_by` validation

Per [D116](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d116-producer-side-informed_by-validation-is-source-aware), `recordReferenceResolver` can validate refs before they enter a signed record. The resolver sees `recordHash`, `source`, `toolName`, `contextId`, and raw `params`. Refs from `informedBy` callbacks and structured auto-detect are kept only when the resolver returns true. Resolver errors drop the candidate and do not block the tool call.

`ATRIB_PARENT_RECORD_HASH` seeds are different: they are producer-owned spawn anchors and bypass resolver lookup because the parent can sign a dispatch record before the child-visible mirror or public log sees it.

Node hosts can use `defaultRecordReferenceResolver()` to check local mirrors under `ATRIB_AUTOCHAIN_SOURCE`, `ATRIB_MIRROR_FILE`, and `ATRIB_RECORDS_DIR` / `~/.atrib/records`, then fall back to log lookup. Pass `localLookupTimeoutMs` when the host needs a hard wall-clock budget for local mirror scanning. If the local scan times out and log lookup does not find the record, the resolver returns `unknown` so hosts can drop the ref without claiming it is absent. `recordHashExistsInMirror()` checks an explicit mirror file, useful when the host configured a custom `recordFile`.

Returns a `SubmissionQueue`-aware wrapper exposing:

- `flush()`: drain pending submissions before shutdown (idempotent)
- `getProof(recordHash)`: retrieve a cached proof bundle by record hash

### Local substrate coordinator contract

Per [P042](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#p042-local-substrate-coordinator-for-long-lived-and-multi-harness-dogfood), `@atrib/mcp` exports the shared request and health-report contract for optional host-owned local coordinators:

```typescript
import {
  LOCAL_SUBSTRATE_REQUEST_MODES,
  buildLocalSubstrateHealthReport,
  createHttpLocalSubstrateTransport,
  createInProcessLocalSubstrateCoordinator,
  validateLocalSubstrateRequest,
  tryLocalSubstrateCoordinator,
  probeLocalSubstrateHealth,
  validateLocalSubstrateHealthReport,
  validateLocalSubstrateResponse,
  hashLocalSubstrateRecordBody,
} from '@atrib/mcp'
```

These helpers let startup-spawn MCP wrappers, long-lived agents, and watcher WAL pipelines target one boundary before any coordinator becomes a runtime dependency. The invariant is strict: the coordinator request carries an unsigned `record_body`, and `hashLocalSubstrateRecordBody()` hashes the canonical body that the existing signing path would sign. Coordinator envelopes, health metadata, WAL join fields, request mode, and fallback policy never enter the signed record bytes.

`tryLocalSubstrateCoordinator()` is an opt-in client shim. Callers provide the transport, so Unix sockets, launchd-owned localhost services, containers, and tests can share the same validation path without pulling a daemon into this package. It validates the request before transport, validates the response against the request operation, and classifies outcomes as `accepted`, `rejected`, `invalid_request`, `invalid_response`, or `unavailable`. `createHttpLocalSubstrateTransport()` is the explicit JSON-over-HTTP helper for hosts that choose that transport.

`mode: "shadow_probe"` is the current startup-spawn rollout path. It asks the coordinator to validate and sign the exact unsigned body, return the hash, and skip coordinator-owned queue or mirror side effects. The middleware still signs, mirrors, and submits locally. This proves wrapper-to-coordinator reachability and record-byte equality without double-committing a record.

The `atrib()` middleware accepts an opt-in `localSubstrate` shadow option for this path. Library callers provide any `LocalSubstrateCoordinatorTransport`; `@atrib/mcp-wrap` exposes the first JSON config path through `createHttpLocalSubstrateTransport()`.

`createInProcessLocalSubstrateCoordinator()` is the first opt-in prototype for startup-spawn trials. It exposes a coordinator transport without creating a daemon, signs only when the unsigned body's `creator_key` matches the coordinator signer, returns the real `record_hash` and receipt token, accepts caller-owned health counters, and leaves log submission optional for tests. Its default harness scope is `startup-spawn`; long-lived agents and watcher WAL paths need their own rollout evidence before they are enabled.

`buildLocalSubstrateHealthReport()` and `probeLocalSubstrateHealth()` build read-only rollout-gate reports for queue depth, WAL join state, active contexts, wrapper counts, and stale child counts. Probe warnings are advisory. They do not change signing, submission, or primary tool-call behavior.

### `createAtribProxy(options): Promise<AtribProxy>`

In-process surrogate `McpServer` that forwards every tool call to an upstream MCP server and attributes them at the proxy layer. Used by the Claude Agent SDK adapter (Case B) and any host that accepts a real `McpServer` instance but where the actual tools live in a third-party MCP server. See `packages/integration/examples/claude-agent-sdk/case-b-third-party-mcp.ts` for the full pattern.

### Lower-level primitives

For advanced use cases (custom transports, manual signing, recommendation calculation), the package also exports the cryptographic and serialization primitives directly: `signRecord`, `signTransactionRecord`, `signTransactionAttestation`, `verifyRecord`, `canonicalRecord`, `canonicalCrossAttestationInput`, `computeContentId`, `genesisChainRoot`, `chainRoot`, `encodeToken`, `decodeToken`, `base64urlEncode`, `base64urlDecode`, `sha256`, `hexEncode`, `hexDecode`, plus event-type helpers (`EVENT_TYPE_SHORT_NAMES`, `EVENT_TYPE_SHORT_TO_URI`, `normalizeEventType`), the W3C trace-context helpers (`readInboundContext`, `writeOutboundContext`, `parseTracestateAtrib`, `parseBaggageAtribSession`, `extractTraceId`, `mergeTracestate`, `mergeBaggageAtribSession`), the record-reference helpers (`SHA256_REF_PATTERN`, `extractRecordHashes`, `extractRecordReferenceCandidates`, `ATRIB_PARENT_RECORD_HASH_ENV`, `parentRecordHashFromEnv`, `defaultRecordReferenceResolver`, `recordHashExistsInMirror`), the subagent env helpers (`ATRIB_CONTEXT_ID_ENV`, `chainTailEnvName`, `buildSubagentProducerEnv`), the harness session-id discovery helpers per [D083](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers) (`resolveEnvContextId`, `KNOWN_HARNESS_DISCOVERIES`), the read-primitive instrumentation helpers per [D084](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d084-read-primitive-instrumentation-for-empirical-loop-closure-measurement) (`logReadPrimitiveCall`, `extractRecordHashesFromMcpResult`), the P042 local-substrate helpers (`LOCAL_SUBSTRATE_REQUEST_MODES`, `validateLocalSubstrateRequest`, `validateLocalSubstrateResponse`, `validateLocalSubstrateHealthReport`, `hashLocalSubstrateRecordBody`, `tryLocalSubstrateCoordinator`, `createHttpLocalSubstrateTransport`, `createInProcessLocalSubstrateCoordinator`, `buildLocalSubstrateHealthReport`, `probeLocalSubstrateHealth`), the normative content-shape extractors per [D086](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d086-bm25-corpus-extended-from-annotations-to-per-event_type-record-content) (`extractIndexableText`, per-event_type extractors and type defs, see the dedicated section below), and the submission queue itself (`createSubmissionQueue`).

### Read-primitive instrumentation ([D084](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d084-read-primitive-instrumentation-for-empirical-loop-closure-measurement) Surface 6)

`logReadPrimitiveCall` wraps any read-primitive MCP handler with per-call instrumentation so a host-side unified analyzer (Surface 9, an `analyze-substrate.mjs` script in the host integration's hook layer; not on npm) can correlate surfacing → reads → writes empirically. Each call appends one jsonl line to `~/.atrib/state/read-primitives/calls.jsonl`:

```ts
import { logReadPrimitiveCall, extractRecordHashesFromMcpResult } from '@atrib/mcp'

server.registerTool(
  'my_read_tool',
  {
    /* ... */
  },
  async (args) =>
    logReadPrimitiveCall(
      'my_read_tool',
      args,
      async () => handlerImpl(args),
      extractRecordHashesFromMcpResult, // or a tighter caller-supplied extractor
    ),
)
```

Wire schema (stable for analyzer consumption):

```json
{
  "invoked_at": 1779527000000,
  "session_id": "ef8150a232f140739bec66122aeeda1a",
  "primitive": "recall_my_attribution_history",
  "query_shape": ["context_id", "limit"],
  "result_count": 25,
  "elapsed_ms": 312,
  "sample_result_hashes": ["sha256:...", "sha256:..."],
  "errored": false
}
```

- `session_id` comes from `resolveEnvContextId()` (32-hex; matches read-primitive responses and fires.jsonl after strip).
- `query_shape` lists the input keys the caller set (truthy values only); captures shape without leaking values.
- `result_count` is the total record-hash count in the response, or `null` when the handler errored OR the result shape is not extractable. The companion `errored` field distinguishes the two cases.
- `sample_result_hashes` caps at 10 entries; supplied extractor controls which hashes get sampled. The default `extractRecordHashesFromMcpResult` deep-walks the MCP tool response for any `sha256:<64-hex>` reference and dedupes.
- Silent-failure per [§5.8](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#58-degradation-contract): instrumentation never blocks the primary tool path; write errors are swallowed.
- `ATRIB_READ_PRIMITIVES_LOG` env var overrides the default jsonl path (used by tests).

The three read-primitive servers (`@atrib/recall` family, `@atrib/trace`, `@atrib/summarize`) already wrap their handlers with this helper at version `@atrib/mcp@0.10.0+`. New read-primitive tools should follow the same pattern per the DOC-SYNC-TRIGGERS entry for Surface 6.

### Normative content-shape contracts ([D086](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d086-bm25-corpus-extended-from-annotations-to-per-event_type-record-content))

Per spec [§1.2](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#12-record-format), `AtribRecord` carries structural metadata only. The actual content body lives in the local mirror's [D062](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d062-local-mirror-sidecar-two-tier-private-local--public-canonical-persistence) sidecar at `_local.content`. The shape of that content varies per event_type (observation has `{ what, why_noted, topics }`; tool_call has `{ tool_name, args, result }`; etc.). Before [D086](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d086-bm25-corpus-extended-from-annotations-to-per-event_type-record-content), each consumer that wanted to read sidecar content reimplemented per-event_type parsing. The `content-shapes` module codifies the shape contract once so producers and consumers round-trip via the same definition.

```ts
import {
  extractIndexableText,
  type ObservationContent,
  type AnnotationContent,
  type RevisionContent,
  type ToolCallContent,
  type TransactionContent,
  type DirectoryAnchorContent,
  type ExtractIndexableTextOptions,
  DEFAULT_FIELD_CAP,
} from '@atrib/mcp'

// Dispatch on the record's event_type URI; returns a flat string of indexable
// text suitable for tokenization (BM25, embeddings) or display synthesis.
const text = extractIndexableText(
  record.event_type, // 'https://atrib.dev/v1/types/observation' etc.
  record.sidecar.content, // typed as `unknown`; runtime shape-checking handles malformed input
  { fieldCap: 2048 }, // optional; defaults to DEFAULT_FIELD_CAP
)
```

Per-event_type extraction (also exported individually for callers that know the event_type at compile time):

| event_type         | Indexable fields                                                                       | Function                                                 |
| ------------------ | -------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `observation`      | `what + why_noted + topics`                                                            | `extractObservationText(content, fieldCap)`              |
| `annotation`       | `summary + topics`                                                                     | `extractAnnotationText(content, fieldCap)`               |
| `revision`         | `prior_position + new_position + reason + topics`                                      | `extractRevisionText(content, fieldCap)`                 |
| `tool_call`        | `tool_name + args/input/arguments + result/output/response` (JSON-stringified, capped) | `extractToolCallText(content, fieldCap)`                 |
| `transaction`      | counterparty + memo + protocol fields                                                  | `extractTransactionText(content, fieldCap)`              |
| `directory_anchor` | `tree_root + epoch_id`                                                                 | `extractDirectoryAnchorText(content, fieldCap)`          |
| extension URI      | generic recursive string-walk (depth ≤ 4, `DEFAULT_FIELD_CAP=2048` per field)          | (internal; falls out of `extractIndexableText` dispatch) |

The shapes are normative. Producers that emit these event_types are expected to write content matching the documented field names; consumers can rely on them. Extension URI producers SHOULD adopt one of the recognizable normative-shape field names (`what`, `why_noted`, `summary`, `description`, `topics`) so the generic walker picks them up naturally, OR call `atrib-annotate` on important records to lift them via the curator path. Per-field length caps prevent giant tool_call payloads from dominating the corpus; field-length defaults to `DEFAULT_FIELD_CAP` (2048 chars).

`@atrib/recall@0.11.0+` uses `extractIndexableText` to build its BM25 corpus; before [D086](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d086-bm25-corpus-extended-from-annotations-to-per-event_type-record-content) it indexed only annotation summaries. `@atrib/trace@0.5.0+` uses the same shapes in `summarizeSidecar` to surface revision content alongside observation `what` and annotation `summary`.

### Harness discovery: env-var + file-fallback ([D083](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers) v1 + v2)

`resolveEnvContextId` derives a default `context_id` for cognitive-primitive MCP servers (`@atrib/emit`, `@atrib/recall`, `@atrib/trace`, `@atrib/summarize`) when the caller omits one. Precedence:

1. `ATRIB_CONTEXT_ID` env ([D078](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default); explicit operator/harness intent).
2. For each entry in `KNOWN_HARNESS_DISCOVERIES`:
   - `discovery.envVar` in env ([D083](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers) v1; per-session-spawn harnesses like Inspect arms).
   - `discovery.fallbackFile()` readable + parseable ([D083](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers) v2; startup-spawn harnesses like Claude Code).
3. `undefined` (caller falls through to its own resolution chain).

The `HarnessDiscovery` interface:

```ts
interface HarnessDiscovery {
  envVar: string // documented env var name
  fallbackFile?: () => string // optional, returns per-instance state file path
  parse(value: string): string | null // env or file value → 32-hex or null
}
```

The file-fallback path is for harnesses that spawn MCP children at process startup, before any per-session env exists. The harness's hook layer (operator-side) writes the state file from a session-aware context; the registry entry's `fallbackFile` thunk returns the matching path. File-read constraints: maximum 128 bytes, trimmed whitespace, silent failure on all errors.

The included Claude Code entry uses `~/.claude/state/active-session-id-${process.ppid}` (per-PPID keyed so concurrent Claude Code instances don't collide). The matching writer is a SessionStart-equivalent hook in the host's hook layer; the writer reads `CLAUDE_CODE_SESSION_ID` from its env (Claude Code provides it to hook subprocesses) and writes the file atomically.

Adding a new harness: add a registry entry. If the harness spawns MCP children per-session, set only `envVar`. If at startup, add `fallbackFile` and ship a corresponding writer in the harness's host integration (typically a SessionStart-equivalent hook).

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

| Route                                 | Method    | Behavior                                                                            |
| ------------------------------------- | --------- | ----------------------------------------------------------------------------------- |
| `GET /.well-known/atrib-policy.json`  | GET, HEAD | Returns policy with `Cache-Control: max-age=300`, or 404 if no policy configured    |
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

The test suite covers:

- Wire-format conformance to spec [§2.6.1](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#261-submit-entry) + [§2.6.2](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#262-inclusion-proof-response)
- Wycheproof Ed25519 test vectors (signing/verification)
- Offline adversarial signing vectors for malformed records, bit-flipped signatures, truncated signatures, wrong creator keys, and JCS optional-field ordering
- JCS canonicalization edge cases (RFC 8785)
- Transaction cross-attestation signing and counterparty signer entries via `signTransactionRecord()` and `signTransactionAttestation()`
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

| Spec section                                                                                                | What this package implements                                               |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [§1.2](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#12-the-attribution-record)             | Attribution record format                                                  |
| [§1.3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#13-canonical-serialization)            | JCS canonicalization (RFC 8785)                                            |
| [§1.4](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#14-signing-and-verification)           | Ed25519 signing and verification                                           |
| [§1.5](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#15-context-propagation)                | Context propagation via `params._meta`, tracestate, baggage, X-atrib-Chain |
| [§2.6.1](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#261-submit-entry)                    | Submission API client (POST a bare signed record)                          |
| [§2.6.2](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#262-inclusion-proof-response)        | Proof bundle response shape                                                |
| [§5.3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#53-atribmcp-mcp-server-middleware)     | Server-side middleware behavior                                            |
| [§5.3.3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#533-record-construction-and-signing) | No emission for `isError: true`                                            |
| [§5.3.5](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#535-log-submission)                  | Non-blocking submission queue, proof cache, HTTP proof endpoint            |
| [§5.3.6](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#536-policy-exposure)                 | Policy exposure via HTTP endpoint and stdio serverInfo                     |
| [§2.8](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#28-proof-bundle-format)                | Proof bundle text format (C2SP tlog-proof serialization and parsing)       |
| [§5.6.3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#563-key-storage-requirements)        | Key storage: memory zeroing via `zeroize()` and `destroy()` on AtribServer |
| [§5.8](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#58-degradation-contract)               | Degradation contract; failures never break the host                        |

The full protocol spec is at [`atrib-spec.md`](https://github.com/creatornader/atrib/blob/main/atrib-spec.md).

## See also

- [`@atrib/agent`](https://github.com/creatornader/atrib/blob/main/packages/agent/README.md), the client-side counterpart for agents calling MCP tools
- [`@atrib/verify`](https://github.com/creatornader/atrib/blob/main/packages/verify/README.md), independent verification of settlement recommendations
- [`@atrib/log-dev`](https://github.com/creatornader/atrib/blob/main/packages/log-dev/README.md), development-mode Merkle log stub for local testing
- [`packages/integration/examples/end-to-end/`](https://github.com/creatornader/atrib/blob/main/packages/integration/examples/end-to-end/), runnable demo wiring everything together
- [`DECISIONS.md`](https://github.com/creatornader/atrib/blob/main/DECISIONS.md), architectural decision log

---

> **A note on documentation links.** The atrib protocol repository is currently private (in-progress public preparation). Links in this README to the spec and sister packages (`atrib-spec.md`, `packages/agent/README.md`, etc.) point at `github.com/creatornader/atrib/blob/main/...` URLs that will resolve once the repository goes public. Until then, see [`atrib.dev`](https://atrib.dev) for the protocol overview.
