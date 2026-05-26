# atrib design system

Version: 0.2
Status: active working design contract
Last updated: 2026-05-25

## Purpose

atrib makes agent activity verifiable. The design system should make that idea feel concrete: not a vague AI platform, not a crypto dashboard, not an observability clone. The interface should feel like a signed receipt becoming part of a chain.

This document is the design source of truth for the public atrib product surface: the website, explorer, protocol docs, package READMEs, share images, and operator-facing status/error states that users see. It has two jobs:

- Record what the surfaces do today.
- Define the product design state atrib is moving toward.

Do not treat this as only an inventory. A useful design system preserves the current truth while making the next truth harder to lose.

## Source Synthesis

This direction synthesizes six input streams:

- Current atrib surfaces: `atrib.dev`, `explore.atrib.dev`, protocol docs, package docs, the public explorer, and CI/deploy status surfaces.
- atrib product language: "Verifiable agent actions", "Every action becomes signed context for the next", and "Agents that reason from a past they can prove."
- Design-reference synthesis from 2026-05-25, reduced to product principles rather than copied references.
- Public writing about agent-readable design rules, including Google Labs' Stitch `DESIGN.md` notes.
- Prior work in the sibling `atrib-web` repo, where the first website-oriented atrib design contract was drafted.
- Local design skills: interface-design for product specificity, Hallmark for anti-generic structure, baseline-ui for technical UI quality, web interface guidelines for accessibility, and make-interfaces-feel-better for interaction detail.

The shared lesson from the best sources: a design system is not only tokens and components. It is a reasoning surface for future design work. It should explain why the system looks this way, what to preserve, what to avoid, and what still needs to become true.

Research handling:

- Keep unpublished source details and raw research lists out of public artifacts unless explicitly approved.
- Public sources can be cited when they help readers understand the design-system shape.
- Research-derived guidance should appear as distilled product principles, backlog items, and design decisions.

## Audience

Primary:

- Agent framework builders deciding whether to add atrib.
- Tool and MCP server authors who need proof of who called what.
- Protocol-minded developers who care about signatures, logs, and causality.

Secondary:

- Auditors, merchants, and other agents that need to verify a record.
- Standards people comparing atrib to trace context, Merkle logs, and payment rails.

The reader is technical and impatient. They want exactness, not hype.

## Product Position

Canonical headline:

```text
Verifiable agent actions.
```

Canonical sub-line:

```text
Every action becomes signed context for the next.
```

Canonical tagline:

```text
Agents that reason from a past they can prove.
```

Use these lines exactly unless the protocol positioning changes in `CLAUDE.md`, `README.md`, and `atrib-spec.md` in the same change.

## Design Intent

Scene: a developer is checking whether an agent really did what it claims. The room is dim, the screen is a record surface, and every colored mark should imply evidence rather than decoration.

Feel:

- Quiet, precise, technical.
- Warm enough to avoid cold observability sameness.
- Dense where data is being inspected.
- Sparse where the protocol thesis needs to land.

Avoid:

- Generic AI gradients.
- Crypto-neon spectacle.
- Enterprise trust-washing.
- Decorative cards that do not help verification.
- Claims that outpace the current product.

## Current State

The current system has a usable foundation, but it is uneven across surfaces.

Working today:

- The landing page has the right core position: verifiable agent actions.
- The palette is mostly disciplined: near-black canvas, warm off-white text, amber evidence mark, restrained borders.
- The explorer has the right product center: search, recent records, graph inspection, and verification surfaces.
- Explorer overview language now avoids exposing raw checkpoint jargon as primary user meaning.
- The live log outage exposed and fixed a real production issue, and smoke checks now enforce latency budgets for public log routes.
- The code examples and standards section make adoption feel concrete.
- Mobile overflow and keyboard entry points have explicit guardrails.

Still underdesigned:

