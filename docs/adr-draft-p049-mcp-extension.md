# P049 candidate ADR draft: dev.atrib/attribution: atrib's propagation and attestation surface as a first-class MCP extension (SEP-2133)

Status: historical candidate draft. Implemented as [D141](../DECISIONS.md#d141-devatribattribution-first-class-mcp-extension-sep-2133). Generated 2026-07-06 by the redesign-overhaul workflow; source plan: [redesign-upgrade-path.md](redesign-upgrade-path.md).

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

## DXXX: `dev.atrib/attribution`: atrib as a first-class MCP extension (SEP-2133)

**Date:** 2026-07-06 (draft; pre-ADR)

**Status:** Draft

**Extends:** [D018](#d018-w3c-trace-context-and-baggage-conformance-leftmost-atrib-lenient-parse-evict-from-end-on-overflow),
[D067](#d067-multi-producer-chain-composition-precedence-contract),
[§1.5.4](../atrib-spec.md#154-mcp-transport-params_meta), and the
"MCP goes stateless" section of
[`docs/redesign-upgrade-path.md`](redesign-upgrade-path.md).

### Context

The MCP 2026-07-28 release (RC locked 2026-05-21, final spec three weeks out)
removes the `initialize` handshake and `Mcp-Session-Id`; protocol version,
client info, and client capabilities now travel in `params._meta` on every
request, and W3C Trace Context keys (`traceparent`, `tracestate`, `baggage`)
inside `_meta` are spec-documented. SEP-2133 makes extensions first-class:
reverse-DNS identifiers (`{vendor-prefix}/{extension-name}`), negotiation
through an `extensions` map on `ClientCapabilities` / `ServerCapabilities`
(carried per-request in `_meta` under
`io.modelcontextprotocol/clientCapabilities`, advertised server-side in the
mandatory `server/discover` response), independent versioning, mandatory
graceful degradation, and a governance ladder: Unofficial (own prefix, no
permission needed) → Experimental (`experimental-ext-*` repos, WG-associated) →
Official (Extensions Track SEP, review by the MCP core maintainers, reference
implementation in an official SDK required).

atrib's MCP surface today is a convention: `@atrib/mcp` middleware reads
inbound context from `params._meta.atrib` > `_meta.tracestate` (`atrib=`
entry per [D018](#d018-w3c-trace-context-and-baggage-conformance-leftmost-atrib-lenient-parse-evict-from-end-on-overflow) /
[§1.5.2](../atrib-spec.md#152-http-transport-tracestate)) > `_meta['X-Atrib-Chain']`
(`readInboundContext` in [`packages/mcp/src/context.ts`](../packages/mcp/src/context.ts)),
derives `context_id` from the `traceparent` trace-id and `session_token` from
`baggage` when present, and writes the propagation token back into the tool
result's `_meta` (`writeOutboundContext`). This works, but nothing about a
server tells a client "tool calls here produce signed, log-committed
attribution records" before the first call, nothing negotiates whether the
caller wants receipts, and the bare `atrib` `_meta` key is exactly the kind of
unprefixed implementation-specific key the new namespace discipline exists to
replace (extension `_meta` keys must be vendor-prefixed; only
`io.modelcontextprotocol/*` and `progressToken` are core-reserved).

One coordination problem is internal: three candidate ADRs from the same
redesign window touch inbound context resolution: this one (a new extension
carrier), the daemon-consolidation draft (redesign step 5, `atribd`, which
sketches an HTTP-era ladder of "explicit `context_id` argument > `_meta.atrib`
> `_meta.tracestate`" that omits both the extension rung and the
`X-Atrib-Chain` fallback the code implements today), and the attest/recall
rename draft (which restates the [D078](#d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default)/[D083](#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers)
env ladder). Three independently restated rung lists will drift. This ADR
therefore claims ownership of the merged definition (see Mechanism) and the
other two drafts defer to it by citation.

The ecosystem research (2026-07-06) shows the slot is open and closing: no
extension, SEP, or working group exists for signed, independently verifiable
action records; gateway vendors sell operator-trusted audit logs;
tool-definition signing (ETDI et al.) is pre-execution; Web Bot Auth / ATP /
Workload Identity Federation are identity-scoped; C2PA is content-scoped. The
Interceptors WG (SEP-2624) is standardizing the middleware mounting layer
atrib's wrappers occupy. The reverse-DNS identifier and the framing are
first-mover assets that expire around the 2026-07-28 final-spec news cycle.

### Decision

Publish an MCP extension specification with identifier
**`dev.atrib/attribution`** (vendor prefix `dev.atrib`, the reverse of
atrib.dev, which the project controls; the second label is not `mcp` or
`modelcontextprotocol`, so the prefix is legal under SEP-2133's reserved-prefix
rule). The extension declares three things and changes no signed byte:

1. **Server-side signing capability**: a server advertises that tool calls
   produce Ed25519-signed atrib records, with advisory metadata (event types
   signed, disclosure posture per [§8.3](../atrib-spec.md#83-salted-commitment-posture),
   expected creator key, log endpoints).
2. **Propagation carriage**: a vendor-prefixed `_meta` block carrying exactly
   two fields in v0.1: the existing 87-char propagation token
   ([§1.5.2](../atrib-spec.md#152-http-transport-tracestate)) and explicit
   `context_id`. This ADR also lands the single canonical inbound resolution
   definition (two ladders, defined below) as normative
   [§1.5.4](../atrib-spec.md#154-mcp-transport-params_meta) text.
3. **Attestation receipts in tool results**: when (and only when) the client
   declared the extension on that request, the server returns a receipt block
   in `result._meta` naming the record it just signed, optionally with the
   full signed record body for immediate Tier-3 verification.

`@atrib/mcp` middleware and `@atrib/agent` become the reference
implementations of the server and client sides respectively; `@atrib/mcp-wrap`
becomes the shim that makes any non-adopting upstream server
extension-conforming. The strategic shift: atrib stops being only "a wrapper
you install" and becomes "a capability a server declares". Any server, in any
language, can implement the extension spec directly and validate against the
conformance corpus without any atrib package.

The existing unprefixed convention (`_meta.atrib`, `tracestate` `atrib=`,
`X-Atrib-Chain`) remains fully supported and is the documented fallback. The
extension is upside, not a dependency.

### Mechanism

**Extension identity.** Identifier `dev.atrib/attribution`. Settings-object
`version: "0.1"`. Per SEP-2133, breaking changes require a new identifier
(`dev.atrib/attribution-v2`); non-breaking evolution uses settings fields.

**Server capability declaration** (returned in the `server/discover`
response's `capabilities`; for legacy protocol versions ≤ 2025-11-25, in the
`initialize` result):

```json
{
  "capabilities": {
    "tools": {},
    "extensions": {
      "dev.atrib/attribution": {
        "version": "0.1",
        "signs": ["tool_call"],
        "receipts": ["token", "record"],
        "disclosure": { "args": "plain-sha256", "result": "omit" },
        "creator_key": "Kp2f...43-char-base64url",
        "logs": ["https://log.atrib.dev/v1"],
        "directory": "https://directory.atrib.dev/v1"
      }
    }
  }
}
```

Every field beyond `version` is OPTIONAL and **advisory**. Per SEP-2133's
security requirements, extension-introduced data is untrusted; capability
declarations are hints for pre-call decisions (e.g. a client or gateway
pinning `creator_key`, or checking a [D051](#d051-capability-scoped-records-via-directory-published-envelopes)
capability envelope via the directory per
[§6.7](../atrib-spec.md#67-capability-declarations)). Trust derives only from
verifying signed records and inclusion proofs, never from the capability map.
A receipt whose `creator_key` differs from a pinned declaration is a
verifier-side signal (like `in_envelope: false`), not a protocol error.

**Client capability declaration** (per-request, inside the mandatory
stateless-era `_meta` block):

```json
"_meta": {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": { "name": "my-agent", "version": "1.2.0" },
  "io.modelcontextprotocol/clientCapabilities": {
    "extensions": {
      "dev.atrib/attribution": { "version": "0.1", "accept": ["token", "record"] }
    }
  }
}
```

`accept` negotiates receipt verbosity: `"token"` alone means
token-only receipts; adding `"record"` requests full signed record bodies.

**Request carriage** (client → server). The extension reserves the `_meta` key
`dev.atrib/attribution` on requests. The v0.1 block carries exactly two
fields, `token` and `context_id`; unknown fields are ignored (forward
compatibility), and no other field is defined:

```json
"params": {
  "name": "search_web",
  "arguments": { "query": "..." },
  "_meta": {
    "dev.atrib/attribution": {
      "token": "R9vN...43chars.Kp2f...43chars",
      "context_id": "0f2a...32hex"
    },
    "traceparent": "00-4bf92f35...-00f067aa...-01",
    "tracestate": "atrib=R9vN...43chars.Kp2f...43chars",
    "baggage": "atrib-session=..."
  }
}
```

`token` is the unchanged [§1.5.2](../atrib-spec.md#152-http-transport-tracestate)
propagation token. `context_id` is the raw 32-hex session anchor, carried
explicitly per the stateless model, the MCP-transport analog of the
[§1.5.3.1](../atrib-spec.md#1531-context-id-header-x-atrib-context)
`X-atrib-Context` HTTP header, and the carriage form of the posture
[D135](#d135-delegated-builder-atrib-context-threads-via-orchestrator-injected-explicit-args)
already chose (orchestrator-injected explicit context over ambient env/file).
The legacy `tracestate` carriage per
[D018](#d018-w3c-trace-context-and-baggage-conformance-leftmost-atrib-lenient-parse-evict-from-end-on-overflow)
continues to be written alongside.

**Deliberately excluded from v0.1: `session_token` and `provenance_token`.**
Both were candidates and both are cut, for the same reason: each already has
exactly one carrier with defined semantics, and adding a second carrier
without a conflict rule against existing producer state would be worse than
not carrying it. `session_token` already travels normatively in `baggage`
under `atrib-session` ([§1.5.5](../atrib-spec.md#155-cross-trace-session-continuity),
a MUST, including for MCP `_meta`), and `@atrib/agent` accumulates session
state across calls; a second inbound carrier would need
accumulated-vs-inbound precedence semantics that nothing currently requires.
`provenance_token` is genesis-record-only and scoped to session ancestry
([§1.2.6](../atrib-spec.md#126-provenance_token)); it is host/orchestrator
configuration for the *start* of a session, not per-request transport state,
and carrying it on every tool call invites producers to stamp it on
non-genesis records. Either field can be added in a later settings version
only together with an explicit conflict rule and conformance vectors.

**Canonical inbound resolution (owned by this ADR).** Landing this ADR
rewrites [§1.5.4](../atrib-spec.md#154-mcp-transport-params_meta) to carry the
following as the single normative definition of MCP inbound-carrier
resolution. Two ladders, because two distinct values are being resolved. The
daemon-consolidation ADR (redesign step 5, `atribd`) and the attest/recall
rename ADR MUST cite [§1.5.4](../atrib-spec.md#154-mcp-transport-params_meta)
for these ladders instead of restating rung lists; the step-5 draft's current
three-rung sketch ("explicit `context_id` argument > `_meta.atrib` >
`_meta.tracestate`") is subsumed here: it conflated the two ladders and
omitted the `X-Atrib-Chain` fallback
[`packages/mcp/src/context.ts`](../packages/mcp/src/context.ts) implements today.

*Ladder 1: propagation token (resolves the inbound chain token):*

```
_meta["dev.atrib/attribution"].token   (new, extension)
  > _meta.atrib                        (existing convention)
  > _meta.tracestate atrib= entry      (D018 / §1.5.2)
  > _meta["X-Atrib-Chain"]             (§1.5.3 fallback)
```

This refines only the "inbound propagation token" rung of the
[D067](#d067-multi-producer-chain-composition-precedence-contract) /
[§1.2.3.1](../atrib-spec.md#1231-multi-producer-chain-composition) chain-root
ladder. The ladder itself (inbound token > within-process autoChain tail >
`ATRIB_CHAIN_TAIL_<context_id>` env > mirror inheritance > synthetic genesis)
is untouched, and `resolveChainRoot` remains the single implementation;
the corollary "never reimplement chain selection in a new producer" holds.
Conflict rule: when the extension key and a legacy carrier decode to different
tokens, the extension key wins and the producer SHOULD log an
`atrib:`-prefixed warning; a malformed extension token falls through to the
next carrier (lenient parse, same posture as [D018](../DECISIONS.md#d018-w3c-trace-context-and-baggage-conformance-leftmost-atrib-lenient-parse-evict-from-end-on-overflow)).

*Ladder 2: context identity (resolves `context_id`):*

```
explicit context_id tool argument      (application intent; primitives /
                                        daemon surfaces; D135 posture)
  > _meta["dev.atrib/attribution"].context_id   (new, extension)
  > _meta.traceparent trace-id         (existing extractTraceId behavior)
  > D078/D083 harness env registry     (env > file fallback)
  > undefined
```

Conflict rules: an explicit tool argument always wins, because the extension block
is transport metadata and an argument is application intent; on mismatch the
producer uses the argument and SHOULD log an `atrib:`-prefixed warning. A
`context_id` in the extension block that is not exactly 32 lowercase hex is
ignored (falls through), never an error. When the extension block and
`traceparent` disagree, the extension block wins with a warning (the
trace-id rung remains for callers that carry no extension block). The
[D078](#d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default)/[D083](#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers)
env/file resolution applies only when no per-request carrier resolved;
its internal ordering is unchanged and stays defined by those ADRs.

**Receipt carriage** (server → client). Emitted **only** when the requesting
client declared `dev.atrib/attribution` in that request's
`io.modelcontextprotocol/clientCapabilities` (SEP-2133 opt-in gating, the
Tasks-extension model):

```json
"result": {
  "content": [ ... ],
  "_meta": {
    "dev.atrib/attribution": {
      "token": "sJ3d...43chars.Kp2f...43chars",
      "receipt": {
        "record_hash": "sha256:9f31...64hex",
        "creator_key": "Kp2f...43chars",
        "context_id": "0f2a...32hex",
        "event_type": "tool_call",
        "chain_root": "sha256:...",
        "log_submission": "queued"
      },
      "record": { "...full signed AtribRecord..." : "optional, only if accept includes 'record'" }
    },
    "atrib": "sJ3d...43chars.Kp2f...43chars",
    "tracestate": "atrib=sJ3d...43chars.Kp2f...43chars",
    "X-Atrib-Chain": "sJ3d...43chars.Kp2f...43chars"
  }
}
```

Receipt rules:

- The receipt names a record the server has **already signed locally**.
  `log_submission` is a queue status (`queued | submitted | disabled |
  failed`), never an awaited proof; log submission stays non-blocking per
  [§5.3.5](../atrib-spec.md#535-log-submission) (critical invariant 4). Proof
  bundles are fetched later, keyed by `record_hash`, exactly as today.
- The optional full `record` is safe by construction: an `AtribRecord` carries
  commitments (`args_hash` etc.), not payloads, per
  [§8.3](../atrib-spec.md#83-salted-commitment-posture). Returning it enables
  immediate Tier-3 signature re-verification by the caller (via
  `@atrib/verify`) without a mirror or
  [§2.12](../atrib-spec.md#212-record-body-archive-layer) archive round-trip.
- If signing fails for any reason, the tool result is returned **without** the
  extension block and without error;
  [§5.8](../atrib-spec.md#58-degradation-contract) applies to every extension
  behavior, producer-side, no exceptions.
- Signing itself is NOT gated on the client's declaration. Whether a server
  signs its own actions is server-local policy (per
  [D100](#d100-mcp-middleware-can-sign-without-log-submission), signing does
  not even require log submission). The extension gates only discovery and
  carriage.
- The legacy unprefixed result keys (`atrib`, `tracestate`, `X-Atrib-Chain`)
  predate the extension and continue to be written unconditionally, unchanged.

**Reservations (extension spec text).** The extension reserves the `_meta` key
`dev.atrib/attribution` on requests and results and the two settings-object
schemas. v0.1 deliberately defines **no new methods, no notifications, no
`resultType` values, and no URI schemes** (contrast with the Tasks extension).
Staying a pure `_meta` + capability-map dialect maximizes gateway
transparency: in the stateless model `_meta` carries the protocol state
that conformant intermediaries are structurally obliged to forward, and the
documented real-world failure mode is accidental SDK `_meta` loss, which the
degradation contract and the [D067](#d067-multi-producer-chain-composition-precedence-contract)
fallback ladder already absorb. The extension spec states this loudly:
designed for `_meta` loss, not `_meta` theft.

**Reference implementations and the shim.**

- `@atrib/mcp` (server side): advertises the capability, implements both
  canonical ladders, writes the gated receipt block. Shipped behind an
  explicit opt-in flag (SEP-2133 SDK posture: extensions disabled by
  default), enabled per config or `ATRIB_MCP_EXTENSION=1`.
- `@atrib/agent` (client side): declares the client capability per-request,
  injects the prefixed carriage block alongside the legacy carriers, consumes
  receipts, and hands verified receipt material to the host.
- `@atrib/mcp-wrap`: one config flag makes any wrapped upstream server
  extension-conforming: the shim for non-adopting servers, multiplying
  extension coverage at zero per-server cost, exactly as it does for signing
  today.
- Adjacent surfaces: [D133](#d133-action-gate-is-a-host-owned-controlproof-package)
  action-gate hosts and gateways can use the server capability declaration
  plus SEP-2243 `Mcp-Method`/`Mcp-Name` headers for cheap pre-action checks;
  gateway **countersigning** (a second distinct signer over the same canonical
  bytes toward [D052](#d052-cross-attestation-requirement-for-transaction-records),
  or tiered evidence per [§5.5.6](../atrib-spec.md#556-generic-authorization-evidence-blocks))
  is explicitly listed as "not specified in v0.1" and reserved for a future
  profile.

**Standards-track plan.**

1. **Now → 2026-07-28:** publish the v0.1 extension spec in-repo at
   `spec/extensions/dev.atrib-attribution/0.1/` (date/version-stamped layout
   mirroring ext-apps), as an **Unofficial** extension per SEP-2133: no
   permission needed, the reverse-DNS prefix is self-sovereign. The identifier
   and framing exist in the vocabulary of the final-spec news cycle.
2. Implement in `@atrib/mcp` / `@atrib/agent` / `@atrib/mcp-wrap` behind
   opt-in flags **without waiting for the stateless SDK**: the extension is a
   pure `_meta` dialect and `params._meta` exists on the current TypeScript
   SDK today; capability advertisement uses the `initialize` result on legacy
   protocol versions and moves to `server/discover` when the Tier-1
   TypeScript SDK ships stateless support. Validate against the conformance
   corpus. The **only** surface gated on the SDK rebuild is
   `services/atrib-primitives` adoption, and that gate is not defined here:
   it is the daemon-consolidation (redesign step 5, `atribd`) ADR's gate
   (stateless-transport SDK support with a hard review date of **2026-10-06**
   and that draft's named fallbacks), shared by cross-reference so a slipped
   SDK blocks both or neither, never leaves this ADR formally unblocked while
   its runtime vehicle is blocked.
3. Engage the Interceptors WG (SEP-2624): position atrib as the reference
   *verifiable audit interceptor*: the interceptor framework standardizes
   where middleware mounts; this extension standardizes what attribution
   carries. Complementary, not competing.
4. If adoption warrants: propose `experimental-ext-` incubation (requires WG
   association), then an Extensions Track SEP (requires a reference
   implementation in an official MCP SDK and review by the MCP core maintainers; official
   extensions are Apache 2.0 with an LF contributor grant; atrib code is
   already Apache-2.0). Only the carriage-extension text would migrate to an
   `ext-*` repo; `atrib-spec.md` and all signed-record semantics remain
   governed here.

**Governance risks (named, with postures).**

- *Identifier is frozen on publication.* Breaking changes force
  `dev.atrib/attribution-v2`. The pending attest/recall verb rename
  ([`docs/attest-recall-rename-impact.md`](attest-recall-rename-impact.md))
  must either be settled first or the published name must be rename-proof,
  which favors the noun `attribution` over any verb.
- *Official-track capture.* Core maintainers have final authority; review is
  months-long; post-acceptance iteration is delegated to an ext-repo
  maintainer set atrib may not control alone. Posture: official status is
  optional legitimacy, never a dependency; if MCP governance ever conditioned
  acceptance on changes to signed-record semantics, the answer is no: the
  carriage forks to a new identifier and records stay byte-identical.
- *Competitive occupation.* SEP-2624 plus one ambitious gateway vendor could
  ship a "good enough" signed-log interceptor within a quarter; ATP owns the
  adjacent "agent trust" framing. Posture: ship before 2026-07-28; keep the
  differentiator explicit (per-action, operator-independent verification plus
  the full substrate: log, graph, archive, primitives, corpora).
- *No machine registry exists for extensions.* Discovery is capability maps,
  `server/discover`, and the human client-matrix page. "Registry traction" is
  really host/client adoption; MCP Apps proved adoption is host-led. Expected
  first adopters are second-tier gateways and commerce rails, hosts last.

**Fallback posture.** If the extension never gets traction, nothing is lost:
every mechanism it declares already works today as an unnegotiated convention
(bare `_meta.atrib`, `tracestate` per
[D018](#d018-w3c-trace-context-and-baggage-conformance-leftmost-atrib-lenient-parse-evict-from-end-on-overflow),
result-side token). Chains, records, verification, and the explorer are
unaffected. The extension text then simply remains atrib's documented `_meta`
dialect under its own prefix. The extension is upside (discovery, correct
opt-in gating, gateway visibility, standards legitimacy), not a dependency.

### Compatibility and migration

- **Signed bytes: zero change.** No new signed field, no canonicalization
  change, no event_type change, no [D036](#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary)
  promotion needed: nothing new is signed. `context_id` in `_meta` carriage
  maps to the existing record field under existing rules. The 90-byte log
  entry, checkpoints, and JCS forms are untouched.
- **Existing signed records, log entries, proof bundles:** untouched and
  verify identically. Verifiers require no change; receipt verification reuses
  `verifyRecord` as-is.
- **Published packages:** minor (non-breaking) releases of `@atrib/mcp`,
  `@atrib/agent`, `@atrib/mcp-wrap` adding opt-in flags. The seven
  cognitive-primitive packages are unaffected in v0.1 (stdio, harness-side);
  they and `services/atrib-primitives` adopt under the shared step-5 gate
  above (the [D120](#d120-local-substrate-coordinator-keeps-startup-spawn-sidecars-wrapper-owned)
  / redesign step-5 rebuild, which is already forced by the same MCP release).
- **Deployed services:** `log-node`, `graph-node`, `directory-node`,
  `archive-node` are untouched: the extension is entirely producer/client
  side. No API, storage, or Fly deployment change.
- **Operator machines:** no mirror or sidecar schema change. An optional,
  additive `_local.extension` sidecar telemetry field (negotiated: yes/no,
  client name) MAY be added for dogfood measurement; sidecar-only, silent-failure.
- **Sibling candidate ADRs:** the daemon-consolidation (`atribd`) and
  attest/recall rename drafts are edited in the same integration pass to cite
  the [§1.5.4](../atrib-spec.md#154-mcp-transport-params_meta) ladders defined
  here instead of restating their own rung lists. This is a doc edit only:
  neither draft's mechanism changes, and `resolveChainRoot` remains untouched
  by all three.
- **Old/new interop matrix:** old client × new server: legacy result keys
  still written, prefixed block absent, nothing breaks. New client × old
  server: client writes both carriers; the old server reads the legacy ones
  or none; the chain ladder falls through as today. Both directions are
  conformance cases.

### Conformance-corpus plan

New directory `spec/conformance/1.5.4/mcp-extension/` (under the
[§1.5.4](../atrib-spec.md#154-mcp-transport-params_meta) propagation family),
generator in `packages/log-dev/scripts/` following the
`generate-conformance-1.2.6.ts` pattern, reference tests in
`packages/mcp/test/` and `packages/verify/test/`. Case families:

1. **capability-declaration**: valid server/client settings objects; unknown
   settings fields ignored; version handling; prefix-rule checks.
2. **negotiation-gating**: client declared → prefixed receipt block present;
   client undeclared → block absent while legacy keys are byte-identical to
   pre-extension behavior; malformed `clientCapabilities` → treated as
   undeclared, no error injected into the tool path.
3. **token-precedence**: extension key > `_meta.atrib` > tracestate >
   `X-Atrib-Chain`; conflicting carriers → extension key wins; malformed
   extension token falls through to the next carrier; all carriers stripped →
   the [D067](#d067-multi-producer-chain-composition-precedence-contract)
   ladder continues (vectors compose with the existing
   `spec/conformance/1.2.3/multi-producer/` corpus).
4. **context-identity-precedence**: explicit tool argument beats extension
   `context_id` (mismatch → argument used, warning); extension `context_id`
   beats `traceparent` trace-id; non-32-hex extension `context_id` ignored
   and falls through; no per-request carrier → env/file resolution per
   [D078](#d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default)/[D083](#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers);
   unknown extra fields in the block (including `session_token` /
   `provenance_token` sent by a future or nonconforming peer) ignored with no
   record-field effect.
5. **receipt-integrity**: receipt `token` equals the token of the attached
   record; `record_hash` recomputes from the record's canonical bytes;
   `creator_key` matches the record signer; `log_submission` status present
   before any submission settles (non-blocking assertion).
6. **degradation**: forced signing failure → tool result identical to
   passthrough, receipt omitted, no thrown error; forced capability-read
   failure → same.

### Alternatives rejected

- *Stay convention-only (do nothing).* Rejected as the primary plan (it
  forfeits discovery, correct opt-in gating, and a closing standards window)
  but retained verbatim as the fallback posture; the convention keeps working.
- *Carry `session_token` and `provenance_token` in the v0.1 block.* Rejected.
  Each already has exactly one carrier with defined semantics
  ([§1.5.5](../atrib-spec.md#155-cross-trace-session-continuity) baggage;
  [§1.2.6](../atrib-spec.md#126-provenance_token) genesis-only configuration);
  a second carrier without accumulated-vs-inbound conflict rules would create
  the exact multi-carrier ambiguity this ADR exists to close for the token.
  Deferred to a later settings version gated on demonstrated need plus
  explicit conflict rules and vectors.
- *Let each ADR state its own precedence ladder.* Rejected. Three drafts in
  one landing window restating overlapping rung lists is how two
  implementations end up disagreeing on identical input. One normative home
  ([§1.5.4](../atrib-spec.md#154-mcp-transport-params_meta)), everyone else
  cites it.
- *New MCP methods (`atrib/receipt`, `atrib/verify`), Tasks-style.* Rejected.
  Receipts annotate an existing tool result; they are not a new operation.
  New methods add gateway-routing surface (`Mcp-Method` allowlists) and
  statefulness pressure for zero expressive gain over `_meta`.
- *Ride the Interceptors extension (SEP-2624) exclusively.* Rejected.
  Interceptors standardize where middleware mounts, not what attribution
  carries; it is also still experimental. Complementary: the atrib middleware
  can mount as an interceptor while the payloads ride this extension.
- *Put receipts in tool result `content`.* Rejected. `content` is the
  model-visible channel; receipts are machine material. `_meta` is the
  designated machine channel, and in the stateless model it is forwarded
  protocol state that intermediaries must preserve.
- *Keep the bare `atrib` `_meta` key as the only carrier and just document
  it.* Rejected. Extension `_meta` keys must be vendor-prefixed under the new
  namespace discipline; an unprefixed key cannot be claimed by an extension
  spec. The bare key survives as the legacy fallback, not the claimed surface.
- *Wait for official/experimental status before publishing anything.*
  Rejected. SEP-2133 explicitly permits unofficial extensions under an owned
  prefix with no approval; waiting forfeits the 2026-07-28 window for no
  compatibility benefit.
- *Add a signed field recording negotiation state.* Rejected outright: it
  changes signed bytes, violating the governing constraint of the upgrade
  path. Negotiation state is transport metadata; at most it lands in the local
  sidecar.

### Doc-sync impact

- `DECISIONS.md`: this entry (promoted from P049); pending-decisions section
  updated.
- `CLAUDE.md`: hub summary line for the new decision; repository-structure
  tree gains `spec/extensions/dev.atrib-attribution/` and
  `spec/conformance/1.5.4/mcp-extension/`.
- `atrib-spec.md` [§1.5.4](../atrib-spec.md#154-mcp-transport-params_meta): add
  the negotiated extension carriage and both canonical inbound ladders as the
  single normative statement; the stale "monitor MCP PR #414" note is
  superseded (SEP-414 standardized trace-context keys in `_meta`) and must be
  updated in the same commit.
- Sibling candidate ADR drafts (daemon consolidation / `atribd`, attest-recall
  rename): edit their context-resolution passages to cite
  [§1.5.4](../atrib-spec.md#154-mcp-transport-params_meta) rather than restate
  rungs; note the shared 2026-10-06 SDK gate cross-reference in both texts.
- `ARCHITECTURE.md`: propagation/trust-model section gains the
  extension-vs-convention paragraph.
- `PRIOR-ART.md`: new rows for SEP-2133 (extensions framework), SEP-414
  (trace context in `_meta`), SEP-2243 (`Mcp-Method`/`Mcp-Name`), SEP-2624
  (interceptors).
- `packages/mcp/README.md`, `packages/agent/README.md`,
  `packages/mcp-wrap/README.md`: opt-in flag documentation and the
  interop matrix.
- `DOC-SYNC-TRIGGERS.md` / `scripts/check-doc-sync.mjs`: no existing
  number-word check is touched (public package count and workspace list are
  unchanged). If the docs introduce a countable claim (e.g. "N conformance
  case families" or "two inbound ladders"), extend the script with a check per
  the established convention rather than relying on manual review.
- `DESIGN.md`: no product surface changes in v0.1; state so in the landing
  commit if the explorer later renders receipt provenance.

### Cross-references

- [`docs/redesign-upgrade-path.md`](redesign-upgrade-path.md), the
  forcing-function section, the "ship atrib as an MCP extension" candidate,
  and the step-5 daemon draft whose SDK gate this ADR shares.
- [D018](#d018-w3c-trace-context-and-baggage-conformance-leftmost-atrib-lenient-parse-evict-from-end-on-overflow),
  tracestate carriage this extension standardizes upward.
- [D067](#d067-multi-producer-chain-composition-precedence-contract) /
  [§1.2.3.1](../atrib-spec.md#1231-multi-producer-chain-composition), the
  chain-root ladder the new carrier feeds without modifying.
- [D078](#d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default) /
  [D083](#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers),
  the env/file context resolution the new ladder sits above.
- [D100](#d100-mcp-middleware-can-sign-without-log-submission), signing
  independent of submission, the basis for non-blocking receipts.
- [D133](#d133-action-gate-is-a-host-owned-controlproof-package), pre-action
  gating that consumes the server capability declaration.
- [D135](#d135-delegated-builder-atrib-context-threads-via-orchestrator-injected-explicit-args),
  explicit context carriage as the default posture.
- [`packages/mcp/src/context.ts`](../packages/mcp/src/context.ts), the inbound /
  outbound carriage implementation this extension formalizes.
- [`docs/attest-recall-rename-impact.md`](attest-recall-rename-impact.md),
  the rename catalog the frozen identifier interacts with.

## Open questions (operator decisions)

- Does the operator accept that this ADR (not the atribd/daemon-consolidation ADR) owns the canonical [§1.5.4](../atrib-spec.md#154-mcp-transport-params_meta) inbound ladders, and will the atribd and attest/recall-rename drafts be edited in the same integration pass to cite [§1.5.4](../atrib-spec.md#154-mcp-transport-params_meta) instead of restating their own rung lists?
- Is the frozen extension identifier `dev.atrib/attribution` acceptable given the pending attest/recall verb rename, or must the rename decision (docs/attest-recall-rename-impact.md) be formally settled before publication?
- Should v0.1 ship before 2026-07-28 even if the extension spec text is the only deliverable (implementation following behind opt-in flags), or is a working @atrib/mcp reference implementation a publication gate?
- Does the operator confirm adopting the atribd draft's SDK gate (stateless TypeScript SDK support, hard review date 2026-10-06, that draft's named fallbacks) verbatim for services/atrib-primitives adoption, rather than a separate gate for this ADR?
- Should `session_token` and `provenance_token` carriage return in a v0.2 settings revision (with accumulated-vs-inbound conflict rules), or is baggage/genesis-config carriage considered permanently sufficient?
- Who owns the future gateway-countersigning profile (second distinct signer over the same canonical bytes toward [D052](../DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records)), and does it justify reserving a settings field name now?
- How much effort should go into the Interceptors WG (SEP-2624) engagement versus treating it as monitoring-only until the WG output stabilizes?
- Should the optional `_local.extension` sidecar telemetry field ship with the v0.1 implementation for dogfood measurement, or wait for a demonstrated measurement need?
