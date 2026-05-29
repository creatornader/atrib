# `@atrib/integration` _(private)_

**Cross-package end-to-end tests and runnable framework examples for the atrib protocol. Not published to npm.**

This package exists for two purposes:

1. **Cross-package integration tests** that exercise `@atrib/mcp` + `@atrib/agent` + `@atrib/verify` + `@atrib/log-dev` together against real `@modelcontextprotocol/sdk` clients and servers; the kind of test that doesn't belong in any single public package because it would create circular dependencies or pull in dev-only deps.
2. **Runnable framework examples** showing how to wire atrib into every supported MCP host and runtime boundary: Claude Agent SDK, Cloudflare Agents, Vercel AI SDK, LangChain JS, the signer-proxy sandbox pattern, plus the standalone end-to-end demo.

If you're a customer trying to figure out how to plug atrib in, the examples here are the answer. If you're contributing to atrib, the tests here are how the cross-package contract is enforced.

## Try the end-to-end demo

The fastest way to see atrib working end-to-end in a single process:

```bash
ATRIB_PRIVATE_KEY=$(node -e 'console.log(Buffer.from(crypto.randomBytes(32)).toString("base64url"))') \
  pnpm --filter @atrib/integration demo
```

In ~150 lines of TypeScript, the demo runs a fake MCP merchant tool server (with `@atrib/mcp`'s `atrib()` middleware), a fake agent client (with `@atrib/agent`'s `wrapMcpClient`), an in-process Merkle log stub (`@atrib/log-dev`), and a stubbed x402 payment that triggers the production transaction-detection logic. Output is colorized chain-by-chain in your terminal:

```
[demo] starting dev log...
[demo] dev log running at http://127.0.0.1:55013
[log]  +tool_call   ctx=73df4367… chain=sha256:d5a8f8996… idx=0
[log]  +tool_call   ctx=73df4367… chain=sha256:7e5ae4b5b… idx=1
[log]  +transaction ctx=73df4367… chain=sha256:cda3d448c… idx=2
[demo] 3 records in the log (2 tool_call, 1 transaction)
```

Every signature, every chain hash, and every transaction event in that output is **real production code**. The fakery is in the surrounding environment (hardcoded merchant responses, stubbed x402 header); not in the protocol layer. See [`examples/end-to-end/README.md`](examples/end-to-end/README.md) for the full walkthrough.

## Examples