- The landing page and explorer feel related, but not yet like one product.
- The explorer has product structure, but its hierarchy still reads closer to an internal tool than a public verification surface.
- The receipt chain is present as an idea, but not yet strong enough as a visual grammar across all surfaces.
- Docs and package READMEs do not yet carry the same visual and writing system.
- Open Graph and touch-icon assets now use the same amber seal, near-black canvas, and signed-graph language across `atrib.dev` and `explore.atrib.dev`.
- CI smoke now catches slow endpoints, but the product does not yet keep historical latency trends or alert routes.

## North Star

atrib should feel like the canonical place to inspect signed agent activity.

The product should make three things legible within a few seconds:

- What was signed.
- What it was chained to.
- How to verify it without trusting atrib.

The strongest version of the system is not a prettier dark dashboard. It is a receipt-native interface language: seals, hashes, event labels, proofs, graph paths, and raw records arranged so a technical person can move from claim to evidence without losing context.

North-star qualities:

- Evidence before explanation.
- Chain structure over decorative network art.
- Exact proof language over broad trust language.
- One calm accent used as the signed-artifact marker.
- Dense inspector views, but generous thesis moments.
- Public surfaces that feel open-source and protocol-native, not enterprise SaaS.

## Product Surface Map

Landing page:

- Job: explain why the protocol exists and route builders into explorer, install, spec, or GitHub.
- Current focus: tighter hero, explorer-first CTA, better proof copy.
- Target state: first viewport should feel like looking at a signed receipt entering a public log.

Explorer:

- Job: inspect records, sessions, identities, graph structure, anchoring, and traces.
- Current focus: mobile safety, accessible search, visible graph edges, clearer action states.
- Target state: verification workflow should be the spine. Search result to record detail to graph to raw proof should feel like one investigation.

YC demo:

- Job: show, in one stable reviewer-facing artifact, that signed causal history changes downstream agent behavior.
- Current focus: `https://explore.atrib.dev/yc-demo.html`, a scripted signed-context graph where Agent B selects current Policy v2 and writes new signed records from that context.
- Target state: visually and linguistically belongs to the same family as the website and explorer, while remaining stable enough for recordings and funding reviewers.

Live replay:

- Job: show recent public-log activity as an animated graph.
- Current focus: `https://explore.atrib.dev/#/demo`, now labeled as live recent-action replay so it does not compete with the stable YC demo.
- Target state: makes live substrate activity legible without looking like a separate demo product.

Protocol docs:

- Job: define the technical truth.
- Current focus: correctness and completeness.
- Target state: docs should borrow the same evidence language and component patterns where useful, especially for diagrams, record examples, and verifier steps.

Package READMEs:

- Job: help builders install the right integration.
- Current focus: package-specific accuracy.
- Target state: every README should follow the same adoption rhythm: install, wrap or sign, verify, inspect.

Share images:

- Job: make the product recognizable in feeds.
- Current focus: shared social-card and touch-icon bytes across the marketing site and explorer.
- Target state: amber seal, graph fragments, and receipt-chain framing should make atrib recognizable before the text is read.
- Asset contract: `atrib-web/scripts/generate-brand-assets.mjs` generates the marketing social card and touch icons; `apps/dashboard/static/opengraph-image.png` and `apps/dashboard/static/apple-touch-icon.png` must remain byte-identical copies of those generated assets until the two repos share a packaged asset pipeline. Browser favicons must also stay aligned: `apps/dashboard/static/favicon.ico` is copied from `atrib-web/app/favicon.ico`, and `/favicon.ico` serves those ICO bytes rather than the SVG icon.

Status and reliability surfaces:

- Job: make product health understandable when atrib's public surfaces fail or slow down.
- Current focus: scheduled smoke checks and post-deploy smoke checks.
- Target state: public and operator-facing states should distinguish unreachable, slow, stale, and unverified. They should name what users can try next.

## Explorer Surface Inventory

This inventory is grounded in `apps/dashboard/index.html` as of 2026-05-25. Update it when routes, view hierarchy, proof language, or reliability states change.

