# atrib SDK session — continuation packet

Handoff from the retired cloud session (2026-07-06/07) that built the two
client SDKs, to its local Desktop successor. This packet is the successor's
entry point; it distills the session rather than narrating it. The
corrections ledger below is **binding** — none of those items may be
re-derived or "fixed" back.

## (a) How to use this packet

Read in this order; skim nothing in items 1-4.

1. This packet, top to bottom.
2. [`docs/atrib-sdk-session-brief.md`](atrib-sdk-session-brief.md) — the
   original spawn brief **including its "Post-spawn addenda" section**,
   which supersedes the spawn prompt where they conflict.
3. `CLAUDE.md` — the hub doc; especially the **"Orchestration cost policy"
   section** (binding for every spawn you make) and the critical
   invariants.
4. [`DECISIONS.md`](../DECISIONS.md) entries
   [D136](../DECISIONS.md#d136-consolidated-client-sdks-atribsdk--python-atrib-in-repo-byte-identical-corpus-tested)
   (this workstream's charter ADR),
   [D137](../DECISIONS.md#d137-universal-evidence-envelope-as-the-single-protocol-level-attachment-model),
   [D138](../DECISIONS.md#d138-anchor-plurality-as-the-default-trust-posture),
   [D139](../DECISIONS.md#d139-session_checkpoint-event-type-the-session-stream-formalized),
   [D140](../DECISIONS.md#d140-delegation-certificates-principal-keys-certify-ephemeral-run-keys),
   [D141](../DECISIONS.md#d141-devatribattribution-first-class-mcp-extension-sep-2133),
   and pending [P046](../DECISIONS.md#p046-atribd-a-public-stateless-native-local-daemon-as-the-default-primitive-topology)-[P048](../DECISIONS.md#p048-payments-profile-spin-out-from-protocol-core).
5. [`packages/sdk/README.md`](../packages/sdk/README.md) and
   [`python/README.md`](../python/README.md) — the authoritative API
   surfaces (both current as of this handoff).
6. [`docs/concepts/17-client-sdks.md`](concepts/17-client-sdks.md) — the
   concepts-level framing.
7. On demand: [`docs/redesign-upgrade-path.md`](redesign-upgrade-path.md)
   (the P042-P049 promotion plan this session executed tranches of),
   [`docs/attest-recall-rename-impact.md`](attest-recall-rename-impact.md)
   (P047 blast radius), `.github/workflows/python-sdk.yml` (CI contract),
   [`docs/publishing-new-npm-package.md`](publishing-new-npm-package.md) +
   [`docs/publishing-new-pypi-package.md`](publishing-new-pypi-package.md)
   (publish runsheets — publishing stays gated, see §f),
   `packages/integration/examples/client-sdk/` (runnable example).

## (b) Session arc

All commits on `claude/atrib-sdk-bootstrap-jsvs7y` unless noted. The
redesign session worked in parallel on
`claude/atrib-redesign-analysis-4g0r9v`; this branch merges FROM it.

1. **Bootstrap** (`0de33cf`, `75cc1e1`): `@atrib/sdk` (packages/sdk;
   attest/recall verbs, daemon-first over the primitives runtime,
   in-process fallback, zero new signing code) and the Python `atrib`
   distribution (python/; full [§1](../atrib-spec.md#1-attribution-record-format) record-layer port — JCS via `rfc8785`,
   Ed25519 via `cryptography`, bit-for-bit `resolve_chain_root`).
   Monorepo placement (not separate repos) was decided deliberately:
   corpora as shared fixtures at the same commit, extraction-ready layout.
2. **Conformance + cross-impl judge** (`4c65e4a`): both SDKs run
   spec/conformance/{1.4, 1.2.6, 1.2.3/multi-producer, 2.6.1} unmodified;
   `python/tests/cross_impl/` + `packages/sdk/scripts/cross-impl-vectors.mjs`
   byte-compare 62 generated vectors across the two stacks.
3. **Adversarial hardening** (`322b6c2`): three-wave pass; every finding
   fixed with a pinned regression (see ledger).
4. **Docs + [D136](../DECISIONS.md#d136-consolidated-client-sdks-atribsdk--python-atrib-in-repo-byte-identical-corpus-tested)** (`49afa17`, `c18cd63`, `be7e84b`, `0abb3ec`): ADR,
   PyPI runsheet, API references, concepts page 17, repo-level placement
   (README/spec [§5.2](../atrib-spec.md#52-package-overview)), python-sdk.yml CI.
5. **atrib-cloud alignment** (separate repo `creatornader/atrib-cloud`,
   branch `claude/action-control-sdk-alignment`, pushed): persistent MCP
   client in `context-provider.ts`, JCS pin on `stableJson`, tests.
6. **Post-spawn addenda** (`7837354`): optional-peer lazy loading (P047
   pattern), anchor headroom, extension-receipt parsing.
7. **Tranche-1.5** (`59af53d`): alignment to the accepted [D137](../DECISIONS.md#d137-universal-evidence-envelope-as-the-single-protocol-level-attachment-model)-[D141](../DECISIONS.md#d141-devatribattribution-first-class-mcp-extension-sep-2133)
   schemas after the redesign session promoted P042-P045/P049
   (`cb9ae29`).
8. **Tranche-3 activation** (`63fae8a`, docs anchor fix `c7f96d2`): the
   big one — anchor fan-out via `createAnchorFanout` with
   `anchor_posture` on results and `flushAnchors()`; daemon receipts
   verified via `verifyAttributionReceipt` and surfaced as
   `VerifiedAttributionReceipt`; `buildEvidenceEnvelope` /
   `validateEvidenceEnvelope` over lazy optional-peer `@atrib/verify`;
   full Python parity (`atrib.anchors`, [D137](../DECISIONS.md#d137-universal-evidence-envelope-as-the-single-protocol-level-attachment-model) `atrib.evidence` surface,
   `verify_attribution_receipt`, per-anchor fan-out queues in
   `AtribClient`); evidence-envelope + mcp-extension + 2.11/anchors
   corpora wired on both sides; both READMEs and concepts page 17
   rewritten from draft (P042/P043/P049) to accepted
   ([D137](../DECISIONS.md#d137-universal-evidence-envelope-as-the-single-protocol-level-attachment-model)/[D138](../DECISIONS.md#d138-anchor-plurality-as-the-default-trust-posture)/[D141](../DECISIONS.md#d141-devatribattribution-first-class-mcp-extension-sep-2133))
   language.
9. **Merges from redesign**: `414b40d` (tranche 2 — protocol-package
   surfaces), `75c64ca`/`af52553` (orchestration cost policy), final
   merge `0b627b5`.

## (c) Corrections ledger — do NOT re-derive

Settled the hard way. Changing any of these is a regression, not a fix.

1. **Branch discipline.** Never push to
   `claude/atrib-redesign-analysis-4g0r9v`. This branch merges FROM it,
   never INTO it. Never rebase pushed history mid-review.
2. **Anchor-set resolution semantics (TS is the reference).** In
   `resolveAnchorSet` (TS) and `_resolve_anchor_plan` (Python): entries
   skipped for hostile shape, unregistered `anchor_type`, or unusable
   endpoint are **excluded from the config and therefore from the
   [§2.11.12](../atrib-spec.md#21112-producer-side-anchor-posture) plurality count**. A present-but-`null`/`None` `anchor_type`
   **skips** (TS `!== undefined` semantics); only an *absent* field
   defaults to `atrib-log`. Registered non-atrib-log types count toward
   plurality without needing a URL. Pinned in
   `python/tests/test_addenda.py`, `test_port_parity.py`, and
   `packages/sdk/test/addenda.test.ts`. (The mcp-layer helper
   `anchor_descriptor_type` intentionally coalesces `None`→atrib-log —
   that is the [§2.11.9](../atrib-spec.md#2119-log_proofs-element-discriminator) discriminator rule, a different layer; do not
   "unify" them.)
3. **Receipt-validity semantics are two different checks.** The
   mcp-extension corpus `expected.receipt_valid` means extension-spec
   [§6.2](extensions/dev.atrib-attribution/v0.1.md#62-receipt-block) validity — structural + internal consistency over the RAW result
   block (`verifyAttributionReceipt` / `verify_attribution_receipt`),
   which is `true` for the record-less log-submission case. The
   record-consistency checker
   (`checkAttributionReceiptConsistency` / `check_attribution_receipt_consistency`)
   deliberately returns `receipt_valid=false, mismatched=['record']`
   when there is no record to check against. Both assertions live in the
   receipt conformance tests on both sides. Do not make either check
   mimic the other.
4. **I-JSON boundary is a rejection contract.** Integers ≥ 2^53 and lone
   UTF-16 surrogates: JS canonicalizes lossily, Python raises
   `ValueError` (wrapped `CanonicalizationError` for key-position
   surrogates). This is deliberate — do NOT make Python mimic JS loss.
   Pinned in `python/tests/test_port_parity.py` and documented in
   `python/README.md`.
5. **Doc anchors.** A bare "6.2" in receipt prose means the *extension spec*
   (`docs/extensions/dev.atrib-attribution/v0.1.md#62-receipt-block`),
   NOT atrib-spec section 6.2 (the directory section). Cross-doc anchors
   must be the
   full-heading GitHub slugs (e.g.
   `#d138-anchor-plurality-as-the-default-trust-posture`) — the doc-sync
   inline-links check flags bare refs but does NOT catch wrong anchors,
   so verify slugs against the actual headings (`c7f96d2` fixed a batch).
6. **Canonical check invocations.** Python type check is `python -m mypy`
   run from `python/` (pyproject `packages=["atrib"]`); `mypy src tests`
   produces false errors. Pytest from the repo root:
   `pytest python/tests`. TS: `pnpm run build && pnpm run test` in
   `packages/sdk/`. Doc gate: `node scripts/check-doc-sync.mjs` from the
   repo root (also covers inline-link linting).
7. **Mirror env split.** The write path uses `ATRIB_MIRROR_FILE`;
   `@atrib/recall` reads `ATRIB_RECORD_FILE`/`ATRIB_MIRROR_DIR`. Demos
   and tests that write-then-read must set both (the client-sdk example
   does).
8. **Cloud-container gotchas that may not apply locally**: the `canvas`
   native dep couldn't build (proxy-blocked prebuilts, no cairo) →
   `pnpm install --ignore-scripts` was used *environment-locally only*;
   repo config was deliberately not changed. On Desktop a normal
   `pnpm install` may just work — try that first. Also: the Write tool
   twice produced literal NUL bytes (`\x00`) inside generated source
   (both `evidence.py` and `evidence.ts`); after large generated writes,
   scan for `\x00`.
9. **Repo names.** The hosted SaaS repo is `creatornader/atrib-cloud`
   (not "atrib-control" — an early mislabel). Its SDK-alignment branch is
   `claude/action-control-sdk-alignment`.
10. **`.claude/agents/` files are NOT in git.** CLAUDE.md's cost policy
    references `.claude/agents/mechanical-builder.md` (sonnet/low) and
    `mechanical-sweeper.md` (haiku/low), but the redesign session never
    committed them — commit `75c64ca` touched only CLAUDE.md. Until they
    land, set `model`/`effort` explicitly per spawn.
11. **Key facts already computed**: Ed25519 seed `0x11`×32 →
    public key `0EqyMnQrtKs6E2i9RhXk5tAiSrcaAWuvhSCjMsl3hzc`.
    `buildEmitArgs`/attest throw `TypeError` (TS) / `ValueError` (Python)
    ONLY on contradictory input; everything operational degrades
    ([§5.8](../atrib-spec.md#58-degradation-contract)) — the degradation-regression tests enumerate the once-broken
    throw paths (unguarded `new URL`, hostile anchor entries, Python
    mirror `UnicodeDecodeError`, WHATWG URL divergences, garbage daemon
    emit results). Do not simplify those guards away.
12. **Explicit-null envelope ref fields.** The [D137](../DECISIONS.md#d137-universal-evidence-envelope-as-the-single-protocol-level-attachment-model) schema types
    `payload.ref.uri`/`record_hash` as string-or-null; the corpus maximal
    case carries `"uri": null`. Python's `build_evidence_envelope` uses
    `_UNSET` sentinels so omitted ≠ explicit `None`. Keep it that way.
13. **Publishing is gated.** Nothing is published: `@atrib/sdk` is in the
    Changesets ignore list; PyPI `atrib` name was verified available
    2026-07-06 but not claimed. Publishing requires an explicit operator
    go (see §f).

## (d) Current state

- **Branch**: `claude/atrib-sdk-bootstrap-jsvs7y`, pushed, clean tree.
  Head at this handoff: the commit adding this packet (parent `c7f96d2`,
  tranche-3 at `63fae8a`, last redesign merge `0b627b5` which brought
  `75c64ca`).
- **Coordination**: the redesign session owns
  `claude/atrib-redesign-analysis-4g0r9v` (last seen head `75c64ca`).
  Merge from it when it signals; never push to it. The website-overhaul
  session works from `docs/website-redesign-relay.md` (not this
  workstream's concern).
- **Check status at handoff** (all green): `@atrib/sdk` build clean +
  **142 passed / 1 skipped**; Python **310 passed / 6 skipped**;
  cross-impl judge **62 passed**; `mypy` strict clean; doc-sync **8/8**.
  CI: `.github/workflows/python-sdk.yml` runs the Python suites, mypy,
  and the cross-impl judge on 3.10/3.12, path-scoped.
- **Other repo**: `creatornader/atrib-cloud` branch
  `claude/action-control-sdk-alignment` pushed (persistent MCP client,
  JCS pin); not merged there — that repo's owner decides.
- **No WIP was abandoned**; nothing uncommitted, no background tasks.

## (e) Remaining work

Routing tiers per the CLAUDE.md orchestration cost policy:
**[solo]** = warm-context main loop; **[executor]** = codex-plugin-cc
executor package (available locally, was NOT available to the cloud
session); **[cheap]** = pinned cheap agent (sonnet/haiku at low effort —
set explicitly until the `.claude/agents/` definitions land);
**[judge]** = premium adversarial/consistency agent (name + justify each).

1. **[solo]** Python daemon transport: `AtribClient` daemon-first over
   MCP Streamable HTTP once the 2026-07-28 stateless MCP transport
   ships. Design-sensitive (degradation contract, cooldowns, receipt
   parsing parity with `DaemonClient`). Blocked on the transport release;
   do not reimplement the current initialize-handshake protocol (explicit
   scope decision, recorded in both READMEs).
2. **[solo, blocked]** Non-atrib-log anchor transports (sigstore-rekor,
   rfc3161-tsa, opentimestamps) in both SDKs. Blocked on real transports
   landing in `@atrib/mcp` (TS currently stubs them); the SDK should then
   only re-export/wire, never fork the logic.
3. **[cheap]** Extend `packages/integration/examples/client-sdk/` to
   demonstrate the tranche-3 surfaces (multi-anchor config +
   `anchor_posture`, `buildEvidenceEnvelope`, receipt verification).
   Mechanical against existing APIs; acceptance = example runs end-to-end.
4. **[executor]** First-publish runsheets for `@atrib/sdk` (npm) and
   `atrib` (PyPI), *only after the operator go* (§f). Both runsheets are
   step-by-step docs; good executor-package material with the runsheet as
   the acceptance gate.
5. **[solo]** Upkeep merges from the redesign branch (P046-P048 activity,
   possible P050/P051 fallout touching the SDK surface). Small,
   judgment-bearing, warm-context.
6. **[judge — only if P047 promotes]** attest/recall rename execution
   review: `docs/attest-recall-rename-impact.md` is the blast-radius
   catalog; an adversarial consistency reviewer is justified there
   because persisted producer labels and signed-bytes claims are easy to
   silently break.
7. **[solo, relay]** Tell the redesign session (or operator) that
   `.claude/agents/mechanical-builder.md` / `mechanical-sweeper.md` are
   referenced by CLAUDE.md but untracked in git (ledger item 10).

## (f) Open operator decisions

1. **Publish timing** for `@atrib/sdk` (npm; currently Changesets-ignored)
   and `atrib` (PyPI; name verified available 2026-07-06). Everything is
   technically ready; the gate is deliberate.
2. **P046 ownership**: when/if the atribd daemon ADR promotes, does this
   SDK workstream's successor own the SDK-side activation, or does the
   redesign session? (The tentative split so far: redesign owns protocol
   packages, this session owns packages/sdk + python.)
3. **Commit the `.claude/agents/` definitions** referenced by the cost
   policy, or keep them environment-local? (They currently exist nowhere
   in git.)
4. **atrib-cloud merge**: the pushed
   `claude/action-control-sdk-alignment` branch in `atrib-cloud` awaits
   review/merge there.
