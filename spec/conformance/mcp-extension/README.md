# atrib `dev.atrib/attribution` MCP-extension conformance corpus

Test fixtures for the `dev.atrib/attribution` v0.1 MCP extension per spec
[§1.5.4](../../../atrib-spec.md#154-mcp-transport-params_meta) (the P049
mcp-extension ADR, extending
[D018](../../../DECISIONS.md#d018-w3c-trace-context-and-baggage-conformance-leftmost-atrib-lenient-parse-evict-from-end-on-overflow)
and the
[D067](../../../DECISIONS.md#d067-multi-producer-chain-composition-precedence-contract)
chain-composition contract). The extension specification itself is
[`docs/extensions/dev.atrib-attribution/v0.1.md`](../../../docs/extensions/dev.atrib-attribution/v0.1.md).

The corpus is the shared contract between every implementation of the
extension's client or server side, in any language, with no atrib package
required: `@atrib/mcp` (server side), `@atrib/agent` (client side),
`@atrib/mcp-wrap` (the shim for non-adopting upstreams), and any third-party
server that declares the capability directly. No signed byte of any record
changes anywhere in this corpus. The extension gates only discovery and
carriage. Chain-root semantics below the inbound-token rung remain pinned by
[`spec/conformance/1.2.3/multi-producer/`](../1.2.3/multi-producer/), which
these vectors compose with.

## Case families

| Family | Asserts |
|---|---|
| `capability--*` | Settings-object validity for both sides: `version` is the only REQUIRED field; unknown settings fields and unknown `accept` values MUST be ignored; an unrecognized `version` under the same identifier is still a declaration (breaking changes require a new identifier per SEP-2133); missing `version` means undeclared, never an error; the reserved-prefix identifier rule (`mcp` / `modelcontextprotocol` labels). |
| `gating--*` | Receipt opt-in gating: the prefixed result block appears ONLY when the client declared the extension on that request; `accept: ["token"]` omits the record body; undeclared and malformed declarations degrade to result `_meta` byte-identical to pre-extension `writeOutboundContext` output (pinned by JCS hash). |
| `token--*` | Ladder 1 (inbound propagation token): `_meta["dev.atrib/attribution"].token` > `_meta.atrib` > `tracestate` `atrib=` > `X-Atrib-Chain`. Conflicting carriers resolve to the extension key with a warning; a malformed extension token falls through (lenient parse per [D018](../../../DECISIONS.md#d018-w3c-trace-context-and-baggage-conformance-leftmost-atrib-lenient-parse-evict-from-end-on-overflow)); all carriers stripped continues down the [§1.2.3.1](../../../atrib-spec.md#1231-multi-producer-chain-composition) ladder. |
| `context--*` | Ladder 2 (context identity): explicit tool argument > extension `context_id` > `traceparent` trace-id > [D078](../../../DECISIONS.md#d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default)/[D083](../../../DECISIONS.md#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers) env-file registry > undefined. Non-32-lowercase-hex extension values fall through; unknown block fields (including `session_token` / `provenance_token` from a nonconforming peer) are ignored with no record-field effect. |
| `receipt--*` | Receipt integrity against REAL Ed25519-signed records: `token` = `encodeToken(record)`, `record_hash` recomputes from `sha256(JCS(record))`, `creator_key` matches the signer, `args_hash` recomputes from the pinned tool args, the record signature verifies independently (Tier-3); a mismatched receipt is discarded without invalidating the tool result; `log_submission` is a closed queue-status enum, never an awaited proof ([§5.3.5](../../../atrib-spec.md#535-log-submission)). |
| `degradation--*` | [§5.8](../../../atrib-spec.md#58-degradation-contract): forced signing failure and forced capability-read failure both leave the tool result byte-identical to passthrough (pinned by JCS hash) with no error; a request with no `_meta` at all never blocks the call and yields a genesis record per [§1.2.3](../../../atrib-spec.md#123-chain_root-for-genesis-records). |

## Cases

| File | Asserts |
|---|---|
| `cases/capability--server-declaration-valid.json` | Full server settings object accepted; advisory fields untrusted. |
| `cases/capability--client-declaration-valid.json` | Client per-request declaration with `accept: ["token","record"]`. |
| `cases/capability--unknown-settings-fields-ignored.json` | Unknown settings fields, unknown accept values, and an unrecognized version are all tolerated. |
| `cases/capability--missing-version-rejected.json` | Missing `version` → undeclared, no protocol error. |
| `cases/capability--reserved-prefix-rejected.json` | Identifier grammar + reserved-label rule over five identifiers. |
| `cases/gating--declared-receipt-present.json` | Declared → prefixed block (token + receipt + record) alongside byte-identical legacy keys. |
| `cases/gating--declared-token-only.json` | `accept: ["token"]` → receipt present, record body omitted. |
| `cases/gating--undeclared-legacy-only.json` | Undeclared → legacy keys only, pinned byte-identical to pre-extension output. |
| `cases/gating--malformed-clientcapabilities-undeclared.json` | Malformed declaration treated as undeclared, no error. |
| `cases/token--extension-key-wins.json` | Four conflicting carriers → extension key wins with warning. |
| `cases/token--malformed-extension-falls-through.json` | Malformed extension token → falls through to `_meta.atrib`. |
| `cases/token--meta-atrib-over-tracestate.json` | Legacy order preserved beneath the extension rung. |
| `cases/token--tracestate-over-x-atrib-chain.json` | tracestate beats the fallback header carrier. |
| `cases/token--x-atrib-chain-fallback.json` | Last-rung fallback resolves alone. |
| `cases/token--all-carriers-stripped.json` | No carriers → chain resolution continues per [D067](../../../DECISIONS.md#d067-multi-producer-chain-composition-precedence-contract); genesis chain_root pinned. |
| `cases/context--explicit-argument-wins.json` | Application intent beats transport metadata ([D135](../../../DECISIONS.md#d135-delegated-builder-atrib-context-threads-via-orchestrator-injected-explicit-args) posture). |
| `cases/context--extension-over-traceparent.json` | Extension `context_id` beats the trace-id, with warning. |
| `cases/context--invalid-extension-hex-falls-through.json` | Non-32-hex extension value ignored, falls to traceparent. |
| `cases/context--no-carrier-env-fallthrough.json` | Transport yields nothing → producer-side [D078](../../../DECISIONS.md#d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default)/[D083](../../../DECISIONS.md#d083-harness-session-id-discovery-extends-d078d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default-for-cognitive-primitive-mcp-servers) resolution. |
| `cases/context--unknown-fields-ignored.json` | Extra block fields ignored; no record-field effect beyond `context_id`. |
| `cases/receipt--consistent.json` | Fully consistent receipt over a real signed tool_call record. |
| `cases/receipt--hash-mismatch-flagged.json` | `record_hash` names a different real record → receipt discarded, tool result untouched. |
| `cases/receipt--log-submission-nonblocking.json` | `queued` receipt valid before submission settles; status enum pinned. |
| `cases/degradation--signing-failure-passthrough.json` | Forced signing failure → passthrough byte-identical, no error. |
| `cases/degradation--capability-read-failure-passthrough.json` | Forced capability-read failure → same passthrough. |
| `cases/degradation--missing-meta-never-blocks.json` | Total `_meta` loss → tool call proceeds, genesis chain. |

## Generator

`packages/log-dev/scripts/generate-conformance-mcp-extension.ts`. Run with:

```sh
pnpm --filter @atrib/log-dev exec tsx scripts/generate-conformance-mcp-extension.ts
```

Seeds and timestamps are hardcoded so successive regenerations produce
byte-identical files. All tokens, record hashes, signatures, and `args_hash`
commitments are real (Ed25519 over JCS-canonical bytes; sha256 via
`@noble/hashes`). Regenerate when:

- the extension request-block or receipt schema changes (requires a new
  settings version in the extension spec first)
- either canonical inbound ladder in
  [§1.5.4](../../../atrib-spec.md#154-mcp-transport-params_meta) changes
- canonical record format ([§1.2](../../../atrib-spec.md#12-the-attribution-record) / [§1.3](../../../atrib-spec.md#13-canonical-serialization)) changes
- a new test case is added

## Reference implementation

`packages/verify/test/conformance-mcp-extension.test.ts` loads each committed
case (never the generator) and asserts every expected field against a
reference implementation of both ladders, the gating rule, receipt
verification, and the degradation contract. Conforming third-party
implementations SHOULD load the same fixtures and assert the same invariants.

## Status

**Initial 26-case corpus shipped** across the six families named in the P049
mcp-extension ADR. Future cases (legacy-`initialize` capability carriage,
gateway `_meta` forwarding shapes, a future `session_token` /
`provenance_token` carriage revision with conflict rules) can be added by
extending the generator.