| Surface                             | User job                                                                               | Current friction                                                                                                                                             | Target hierarchy                                                                                | Next design action                                                                                                            |
| ----------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Overview `#/`                       | Understand live log health, search a known identifier, and scan recent signed records. | The page now says "proof status" and "log health", but it still mixes product health, proof state, recent activity, and onboarding in one first-screen band. | Live state, search, proof path, recent receipts, event key.                                     | Separate product health from proof status. Add stale/slow language when data is old or delayed.                               |
| Action `#/action/<record_hash>`     | Verify one signed record and decide where to inspect next.                             | The receipt panel now states what the log proof does and does not prove, but it still needs a fuller independent verifier path.                              | Subject, event summary, signer, inclusion/proof checks, session/identity/trace links, raw JSON. | Clarify missing directory claim as optional, not a warning. Add inclusion-proof and checkpoint replay details when available. |
| Identity `#/identity/<creator_key>` | Understand who a key claims to be and inspect that signer's sessions.                  | The directory and activity-map concepts are useful but dense. A user can miss that a missing claim does not invalidate signatures.                           | Key, claim state, claim history, activity map, sessions, raw directory data when needed.        | Add a plain-language identity-state model: claimed, unclaimed, directory error, claim history available.                      |
| Session `#/session/<context_id>`    | Read one agent workflow as a sequence and graph.                                       | Fallback states are honest but too implementation-heavy, especially when graph-node errors or large sessions produce sparse views.                           | Readiness row (source, graph, transaction, references), structural stats, graph when useful, signed records table, fallback reason. | Rewrite graph fallback copy around user meaning: graph unavailable, log records still trustworthy.                            |
| Trace `#/trace/<record_hash>`       | Walk backward from a record through provenance and chain ancestry.                     | The split between provenance trace and causal chain is technically correct but heavy for first-time readers.                                                 | Starting record, provenance ancestry, linear chain, edge legend, direct action link.            | Add a small "two ways backward" explainer before the graph. Keep spec references secondary.                                   |
| Anchoring `#/anchoring`             | Check signed checkpoint and directory anchor state.                                    | Anchoring is the most protocol-heavy view. It risks sounding like internal implementation unless it names what a checkpoint lets a verifier do.              | Protected history, checkpoint, directory anchor, endpoint state, raw proof material.            | Rename labels around verifier jobs: "history checkpoint", "directory state anchor", "latest protected tree".                  |
| Live replay `#/demo`                | See a live replay of recent signed agent activity.                                     | It is useful as motion, but it can read as spectacle unless the selected records map back to verification. It must not be confused with the stable YC demo.    | Selected session, timeline, replay graph, selected record inspector, action links.              | Make the inspector more receipt-like. Add a clear link from replay state to the action receipt.                               |
| About `#/about`                     | Learn what each view means and how to verify records.                                  | It covers the basics, but it should become the glossary for the design language: receipt, signer, log, proof, trace, anchor.                                 | What this is, seven views, core vocabulary, manual verification steps.                          | Add a compact glossary and link terms back into view headers.                                                                 |

## Execution Backlog

### Public surface alignment

- [x] Create a design contract that covers landing and explorer-adjacent patterns in `atrib-web`.
- [x] Promote the design contract into this repo as `DESIGN.md`.
- [x] Add a public header with explorer, spec, and GitHub routes.
- [x] Make explorer the primary public CTA.
- [x] Tighten landing copy around signed receipts and verifier checks.
- [x] Add explorer overview verification path: find claim, read receipt, trace chain.
- [x] Add action-detail receipt panel before raw JSON.
- [x] Add identity and session page paths so detail views explain how to read themselves.
- [x] Define event-chip colors, labels, and density rules for every record type.
- [x] Add explorer detail-view hierarchy rules: subject header, verification status, graph, raw JSON, related records.
- [x] Bring explorer tokens closer to this document without losing dense product affordances.

### Receipt chain system

- [ ] Design one reusable receipt component for landing examples, explorer details, and docs.
- [ ] Define graph legend and edge-treatment rules across explorer and diagrams.
- [ ] Add visual rules for `informed_by`, `provenance_token`, annotations, and revisions.
- [ ] Standardize hash truncation, copy affordances, and raw-record disclosure.
- [ ] Create empty, loading, and error states for public verification flows.

