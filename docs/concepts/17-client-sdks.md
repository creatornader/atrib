# The client SDKs

> Two verbs over the whole substrate: `attest()` writes signed context, `recall()` reads it back. One consolidated TypeScript package and one Python distribution expose the same surface, prefer the same local daemon, fall back in-process, and produce records no verifier can tell apart. The SDKs are glue plus re-exports; they add no new signing implementation.

**Status**: DRAFT
**Spec anchors**: [D136](../../DECISIONS.md#d136-consolidated-client-sdks-atribsdk--python-atrib-in-repo-byte-identical-corpus-tested) · [§5](../../atrib-spec.md#5-sdk-specification) · [§5.8](../../atrib-spec.md#58-degradation-contract) · [§1](../../atrib-spec.md#1-attribution-record-format)
**Builds on**: [Records & signing](01-records-and-signing.md), [The chain](04-the-chain.md), [The cognitive primitives: two verbs, seven aliases](11-cognitive-primitives.md), [Local substrate coordinator](13-local-substrate-coordinator.md)
**Enables**: one-import application access to the substrate; the first cross-language proof that two implementations of [§1](../../atrib-spec.md#1-attribution-record-format) agree byte-for-byte

## Why the consolidated SDKs exist

Before [D136](../../DECISIONS.md#d136-consolidated-client-sdks-atribsdk--python-atrib-in-repo-byte-identical-corpus-tested), an application developer who wanted atrib faced a scattered client surface: `@atrib/mcp` for signing, chain composition, mirrors, and submission; `@atrib/emit` for explicit writes; and seven cognitive-primitive MCP servers for reads. Each piece is right for its own producer class, but "my app wants to record a decision and look it up later" should not require assembling four packages.

`@atrib/sdk` (`packages/sdk/`) is the consolidated JS/TS client. `atrib` (`python/`) is its Python sibling and, more importantly, the first non-TypeScript implementation of the record layer, the real test of the spec's "two implementations must agree" claims. Both live in this monorepo, extraction-ready, so the conformance corpora stay the shared test fixtures at the same commit.

The defining constraint: **no third signing implementation**. Every `@atrib/sdk` write terminates in `@atrib/emit`'s `handleEmit` pipeline; every Python write goes through the ported record layer that the corpora hold byte-identical to it. The SDK layer is verbs, routing, and re-exports, never new cryptography.

## The two verbs

The seven cognitive primitives ([D079](../../DECISIONS.md#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface)) were originally the *agent-facing* surface: monomorphic MCP tools a model calls one at a time. This SDK proposal's naming target became the actual MCP tool surface with the attest/recall rename ([D164](../../DECISIONS.md#d164-attestrecall-verb-rename-and-primitive-surface-collapse)): the two verbs below are now `attest` and `recall`, real MCP tools mounted alongside the seven legacy names, not an SDK-only abstraction:

- **`attest()`** collapses the three writes. An optional `ref` discriminator selects the kind: no ref signs an observation (emit), `ref.kind: 'annotates'` signs an annotation, `ref.kind: 'revises'` signs a revision. The record bytes are identical to what the dedicated primitives would have signed.
- **`recall()`** collapses the reads under one shape-discriminated query: history, walks, annotations, revisions, content search, session chains, orphans, signers, trace in both directions, and handoff verification ([D106](../../DECISIONS.md#d106-verify-is-promoted-to-cognitive-primitive-7)).

The collapse is surface, not semantics: each ref/shape still maps 1:1 to what a dedicated primitive tool would have signed or returned. The seven legacy tool names stay mounted as permanent aliases over the same handlers per [D164](../../DECISIONS.md#d164-attestrecall-verb-rename-and-primitive-surface-collapse).

## Daemon-first, in-process fallback

Both SDKs prefer the local primitives runtime (the host-owned daemon of [D120](../../DECISIONS.md#d120-local-substrate-coordinator-keeps-startup-spawn-sidecars-wrapper-owned)) over MCP Streamable HTTP (`$ATRIB_PRIMITIVES_HTTP_ENDPOINT`, default `http://127.0.0.1:8796/mcp`). One process, one key owner, one mirror, one submission queue, however many applications sit on top.

When no daemon is reachable, the TypeScript SDK falls back in-process: writes through `emitInProcess()` (`@atrib/emit`, a hard dependency; the write path must always work), history reads through `@atrib/recall`, and verification through `@atrib/verify-mcp` (both optional peers, loaded lazily; absent peers degrade to a typed unavailable outcome instead of an import failure). Shapes without an exported in-process engine degrade honestly with a warning naming the runtime tool; a divergent reimplementation would be worse than a truthful "not served".

The Python client signs in-process in v0 and serves the history/session_chain shapes over the local mirror; its daemon transport arrives with the stateless MCP HTTP transport rather than reimplementing the current initialize-handshake session protocol. Both SDKs are semantically stateless either way: `context_id` and chain tokens travel as explicit per-request values, never as protocol-session state.

## Byte-identity, enforced not asserted

The guarantee that makes a second implementation worth having: identical inputs produce identical JCS canonical forms ([§1.3](../../atrib-spec.md#13-canonical-serialization)), identical Ed25519 signatures, identical record hashes, propagation tokens, and chain roots. A verifier MUST NOT be able to tell which implementation signed a record.

Two mechanisms enforce it:

1. **The shared conformance corpora** (`spec/conformance/1.4/` signing + adversarial, `1.2.6/` provenance_token, `1.2.3/multi-producer/` chain-root precedence, `2.6.1/` submission validation, `evidence-envelope/` [D137](../../DECISIONS.md#d137-universal-evidence-envelope-as-the-single-protocol-level-attachment-model) envelopes, the `mcp-extension/` receipt cases, and the `2.11/anchors/` posture table) run unmodified against both SDKs. The corpora are fixtures, not inspiration: a failure is a spec-bug discovery, not something to route around.
2. **The cross-implementation determinism judge** (`python/tests/cross_impl/` + `packages/sdk/scripts/cross-impl-vectors.mjs`) pushes seeded generated inputs (unicode sorting edges, float serialization, optional-field combinations) through both stacks and diffs the canonical bytes, signatures, hashes, and tokens.

The ports preserve JS semantics deliberately, down to regex anchoring (`\Z` vs `$`), `typeof`-vs-`bool` timestamp guards, and WHATWG default-port dropping in URL normalization. Where the two runtimes genuinely cannot agree (content outside I-JSON, like integers past 2^53−1), the Python side rejects rather than silently reproducing JS precision loss, and that boundary is pinned in a test.

## The degradation contract

Both SDKs inherit [§5.8](../../atrib-spec.md#58-degradation-contract) whole: **operational failures never throw; contradictory input is the only throw path.** Daemon unreachable → fallback. No signing key → pass-through result with a warning. Log unreachable → non-blocking bounded retry, record kept locally. Missing optional peer → typed unavailable outcome. Every warning carries the `atrib:` prefix. The one thing that does raise is programmer error: a `ref.kind` that contradicts an explicit `event_type`, an unknown recall shape, a malformed `context_id`. Silence about broken inputs would corrupt records; silence about broken infrastructure is the contract.

## Anchors, receipts, envelopes

Three accepted-ADR surfaces ride along with the verbs, all outside signed bytes:

- **Anchor plurality** ([D138](../../DECISIONS.md#d138-anchor-plurality-as-the-default-trust-posture), [§2.11.7-§2.11.13](../../atrib-spec.md#2117-anchors-generalizing-the-replication-target)): attests fan out to every configured anchor (zero-config gets the built-in two-anchor default set), the resolved [§2.11.12](../../atrib-spec.md#21112-producer-side-anchor-posture) posture surfaces on the result, and a deliberate sub-plurality set is stated with `allowSingleAnchor` / `allow_single_anchor`. Fire-and-forget per [§5.3.5](../../atrib-spec.md#535-log-submission); anchoring never blocks a write.
- **Attribution receipts** ([D141](../../DECISIONS.md#d141-devatribattribution-first-class-mcp-extension-sep-2133)): with receipts opted in, the TypeScript daemon client parses the `dev.atrib/attribution` block from tool-result `_meta` and runs the extension-spec [§6.2](../extensions/dev.atrib-attribution/v0.1.md#62-receipt-block) integrity check; both SDKs expose the parse/verify/consistency helpers. Receipts are advisory: trust derives from verifying signed records.
- **Evidence envelopes** ([D137](../../DECISIONS.md#d137-universal-evidence-envelope-as-the-single-protocol-level-attachment-model), [§5.5.7](../../atrib-spec.md#557-universal-evidence-envelope)): both SDKs validate and build envelopes (payload commitment via the JCS or raw hash rule) and map frozen legacy [§5.5.6](../../atrib-spec.md#556-generic-authorization-evidence-blocks) evidence blocks deterministically; the TypeScript builder delegates to the optional peer `@atrib/verify` and degrades when it is absent.

## What is deliberately not in the SDK

- **Summarize.** Not an SDK verb and not a recall shape. Synthesis belongs to the calling harness/model; the SDK returns verified raw material.
- **Payments detection and settlement.** Transaction detection lives with the runtime middleware (`@atrib/agent`), and the payments layer is on a spin-out path from protocol core ([D147](../../DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core)). The SDK keeps the transaction *record* layer (signing, cross-attestation helpers) because that is trust semantics, not rail plumbing.
- **Control decisions.** Deciding whether an action may run is host-owned: [`@atrib/action-gate`](../../packages/action-gate/README.md) per [D133](../../DECISIONS.md#d133-action-gate-is-a-host-owned-controlproof-package) signs allow/block/escalate decisions and outcomes at the host's boundary. The client SDK records and recalls; it does not gate.

The line is the same in all three cases: the SDK is the substrate's client, not a policy engine, a synthesizer, or a payment rail.

## Worked example

An orchestrator (TypeScript) records a decision; a delegated Python job carries it forward:

```ts
import { createAtribClient } from '@atrib/sdk'
const client = createAtribClient()
const decision = await client.attest({
  content: { what: 'shard the index by tenant', why_noted: 'p99 regression' },
})
// hand decision.record_hash to the delegated job (explicit args, per D135)
```

```python
from atrib import AtribClient
client = AtribClient()
client.attest(
    {"what": "shard rollout complete", "tenants": 412},
    informed_by=[decision_record_hash],  # threaded from the orchestrator
)
```

Both records verify with the same verifier, hash with the same rules, and land in the same graph; the `informed_by` edge connects work across languages because the bytes agree.

## See also

- Package references: [`packages/sdk/README.md`](../../packages/sdk/README.md) (full `@atrib/sdk` API reference), [`python/README.md`](../../python/README.md) (full Python API reference)
- Decisions: [D136 Consolidated client SDKs](../../DECISIONS.md#d136-consolidated-client-sdks-atribsdk--python-atrib-in-repo-byte-identical-corpus-tested), [D067 chain composition precedence](../../DECISIONS.md#d067-multi-producer-chain-composition-precedence-contract), [D099 explicit emit content commitment](../../DECISIONS.md#d099-explicit-emit-records-commit-local-content-through-default-args_hash), [D135 delegated-builder context threading](../../DECISIONS.md#d135-delegated-builder-atrib-context-threads-via-orchestrator-injected-explicit-args)
- Concepts: [Records & signing](01-records-and-signing.md) (what the SDKs sign), [The chain](04-the-chain.md) (what `informed_by` and chain roots mean), [The cognitive primitives: two verbs, seven aliases](11-cognitive-primitives.md) (the agent-facing surface the verbs collapse), [Local substrate coordinator](13-local-substrate-coordinator.md) (the daemon topology)
- Session brief: [`docs/atrib-sdk-session-brief.md`](../atrib-sdk-session-brief.md)
