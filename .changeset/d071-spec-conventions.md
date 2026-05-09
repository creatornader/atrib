---
'@atrib/mcp': patch
---

[D071](../DECISIONS.md#d071-spec-writing-conventions): codify ten spec writing conventions as binding ADR.

The atrib specification grew from [D041](../DECISIONS.md#d041-informed_by-linking-primitive-and-informed_by-edge-type) through [D070](../DECISIONS.md#d070-record-body-archive-layer-placeholder-adr) over six weeks of intensive spec work, with sections varying in their treatment of normative vs informative status, cross-reference style, conformance-corpus binding, and pattern-subsection layout. Drift across these dimensions creates costs both for readers (`MUST` claims meaning different things in different sections) and for spec maintenance (no clear template for new sections).

The new ADR adopts ten conventions as binding for new spec material and substantive edits to existing material. Existing sections that predate the ADR are grandfathered until substantively edited. Conventions:

1. Section status declaration (`_This section is normative._` / `_informative._`)
2. RFC 2119 language for normative claims
3. Inline cross-references via markdown anchor links (mechanically enforced by `scripts/check-doc-sync.mjs`)
4. Pattern subsection template (`Where it fits` / `How atrib mounts` / `Causality formation` / `Reference implementation` / `Trade-offs`)
5. Reference implementation status tags (shipped or planned with sequencing note)
6. Conformance corpus jointly normative with Appendix A
7. Prose audit on every push (mechanically enforced by `scripts/check-leaks.mjs`)
8. Sync triggers updated when sections change (mechanically enforced by `scripts/check-doc-sync.mjs`)
9. ADR template (`Date` / `Context` / `Decision` / `Alternatives considered` / `Consequences` / `Cross-references`)
10. Architectural framing, not session narrative

Conventions 3, 7, and 8 have mechanical enforcement; others are review-enforced. No code changes in `@atrib/mcp` itself; this changeset documents the spec-side governance change since `@atrib/mcp` is the canonical reference implementation that future spec sections will cite.