### Explorer information architecture

- [x] Add a view-by-view explorer surface inventory.
- [x] Add explicit "what this proves" and "what this does not prove" copy to action receipts.
- [ ] Re-audit overview cells and labels against user meaning, not internal field names.
- [ ] Rework action detail so a non-protocol reader can answer: what happened, who signed it, what proves it, and what came before.
- [ ] Decide whether "explorer", "public log", "verifier", or another term names the surface best.
- [ ] Add a plain-language proof status model for verified, unverifiable, stale, unreachable, and partial states.
- [ ] Check mobile detail views at 320, 375, 390, and 414px.

### Documentation system

- [ ] Create README writing patterns for install, sign, verify, inspect.
- [ ] Update package READMEs to use the same verbs and proof language.
- [ ] Add diagram rules for protocol docs.
- [ ] Define how much visual design belongs in docs versus the explorer.

### Reliability and observability

- [x] Add public log smoke checks for reachability.
- [x] Add latency budgets to public log smoke checks.
- [ ] Track latency history for public endpoints instead of only pass/fail.
- [ ] Add alert routing for scheduled smoke failures.
- [ ] Add lightweight process metrics for log-node event-loop and request latency.
- [ ] Decide whether a benchmark endpoint, periodic benchmark job, or private Fly check is the right production hardening layer.

### Launch and share surfaces

- [x] Govern Open Graph and social-card composition with this system.
- [ ] Create a launch graphic pattern based on the amber seal and receipt chain.
- [ ] Add examples for screenshots, blog diagrams, and short demos.
- [ ] Check share images at mobile feed sizes, not only full resolution.

## Open Design Questions

- Should the explorer feel warmer like the landing page, or slightly cooler because it is a dense inspection tool?
- Does the amber seal represent any signed artifact, or only records that have passed verification?
- Should the public site show live explorer data in the hero, or keep the hero static until the explorer is more polished?
- What is the right public name for the explorer: explorer, public log, verifier, or something else?
- How much protocol vocabulary should appear before the first install command?
- Should reliability states be part of the public explorer, an operator-only surface, or both?

## Signature Element

The signature element is the receipt chain:

- A small amber seal marks signed artifacts.
- Hairline connectors show that records form a chain.
- Monospace hash fragments and event labels sit inside restrained surfaces.
- Live explorer data should look like evidence, not a marketing demo.

This signature must appear in at least five places across a public surface: brand mark, hero status pill, code block header, section divider, explorer event chips, graph legend, receipt/action detail, or CTA panel.

## Tokens

### Colors

```yaml
colors:
  background:
    value: '#0a0a0a'
    purpose: 'Primary canvas. Near-black, not pure black.'
  explorer-background:
    value: '#0a0b0e'
    purpose: 'Explorer canvas. Slightly cooler for dense data views.'
  surface:
    value: '#131210'
    purpose: 'Landing page panels and code blocks.'
  surface-raised:
    value: '#1c1a17'
    purpose: 'Headers and surfaces one level above panels.'
  explorer-surface:
    value: '#14161a'
    purpose: 'Explorer panels, feeds, and stats.'
  foreground:
    value: '#f5f4ee'
    purpose: 'Primary text. Warm off-white, never pure white.'
  muted:
    value: '#8a877e'
    purpose: 'Tertiary landing text and metadata.'
  muted-foreground:
    value: '#b8b5ac'
    purpose: 'Secondary landing copy.'
  border:
    value: '#2d2a25'
    purpose: 'Default landing structure.'
  border-strong:
    value: '#423e36'
    purpose: 'Important landing panel edges.'
  accent:
    value: '#e8a04f'
    purpose: 'Signed receipt mark on the landing page.'
  explorer-accent:
    value: '#fcd34d'
    purpose: 'Live explorer status, active nav, and primary action.'
  success:
    value: '#34d399'
    purpose: 'Verified, live, or healthy states.'
  warning:
    value: '#fbbf24'
    purpose: 'Slow, stale, or partial states.'
  error:
    value: '#f87171'
    purpose: 'Verification failures or destructive states.'
```

