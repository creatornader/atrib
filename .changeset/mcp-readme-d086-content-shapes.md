---
'@atrib/mcp': patch
---

Documents the normative content-shape contracts shipped in [D086](./DECISIONS.md#d086-bm25-corpus-extended-from-annotations-to-per-event_type-record-content). The `0.11.0` ship added `extractIndexableText` + per-event_type type defs (`ObservationContent`, `AnnotationContent`, `RevisionContent`, `ToolCallContent`, `TransactionContent`, `DirectoryAnchorContent`) + the per-event_type extractor functions + `DEFAULT_FIELD_CAP`, but the package README didn't cover them. This patch adds a dedicated "Normative content-shape contracts" section under the API reference with the per-event_type extraction table + extension-URI handling guidance, plus a one-line cross-reference in the "Lower-level primitives" paragraph so the new exports show up alongside the other helper exports. No code change.
