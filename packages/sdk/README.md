# @atrib/sdk

Consolidated atrib client SDK. Two verbs over the substrate: **`attest()`**
(write) and **`recall()`** (read), plus the complete [§1](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#1-attribution-record-format) record layer
re-exported from `@atrib/mcp`, so application code needs exactly one import.

This package is a consolidation, not a greenfield: it adds **no new
canonicalization, hashing, or signing implementation**. Every write
terminates in `@atrib/emit`'s `handleEmit` pipeline (records are
byte-identical to wrapper-signed and primitive-signed records), and every
cryptographic primitive is the existing `@atrib/mcp` one.

## Install

```bash
pnpm add @atrib/sdk
```

Version 0.1.0 is first-published manually. Later releases use npm Trusted
Publisher through `release.yml`. `@atrib/recall`, `@atrib/verify`, and
`@atrib/verify-mcp` are optional peers. Install them alongside for the
in-process recall and verify fallbacks. Without them, those paths degrade to
a typed unavailable outcome per the degradation contract below.

Verify a local build with `pnpm --filter @atrib/sdk test`.

## Topology: daemon-first

Per [D120](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d120-local-substrate-coordinator-keeps-startup-spawn-sidecars-wrapper-owned) and the redesign upgrade path, the local primitives runtime is the
default peer. The SDK talks MCP Streamable HTTP to it
(`$ATRIB_PRIMITIVES_HTTP_ENDPOINT`, default `http://127.0.0.1:8796/mcp`)
and falls back to in-process engines when no daemon is reachable:

| Verb | Daemon path | In-process fallback |
| --- | --- | --- |
| `attest()` | `emit` tool (daemon-owned key) | `emitInProcess()` from `@atrib/emit` (caller-owned key) |
| `recall({shape: 'history'})` | `recall_my_attribution_history` | `recall()` from `@atrib/recall` (optional peer) |
| `recall({shape: 'verify'})` | `atrib-verify` | `handleAtribVerify()` from `@atrib/verify-mcp` (optional peer) |
| other recall shapes | matching runtime tool | degraded warning outcome (v0) |

`@atrib/recall` and `@atrib/verify-mcp` are **optional peer dependencies**
loaded lazily (the P047 pattern): without them installed, those two
in-process fallbacks degrade to a typed unavailable outcome with a
warning instead of an import failure. `@atrib/emit` stays a hard
dependency so the write path always works.

The SDK is **semantically stateless** (stateless-MCP-native posture):
`context_id` and chain tokens are explicit per-request values; nothing
rides on the MCP protocol session, which remains a transport detail of the
current runtime until the 2026-07-28 stateless transport ships.

## Usage

```ts
import { createAtribClient } from '@atrib/sdk'

const client = createAtribClient()

// Write: observation (default), or annotate/revise via ref.kind
const result = await client.attest({
  content: { what: 'chose sqlite over postgres', why_noted: 'deployment constraint' },
})

await client.attest({
  content: { summary: 'supersedes the sqlite decision', reason: 'scale changed' },
  ref: { kind: 'revises', record_hash: result.record_hash! },
})

// Read: one verb, shape-discriminated
const history = await client.recall({ shape: 'history', limit: 10 })
const walk = await client.recall({ shape: 'walk', from_record_hash: result.record_hash! })

await client.close()
```

`summarize` is deliberately **not** a recall shape: synthesis belongs to
the calling harness/model; the SDK returns verified raw material.

## Degradation contract ([§5.8](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#58-degradation-contract))

Operational failures never throw and never block. If the daemon is
unreachable, the SDK falls back to in-process engines. If there is no
signing key, it returns a pass-through result with a warning. Log
submission is non-blocking with bounded retry, through the existing
`@atrib/mcp` submission queue. The only throw paths are contradictory
inputs (programmer error), such as `ref.kind: 'revises'` with
`event_type: 'annotation'`.

## Anchors ([D138](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d138-anchor-plurality-as-the-default-trust-posture), [§2.11.7-§2.11.13](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#2117-anchors-generalizing-the-replication-target))

