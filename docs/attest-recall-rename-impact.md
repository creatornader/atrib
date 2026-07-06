# attest / recall verb rename: upstream and downstream impact catalog

Status: catalog complete (repo sweep + npm registry check, 2026-07-06). The
rename does not land until this catalog's sequencing is accepted as an ADR.
See [`redesign-upgrade-path.md`](redesign-upgrade-path.md) step 6 for the
decision context: write tools (`atrib-emit`, `atrib-annotate`, `atrib-revise`)
collapse under **`attest`**; read tools (`atrib-recall`, `atrib-trace`,
`atrib-verify`) collapse under **`recall`**; `atrib-summarize` relocates to
the harness.

Every finding is classified into one of five impact classes:

| Class | Meaning | Migration rule |
|---|---|---|
| (a) internal code | freely renamable in one commit | rename + tests in lockstep |
| (b) published npm surface | package names, bin names, exported symbols on the registry | new publish + `npm deprecate` shim; old names keep working ≥1 major cycle |
| (c) persisted historical data | strings already written to mirrors/state jsonl on operator machines | consumers accept old AND new strings forever; never rewrite history |
| (d) signed record bytes | immutable | the rename MUST NOT touch these (verified below) |
| (e) operator machine state | launchd plists, MCP client configs, hook configs, existing mirror files outside the repo | migration runsheet + health-gate tooling updates |

## Headline: signed bytes are untouched (class d, verified)

**Renaming the MCP tool names changes zero signed bytes.** The registered
tool-name string never enters a signed record:

- `content_id` derives from the constant synthetic URL `'mcp://atrib-emit'`
  (`services/atrib-emit/src/sign.ts:29`) plus the **event_type URI leaf**
  (`observation`/`annotation`/`revision`), via
  `packages/mcp/src/content-id.ts` — not from the MCP tool name.
