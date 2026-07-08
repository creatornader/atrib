# Relay brief: what the 2026-07 redesign means for the website overhaul

Audience: the session doing the website overhaul/redesign. Written 2026-07-06
by the redesign-analysis session, immediately after the operator approved the
P042-P050 candidate set ([DECISIONS.md](../DECISIONS.md) Pending decisions;
full drafts in `docs/adr-draft-p04x-*.md`). This document is the authoritative
list of redesign facts that affect public-facing language, structure, and
claims. Where this brief and older website copy conflict, this brief wins;
where this brief and the ADR drafts conflict, the drafts win.

## Governance you are bound by (before any copy changes)

1. **`DESIGN.md` is the design source of truth.** Read it before visual, UI
   writing, or user-facing reliability-state changes, and update it in the
   same commit when a product surface contract changes (CLAUDE.md "Design
   system" section).
2. **The canonical protocol identity is centrally governed.** Headline
   "Verifiable agent actions."; sub-line "Every action becomes signed context
   for the next."; tagline "Agents that reason from a past they can prove."
   These live in four synchronized places (README top, spec abstract, root
   package metadata, GitHub repo description). The approved redesign does NOT
   change the protocol identity — evolve framing *around* these lines, don't
   rewrite them unilaterally. If the overhaul concludes they must change,
   that's an operator decision updating all four surfaces in one commit.
3. **Commercial framing stays out of the spec abstract and GitHub repo
   description** (CLAUDE.md rule). Product pages may use the commercial
   frame (records in the action path; hosts check actions before they run).
4. If website copy lives in this repo, `pnpm doc-sync` checks it: bare
   `§x.y` / `Dxxx` / `Pxxx` refs must be inline-linked, number-word claims
   ("seven cognitive primitives", package counts) are mechanically checked,
   and a public-boundary wording check rejects internal strategy-and-persuasion
   vocabulary in public files (rule list in `scripts/check-doc-sync.mjs`). Write copy accordingly.

## The ten approved facts that change public language

1. **Two verbs become the agent-facing story: `attest` (write) and `recall`
   (read)** (P047). The seven cognitive primitives collapse: emit/annotate/
   revise → `attest` with a relationship qualifier; recall/trace/verify →
   `recall` with shape and verification parameters; summarize relocates to
   the harness (it is no longer an atrib primitive — remove it from
   primitive-surface marketing). The seven monomorphic tool names survive as
   *aliases* during a long migration window, so documentation pages keep
   them, but the front-door narrative is two verbs. Do not present
   "atrib-emit" as the headline write verb anywhere new.
2. **Trust story changes from "the public log" to "anchor plurality"**
   (P043). log.atrib.dev stops being described as *the* trust root and
   becomes the reference anchor — the best-behaved member of a ≥2-anchor
   default set (atrib log-node, Sigstore Rekor, RFC 3161 TSAs,
   OpenTimestamps). New copy shape: "verifiable against independent anchors,
   including infrastructure atrib doesn't operate." This is a *stronger*
   trust claim, lead with it.
3. **Session checkpoints** (P044): a new record type commits a Merkle root
   over a whole session, enabling two new marketable capabilities:
   *selective disclosure* (prove one action belongs to a committed session
   without revealing the rest) and *provable completeness* ("this is the
   whole session, not excerpts"). Language note: it ships extension-first;
   don't present it as a normative event type until the byte promotion lands.
4. **Delegation certificates** (P045): durable *principal* keys certify
   scoped, expiring *run* keys. Website-grade story: revoke one compromised
   run without rotating an identity; sandboxed agents hold keys worth
   exactly one run. Good enterprise/security page material once the spec
   section lands.
5. **Local daemon consolidation** (P046): the seven-process topology
   consolidates into one local daemon. Do not announce or name the daemon
   in public copy until the P046 timing gate passes; until then, describe
   the local runtime generically. Announcement-timing details live in the
   private relay supplement.
6. **attest/recall rename sequencing** (P047): new names become primary in
   docs *inside* the alias window; legacy tool names stay documented for
   migration. npm package pages: `@atrib/attest` will be published fresh;
   `@atrib/recall` keeps its name.
7. **Payments move from core to a profile** (P048). The website must stop
   presenting six-protocol payment detection as protocol core. Core keeps —
   and pages should say exactly this — the `transaction` record type,
   two-party cross-attestation, and the evidence envelope; rails (ACP, UCP,
   x402, MPP, AP2, a2a-x402) attach as an independently versioned Payments
   Profile. Settlement/policy/calculation become profile documentation, not
   core-spec features. This reframes atrib's category: the substrate is
   verifiable agent actions and provable memory; commerce is one profile on
   top.
8. **Universal evidence envelope** (P042): one attachment model for OAuth/
   MCP, AAuth, x401, AP2/VI, human approvals, counterparty attestations,
   delegation certificates. Website value line: "any externally verifiable
   material rides the same envelope; verifiers evaluate it in tiers."
9. **`dev.atrib/attribution` MCP extension** (P049): the flagship
   ecosystem/distribution story. The line that should anchor the relevant
   page: **atrib stops being only "a wrapper you install" and becomes "a
   capability a server declares."** MCP's 2026-07-28 release makes
   extensions first-class (reverse-DNS ids, per-request capability
   negotiation); atrib publishes `dev.atrib/attribution` v0.1 declaring
   server-side signing, propagation carriage, and attestation receipts.
   Timing: v0.1 is targeted *before* 2026-07-28 to own the
   signed-action-record slot — coordinate any announcement copy with that
   window. Positioning care: "unofficial extension" is the correct formal
   status; official Extensions-Track status is possible later and must not
   be claimed early.
10. **MCP statelessness alignment** (context for all of the above): the MCP
    2026-07-28 release removes protocol sessions; atrib's explicit
    per-request context carriage and non-blocking receipts fit it natively.
    "Built for stateless MCP" is a legitimate, current claim.

## Vocabulary table (old → new)

| Retire / demote | Use instead |
|---|---|
| "the seven cognitive primitives" as front door | "two verbs, `attest` and `recall`" (seven names remain as aliases/deep-docs) |
| "atrib-summarize" as a core primitive | harness-owned synthesis over `recall` output |
| "the public log" as trust root | "anchor plurality; log.atrib.dev is the reference anchor" |
| "six payment protocols detected" (core claim) | "transaction records + cross-attestation in core; rails via the Payments Profile" |
| "wrapper you install" (sole model) | "capability a server declares (`dev.atrib/attribution`), wrapper as the shim for everything else" |
| "fan-out"/multi-agent framing alone | "orchestration topologies" (relay/baton-pass AND fan-out; see [D142](../DECISIONS.md#d142-orchestration-topology-baton-pass-and-join-records-as-attest-conventions)) |

## What has NOT changed (do not drift on these)

- Protocol identity lines (above), Ed25519/JCS/Merkle mechanics, the
  degradation contract, fact/policy separation, the graph's two reading
  planes ([D118](../DECISIONS.md#d118-primary-trace-path-is-a-presentation-rule-over-trace-and-chain) explorer framing), and every existing signed byte. Any page
  claiming a format change is wrong by construction — the entire approved
  set is additive except the payments relocation.
- The explorer (apps/dashboard) contract is unchanged today; anchor and
  checkpoint views arrive with their ADRs, not before.
- Live demos on the site remain governed by the [D117](../DECISIONS.md#d117-demo-records-are-classified-by-execution-surface) demo-record surface
  classifications.

## Timeline facts for any dated copy

- Moved to the private relay supplement. Before writing any dated
  copy, consult it, and verify tense against the DECISIONS.md promotion
  status as described under Coordination below.

## Coordination

- This branch (`claude/atrib-redesign-analysis-4g0r9v`) is the source for
  all of the above; implementation is landing tranche-by-tranche. Before
  finalizing copy about any single ADR, check whether its P-entry in
  DECISIONS.md has been promoted to a Dxxx (promotion = implementation
  landed = safe to state in present tense; unpromoted = future/roadmap
  tense).
- Questions or conflicts: route through the operator to the redesign
  session, which owns this brief and updates it as tranches land.

## Status update (2026-07-06, later same day)

P042-P045 and P049 are implemented and promoted to accepted ADRs
[D137](../DECISIONS.md#d137-universal-evidence-envelope-as-the-single-protocol-level-attachment-model)
through
[D141](../DECISIONS.md#d141-devatribattribution-first-class-mcp-extension-sep-2133):
facts 2, 3, 4, 8, and 9 above may now be written in PRESENT tense (the spec
sections, conformance corpora, and the dev.atrib/attribution v0.1 extension
document exist on this branch). The session-checkpoint event type remains
extension-URI staged, so fact 3's language note still applies. Facts 1, 5,
6, and 7 (P046-P048) remain roadmap tense; the fact-5 embargo stands. [D136](../DECISIONS.md#d136-consolidated-client-sdks-atribsdk--python-atrib-in-repo-byte-identical-corpus-tested)
(consolidated `@atrib/sdk` + Python `atrib` SDKs) also landed and is safe to
reference in developer-facing copy.