`anchors` config takes a **set** of anchor descriptors: bare strings
(atrib-log [§2.6.1](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#261-submit-entry)
endpoints) or `{ url | endpoint, anchor_type?, ... }` objects covering
the [§2.11.8](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#2118-anchor-type-registry)
registry (`atrib-log`, `sigstore-rekor`, `rfc3161-tsa`,
`opentimestamps`). In-process attests fan out to **every** configured
anchor through `@atrib/mcp`'s `createAnchorFanout` (fire-and-forget per
[§5.3.5](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#535-log-submission)).
No anchor config at all resolves to `BUILT_IN_DEFAULT_ANCHOR_SET` (two
independent anchors, [§2.11.12](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#21112-producer-side-anchor-posture)
rule 1). A sub-plurality set (fewer than two anchors) warns and writes the
`_local.anchor_config` sidecar degradation marker unless
`allowSingleAnchor: true` states it is deliberate. The resolved posture
surfaces as `anchor_posture` on `AttestResult`, and `flushAnchors()` gives a
bounded wait on pending legs. Anchoring never touches signed bytes and
never blocks the write.

## Extension receipts (opt-in)

With `attributionReceipts: true`, the daemon client parses
`dev.atrib/attribution` attestation receipts from tool results' `_meta`
([D141](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d141-devatribattribution-first-class-mcp-extension-sep-2133),
extension v0.1): the propagation token, a receipt naming the record the
server already signed (`log_submission` is a queue status, never an
awaited proof), and optionally the full signed record for immediate
Tier-3 re-verification. Each parsed block is run through `@atrib/mcp`'s
`verifyAttributionReceipt` (extension spec [§6.2](https://github.com/creatornader/atrib/blob/main/docs/extensions/dev.atrib-attribution/v0.1.md#62-receipt-block) integrity check) and
surfaces as `attribution_receipt: { block, verification }` on
attest/recall results. Receipts are advisory. Trust derives from
verifying signed records, never from the receipt.

## Evidence envelopes ([D137](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d137-universal-evidence-envelope-as-the-single-protocol-level-attachment-model), [§5.5.7](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#557-universal-evidence-envelope))

The universal envelope (profile type URI, four-tier ladder `declared →
shape → attested → verified`, payload commitment, verifier facts) is the
single attachment model for external evidence; the legacy `protocol`
string set is frozen. The SDK ships the structural types/helpers plus
production and validation: `buildEvidenceEnvelope` computes the payload
commitment (JCS or raw hash rule) and `validateEvidenceEnvelope` applies
the normative shape rules. Both delegate to the optional peer
`@atrib/verify` and degrade with a warning when it is not installed.
Envelopes live outside signed bytes (mirror sidecar, archive evidence
projection, verifier results, host-owned packets).

## API reference

Everything below is exported from the package root (`import { … } from
'@atrib/sdk'`). The surface splits into the SDK layer (the two verbs, the
config, the daemon transport, the hash helpers, the evidence and receipt
types) and the record layer re-exported verbatim from `@atrib/mcp` and
`@atrib/emit`.

### `createAtribClient(config?)` → `AtribClient`

Builds a client from an [`AtribClientConfig`](#atribclientconfig)
(default `{}`). Construction is cheap and never throws on operational
problems: the daemon connection is lazy (first call), the in-process
signing key resolves lazily on the first attest that needs it, and anchor
normalization collects warnings instead of erroring.

```ts
interface AtribClient {
  attest(input: AttestInput): Promise<AttestResult>
  recall<T = unknown>(query: RecallQuery): Promise<RecallOutcome<T>>
  flushAnchors(): Promise<void> // bounded wait on pending anchor legs; never throws
  close(): Promise<void>
}
```

**Throw vs degrade.** Both verbs follow the
[§5.8](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#58-degradation-contract)
degradation contract: operational failures (daemon unreachable, tool
error, missing key, missing optional peer, log unreachable) never throw.
They degrade into `warnings` on the result, with `via: 'none'` when
nothing could serve the call. The only throw paths are contradictory or
malformed **inputs** (programmer error): a `ref.kind` that contradicts an
explicit `event_type`, an unknown `ref.kind`, an unknown recall `shape`,
or an input shape that fails `emitInProcess`'s schema validation.

**`attest(input)` semantics.** Maps `AttestInput` to the shared
`EmitInput` argument shape via `buildEmitArgs` (exported; throws
`TypeError` on contradictory input, the write verb's only throw path),
then tries paths in order:

1. **Daemon** (`daemon.mode` `'prefer'` or `'require'`): calls the `emit`
   tool on the primitives runtime. The daemon owns the signing key. A
   structurally-garbage daemon result (no `record_hash` string) counts as
   a daemon failure, not a silent all-null success.
2. **In-process** (`'prefer'` after a daemon failure, or `'off'`): resolves
   the caller-owned key (see `key` in
   [`AtribClientConfig`](#atribclientconfig)) and calls `emitInProcess`
   from `@atrib/emit` with the configured `producer` and the primary
   atrib-log anchor as `logEndpoint`, then reads the freshly signed
   record back from the mirror tail and fans it out to every configured
   anchor via `createAnchorFanout`
   ([D138](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d138-anchor-plurality-as-the-default-trust-posture);
   fire-and-forget per [§5.3.5](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#535-log-submission);
   the primary log receiving the record twice is idempotent-safe per
   [§2.6.1](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#261-submit-entry)
   step 6), stamping the resolved `anchor_posture` on the result. Without a
   key, the SDK returns a pass-through result (`via: 'none'`, `record_hash: null`) with a
   warning, per
   [§5.8](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#58-degradation-contract)
   rule 5. The daemon path never consults the client's fan-out: the
   daemon owns its own anchors.

Under `daemon.mode: 'require'`, a daemon failure returns the degraded
`via: 'none'` result directly. It never falls back and never throws.

**`recall(query)` semantics.** Resolves the shape (`query.shape`, default
`'history'`), maps it to the physical tool name via `SHAPE_TO_TOOL`
(exported), strips the SDK-only `shape` discriminator and `undefined`
values, and injects the client's default `context_id` for the
`session_chain` and `orphans` shapes when the query omits it. Then:
daemon first; on failure, the in-process fallback for the two shapes
whose engines are exported as libraries today (`history`, `verify`);
every other shape degrades to `via: 'none'` with a warning naming the
runtime tool to use instead. See the
[shape table](#recallquery-shapes) for the full routing.

**`close()`** closes the daemon transport if one was opened. Best-effort;
never throws. Safe to call when `daemon.mode` was `'off'`.

### `AttestInput` / `AttestRef`

One write shape collapsing emit / annotate / revise. `ref` is the
discriminator:

```ts
interface AttestRef {
  kind: 'annotates' | 'revises'
  record_hash: string // sha256:<64-hex>
}
```

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `content` | `Record<string, unknown>` | yes | The content being attested. Committed via default `args_hash` = `sha256(JCS(content))` per [D099](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d099-explicit-emit-records-commit-local-content-through-default-args_hash); full content stays in the local mirror sidecar. |
| `event_type` | `string` | no | Short name (`'observation'`, `'annotation'`, …) or absolute URI. Default `'observation'`, or derived from `ref.kind` (`'annotates'` → annotation, `'revises'` → revision). An explicit value that contradicts `ref.kind` throws `TypeError`. |
| `ref` | `AttestRef` | no | Collapsed annotate/revise reference; sets the record's `annotates` or `revises` field. |
| `informed_by` | `string[]` | no | `sha256:<64-hex>` refs of records this one was informed by ([§1.2.5](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#125-informed_by)). |
| `allow_unresolved_informed_by` | `boolean` | no | Keep deliberately dangling `informed_by` refs ([D113](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d113-unvalidated-informed_by-refs-are-omitted-by-default) opt-in). |
| `context_id` | `string` | no | Explicit context (32 lowercase hex). Default: the client's `contextId`, else `resolveEnvContextId()` ([D078](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default)/[D083](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers)). |
| `chain_root` | `string` | no | Explicit chain_root override (requires a context_id). Default: [`resolveChainRoot`](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#1231-multi-producer-chain-composition) precedence in the emit pipeline. |
| `provenance_token` | `string` | no | [§1.2.6](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#126-provenance_token) cross-session anchor (genesis-only, 22-char base64url). |
| `tool_name` | `string` | no | [§8.2](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#82-opaque-name-posture) tool-name disclosure. |
| `args_hash` | `string` | no | Explicit [§8.3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#83-salted-commitment-posture) args commitment (overrides the [D099](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d099-explicit-emit-records-commit-local-content-through-default-args_hash) default). |
| `result_hash` | `string` | no | Explicit [§8.3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#83-salted-commitment-posture) result commitment. |

### `AttestResult`

| Field | Type | Meaning |
| --- | --- | --- |
| `record_hash` | `string \| null` | `sha256:<64-hex>` of the signed record, or `null` when nothing was signed (degraded). |
| `context_id` | `string \| null` | Context the record landed in. |
| `log_index` | `number \| null` | Public-log index when submission already confirmed; `null` while in flight or disabled. |
| `inclusion_proof` | `ProofBundle['inclusion_proof'] \| null` | RFC 6962 inclusion proof when already available (cached by record hash per [§5.3.5](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#535-log-submission)). |
| `receipt_id` | `string?` | Present when the emit pipeline issued a receipt id. |
| `via` | `'daemon' \| 'in-process' \| 'none'` | Which path produced the record. `'none'` = degraded; see `warnings`. |
| `warnings` | `string[]` | `atrib:`-prefixed operational warnings (anchor skips, fallbacks, pass-through, flush deadline). |
| `anchor_posture` | `AttestAnchorPosture?` | `{ effective_anchor_count, used_default_set, warned }`: the resolved [§2.11.12](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#21112-producer-side-anchor-posture) posture; present on in-process attests that reached the anchor fan-out. |
| `attribution_receipt` | `VerifiedAttributionReceipt?` | `{ block, verification }`: the parsed `dev.atrib/attribution` receipt plus its `verifyAttributionReceipt` outcome; only when `attributionReceipts: true` and the daemon emitted one. Advisory. |

### `RecallQuery` shapes

`RecallQuery` is the union of ten query interfaces discriminated by
`shape` (omitted `shape` means `'history'`). `SHAPE_TO_TOOL` maps each
shape to its physical tool name on the primitives runtime; the fallback
column says what serves the shape when no daemon is reachable.

| Shape | Daemon tool | In-process fallback | Args (beyond `shape`) |
| --- | --- | --- | --- |
| `history` (`HistoryQuery`) | `recall_my_attribution_history` | `recall()` from `@atrib/recall` (optional peer) | `context_id?`, `context_scope?` (`'all' \| 'env'`), `creator_key?`, `event_type?`, `content_id?`, `tool_name?`, `args_hash?`, `min_importance?` (`'critical' \| 'high' \| 'medium' \| 'low' \| 'noise'`), `topic_tags?`, `include_revised?`, `min_signers?`, `rank_by?` (`'timestamp' \| 'relevance' \| 'causal_distance'`), `rank_anchor?`, `toc?`, `limit?`, `offset?`, `compact?`, `include_unverified?` |
| `walk` (`WalkQuery`) | `recall_walk` | none (degrades) | `from_record_hash` (required), `edge_types?` (`'CHAIN_PRECEDES' \| 'INFORMED_BY' \| 'ANNOTATES' \| 'REVISES'`), `depth?` |
| `annotations` (`AnnotationsQuery`) | `recall_annotations` | none (degrades) | `record_hash` (required) |
| `revisions` (`RevisionsQuery`) | `recall_revisions` | none (degrades) | `record_hash` (required) |
| `by_content` (`ByContentQuery`) | `recall_by_content` | none (degrades) | `query` (required), `k?`, `max_records?`, `evidence_mode?` (`'bounded' \| 'require_complete'`) |
| `session_chain` (`SessionChainQuery`) | `recall_session_chain` | none (degrades) | `context_id?` (defaulted from the client), `limit?`, `include_content?` |
| `orphans` (`OrphansQuery`) | `recall_orphans` | none (degrades) | `context_id?` (defaulted from the client), `event_type?`, `creator_key?`, `limit?` |
| `by_signer` (`BySignerQuery`) | `recall_by_signer` | none (degrades) | `min_records?` |
| `trace` / `trace_forward` (`TraceQuery`) | `trace` / `trace_forward` | none (degrades) | `record_hash` (required), `context_id?`, `depth?`, `max_nodes?`, `compact?`, `include_content?` |
| `verify` (`VerifyQuery`) | `atrib-verify` | `handleAtribVerify()` from `@atrib/verify-mcp` (optional peer) | `packet?`, `records?`, `claims?`, `required_record_hashes?`, `trusted_creator_keys?`, `allowed_context_ids?`, `require_body?`, `require_body_commitment?`, `require_log_inclusion?`, `log_public_key_b64?`, `now_ms?`, `max_age_ms?` |

`verify` is Pattern 3 handoff-claim verification
([D105](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d105-pattern-3-handoff-claims-use-verifier-side-claim-acceptance)/[D106](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d106-verify-is-promoted-to-cognitive-primitive-7)).
"None (degrades)" shapes return `via: 'none'`, `data: null`, and a
warning naming the runtime tool to use instead, rather than a divergent
reimplementation. When a peer-backed fallback engine itself throws, that
too is caught and degraded.

### `RecallOutcome<T>`

| Field | Type | Meaning |
| --- | --- | --- |
| `shape` | `RecallShape` | Echo of the resolved shape. |
| `via` | `'daemon' \| 'in-process' \| 'none'` | Which path served the read. `'none'` = degraded; see `warnings`. |
| `data` | `T \| null` | The tool/engine result (parsed JSON when the daemon returned the single-JSON-text-block convention), or `null` when degraded. |
| `warnings` | `string[]` | `atrib:`-prefixed operational warnings. |
| `attribution_receipt` | `VerifiedAttributionReceipt?` | As on `AttestResult`; opt-in, advisory. |

### `AtribClientConfig`

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `daemon` | `DaemonConfig` | see below | Daemon endpoint/mode/timeouts. |
| `anchors` | `AnchorSpec[]` | `BUILT_IN_DEFAULT_ANCHOR_SET` (two anchors; the atrib-log member honors `$ATRIB_LOG_ENDPOINT`) | [D138](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d138-anchor-plurality-as-the-default-trust-posture) anchor set; in-process attests fan out to every member. Hostile entries and unregistered `anchor_type` values warn-and-skip. |
| `allowSingleAnchor` | `boolean` | `false` | [§2.11.12](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#21112-producer-side-anchor-posture) rule 3: states a < 2-anchor set is deliberate, silencing the sub-plurality warning and the sidecar degradation marker. |
| `attributionReceipts` | `boolean` | `false` | Opt-in parsing + verification of `dev.atrib/attribution` receipts from daemon `_meta` ([D141](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d141-devatribattribution-first-class-mcp-extension-sep-2133)). |
| `key` | `ResolvedKey \| null` | `resolveKey()` ladder from `@atrib/emit` (`ATRIB_PRIVATE_KEY` env → `ATRIB_KEY_FILE` → macOS Keychain → 1Password) | Pre-resolved in-process signing key. `null` disables in-process signing (pass-through per [§5.8](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#58-degradation-contract) rule 5). Note: *any* explicitly-set `key` property opts out of the `resolveKey()` ladder. |
| `contextId` | `string` | `resolveEnvContextId()` at call time | Per-client default context (32 lowercase hex). Context identity stays an explicit per-request value (stateless-MCP-native posture). |
| `producer` | `string` | `'atrib-sdk'` (`DEFAULT_PRODUCER`) | `_local.producer` mirror-sidecar label ([§5.9](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#59-local-mirror-conventions)); in-process path only. |

### `DaemonConfig` / `DaemonMode`

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `endpoint` | `string` | `$ATRIB_PRIMITIVES_HTTP_ENDPOINT`, then `http://127.0.0.1:8796/mcp` (`DEFAULT_DAEMON_ENDPOINT`) | MCP Streamable HTTP endpoint of the local primitives runtime. |
| `mode` | `'prefer' \| 'require' \| 'off'` | `'prefer'` | `'prefer'`: try daemon, fall back in-process. `'require'`: daemon only; failure degrades to a warning result (never a throw). `'off'`: in-process only (no `DaemonClient` is constructed). |
| `connectTimeoutMs` | `number` | `1500` | Daemon connect timeout. |
| `callTimeoutMs` | `number` | `10000` | Per-`tools/call` timeout. |
| `retryCooldownMs` | `number` | `30000` | Cooldown before re-probing an unreachable daemon; within the window, calls skip straight to the fallback. |

`resolveDaemonEndpoint(config?)` applies exactly that endpoint
precedence and is exported for hosts that want to probe the runtime
themselves.

### `AnchorSpec` / `resolveAnchorSet(anchors, allowSingleAnchor?)` → `ResolvedAnchorSet`

An anchor is either a bare string (an atrib-log
[§2.6.1](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#261-submit-entry)
endpoint, shorthand for `{ url }`) or an `AnchorDescriptor`
(`{ anchor_type?, anchor_id?, url?, endpoint?, ... }`: `url` wins over
`endpoint`; an absent `anchor_type` means `'atrib-log'`; registered
non-atrib-log types like `'opentimestamps'` need no URL).

`resolveAnchorSet` normalizes the caller's specs into the canonical
[§2.11.12](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#21112-producer-side-anchor-posture)
`AnchorSetConfig` that `createAnchorFanout` / `resolveAnchorPosture`
consume, and never throws: hostile entries (non-string/non-object,
missing/invalid endpoint where one is required) and `anchor_type` values
outside the [§2.11.8](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#2118-anchor-type-registry)
registry warn-and-skip. Skipped entries are **excluded** from the
config, so they never count toward the plurality posture. `undefined`
input returns an empty config (the built-in default set applies
downstream). Returns `{ config: AnchorSetConfig, primaryLogEndpoint:
string | undefined, warnings: string[] }`; `primaryLogEndpoint` (the
first usable atrib-log anchor) doubles as the in-process emit pipeline's
`logEndpoint`.

### `DaemonClient` / `DaemonCallOutcome`

The MCP Streamable HTTP transport to the primitives runtime, exported
for hosts that want raw tool access with the same degradation posture.

```ts
new DaemonClient(config?: DaemonConfig, options?: { attributionReceipts?: boolean })

type DaemonCallOutcome =
  | { ok: true; value: unknown; attribution?: AttributionReceiptBlock }
  | { ok: false; reason: string }
```

- `callTool(name, args)` → `Promise<DaemonCallOutcome>`. Never throws.
  Tool results carrying a single JSON text block (the atrib primitive
  convention) are parsed; non-JSON text is returned as the string; other
  result shapes are returned raw. A result with `isError: true` is a
  failure outcome.
- Connection is lazy and cached; a failed call closes the transport and
  starts the `retryCooldownMs` window, during which `callTool` returns
  `{ ok: false }` immediately without re-probing.
- `close()`: best-effort transport close; never throws.
- The client is semantically stateless: `context_id` and chain tokens
  travel as explicit tool arguments on every call; the MCP protocol
  session (initialize handshake + `Mcp-Session-Id`) is a transport
  detail managed by the official `@modelcontextprotocol/sdk` client.

### Hash helpers

Compositions of `@atrib/mcp` primitives, with no hashing implementation of their own.

| Export | Returns | Meaning |
| --- | --- | --- |
| `recordHashHex(record)` | bare 64-char lowercase hex | SHA-256 over the JCS-canonical COMPLETE signed record, including `signature` ([§1.2.3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#123-chain_root-for-genesis-records)). |
| `recordHashRef(record)` | `sha256:<64-hex>` | The reference form used by `chain_root`, `informed_by`, `annotates`, `revises`. |
| `deriveProvenanceToken(upstream)` | 22-char base64url | [§1.2.6](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#126-provenance_token) token for a downstream genesis record: base64url (no padding) of the first 16 bytes of the upstream record hash. |

### Evidence envelope family ([D137](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d137-universal-evidence-envelope-as-the-single-protocol-level-attachment-model), [§5.5.7](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#557-universal-evidence-envelope))

Structural types/helpers are SDK-local; envelope **production and
validation** delegate to the optional peer `@atrib/verify` (lazy import;
missing peer degrades to a `null` envelope with a warning naming the
peer, per [§5.8](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#58-degradation-contract)).
Envelopes live outside signed bytes (mirror sidecar, archive evidence
projection, verifier results, host-owned packets).

| Export | Kind | Meaning |
| --- | --- | --- |
| `EvidenceTier` | type | `'declared' \| 'shape' \| 'attested' \| 'verified'`: what the verifier party actually did. |
| `EvidencePayloadRefKind` | type | `'inline' \| 'mirror' \| 'archive' \| 'external' \| 'withheld'`. |
| `EvidencePayloadRef` | type | `{ kind, uri?, record_hash? }` (`uri` and `record_hash` are string-or-null). `uri` for archive/external locations; `record_hash` when the payload is itself a signed atrib record. |
| `EvidencePayload` | type | `{ hash, media_type?, ref?, inline? }`: `hash` is a `"sha256:" + hex` commitment to the raw evidence material; `inline` only when `ref.kind === 'inline'`, never public. The type is lenient; normative validation requires `ref`. |
| `EvidenceConstraint` | type | `{ type, status: 'passed' \| 'failed' \| 'unresolved' \| 'not_checked', expected?, actual? }`. |
| `EvidenceEnvelope` | type | `{ envelope: 1, profile, profile_version, tier, payload, facts?, result?, verifier? }`: one envelope schema, N profiles identified by absolute HTTPS type URI. Normative validation requires `result`. |
| `evidenceEnvelopeKey(envelope)` | function | Dedup identity: `` `${profile} ${payload.hash}` ``. Multiple instances per key are permitted; consumers order by tier desc, then `checked_at_ms` desc, then verifier name. |
| `evidenceTierRank(tier)` | function | Numeric rank, `0` (declared) … `3` (verified); unknown tiers rank `-1`. |
| `buildEvidenceEnvelope(input)` | async function | Producer-side builder: computes `payload.hash` from `payload.material` (JCS rule) or `hash_rule: 'raw'` (UTF-8 rule), fills the default `result`, and validates via the peer. Returns `{ envelope, validation, warnings }` with `envelope: null` on rejection or missing peer; throws `TypeError` only on contradictory input (hash AND material, `hash_rule` without material, neither). |
| `validateEvidenceEnvelope(envelope)` | async function | Runs the peer's normative [§5.5.7](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#557-universal-evidence-envelope) shape validation. Returns `{ validation, warnings }`; `validation: null` when the peer is missing. |

### Attribution receipt family ([D141](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d141-devatribattribution-first-class-mcp-extension-sep-2133), `dev.atrib/attribution` v0.1)

Receipts are advisory extension data: trust derives only from verifying
signed records and inclusion proofs, never from the receipt. See the
extension document under `docs/extensions/dev.atrib-attribution/`.

| Export | Kind | Meaning |
| --- | --- | --- |
| `ATTRIBUTION_EXTENSION_KEY` | const | `'dev.atrib/attribution'`: the `_meta` key. Aliases `@atrib/mcp`'s `ATTRIBUTION_EXTENSION_ID` (also re-exported). |
| `ATTRIBUTION_LOG_SUBMISSION_STATUSES` | const | The four known statuses, re-exported from `@atrib/mcp`. |
| `AttributionLogSubmissionStatus` | type | `'queued' \| 'submitted' \| 'disabled' \| 'failed'`; unknown future values pass through as strings. A queue status, never an awaited proof ([§5.3.5](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#535-log-submission)). |
| `AttributionReceipt` | type | `{ record_hash?, creator_key?, context_id?, event_type?, chain_root?, log_submission? }`: all optional strings. |
| `AttributionReceiptBlock` | type | `{ token?, receipt?, record? }`: the [§1.5.2](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#152-http-transport-tracestate) propagation token, the receipt, and optionally the full signed record for immediate Tier-3 re-verification. |
| `VerifiedAttributionReceipt` | type | `{ block, verification }`: what the daemon client attaches to attest/recall results: the parsed block plus the [§6.2](https://github.com/creatornader/atrib/blob/main/docs/extensions/dev.atrib-attribution/v0.1.md#62-receipt-block) integrity outcome. |
| `parseAttributionReceiptBlock(meta)` | function | Lenient extraction from a tool result's `_meta`: anything malformed yields `null`, never a throw; wrong-typed fields are dropped; an all-dropped receipt counts as absent. |
| `verifyAttributionReceipt(block)` | function | Re-exported from `@atrib/mcp`: the extension-spec [§6.2](https://github.com/creatornader/atrib/blob/main/docs/extensions/dev.atrib-attribution/v0.1.md#62-receipt-block) consumer check over the RAW result block: structural well-formedness plus internal consistency across token, receipt, and the optional record. Returns `AttributionReceiptVerification` `{ valid, mismatched }` (`['malformed']` for non-blocks). Internal consistency only; not a proof. |
| `checkAttributionReceiptConsistency(block, record?)` | function | Record-side consistency: checks a parsed block's claims against the signed record they name (attached or caller-retrieved). No record at all → `{ receipt_valid: false, mismatched_fields: ['record'] }` (conservative, nothing to check against). |

### Record-layer re-exports

The complete [§1](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#1-attribution-record-format)
record layer, re-exported verbatim from `@atrib/mcp` (grouped as in
`src/index.ts`):

**Types + event vocabulary.**

- `EVENT_TYPE_TOOL_CALL_URI`, `EVENT_TYPE_TRANSACTION_URI`, `EVENT_TYPE_OBSERVATION_URI`, `EVENT_TYPE_DIRECTORY_ANCHOR_URI`, `EVENT_TYPE_ANNOTATION_URI`, `EVENT_TYPE_REVISION_URI`: the six normative event-type URIs.
- `EVENT_TYPE_SHORT_NAMES`: the six short aliases accepted by agent-facing tools.
- `EVENT_TYPE_SHORT_TO_URI`: short alias → canonical URI map.
- `isNormativeEventTypeUri(uri)`: membership in the normative set (informational).
- `isValidEventTypeUri(value)`: [§1.4.5](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#145-event_type-uri-validation) syntactic URI validation (extension URIs pass).
- `normalizeEventType(value)`: short alias / known typo path → canonical URI; unknown values pass through.

**Canonicalization ([§1.3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#13-canonical-serialization)).**

- `canonicalRecord(record)`: JCS bytes of the complete signed record (the record-hash preimage).
- `canonicalSigningInput(record)`: JCS bytes with `signature` removed (the signing input).
- `canonicalCrossAttestationInput(record)`: [§1.7.6](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#176-cross-attestation-requirement-for-transaction-records) bytes with `signers: []` and no top-level `signature`.

**Signing + verification ([§1.4](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#14-signing-and-verification)).**

- `getPublicKey(privateKey)`: raw 32-byte Ed25519 public key for a 32-byte seed.
- `signRecord(record, privateKey)`: [§1.4.2](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#142-signing-procedure) signing; returns the record with `signature` set.
- `signTransactionRecord(record, privateKey, counterpartySigners?)`: signs the cross-attestation bytes; creator's signer entry first.
- `signTransactionAttestation(record, privateKey)`: one counterparty `SignerEntry` over an existing transaction record's bytes.
- `verifyRecord(record)`: [§1.4.3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#143-verification-procedure) verification, all steps.

**Hashing + encoding.**

- `sha256(bytes)`: SHA-256 digest.
- `base64urlEncode` / `base64urlDecode`: base64url, no padding.
- `hexEncode` / `hexDecode`: lowercase hex.

**Chain composition ([§1.2.3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#123-chain_root-for-genesis-records) / [§1.2.3.1](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#1231-multi-producer-chain-composition)).**

- `genesisChainRoot(contextId)`: `"sha256:" + hex(SHA-256(UTF-8(context_id)))`.
- `chainRoot(parentRecord)`: chain_root for a non-genesis record.
- `resolveChainRoot(opts)`: the [D067](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d067-multi-producer-chain-composition-precedence-contract) precedence contract (token > autoChain tail > env var > mirror tail > synthetic genesis). Never reimplement chain selection.

**Propagation ([§1.5](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#15-context-propagation)).**

- `encodeToken(record)` / `decodeToken(token)`: the [§1.5.2](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#152-http-transport-tracestate) propagation token (`base64url(record_hash) + "." + base64url(creator_key)`; lenient decode returns `null`).
- `extractTraceId(traceparent)`: trace-id from a W3C `traceparent` header.
- `mergeTracestate(atribEntry, existing)` / `parseTracestateAtrib(tracestate)`: atrib member handling in W3C `tracestate`.
- `mergeBaggageAtribSession(sessionToken, existing)` / `parseBaggageAtribSession(baggage)`: session token in W3C `baggage`.
- `readInboundContext(params)` / `writeOutboundContext(...)`: MCP `params._meta` context reading/writing ([§1.5.4](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#154-mcp-transport-params_meta)).

**Content identity ([§1.2.2](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#122-content_id-derivation)).**

- `computeContentId(serverUrl, toolName)`: `"sha256:" + hex(SHA-256(normalized + ":" + tool))`.
- `normalizeServerUrl(url)`: WHATWG-semantics URL normalization feeding `content_id`.

**Log entry serialization ([§2.3.1](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#231-entry-serialization)).**

- `serializeEntry(input)`: the 90-byte fixed log entry.
- `eventTypeUriToByte(uri)`: event_type byte mapping (extensions → `0xFF`).

**Submission-side validation ([§2.6.1](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#261-submit-entry) client parity).**

- `validateSubmission(record)`: client-side mirror of the log's submission validation; returns `ValidationResult`.

**Mirror conventions ([§5.9](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#59-local-mirror-conventions)).**

- `readMirrorTail(...)`: newest record on a mirror file.
- `inheritChainContext(...)`: mirror-based chain inheritance for new producers.
- `recordHashExistsInMirror(...)`: presence check by record hash.

**Context identity ([D078](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default)/[D083](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers)).**

- `resolveEnvContextId(env?)`: `ATRIB_CONTEXT_ID`, then the harness discovery registry (Claude Code, Codex, file fallbacks).

**Submission queue ([§5.3.5](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#535-log-submission)).**

- `createSubmissionQueue(...)`: the non-blocking, bounded-retry log submitter with per-record-hash proof caching.

**Type re-exports.** `AtribRecord`, `UnsignedAtribRecord`, `SignerEntry`,
`ChainContext`, `DecodedToken`, `EntryInput`, `ProofBundle`,
`SubmissionQueue`, `ValidationResult`.

**Anchor plurality ([D138](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d138-anchor-plurality-as-the-default-trust-posture), [§2.11.7-§2.11.13](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#2117-anchors-generalizing-the-replication-target)), re-exported from `@atrib/mcp`.**

- `ANCHOR_TYPES`: the [§2.11.8](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#2118-anchor-type-registry) v1 registry (`atrib-log`, `sigstore-rekor`, `rfc3161-tsa`, `opentimestamps`).
- `BUILT_IN_DEFAULT_ANCHOR_SET`: the two-anchor zero-config default ([§2.11.12](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#21112-producer-side-anchor-posture) rule 1).
- `resolveAnchorPosture(config)` / `resolveEffectiveAnchors(config)`: the pure [§2.11.12](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#21112-producer-side-anchor-posture) posture/effective-set resolution.
- `createAnchorFanout(options)` / `submitToAnchors(...)`: the per-anchor transport fan-out the client uses on in-process attests; exported for hosts that anchor records themselves.
- Types `AnchorType`, `AnchorDescriptor`, `AnchorSetConfig`, `AnchorPostureResolution`, `AnchorConfigSidecarMarker`, `AnchorFanout`, `AnchorFanoutTicket`, `AnchorSubmissionOutcome`, `AnchorSubmissionStatus`.

**Key handling ([§5.6](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#56-key-management)), re-exported from `@atrib/emit`.**

- `resolveKey()`: the async key ladder: `ATRIB_PRIVATE_KEY` env → `ATRIB_KEY_FILE` → macOS Keychain → 1Password; `null` (pass-through) when nothing resolves.
- `emitInProcess(input, options?)`: the in-process write engine the SDK's fallback path uses; exported for hosts that want it directly.
- Types `EmitOutput`, `ResolvedKey`.

## Conformance

`test/` runs the shared corpora: `spec/conformance/1.4/` (signing +
adversarial), `1.2.6/` (provenance_token), `1.2.3/multi-producer/`
(chain-root precedence), `2.6.1/` (submission validation, client-side),
`evidence-envelope/` ([D137](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d137-universal-evidence-envelope-as-the-single-protocol-level-attachment-model) shape/build/validate), and the
`mcp-extension/` receipt cases ([D141](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d141-devatribattribution-first-class-mcp-extension-sep-2133) `verifyAttributionReceipt` +
consistency semantics), against this package's exported surface. The
corpora are fixtures, not inspiration: any failure is a spec-bug
discovery, not something to route around.

## Status

v0.1.0, unpublished (first-publish pending; see
`docs/publishing-new-npm-package.md` and the Changesets ignore list).

## Part of atrib

atrib is an open protocol for verifiable agent actions. Every action becomes a signed, chain-linked record that anyone can verify against a public Merkle log, with no operator to trust. This package is one entrypoint. See the [full package family](https://github.com/creatornader/atrib#packages) and the [protocol spec](https://github.com/creatornader/atrib/blob/main/atrib-spec.md).
