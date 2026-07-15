# P047 candidate ADR draft: attest/recall verb rename and primitive-surface collapse

Status: historical candidate draft. Implemented as [D164](../DECISIONS.md#d164-attestrecall-verb-rename-and-primitive-surface-collapse). Generated 2026-07-06 by the redesign-overhaul workflow; source plan: [redesign-upgrade-path.md](redesign-upgrade-path.md).

Candidate set (cross-references between drafts resolve via this table):

| Pending | Key | Draft |
|---|---|---|
| P042 | evidence-envelope | [docs/adr-draft-p042-evidence-envelope.md](adr-draft-p042-evidence-envelope.md) |
| P043 | anchor-plurality | [docs/adr-draft-p043-anchor-plurality.md](adr-draft-p043-anchor-plurality.md) |
| P044 | session-checkpoint | [docs/adr-draft-p044-session-checkpoint.md](adr-draft-p044-session-checkpoint.md) |
| P045 | delegation-certificates | [docs/adr-draft-p045-delegation-certificates.md](adr-draft-p045-delegation-certificates.md) |
| P046 | atribd-daemon | [docs/adr-draft-p046-atribd-daemon.md](adr-draft-p046-atribd-daemon.md) |
| P047 | attest-recall-rename | [docs/adr-draft-p047-attest-recall-rename.md](adr-draft-p047-attest-recall-rename.md) |
| P048 | payments-spinout | [docs/adr-draft-p048-payments-spinout.md](adr-draft-p048-payments-spinout.md) |
| P049 | mcp-extension | [docs/adr-draft-p049-mcp-extension.md](adr-draft-p049-mcp-extension.md) |

---

# Draft ADR: attest/recall verb rename and primitive-surface collapse

**Date:** 2026-07-06 (draft; not accepted)

**Status:** Draft

**Supersedes (on acceptance, via banners, per the [D082](#d082-cli-binary-distribution-of-emitinprocess-supersedes-d081s-integration-shape) precedent):** the surface enumeration of [D079](#d079-the-six-core-cognitive-primitives-atribs-agent-facing-surface) and [D106](#d106-verify-is-promoted-to-cognitive-primitive-7). Both ADRs remain immutable historical record; this draft adds "superseded by" banners only.

**Depends on:** [`docs/attest-recall-rename-impact.md`](attest-recall-rename-impact.md) (blast-radius catalog, repo sweep + npm registry check 2026-07-06) and, for sequencing, redesign step 5 (daemon consolidation) in [`docs/redesign-upgrade-path.md`](redesign-upgrade-path.md); step 6 lands with or after step 5 because the daemon is the cheapest alias mounting point.

## Context

atrib's agent-facing surface is seven monomorphic cognitive primitives ([D079](#d079-the-six-core-cognitive-primitives-atribs-agent-facing-surface), [D106](#d106-verify-is-promoted-to-cognitive-primitive-7)) shipped as seven npm packages exposing 15 physical MCP tools across 8 server identities. The 2026-07 clean-room redesign converged on two verbs: **`attest`** (write: emit/annotate/revise collapse to one handler with a `ref.kind` relationship qualifier) and **`recall`** (read: recall/trace/verify collapse under `shape` and `verification` parameters; summarize relocates to the harness). Two external forces make this the right moment:

1. **MCP goes stateless (spec final 2026-07-28).** Tool names now travel as `Mcp-Name` HTTP routing headers that servers must validate against the JSON-RPC body (SEP-2243), making them visible to gateways, load balancers, and operator allowlist rules, a de-facto sixth impact class (network middleboxes) on top of the catalog's five. `tools/list` responses become client-cacheable via `ttlMs`/`cacheScope` (SEP-2549), so a rename propagates on cache expiry, not deploy. And MCP sampling (the only mechanism by which a server borrows the client's model) enters deprecation, which is the protocol itself agreeing that `atrib-summarize` (a substrate primitive owning an LLM call) belongs in the harness.
2. **The naming is already inconsistent** (bare `emit`/`trace`/`summarize` vs prefixed `atrib-annotate`/`atrib-verify` vs `recall_*`), so the rename is also a normalization.

**The invariant conflict this draft must resolve, not paper over:** [D079](#d079-the-six-core-cognitive-primitives-atribs-agent-facing-surface) explicitly rejected polymorphic dispatch ("one tool, switch on event_type enum"). The collapse is not that shape, and the whole decision rests on that distinction. `attest` does not switch on an event_type enum: it has one cognitive purpose (make a signed statement now), and `ref.kind` is a declared-relationship qualifier whose two values map onto the two relationship-bearing normative event types that already exist. The event_type vocabulary, the required-args differences (a revision requires a target and a reason; an annotation requires a target), and the graph effects (ANNOTATES/REVISES edges per [§3.2.4](../atrib-spec.md#324-edge-derivation-rules)) all survive intact; they move from the tool-name axis to the argument axis. What [D079](#d079-the-six-core-cognitive-primitives-atribs-agent-facing-surface) protected that a bare parameter cannot replace is the *affordance*: a tool literally named `atrib-revise` in the tool list actively prompts mind-change recording; a `ref.kind` enum buried in a schema does not. This draft therefore keeps the seven legacy names permanently mountable as thin named aliases (opt-in, dispatching to the same two handlers), so hosts that want the affordance keep it. The [D080](#d080-primitive-lifecycle-extensions-first-dedicated-mcps-upon-promotion) promotion gate for *new* primitives is untouched.

**Critical-invariant posture.** No signed byte, log-entry byte, or canonicalization rule changes (verified below). No new event type is created, so the [D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary) gate is not invoked. Graph derivation is untouched: edges derive from signed record structure ([§3.2.4](../atrib-spec.md#324-edge-derivation-rules)), and the collapse still writes the identical `annotates`/`revises`/`informed_by` fields. Every producer-side moving part in the migration (alias mounts, forwarding shims, instrumentation writers, deprecation-warning paths) is bound by the [§5.8](../atrib-spec.md#58-degradation-contract) degradation contract: catch everything, `atrib:`-prefixed logging, never affect the primary call.

## Decision

Collapse the seven-primitive MCP surface to two verbs, **`attest`** (write) and **`recall`** (read), executed under the five-class migration rules below. `atrib-summarize` relocates to the harness with no successor package. The seven legacy tool names remain mountable as opt-in affordance aliases indefinitely; they retire from *default* tool lists only after an instrumentation-verified zero-dispatch cycle. Six of the seven published packages are deprecated with forwarding shims; `@atrib/recall` keeps its name and absorbs the read shapes (with the verify library scoped as an optional peer dependency, [§6](../atrib-spec.md#6-key-directory) N1); the unclaimed `@atrib/attest` name is claimed immediately. Zero signed bytes change.

## Mechanism

### 1. The `attest` tool (write verb)

One handler, delegating to the existing `handleEmit`/`emitInProcess` path in `@atrib/mcp` so signed bytes are identical by construction.

```json
{
  "content": { "kind": "insight", "body": "...", "topics": ["..."] },
  "ref": { "kind": "revises", "target": "sha256:<64 lowercase hex>", "reason": "..." },
  "informed_by": ["sha256:<64hex>"],
  "context_id": "<32hex, optional>",
  "provenance_token": "<optional, genesis-only per §1.2.6>",
  "tool_name": "<optional §8.2 disclosure>",
  "producer": "<optional sidecar label override>"
}
```

Exact `ref` → record mapping (exhaustive; anything else is a typed tool error and nothing is signed):

| `ref` | `event_type` (signed) | byte | signed relationship field |
|---|---|---|---|
| absent | `https://atrib.dev/v1/types/observation` | 0x03 | none |
| `{ "kind": "annotates", "target": h }` | `https://atrib.dev/v1/types/annotation` | 0x05 | `annotates: h` |
| `{ "kind": "revises", "target": h, "reason": r }` | `https://atrib.dev/v1/types/revision` | 0x06 | `revises: h` (reason lives in content, as today) |

Validation is the existing require/forbid invariant relocated: `target` must be `"sha256:" + 64 lowercase hex`; `reason` is required for `revises`; `annotates`/`revises` fields are forbidden on any record whose `ref` does not declare them. `informed_by` composes freely with any `ref` and keeps [D113](#d113-unvalidated-informed_by-refs-are-omitted-by-default) omit-unvalidated defaults. Content commitment keeps [D099](#d099-explicit-emit-records-commit-local-content-through-default-args_hash) default `args_hash`.

Success result (unchanged fields from today's emit family): `{ "record_hash", "context_id", "event_type", "chain_root", "mirror_path", "submitted" }`.

### 2. The `recall` tool (read verb)

One read-only handler; signs nothing. Absorbs the 8 recall tools, `trace`/`trace_forward`, and `atrib-verify`:

```json
{
  "shape": "history | walk | content | chain | annotations | revisions | orphans | by_signer",
  "direction": "backward | forward",
  "start": "sha256:<64hex>",
  "query": "<BM25 content query per D086>",
  "filters": { "creator_key": "...", "context_id": "...", "event_type": "...", "since": "...", "until": "...", "tool_name": "..." },
  "verification": { "mode": "handoff", "packet": { } },
  "limit": 20,
  "cursor": "<opaque explicit handle; never protocol-session state>"
}
```

Exact shape ↔ legacy map: `history` = `recall_my_attribution_history`; `walk` (+`direction`, `start`) = `recall_walk`/`trace`/`trace_forward`; `content` (+`query`) = `recall_by_content`; `chain` = `recall_session_chain`; `annotations`/`revisions`/`orphans`/`by_signer` = their `recall_*` namesakes. Per-shape required args are validated (e.g. `walk` requires `start`). The `verification` parameter runs the `@atrib/verify-mcp` Pattern 3 handoff-acceptance logic and attaches its tiered result to the response; `@atrib/verify` (the library) is not renamed, and its dependency relationship to `@atrib/recall` is scoped in [§6](../atrib-spec.md#6-key-directory) N1 (optional peer, lazy-loaded; never a hard dependency). Every compact result keeps `record_hash` so callers can chain shapes, preserving the [D084](#d084-read-primitive-instrumentation-for-empirical-loop-closure-measurement) contract. There is no `summarize` shape: the read surface returns verified material; the caller synthesizes (MCP sampling deprecation).

### 3. Context identity and chain precedence (deferred to one canonical ladder)

This ADR changes no resolution semantics and, deliberately, defines no precedence list of its own. The two-verb handlers keep calling the existing implementations unchanged:

- **Inbound token resolution:** `readInboundContext` in `packages/mcp/src/context.ts`, which today resolves `_meta.atrib` > `_meta.tracestate` `atrib=` entry ([§1.5.4](../atrib-spec.md#154-mcp-transport-params_meta)) > `X-Atrib-Chain` fallback ([§1.5.3](../atrib-spec.md#153-http-fallback-x-atrib-chain)).
- **`context_id` defaulting:** `resolveEnvContextId` in `packages/mcp/src/harness-context.ts`: `ATRIB_CONTEXT_ID` env ([D078](#d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default)) > harness registry env ([D083](#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers)) > [D083](../DECISIONS.md#d083-harness-session-id-discovery-extends-d078d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default-for-cognitive-primitive-mcp-servers) v2/v3 file fallback > undefined; an explicit tool argument always wins before defaulting is consulted.
- **Chain-root resolution:** `resolveChainRoot` per [D067](#d067-multi-producer-chain-composition-precedence-contract) against the existing multi-producer corpus, never reimplemented.

Two sibling candidate ADRs (daemon consolidation, redesign step 5; and the prospective `dev.atrib` MCP-extension ADR) also touch inbound resolution for the MCP-stateless world. To prevent three ADRs shipping three divergent normative precedence lists, the merged inbound-resolution ladder MUST be canonicalized in exactly one place (either the spec, [§1.5.3](../atrib-spec.md#153-http-fallback-x-atrib-chain)-[§1.5.4](../atrib-spec.md#154-mcp-transport-params_meta), or whichever of those ADRs lands first), and this ADR binds to that definition by reference. Acceptance of this ADR is conditioned on that owner existing (open question 5); until then the implemented behavior of `readInboundContext`/`resolveEnvContextId`/`resolveChainRoot` is the de-facto contract and this ADR does not alter it.

### 4. Signed-bytes invariant (class d): confirmed, and where it is proven

The registered MCP tool name never enters a signed record, so the rename changes zero signed bytes. Proven at four points, verified in the catalog's "Headline" section and re-verified against source for this draft:

1. `content_id` derives from the constant `SYNTHETIC_SERVER_URL = 'mcp://atrib-emit'` (`services/atrib-emit/src/sign.ts:29`) plus the **event_type URI leaf**, via `packages/mcp/src/content-id.ts`, never from the tool name.
2. `event_type` values are the URI constants in `packages/mcp/src/types.ts:157-176`, fixed by the normative vocabulary ([D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary)); no new event type is created.
3. The optional signed `tool_name` field is caller-supplied [§8.2](../atrib-spec.md#82-opaque-name-posture) disclosure, independent of what the tool is named.
4. The read servers sign nothing.

**Frozen constants (normative for this ADR):** `SYNTHETIC_SERVER_URL = 'mcp://atrib-emit'` is frozen permanently as an opaque historical constant, including inside `@atrib/attest`. Renaming it would fork `content_id` across the rename date, splitting recall groupings for zero verifier value. The six event-type URIs and the `content_id` derivation are likewise pinned (mechanically, by the new corpus, family 6 below). Records signed before and after the rename are byte-identical in canonical form and mutually verifiable; the emit/annotate/revise byte-identity invariant survives by construction because both names call one handler.

### 5. Alias-window rules (exact)

- **W1: additive mount first.** Mount `attest` and `recall` as *additional* tools on every existing server and the primitives runtime/daemon. Union = 15 legacy names + 2 new names. Old-name and new-name calls with equivalent args MUST produce identical canonical signed bytes given identical key/timestamp/chain inputs (corpus family 1).
- **W2: `ttlMs` bound (SEP-2549).** For the whole window, every server advertises `ttlMs ≤ 300000` (5 min; operator-tunable) on `tools/list`. A name may leave a default list only after (a) elapsed time ≥ the maximum `ttlMs` that deployment ever advertised plus one deploy cycle, AND (b) gate W4. Retiring a name while a cached list still offers it produces hard failures on stateless retries; this rule is what prevents that.
- **W3: `Mcp-Name` consistency (SEP-2243).** Both name sets must pass header validation for the whole window. `@atrib/mcp-wrap` MUST rewrite the `Mcp-Name` header and the JSON-RPC body tool name atomically; a mismatch is a stateless-server rejection. Operators with header-based middlebox rules (impact class f) add the new names to allowlists *before* W5.
- **W4: instrumentation retirement gate.** A legacy name leaves default `tools/list` only after a full measurement cycle (proposed 30 days) of zero dispatches on that name: reads measured via the `primitive` field in `~/.atrib/state/read-primitives/calls.jsonl` ([D084](#d084-read-primitive-instrumentation-for-empirical-loop-closure-measurement)); writes via `_local.producer` counts in mirrors.
- **W5: behavioral flip strictly inside the window.** After W1 is live everywhere and before any retirement: `skills/atrib/SKILL.md` frontmatter allowed-tools (the fully-qualified `mcp__<server>__<tool>` strings; a stale list means the agent cannot invoke the tool at all) and imperative body guidance; host hook prompts; operator MCP client configs; and the health-gate pins in `scripts/update-primitives-runtime.mjs` (`EXPECTED_PRIMITIVE_TOOLS`, `EXPECTED_TOOL_NAMES`, `EXPECTED_BEHAVIORAL_PROBES`) plus companion topology scripts, which hold the *union* during the window per [D128](#d128-host-owned-primitive-runtime-updates-are-build-restart-direct-probe)-[D130](#d130-primitive-runtime-health-uses-non-mutating-behavioral-probes).
- **W6: affordance aliases are permanent, opt-in.** After default retirement, the seven legacy names remain mountable via config (e.g. `ATRIB_MOUNT_LEGACY_PRIMITIVE_ALIASES=1`), preserving the [D079](#d079-the-six-core-cognitive-primitives-atribs-agent-facing-surface) affordance argument. The packages never hard-remove the names.

### 6. npm sequence (all seven published; `@atrib/attest` unclaimed as of 2026-07-06)

- **N0.** Claim `@atrib/attest` immediately (placeholder publish per [`docs/publishing-new-npm-package.md`](publishing-new-npm-package.md), README pointing at this ADR) to close the squat window; keep it in the `.changeset/config.json` first-publish ignore list until the real publish (`check-release-publish-readiness.mjs`).
- **N1.** Implementation inversion. `@atrib/attest` becomes the write-verb home (handler + server + `atrib-attest` bin, mounting `attest` plus the three legacy write names). `@atrib/emit`, `@atrib/annotate`, `@atrib/revise` publish new majors as thin shims depending on `@atrib/attest`, re-exporting old symbols and forwarding old bins (`atrib-emit`, `atrib-emit-cli`, `atrib-local-substrate`, `atrib-annotate`, `atrib-revise`). `@atrib/recall` keeps its name and publishes a new major absorbing `walk` shapes and the `verification` parameter. **Verify-dependency scoping (explicit, because pulling the full verifier stack into every recall install would contradict the primitive's narrow bash-standard framing):** the `verification` parameter consumes exactly two functions plus their result types from the verify library: `handoffClaimsFromEvidencePacket` and `verifyHandoffClaims` (`HandoffEvidencePacket`, `HandoffClaimVerification`, `HandoffVerificationResult`), the same surface `services/atrib-verify/src/index.ts` imports today. But `@atrib/verify`'s module closure transitively reaches the [D090](#d090-ap2-receipt-jwt-verification-uses-jose-in-atribverify)/[D091](#d091-ap2--vi-sd-jwt-conformance-uses-openwallet-sd-jwt-js) JOSE/SD-JWT stack (`handoff.ts` → `verify-record.ts` → `ap2-vi-evidence.ts` → `jose`, `@sd-jwt/*`), so `@atrib/verify` becomes an **optional peer dependency** of `@atrib/recall`, dynamically imported on first use of `verification`. When unresolvable, the read itself succeeds and the `verification` block returns a typed `{ "status": "verifier_unavailable" }` result, the [§5.8](../atrib-spec.md#58-degradation-contract) posture; degraded verification never blocks a read. The daemon/primitives-runtime topology always bundles `@atrib/verify` (it already depends on it via `@atrib/verify-mcp` today), so dogfood behavior is unchanged; only standalone `@atrib/recall` installs get lighter. A leaner cut (a documented `@atrib/verify/handoff` subpath or split package) requires first restructuring the verify library's evidence closure behind lazy imports; deferred as open question 6, not a blocker. `@atrib/trace` and `@atrib/verify-mcp` become shims depending on `@atrib/recall`. `@atrib/summarize` gets no successor.
- **N2.** `@atrib/mcp` keeps its name; exports `handleAttest`/`attestInProcess` as primary with `handleEmit`/`emitInProcess` retained as documented aliases (never removed by this ADR). The ~30 verb-embedded API symbols (`EmitInput`, `createAtribTraceServer`, `handleAtribVerify`, …) gain new-named exports with old names kept as deprecated aliases.
- **N3.** Targeted deprecation *after* shim majors are live: `npm deprecate` the pre-shim ranges (`<shim-major`) so installed old versions warn while the shim line stays clean. Message templates: `@atrib/emit`: "Superseded by @atrib/attest (write verb). Signed records are byte-identical; existing mirrors and records stay valid. See DECISIONS.md D0XX." Annotate/revise: "...folds into @atrib/attest ref.kind=annotates|revises...". `@atrib/trace`: "...folds into @atrib/recall shape=walk...". `@atrib/verify-mcp`: "...folds into @atrib/recall verification parameter; the @atrib/verify library is unaffected...". `@atrib/summarize`: "Relocates to the harness (MCP sampling deprecation); no successor package. Records and mirrors are unaffected." Full-package (`"*"`) deprecation only at end-of-life, ≥1 major cycle later.
- **N4.** Workspace mechanics in lockstep: new workspace dir, `pnpm-lock.yaml`, workspace globs, changesets config; annotate/revise/trace/verify-mcp dependency edges flip; `@atrib/primitives-runtime` depends on the two new homes.

### 7. Persisted-data acceptance rules (class c: old strings valid forever)

- **L1: `_local.producer` is an opaque pass-through, permanently.** Historical values (`'atrib-emit'`, `'atrib-annotate'`, `'atrib-revise'`, `'atrib-emit-cli'`, hook-stamped labels) remain valid forever. Verified in the catalog: no consumer filters or joins on hardcoded producer equality (`resolveDisplayProducer` and the recall/trace indexing paths are pass-through), so no compatibility shim is needed. New writers stamp `'atrib-attest'` / `'atrib-attest-cli'`; the envelope `producer` override survives per the [§5.9.3](../atrib-spec.md#593-the-_local-sidecar-shape) sidecar contract.
- **L2: `calls.jsonl` `primitive` field.** Analyzers accept the union of legacy tool names and new `recall`+shape values; per-tool time series carry a rename-date discontinuity annotation. History is never rewritten.
- **L3: mirror filename.** The default write pattern `~/.atrib/records/atrib-emit-<agent>.jsonl` is frozen (same posture as `SYNTHETIC_SERVER_URL`); existing files keep their names forever and readers glob both patterns if a new one is ever adopted (open question 4).
- **L4: coordinator wire strings.** `source: '@atrib/emit'` in local-substrate WAL/receipts and `primitive: 'atrib-verify'` in captured verify responses remain valid history; new values are additive; consumers treat both as opaque.

## Compatibility and migration

- **Existing signed records:** untouched and untouchable (class d, [§4](../atrib-spec.md#4-attribution-policy-format) above). Every historical record verifies with post-rename verifiers, and post-rename records verify with pre-rename verifiers; corpus family 1 pins a pre-rename fixture that must verify forever. Log entries (90-byte format), event_type bytes 0x03/0x05/0x06, JCS canonicalization, and edge derivation are all unchanged.
- **Published packages:** never unpublished (npm forbids it); six of seven deprecate onto shims per [§6](../atrib-spec.md#6-key-directory); shims held ≥1 major cycle; `@atrib/verify` (which becomes an optional peer of `@atrib/recall`, N1), `@atrib/mcp-wrap` (`atrib-wrap` bin), `@atrib/cli` (`atrib` bin), and `@atrib/runtime-log` are explicitly not renamed.
- **Deployed services:** log-node, graph-node, directory-node, archive-node, and the dashboard are out of blast radius (catalog-verified: dashboard has zero tool-name occurrences; the metrics pipeline keys on event_type bytes, never tool or producer names). The primitives runtime/daemon carries the alias union and, per the MCP stateless release, drops `Mcp-Session-Id` machinery independently under redesign step 5.
- **Operator machines (class e):** launchd labels (`com.nader.atrib-primitives.<profile>`, `com.nader.atrib-drain`) embed the runtime name, not a verb: no label rename, but plists that exec legacy bins are updated in an operator runsheet; health-gate and topology scripts pin the tool union during the window (W5); operator MCP client configs and the live SKILL.md symlink flip inside the window; env keys gain new-name variants with old keys honored indefinitely (precedence: new key > old key; divergence logs an `atrib:`-prefixed warning, silent-failure-safe); Keychain `atrib-creator*` services are explicitly out of scope.
- **Degradation:** every shim, alias mount, forwarding bin, instrumentation writer, deprecation path, and the optional-peer `verification` loader obeys [§5.8](../atrib-spec.md#58-degradation-contract): a failed alias lookup, a stale cached tool list, or an unresolvable verify peer must never corrupt or block a write or read that reaches the handler.

## Conformance-corpus plan

New named directory `spec/conformance/attest-recall/` (named-directory precedent: `ap2-vi-crypto/`, `runtime-log/`, `local-substrate-coordinator/`), landing in the same commit as the ADR per the upgrade-path rule. Case families:

1. **`byte-identity/`**: fixed key, timestamp, and chain tail: `emit` vs `attest` (no `ref`); `atrib-annotate` vs `attest` (`ref.kind: annotates`); `atrib-revise` vs `attest` (`ref.kind: revises`) → identical JCS canonical bytes and signatures. Plus one pre-rename historical record fixture that MUST verify unchanged under the post-rename verifier.
2. **`ref-mapping/`**: adversarial: unknown `ref.kind`; missing/malformed `target`; missing `reason` on revises; `annotates`/`revises` field present without the matching `ref`; `ref` composed with `informed_by` (allowed) and with `provenance_token` genesis rules.
3. **`read-equivalence/`**: one fixed mirror fixture; a `shape` vector for each of the 8 legacy recall tools plus `trace`/`trace_forward` whose result set and ordering MUST match the legacy handler JSON-for-JSON; `verification` vectors mirroring the Pattern 3 accept/reject cases, plus a verify-peer-absent vector that MUST return the typed `verifier_unavailable` block while the read result is unchanged; `record_hash` presence on every compact result.
4. **`alias-window/`**: `tools/list` union with `ttlMs` advertised; `Mcp-Name` header/body mismatch MUST reject; `@atrib/mcp-wrap` atomic-rewrite vectors (header and body consistent after in-flight rewrite).
5. **`persisted-labels/`**: mixed old/new `_local.producer` mirrors and mixed `primitive` calls.jsonl fixtures that indexing and the [D084](#d084-read-primitive-instrumentation-for-empirical-loop-closure-measurement) analyzer MUST accept.
6. **`frozen-constants/`**: pins `'mcp://atrib-emit'`, the six event-type URIs, and expected `content_id` outputs per event kind.

Consumed by `@atrib/attest` and `@atrib/recall` tests, the primitives-runtime/daemon protocol tests (which currently hardcode the sorted 15-tool list; those pins become union pins), `@atrib/mcp-wrap` tests, and the analyzer tests.

## Alternatives rejected

- **Rename tool names without collapsing (pure cosmetics).** Pays the full class (b)/(e) migration cost while dissolving none of the operational surface (per-primitive spawn topology, 15-name health-gate pins) the collapse exists to remove.
- **Big-bang rename with no alias window.** SEP-2549 cached tool lists and live SKILL.md symlinks on operator machines guarantee stale-name dispatch; on stateless HTTP that is a hard failure, not a graceful one.
- **Polymorphic single tool switching on an event_type enum** (the exact shape [D079](#d079-the-six-core-cognitive-primitives-atribs-agent-facing-surface) rejected). Still rejected. `attest` does not select among arbitrary event types; `ref.kind` qualifies a declared relationship within one write purpose, required args stay distinct per kind, and the affordance is preserved via permanent opt-in aliases (W6). This ADR supersedes [D079](../DECISIONS.md#d079-the-six-core-cognitive-primitives-atribs-agent-facing-surface)'s surface count, not its monomorphic bar.
- **Renaming `SYNTHETIC_SERVER_URL` to `'mcp://atrib-attest'`.** Would fork `content_id` for new records across the rename date, splitting the "all observations share content_id" continuity for zero verifier value. Frozen instead.
- **`@atrib/recall` hard-depending on `@atrib/verify`.** Would pull the full [D090](#d090-ap2-receipt-jwt-verification-uses-jose-in-atribverify)/[D091](#d091-ap2--vi-sd-jwt-conformance-uses-openwallet-sd-jwt-js) JOSE/SD-JWT evidence stack into every standalone recall install for a parameter most reads never pass, contradicting the primitive's narrow-input framing. Optional peer + lazy dynamic import + typed `verifier_unavailable` degradation keeps the read primitive lean while the daemon topology bundles the verifier (N1).
- **Restating a rename-local context/chain precedence ladder.** Three concurrent candidate ADRs touching inbound resolution would ship three divergent normative lists; this ADR binds by reference to the single canonical ladder ([§3](../atrib-spec.md#3-graph-query-interface)) instead of defining a fourth.
- **Rewriting historical producer labels, `primitive` values, or mirror filenames.** Class (c) history is never rewritten: annotate the analysis, don't touch the data.
- **Renaming `@atrib/verify` (library) or the `atrib-wrap`/`atrib`/`atrib-runtime-log` bins.** The verify library is a verifier, not the primitive; the others don't carry the renamed verbs.
- **Keeping `summarize` as an MCP primitive.** MCP sampling is deprecated in the 2026-07-28 release; a substrate primitive that owns an LLM call swims against the protocol's current. The read surface returns verified material; the caller synthesizes.
- **Calendar-only retirement (no instrumentation gate).** [D084](#d084-read-primitive-instrumentation-for-empirical-loop-closure-measurement) exists precisely so retirement can be measured rather than guessed; W4 uses it.

## Doc-sync impact

- **`scripts/check-doc-sync.mjs`:** Check 4 (every workspace package dir in CLAUDE.md's tree; the "twenty-nine" number-word vs the `@atrib/*` bullet count) and Check 5 (README's "Seventeen designed-public packages" vs the non-private package.json count) both fire on the package additions and the eventual collapse, self-healing by updating prose in the same commits. **New checks added by this ADR:** (a) a primitive-surface check pinning the alias-window tool union against the registration sites, giving the window mechanical enforcement; (b) a `DOC-SYNC-TRIGGERS.md` row-count check against CLAUDE.md's parenthetical, per the repo's extend-the-script guidance (see next bullet).
- **`DOC-SYNC-TRIGGERS.md`:** five existing rows updated, cited here by row text rather than line or row number because the two numbering schemes have already diverged (CLAUDE.md says the table has "52 rows"; it has ~64 data rows): "Local mirror envelope or sidecar shape changed" and "OpenInference local sidecar content convention changed" (sidecar-consumer coordination rows), "Harness session-id discovery registry extended" ([D083](#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers)), "Mirror sidecar producer label conventions extended" (gains the `'atrib-attest'` family), and "Read-primitive instrumentation surface extended" ([D084](#d084-read-primitive-instrumentation-for-empirical-loop-closure-measurement)). New rows land for the attest/recall surface itself. **Same commit:** CLAUDE.md's stale "(52 rows)" parenthetical is corrected to the actual data-row count and pinned by the new check-doc-sync row-count check above.
- **Anchor hygiene (same commit):** this ADR links [D079](#d079-the-six-core-cognitive-primitives-atribs-agent-facing-surface) and [D080](#d080-primitive-lifecycle-extensions-first-dedicated-mcps-upon-promotion) with their real GitHub slugs (the headings contain commas, which slug to single hyphens). CLAUDE.md, README.md, and several older ADR cross-references carry stale double-hyphen variants of both slugs that have never resolved. Since this ADR already edits those documents' primitive sections (banners, enumerations), the stale slugs are normalized in the same pass rather than propagated further.
- **`DECISIONS.md`:** this ADR plus supersession banners on [D079](#d079-the-six-core-cognitive-primitives-atribs-agent-facing-surface) and [D106](#d106-verify-is-promoted-to-cognitive-primitive-7); the seven-verb table stays as historical record (ADRs are immutable per the [D082](#d082-cli-binary-distribution-of-emitinprocess-supersedes-d081s-integration-shape) precedent).
- **`CLAUDE.md`** (43 hits): opening primitive enumeration, repository-structure tree (`services/atrib-*`), monorepo counts, and the "Seven core cognitive primitives" key-decision bullet. **`README.md`** (26 hits): packages table, counts, product copy. **`ARCHITECTURE.md`** (9 hits). **`docs/concepts/11-cognitive-primitives.md`** plus the concepts index and docs 13-14. All seven `services/atrib-*/README.md` plus primitives-runtime, mcp, verify, and integration READMEs; npm `description` fields.
- **`skills/atrib/SKILL.md`** (67 hits): *behavioral, not descriptive*: its frontmatter allowed-tools list hard-codes `mcp__<server>__<tool>` dispatch strings and is symlinked live into `~/.claude/skills` and `~/.agents/skills`; it flips inside the alias window (W5), never as a docs-only pass.
- **`atrib-spec.md`** (~17 lines, narrative only): example updates in [§1.2.3.1](../atrib-spec.md#1231-multi-producer-chain-composition), [§5.9.3](../atrib-spec.md#593-the-_local-sidecar-shape), [§7.2](../atrib-spec.md#72-the-recall-tool-pattern) (canonical example), [§7.8](../atrib-spec.md#78-cross-harness-continuation-packets), and the [§9](../atrib-spec.md#9-runtime-integration-patterns) hook examples. **The spec never normatively fixes MCP tool-name strings**, so no normative spec edit is required, and the event_type vocabulary is untouched.
- **Verified out of blast radius** (no edits): apps/dashboard, the metrics pipeline, proof-packets/, policies/, DESIGN.md, METRICS.md, PRIOR-ART.md, and the GitHub repo description.

**Total blast radius** (from the catalog): ~15 tool strings + 8 server names + ~30 published API symbols + 8 package names + ~10 bins (classes a/b); 4 producer labels + 1 jsonl field + 1 filename pattern accepted forever (class c); **zero signed bytes** (class d); 2 launchd label families + ~5 pinning scripts + operator client configs + the live SKILL.md symlink (class e); network middleboxes via `Mcp-Name` (class f); ~1,024 documentation occurrences across 122 files, of which only SKILL.md is behavioral.

## Open questions (operator decisions)

- Sequencing: does the rename land strictly after daemon consolidation (redesign step 5), with aliases mounted only on the daemon, or may W1 alias mounts ship on the seven standalone stdio servers first so the window opens before the daemon lands?
- Alias-window parameters need operator sign-off: the W2 ttlMs ceiling (proposed 300000 ms) and the W4 zero-dispatch measurement cycle length (proposed 30 days) are proposals, not measurements.
- Are the verbs attest/recall final? N0 (claiming @atrib/attest on npm) makes the write verb publicly visible before the ADR is accepted; if the verb is still negotiable, N0 should wait or use a private placeholder.
- Mirror filename pattern: keep ~/.atrib/records/atrib-emit-<agent>.jsonl frozen permanently (current L3 posture), or adopt atrib-attest-<agent>.jsonl for newly created agents with dual-pattern globbing in every reader?
- Which document owns the merged context-identity / inbound-token precedence ladder that this ADR, the step-5 daemon ADR, and the prospective dev.atrib MCP-extension ADR must all cite: the spec ([§1.5.3](../atrib-spec.md#153-http-fallback-x-atrib-chain)-[§1.5.4](../atrib-spec.md#154-mcp-transport-params_meta)) or the first of those ADRs to land? This ADR only binds by reference and is conditioned on the owner existing.
- Should @atrib/verify restructure its evidence closure (lazy dynamic imports of jose/@sd-jwt behind verifyRecord's evidence path, or a documented lean handoff subpath/split package) so @atrib/recall's verification path can eventually drop the optional-peer install entirely, and should that restructuring precede or follow the recall major?
- Anchor normalization scope at integration: fix the stale double-hyphen [D079](../DECISIONS.md#d079-the-six-core-cognitive-primitives-atribs-agent-facing-surface)/[D080](../DECISIONS.md#d080-primitive-lifecycle-extensions-first-dedicated-mcps-upon-promotion) slugs everywhere they appear repo-wide (CLAUDE.md, README.md, older ADR cross-references), or retitle the two DECISIONS.md headings to match the established slug convention, and should check-doc-sync.mjs gain an anchor-resolution check to prevent recurrence?
- Retirement default for hosted/managed deployments: W4 measures the operator's own instrumentation; is a legacy name allowed to retire from the published packages' default mounts based on dogfood-only zero-dispatch data, or must retirement wait for a public deprecation period regardless of measured usage?