- `event_type` values are the URI constants in
  `packages/mcp/src/types.ts:157-176`, orthogonal to tool verbs and fixed by
  the normative vocabulary (0x03/0x05/0x06 per
  [D036](../DECISIONS.md#d036-bar-for-promoting-an-extension-uri-to-atribs-normative-event_type-vocabulary)).
- The optional signed `tool_name` field is caller-supplied
  [§8.2](../atrib-spec.md#82-opaque-name-posture) disclosure threaded through
  the emit tool's argument — independent of what the tool is named. Annotate
  and revise never pass it.
- The read servers (recall/trace/summarize/verify) sign nothing.

The immutable set to leave untouched: `SYNTHETIC_SERVER_URL =
'mcp://atrib-emit'` (it embeds the *package* name, not the tool verb — it
changes only if `@atrib/emit` itself is renamed, and even then old records
must keep verifying, so the safe move is to freeze it permanently as an
opaque historical constant), the event-type URI constants, and the
`content_id` derivation. Records signed before and after the rename remain
byte-identical and mutually verifiable — the emit/annotate/revise
byte-identity invariant survives by construction.

## Class (b): published npm surface (checked against the registry 2026-07-06)

All seven primitive packages are live; npm packages cannot be unpublished, so
deprecation messages + forwarding shims are the only lever.

| Package | Latest | Rename disposition |
|---|---|---|
| `@atrib/emit` | 0.16.2 | superseded by the write verb; deprecate → point at new package |
| `@atrib/annotate` | 0.2.37 | folds into write verb (`ref.kind: annotates`); deprecate |
| `@atrib/revise` | 0.2.37 | folds into write verb (`ref.kind: revises`); deprecate |
| `@atrib/recall` | 0.14.3 | name survives; absorbs trace + verify read shapes |
| `@atrib/trace` | 0.5.17 | folds into recall (`shape: walk`); deprecate |
| `@atrib/summarize` | 0.4.19 | relocates to harness; deprecate without replacement pointer |
| `@atrib/verify-mcp` | 0.2.17 | folds into recall (`verification` param); deprecate. `@atrib/verify` (library, 0.7.10) is NOT renamed — verifier library, not the primitive |
| `@atrib/attest` | — | **unclaimed; available as the target name** |
| `@atrib/mcp` | 0.18.1 | keeps name; new verb-named helpers exported alongside `handleEmit`/`emitInProcess`, old kept as aliases |

Also class (b):

- **Bin names** shipped by these packages: `atrib-emit`, `atrib-emit-cli`,
  `atrib-local-substrate` (from `@atrib/emit`), `atrib-annotate`,
  `atrib-revise`, `atrib-recall`, `atrib-trace`, `atrib-summarize`,
  `atrib-verify`. New bins added; old bins kept as forwarding shims ≥1 major.
  Adjacent family members NOT in this rename: `atrib-wrap`, `atrib` (cli),
  `atrib-runtime-log`.
- **~30 exported API symbols embedding the verbs**: `handleEmit`,
  `emitInProcess`, `EmitInput`/`EmitOutput`, `createAtribEmitServer`,
  `buildAndSignEmitRecord`, `resolveEmitLocalSubstrate*FromEnv`,
  `createAtribAnnotateServer`/`AnnotateInput`,
  `createAtribReviseServer`/`ReviseInput`, `createAtribRecallServer`,
  `getAtribRecallRuntimeContract`, `createAtribTraceServer`,
  `createAtribSummarizeServer`, `createAtribVerifyServer`,
  `handleAtribVerify`/`AtribVerifyInput`/`AtribVerifyOutput`. Breaking to
  rename — export new names, keep old as deprecated aliases.
- **Workspace dependency edges** that move in lockstep: annotate/revise
  depend on `@atrib/emit`; `@atrib/primitives-runtime` depends on all seven;
  plus `pnpm-lock.yaml`, workspace globs, `.changeset/` config (first-publish
  ignore list per `check-release-publish-readiness.mjs`).

## Class (a): internal code

The **15 physical MCP tool names** and registration sites:

| Tool | Registered in |
|---|---|
| `emit` | `services/atrib-emit/src/index.ts:352` |
| `atrib-annotate` | `services/atrib-annotate/src/index.ts:125` |
| `atrib-revise` | `services/atrib-revise/src/index.ts:128` |
| `recall_my_attribution_history`, `recall_walk`, `recall_annotations`, `recall_revisions`, `recall_by_content`, `recall_session_chain`, `recall_orphans`, `recall_by_signer` | `services/atrib-recall/src/index.ts` (8 tools) |
| `trace`, `trace_forward` | `services/atrib-trace/src/index.ts:312,367` |
| `summarize` | `services/atrib-summarize/src/index.ts:102` |
| `atrib-verify` | `services/atrib-verify/src/index.ts:209` |

Note the current naming is already inconsistent (bare `emit`/`trace`/
`summarize` vs prefixed `atrib-annotate`/`atrib-verify` vs `recall_*`) — the
rename is also a normalization opportunity.

Other class (a): the 8 `McpServer` `name` identities (`'atrib-emit'` …
`'atrib-primitives'`) — internal strings, but they form the first half of the
`mcp__<server>__<tool>` IDs in operator client configs, so they cascade into
class (e); the primitives-runtime dynamic factory keyed by short names;
behavioral-probe call sites in `services/atrib-primitives/src/index.ts`;
`logReadPrimitiveCall(<tool name>)` literals in each read server; env keys
embedding primitive nouns (`ATRIB_PRIMITIVES_*`, `ATRIB_SUMMARIZE_*`,
`ATRIB_RECALL_*`) — operator-facing, so also class (e). Tests pin all of it:
`services/atrib-primitives/test/mcp-protocol.test.ts` hardcodes the sorted
15-tool list and the per-primitive package/tool/mutates map;
`services/atrib-recall/test/mcp-protocol.test.ts` asserts exactly 8 recall
tools; emit/cli/verify/legibility tests assert tool names, producer labels,
and `primitive: 'atrib-verify'`.

## Class (c): persisted historical data (accept old strings forever)

- **`_local.producer` labels** already written into every historical mirror
  line: `'atrib-emit'`, `'atrib-annotate'`, `'atrib-revise'`,
  `'atrib-emit-cli'` (writers in `services/atrib-emit/src/index.ts`,
  `cli.ts`, and the annotate/revise servers). Good news, verified: **no
  consumer filters or joins on hardcoded producer equality** —
  `resolveDisplayProducer` and the recall/trace indexing paths treat the
  label as an opaque pass-through string. Historical labels keep displaying;
  new `'atrib-attest'`-family labels coexist without a compatibility shim.
- **`~/.atrib/state/read-primitives/calls.jsonl`**: the persisted `primitive`
  field carries the tool-name string (`'recall_my_attribution_history'`,
  `'trace'`, `'summarize'`, `'atrib-verify'`, …) per
  [D084](../DECISIONS.md#d084-read-primitive-instrumentation-for-empirical-loop-closure-measurement).
  Any analyzer must accept old and new values; per-tool time series get a
  discontinuity at the rename date (annotate in the analysis, don't rewrite).
- **Default mirror filename** `~/.atrib/records/atrib-emit-<agent>.jsonl`
  (`storage.ts:61`, doctor check in `cli.ts:490`): existing files keep their
  names forever; the new writer either keeps the pattern (verb-neutral
  enough) or writes a new pattern while readers glob both.
- **Coordinator wire strings**: `source: '@atrib/emit'` persisted in
  local-substrate WAL/receipts; `primitive: 'atrib-verify'` in verify
  response bodies (captured downstream). New values allowed; old values
  remain valid history.

## Class (e): operator machine state outside the repo

The hard operational coupling — miss any of these and live hosts or CI health
gates break:

1. **launchd labels**: `com.nader.atrib-primitives.<profile>` (pinned as
   `LAUNCH_AGENT_PREFIX` in `scripts/update-primitives-runtime.mjs:13`) and
   `com.nader.atrib-drain` (topology report's label discrimination). Existing
   plists in `~/Library/LaunchAgents/` reference old labels; the runsheet
   must unload/replace them, and the topology scripts must accept both
   labels during the window.
2. **Health-gate pins** ([D128](../DECISIONS.md#d128-host-owned-primitive-runtime-updates-are-build-restart-direct-probe)–[D130](../DECISIONS.md#d130-primitive-runtime-health-uses-non-mutating-behavioral-probes)):
   `update-primitives-runtime.mjs` pins `EXPECTED_PRIMITIVE_TOOLS` (all 15
   names), `EXPECTED_TOOL_NAMES`, `PRIMITIVE_PACKAGE_PATHS`, expected package
   versions, and `EXPECTED_BEHAVIORAL_PROBES`; companion check scripts and
   `report-local-substrate-topology.mjs` compute the gates. During the alias
   window the expected-tools map must contain the union.
3. **Operator MCP client configs** (`.mcp.json` / Claude Code config): tools
   are wired as `mcp__<server>__<tool>` — both halves change. Old configs
   keep working only if servers mount old tool names as aliases.
4. **Hook configs / decision-guidance strings** that spawn `atrib-emit-cli`
   or inject "call atrib-revise…" prompts (host-owned, outside the repo).
5. **Keychain services** (`atrib-creator*`): adjacent family, embeds
   "creator" not a verb — explicitly NOT part of this rename.

## Documentation and product-copy surfaces

Repo-wide scale: the seven hyphenated names occur **~1,024 times across 122
files**; "cognitive primitive(s)" phrasing plus
`recall_my_attribution_history` adds **~364 occurrences across 69 files**.
Per name: `atrib-emit` 478 (inflated — also a directory, package, and binary
name), `atrib-annotate` 159, `atrib-verify` 156, `atrib-revise` 147,
`atrib-recall` 129, `recall_my_attribution_history` 129, `atrib-trace` 100,
`atrib-summarize` 89.

### Agent-behavioral (changes what running agents DO — flip with the code)

- **`skills/atrib/SKILL.md` — 67 hits; the single most load-bearing file.**
  Symlinked live into `~/.claude/skills` and `~/.agents/skills` on operator
  machines. Its frontmatter allowed-tools list hard-codes the fully-qualified
  dispatch strings (`mcp__atrib-emit__emit`,
  `mcp__atrib-recall__recall_my_attribution_history`, all 8 recall siblings,
  `mcp__atrib-trace__trace`, `mcp__atrib-verify__atrib-verify`, …), and its
  body gives imperative "Call atrib-revise with revises=…" guidance. A stale
  list means the agent **cannot invoke the tool at all**. Must flip inside
  the alias window.
- Host hook prompts / decision-time injection strings mirroring SKILL.md
  (class (e), on operator machines).

### Descriptive (doc-consistency edits only)

- **atrib-spec.md (~17 lines, narrative only)** —
  [§1.2.3.1](../atrib-spec.md#1231-multi-producer-chain-composition),
  [§5.9.3](../atrib-spec.md#593-the-_local-sidecar-shape) (producer label
  examples), [§7.2](../atrib-spec.md#72-the-recall-tool-pattern)
  (`recall_my_attribution_history` as the canonical *example*),
  [§7.5](../atrib-spec.md#75-harness-side-reasoning-chains),
  [§7.8](../atrib-spec.md#78-cross-harness-continuation-packets) (fullest
  enumeration), [§9](../atrib-spec.md#9-runtime-integration-patterns) hook
  examples. **The spec never normatively fixes MCP tool-name strings**; the
  normative event_type vocabulary is untouched by the rename.
- **DECISIONS.md (235 hits; ~14 ADR titles)** —
  [D076](../DECISIONS.md#d076-long-lived-atrib-emit-daemon-opt-in-spawn-per-emit-fallback),
  [D079](../DECISIONS.md#d079-the-six-core-cognitive-primitives-atribs-agent-facing-surface),
  [D080](../DECISIONS.md#d080-primitive-lifecycle-extensions-first-dedicated-mcps-upon-promotion),
  [D083](../DECISIONS.md#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers),
  [D084](../DECISIONS.md#d084-read-primitive-instrumentation-for-empirical-loop-closure-measurement),
  [D085](../DECISIONS.md#d085-recall-calibration-defaults-survey-grounded-rationale),
  [D087](../DECISIONS.md#d087-signed-diagnostic-outcome-trace-replay-as-canonical-repair-pattern),
  [D106](../DECISIONS.md#d106-verify-is-promoted-to-cognitive-primitive-7),
  [D123](../DECISIONS.md#d123-critical-path-content-recall-requires-complete-evidence-or-explicit-fallback)–[D130](../DECISIONS.md#d130-primitive-runtime-health-uses-non-mutating-behavioral-probes).
  Per the confirmed supersession convention
  ([D081](../DECISIONS.md#d081-in-process-emit-for-hook-class-producers-emitinprocess)→[D082](../DECISIONS.md#d082-cli-binary-distribution-of-emitinprocess-supersedes-d081s-integration-shape)
  precedent), ADRs are immutable: the rename lands as a **new ADR** with
  short "superseded by" banners on
  [D079](../DECISIONS.md#d079-the-six-core-cognitive-primitives-atribs-agent-facing-surface)/[D106](../DECISIONS.md#d106-verify-is-promoted-to-cognitive-primitive-7);
  the seven-verb table stays as historical record.
- **CLAUDE.md (43 hits)**: opening enumeration, repository-structure tree
  (`services/atrib-*` dirs), "twenty-nine workspace packages" section,
  key-decisions bullet. **README.md (26 hits)**: packages table, "Seventeen
  designed-public packages" paragraph, product copy.
  **DOC-SYNC-TRIGGERS.md (24 hits)**: rows 57–58, 68–70; row 69 documents
  the producer-label identities. **ARCHITECTURE.md (9 hits)**.
  **docs/concepts/11-cognitive-primitives.md** (titled "The seven cognitive
  primitives") plus concepts index and docs 13–14. **Per-package READMEs**:
  all seven `services/atrib-*/README.md` plus primitives-runtime, mcp,
  verify, integration.
- **npm `description` fields** in the service package.json files: describe
  purpose without embedding the hyphenated names — update for consistency.

### Confirmed OUT of blast radius (verified negative)

apps/dashboard (zero tool-name occurrences; its "producer-claimed ancestry"
is graph-derivation vocabulary; `_local.producer` is not surfaced in the UI),
the metrics pipeline (`metrics.mjs` and snapshots key on event_type bytes,
never tool or producer names), proof-packets/, policies/, DESIGN.md,
METRICS.md, PRIOR-ART.md, GitHub repo description.

### Doc-sync gates a migration trips

`scripts/check-doc-sync.mjs` does not assert the verb names or the literal
"seven cognitive primitives" phrase. What fires: **Check 4** (every workspace
package dir must appear in CLAUDE.md's tree; the Monorepo number-word
"twenty-nine" must match the `@atrib/*` bullet count) and **Check 5**
(README's "Seventeen designed-public packages" vs the non-private
package.json count). Both fire on a 7→2 package collapse or directory
renames; both are self-healing by updating prose in the same commit. Extend
the script with a primitive-name check if the alias window needs mechanical
enforcement.

## New surface from the MCP stateless spec (final 2026-07-28)

The MCP 2026-07-28 release adds two rename-relevant mechanisms (see the
[upgrade path](redesign-upgrade-path.md) for the full spec-change analysis):

- **`Mcp-Name` routing headers (SEP-2243):** on Streamable HTTP, the tool
  name travels as an HTTP header that servers must validate against the
  JSON-RPC body — so tool names become visible to gateways, load balancers,
  and any header-based routing/allowlist rules operators have configured.
  That is a sixth de-facto impact class: **network middleboxes**. The alias
  window must keep both old and new names passing any such rules, and
  `@atrib/mcp-wrap` (which rewrites calls in flight) must preserve
  header/body consistency or stateless servers will reject the request.
- **`tools/list` caching via `ttlMs`/`cacheScope` (SEP-2549):** clients may
  cache the tool list, so a rename propagates on cache expiry, not on
  deploy. During the alias window the servers should advertise a short
  `ttlMs`, and old names must stay mounted for at least the longest TTL ever
  advertised — retiring a name while a cached list still offers it produces
  hard failures on stateless retries.

Both mechanisms reinforce the alias-window sequencing below rather than
changing it.

## Recommended migration sequencing

1. **Alias window first, rename second.** Mount `attest` (and the collapsed
   `recall` shapes) as *additional* tools on the existing servers /
   primitives runtime. Nothing breaks; both names dispatch to one handler.
2. **Flip the behavioral surfaces inside the window**: SKILL.md allowed-tools
   and imperative guidance, hook prompts, operator MCP client configs,
   health-gate expected-tool unions.
3. **New packages** (`@atrib/attest`; `@atrib/recall` absorbs read shapes)
   publish with old packages depending on them and re-exporting; `npm
   deprecate` the six retiring names with pointers.
4. **Operator runsheet**: launchd label migration, topology-script label
   union, mirror-filename glob acceptance.
5. **Docs pass** (CLAUDE.md tree + number-words, README tables + counts,
   DOC-SYNC-TRIGGERS row 69, concepts page, per-package READMEs) in the same
   commit as each mechanical change, keeping `pnpm doc-sync` green.
6. **New ADR** documenting the collapse and rename, banners on
   [D079](../DECISIONS.md#d079-the-six-core-cognitive-primitives-atribs-agent-facing-surface)
   and
   [D106](../DECISIONS.md#d106-verify-is-promoted-to-cognitive-primitive-7);
   spec narrative examples updated in the same change (no normative edits
   required).
7. **Retire old tool names** from the servers only after instrumentation
   shows zero old-name dispatches for a full cycle
   (`~/.atrib/state/read-primitives/calls.jsonl` `primitive` field is the
   measurement instrument — [D084](../DECISIONS.md#d084-read-primitive-instrumentation-for-empirical-loop-closure-measurement)
   pays for itself here).

Total blast radius: ~15 tool strings + 8 server names + ~30 published API
symbols + 8 package names + ~10 bins (classes a/b), 4 producer labels + 1
jsonl field + 1 filename pattern accepted-forever (class c), **zero signed
bytes** (class d), 2 launchd label families + ~5 pinning scripts + operator
client configs and the live SKILL.md symlink (class e), and ~1,000
documentation occurrences across 122 files — of which only SKILL.md is
behavioral.