| Example                        | Path                                                         | What it shows                                                                                                                                                                                |
| ------------------------------ | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **End-to-end demo**            | [`examples/end-to-end/`](examples/end-to-end/)               | All moving parts in a single process: dev log + merchant + agent + payment + visualizer. Run with `pnpm demo`.                                                                               |
| **Claude Agent SDK**           | [`examples/claude-agent-sdk/`](examples/claude-agent-sdk/)   | Both Case A (in-process tools. wrap the SDK's `McpServer` with `atrib()`) and Case B (third-party MCP servers; proxy via `createAtribProxy`).                                                |
| **Cloudflare Agents**          | [`examples/cloudflare-agents/`](examples/cloudflare-agents/) | Both surfaces: server-side `McpAgent` (Surface 1) and client-side `Agent` calling upstream MCP servers (Surface 2), with live Worker proofs plus an interactive HITL approval-trace example. |
| **Vercel AI SDK + AI Gateway** | [`examples/vercel-ai-sdk/`](examples/vercel-ai-sdk/)         | Vercel AI SDK with MCP tools, routed through the AI Gateway (recommended pattern for model fallback + observability).                                                                        |
| **LangChain JS**               | [`examples/langchain-js/`](examples/langchain-js/)           | `MultiServerMCPClient` patched in-place by `attributeLangchainMcp` so every server it manages emits attributed records. including forked clients used for per-call header workflows.         |
| **Signer proxy**               | [`examples/signer-proxy/`](examples/signer-proxy/)           | Sandboxed-execution composition: sandbox code requests a signature, while the host signer keeps the Ed25519 key outside the sandbox and owns signer-controlled fields.                       |

Every example has a `README.md` next to it explaining what's wired up and which lines a real customer would copy.

## AP2 Live Interop

`@atrib/integration` includes an opt-in AP2 reference artifact harness for runs produced by `google-agentic-commerce/AP2` samples or a compatible AP2 participant.

Full upstream AP2 scenario launches are credential-gated and stay outside default CI. Do not commit `.env` files or API keys. A successful upstream run should be exported into the JSON artifact contract below, then checked through the same harness as local fixtures.

The harness does not start AP2 services in default CI. Instead, it reads AP2 result and evidence artifacts, then runs the production atrib detector and verifier:

```bash
ATRIB_AP2_INTEROP_RESULT_JSON=/path/to/ap2-result.json \
ATRIB_AP2_INTEROP_EVIDENCE_JSON=/path/to/ap2-vi-evidence.json \
ATRIB_AP2_INTEROP_TRANSACTION_RECORD_JSON=/path/to/atrib-transaction-record.json \
ATRIB_AP2_INTEROP_REQUIRE_COUNTERPARTY_ATTESTATION=1 \
ATRIB_AP2_INTEROP_NOW_SECONDS=1779840000 \
  pnpm --filter @atrib/integration ap2-live-interop
```

If a local command should create the artifacts first, pass it with `ATRIB_AP2_INTEROP_COMMAND`. Detection-only smoke checks may set `ATRIB_AP2_INTEROP_ALLOW_DETECTION_ONLY=1`, but full AP2 interop should include the evidence bundle so `verifyAp2ViEvidenceAsync()` runs off the detector path.

The transaction-record artifact is optional unless `ATRIB_AP2_INTEROP_REQUIRE_COUNTERPARTY_ATTESTATION=1` is set. When present, the harness runs `verifyRecord()`, checks the record `content_id` against the detected AP2 receipt identity, and requires `cross_attestation.missing: false`.

To create a local AP2 participant artifact set from an AP2 result and AP2 / VI evidence bundle, run:

```bash
pnpm --filter @atrib/integration ap2-local-participant \
  --result-json test/fixtures/ap2-vi-reference/ap2-vi-reference-result.json \
  --evidence-json test/fixtures/ap2-vi-reference/ap2-vi-reference-evidence.json \
  --out-dir /tmp/atrib-ap2-local-participant
```

The local participant generator rehydrates split JWT fixtures when needed, derives the AP2 transaction `content_id` through `detectTransaction()`, and writes `ap2-result.json`, `ap2-vi-evidence.json`, and `atrib-transaction-record.json`. The transaction record carries both an agent signer and a local counterparty signer over atrib's canonical transaction bytes. It is not a substitute for a real merchant/PISP signature, but it exercises the same `signers[]` path a real AP2 participant must use.

The fixture directory [`test/fixtures/ap2-reference/`](test/fixtures/ap2-reference/) contains compact AP2 receipt JWT artifacts generated from the official `google-agentic-commerce/AP2` Python SDK. Regenerate them from a local AP2 checkout with:

```bash
uv run --project /tmp/google-ap2-reference \
  python packages/integration/scripts/generate-ap2-reference-receipts.py \
  --ap2-repo /tmp/google-ap2-reference
```

Those fixtures exercise the AP2 SDK receipt-JWT path in default CI while keeping full AP2 scenario launches opt-in.

The fixture directory [`test/fixtures/ap2-vi-reference/`](test/fixtures/ap2-vi-reference/) combines the official AP2 Python SDK with the public `agent-intent/verifiable-intent` reference implementation. Regenerate it from local upstream checkouts with:

```bash
uv run --with cryptography --with jwcrypto --with pydantic \
  python packages/integration/scripts/generate-ap2-vi-reference-evidence.py \
  --ap2-repo /tmp/google-ap2-reference \
  --vi-repo /tmp/verifiable-intent-reference
```

That fixture creates L1, L2, and split L3 VI credentials through the VI reference library, verifies them with the upstream VI verifier, mints compact AP2 receipt JWTs through the AP2 SDK, and then feeds the combined artifact through atrib's live interop harness.

## Tests

Run with `pnpm --filter @atrib/integration test`. 48 tests across 13 files:

- **`test/end-to-end.test.ts`** (3 tests), full attribution chain across the public packages: agent calls a tool, server emits a signed record, the record's chain hash links to the previous step, the verifier re-runs the calculation against the resulting graph.
- **`test/ap2-vi-e2e.test.ts`** (3 tests), AP2 v0.2 receipt detection plus async `@atrib/verify` AP2 / Verifiable Intent evidence checking for immediate and autonomous flows. This protects the detector/verifier boundary: successful receipts close the transaction, VI mandates remain verifier-side authorization evidence with SD-JWT / VC conformance and mandate constraints checked off the detector path, AP2 Path 2 detection returns a receipt-derived `contentId` instead of the generic server URL fallback when stable receipt identity is present, and a real counterparty signer over atrib transaction bytes satisfies cross-attestation without treating AP2 receipt JWTs as signers.
- **`test/ap2-live-interop.test.ts`** (6 tests), opt-in AP2 reference artifact harness coverage. It proves AP2 reference-style result JSON plus AP2 / VI evidence JSON pass through `detectTransaction()` and `verifyAp2ViEvidenceAsync()`, transaction-record artifacts pass through `verifyRecord()` with counterparty attestation, mandates alone do not pass the transaction gate, and environment configuration fails early when malformed.
- **`test/ap2-local-participant.test.ts`** (1 test), local AP2 participant artifact generation. It proves an AP2 result plus AP2 / VI evidence bundle can be rehydrated into live interop artifacts and paired with a counterparty-signed atrib transaction record.
- **`test/ap2-reference-artifacts.test.ts`** (1 test), official AP2 Python SDK receipt artifacts. It proves compact receipt JWTs generated by `ap2.sdk.receipt_wrapper.ReceiptClient` and `ap2.sdk.jwt_helper.create_jwt` pass through the live interop harness, verify against caller-supplied JWKS roots, and compose with a counterparty-signed atrib transaction record.
- **`test/ap2-vi-reference-artifacts.test.ts`** (1 test), upstream AP2 plus VI reference artifacts. It proves VI credentials generated and verified by `agent-intent/verifiable-intent` compose with AP2 receipt JWTs generated and verified by the official AP2 SDK, including `cart.items[].sku` checkout payloads, `mandate.payment.reference`, SD-JWT core conformance, and counterparty-signed atrib transaction bytes.
- **`test/cloudflare-agent-packet.test.ts`** (1 test), Cloudflare Agent transaction packet coverage. It proves the replay-promotable Cloudflare packet can be verified as a Pattern 3-style handoff artifact before follow-up work cites it.
- **`test/pattern3-handoff.test.ts`** (9 tests), Pattern 3 receiving-side verification. It covers private continuation packets, body commitment checks, stale packet rejection, context mismatch handling, and transaction-packet verification through the `@atrib/verify` handoff surface.
- **`test/real-mcp-sdk.test.ts`** (2 tests), exercises both the wrapped MCP client and wrapped MCP server against a real `@modelcontextprotocol/sdk@1.29.0` transport, including the [§6](../../atrib-spec.md#6-key-directory) retroactive dispatcher wrap path and the `wrapMcpClient` adapter.
- **`test/full-chain.test.ts`** (3 tests), the wrapper → mirror → log → verify path with a real signed record set.
- **`test/resolve-identity-step7.test.ts`** (3 tests), real directory lookup plus verifier step 7 behavior around anchored identity evidence.
- **`test/conformance-3.2.4.test.ts`** (11 tests), demo-vs-production drift guard. The integration package's `src/graph-builder.ts` is the in-process graph builder used by `pnpm demo`, the calc-demo script, and the in-process end-to-end test. If it silently drifts from `services/graph-node`'s production derivation, the demo's chain-hash output misrepresents what production atrib infrastructure actually emits. This test runs every record fixture through BOTH implementations and asserts normalized edge sets, node sets, and per-node `verification_state` values match exactly. The 9-edge regression case at the bottom of the file is the load-bearing assertion: if any of the four producer-claim edges (INFORMED_BY, PROVENANCE_OF, ANNOTATES, REVISES, [D041](../../DECISIONS.md#d041-informed_by-linking-primitive-and-informed_by-edge-type), [D044](../../DECISIONS.md#d044-provenance_token-field-for-cross-session-causal-anchoring), [D058](../../DECISIONS.md#d058-promote-annotation-to-atrib-normative-event_type-byte-0x05), [D059](../../DECISIONS.md#d059-promote-revision-to-atrib-normative-event_type-byte-0x06)) silently drifts between the two implementations, the demo would start misrepresenting cognitive-primitive behavior, the surface customers care most about (atrib-emit, atrib-recall, atrib-trace, atrib-summarize).
- **`test/signer-proxy.test.ts`** (4 tests), [D102](../../DECISIONS.md#d102-sandboxed-signer-proxy-keeps-keys-outside-sandbox) sandbox signer-proxy example coverage. It proves sandbox code can request a tool-call signature without holding a private key, host signer policy runs before signing, signer-controlled fields supplied by the sandbox are rejected, and optional submission failure stays off the signing path.

**Honest framing on `conformance-3.2.4.test.ts`.** Both implementations are TypeScript, share `@atrib/mcp.canonicalRecord` for JCS, `@noble/hashes/sha2` for SHA-256, and `@atrib/mcp.verifyRecord` for Ed25519. Calling them "two independent implementations" in the spec's strongest sense would overstate the test's coverage; it catches algorithm-port errors and future drift between the two files, but it does not validate the spec against an independent reading of the prose or against an independent set of cryptographic primitives. Cross-language conformance against the `spec/conformance/3.4.1/` and `spec/conformance/3.4.5,6,7/` corpora is a separate later effort that lands when an external integrator writes a non-TS implementation and validates against the corpus without help from this codebase.

These tests are deliberately small in number; most behavior is covered by the per-package unit tests (391 total across the workspace). The integration tests are the **cross-package contract** layer: they catch the kind of bug that happens when one package's wire format quietly drifts from another's expectations.

## Why this package is private

`@atrib/integration` will never be published to npm because:

- It depends on `@atrib/log-dev`, which is also private and intentionally never published.
- It pulls in every public atrib package as a workspace dependency, plus `@modelcontextprotocol/sdk`, plus framework SDKs as dev deps. None of that should ship to a customer.
- The examples are reference material, not a library; customers should copy the patterns into their own code, not depend on this package.

The `"private": true` in `package.json` enforces this; `pnpm publish` will refuse to publish it.

## How customer conversations use this package

When a prospective customer (Exa, Firecrawl, Browserbase, a checkout-tool builder, etc.) asks how atrib actually works:

1. Run `pnpm --filter @atrib/integration demo` in front of them.
2. Watch the colored chain hashes scroll past.
3. Walk them through which lines of code they'd add on the merchant side (~3 lines: import, wrap, set log endpoint) and on the agent side (~2 lines: import, wrap with `wrapMcpClient` or the framework adapter).
4. Open the example matching their stack and show them the integration point.
5. Switch to the production answer: "the dev log is for local development; the production log is `log.atrib.dev/v1`, Tessera-backed per spec [§2](../../atrib-spec.md#2-merkle-log-protocol); same wire format, no client changes needed when it ships."

The examples make the abstract protocol concrete in a way that the spec and the package READMEs cannot.

## See also

- [`@atrib/mcp`](../mcp/README.md), server-side middleware
- [`@atrib/agent`](../agent/README.md), agent-side interceptor + all framework adapters
- [`@atrib/verify`](../verify/README.md), merchant verification
- [`@atrib/log-dev`](../log-dev/README.md), in-memory dev Merkle log stub used by the demo
- [`atrib-spec.md`](../../atrib-spec.md), the protocol specification
- [`DECISIONS.md`](../../DECISIONS.md), architectural decision log