Rules:

- Use accent color as evidence, not confetti.
- Keep accent under 10% of a product UI viewport.
- Product data color may use multiple hues only when categories need separation.
- Explorer implementation should expose product token names first, then map dense inspector aliases like `--bg`, `--surface`, and `--text` onto them.
- Never use purple-blue gradients as brand expression.
- Never use pure `#000` or `#fff`.

### Typography

```yaml
typography:
  sans:
    family: 'Inter'
    purpose: 'Readable product and landing copy.'
  mono:
    family: 'IoskeleyMono'
    purpose: 'Hashes, commands, record labels, and protocol details.'
  display:
    family: 'Inter'
    purpose: 'Large protocol statements with restrained weight.'
```

Rules:

- Headings use balanced wrapping.
- Body copy stays between 55 and 75 characters on desktop.
- Mobile copy should be intentionally narrower, around 30 to 36 characters.
- Data numbers use tabular numerals.
- Letter spacing stays `0` unless a local all-caps protocol label needs spacing for scanability.

### Spacing

```yaml
spacing:
  xs: '4px'
  sm: '8px'
  md: '16px'
  lg: '24px'
  xl: '32px'
  section-mobile: '80px'
  section-desktop: '112px'
```

Rules:

- Use 8px rhythm for controls and panels.
- Page sections can breathe; inspector views should be denser.
- Fixed-format elements must have stable widths or overflow behavior.

### Radius

```yaml
radii:
  control: '5px'
  panel: '8px'
  large-panel: '12px'
```

Rules:

- Keep cards at 8px or less unless the existing component uses 12px for a large framed diagram.
- Nested radii must be concentric: outer radius equals inner radius plus padding.

### Motion

```yaml
motion:
  interaction-duration: '120ms'
  feedback-duration: '150ms'
  diagram-duration-max: '200ms'
  easing: 'ease-out'
```

Rules:

- Motion must explain causality or state change.
- Animate transform and opacity. Avoid width, height, top, left, margin, and padding.
- Respect `prefers-reduced-motion`.
- Explorer graphs should keep structural context visible while users move through them.

## Components

### Brand Header

Purpose: orient the visitor immediately.

Requirements:

- Brand mark uses the amber seal.
- Primary links: explorer, spec, GitHub.
- Header must fit mobile without horizontal page overflow.
- Public site header and explorer header should feel related, not identical.

### Code Block

Purpose: make adoption feel small and concrete.

Requirements:

- Header row names the file or command.
- Copy button has visible feedback and an accessible label.
- Code must not force horizontal page overflow on mobile.
- Use the receipt seal dot in command headers.

### Receipt/Event Chip

Purpose: label signed activity with enough color to scan.

Requirements:

- Color communicates event type.
- Label text must remain readable without color alone.
- Each chip should have a stable width or wrapping strategy in dense views.
- Canonical labels: tool call, observation, annotation, revision, transaction, directory anchor, extension.
- Dense views put the count first: `3 tool calls`, not `tool_call 3`.
- Receipts use the noun form: `tool call record`, `revision record`, `signed record` when unknown.

### Explorer Search

Purpose: route a known identifier to the right view.

Requirements:

- Accept creator key, context id, or record hash.
- Search button has `type="button"` and a clear accessible label.
- Placeholder may truncate on mobile, but help text must name the accepted inputs.

### Graph View

Purpose: show structure, not decorative network art.

Requirements:

- Edges stay visible during movement.
- Hover emphasizes neighborhood without erasing the rest of the graph.
- Legend explains node and edge meaning near the graph.
- Empty, loading, and error states must say what the user can do next.

### Reliability State

Purpose: tell a user whether a product surface is live, slow, stale, unreachable, or partially verified.

Requirements:

- Do not collapse slow and unreachable into the same message.
- When the log is slow, keep the last good data visible and label it stale.
- When a proof cannot be verified, name which check is missing: signature, inclusion proof, checkpoint, directory lookup, or graph lookup.
- User-facing copy should say what can be tried next: retry, inspect raw record, open the log endpoint, or wait for the next poll.

## Writing

Voice:

- Direct.
- Exact.
- Builder-facing.
- No inflated trust claims.

Good:

- "Verify the signature, inclusion proof, and checkpoint."
- "Paste a record hash."
- "Install either package, the other, or both."
- "The log is reachable but slow."

Bad:

- "Universal trust layer."
- "Revolutionary attribution."
- "Secure by design" without naming the mechanism.
- "Latest checkpoint" as a standalone user-facing label.

Patterns:

- Lead with the object being verified.
- Prefer verbs: sign, chain, verify, inspect, settle.
- Explain trust by naming independent checks.
- Do not restate the heading in the paragraph below it.
- Avoid exposing protocol nouns as primary UI labels unless the UI also explains their user meaning.

## Layout

Landing:

- First viewport: brand, protocol headline, sub-line, install path, explorer/spec/GitHub routes.
- Middle: why the protocol exists, how the layer fits, what it works with.
- End: standards and installation.

Explorer:

- First viewport: live status, plain-language explanation, search, key stats, recent activity.
- Detail views: subject header, verification state, graph or record body, raw JSON when needed.
- Detail pages use this order: subject header, verification or readiness status, readable evidence, related records, raw JSON disclosure.
- When a detail page needs both a status row and metrics row, keep their jobs distinct. Status rows answer whether the surface is ready and what to inspect next. Metric rows answer what data shape is loaded.
- Raw JSON starts closed unless it is the primary object being inspected.

Mobile:

- No horizontal page overflow at 320, 375, 390, or 414px.
- Long hashes and code either wrap carefully or scroll inside their own framed element.
- Primary actions are at least 40px tall.

## Current Gaps

These are the remaining gaps from the May 25 design and production-hardening sessions:

1. **Design system execution:** This document now exists in the repo, but most surfaces still need to be audited and brought into line with it.
2. **Explorer UI polish:** The overview language improved, but the explorer still needs a full information-architecture pass around what users should understand first.
3. **Latency observability beyond smoke:** Scheduled smoke catches slow endpoints now. It does not store trend history or route alerts yet.
4. **Production log hardening:** The Merkle hot path is fixed. The service still needs better event-loop and request-latency visibility.
5. **Research-source hygiene:** Prior research is captured here at the principle level. Raw links and unpublished reference lists stay out of public artifacts unless explicitly approved.
6. **Website/content pass:** The site needs a focused branch for copy, layout, and proof-first adoption flow.
7. **Prettier debt:** Repo-wide formatting cleanup remains tracked separately in GitHub issue #23.

## Next Execution Slice

Start with the explorer because it is the product surface where design quality and protocol comprehension meet.

Recommended slice:

- Create a surface inventory for the explorer overview, action detail, identity, session, trace, anchoring, demo, and about views.
- For each view, record current user job, current friction, target hierarchy, and component changes.
- Implement the smallest high-confidence UI update from that inventory, preferably action detail or overview proof status.
- Verify with desktop and mobile screenshots before merge.

## Design Decisions Log

| Date       | Decision                                                      | Rationale                                                                                                                |
| ---------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 2026-05-25 | Use the receipt chain as atrib's signature design element     | It is specific to the product and maps directly to signed records, hashes, proof, and causality.                         |
| 2026-05-25 | Keep this file as the repo design source of truth             | The explorer and protocol surfaces live in this repo, so design guidance must not live only in the sibling website repo. |
| 2026-05-25 | Treat latency and stale data states as design-system concerns | A public verification surface fails users when it hides whether data is slow, stale, unreachable, or unverified.         |

## Public References

- Google Labs, "Stitch: Design.md": `DESIGN.md` files give agents the reasoning behind a design system and help validate implementation choices against design rules and accessibility constraints. <https://blog.google/innovation-and-ai/models-and-research/google-labs/stitch-design-md/>
