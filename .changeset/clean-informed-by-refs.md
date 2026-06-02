---
'@atrib/mcp': patch
'@atrib/emit': patch
---

Tighten producer-side informed_by handling.

`@atrib/mcp` now limits `autoDetectInformedByFromArgs` to structured record-reference fields and exports `extractRecordReferenceCandidates` for callers that need the same behavior. It no longer turns hashes in prose, commitment fields, or nested `informed_by` envelopes into automatic graph claims.

`@atrib/emit` now checks informed_by refs before signing. Refs found in local mirrors or the configured log lookup are kept. Operationally unknown refs are kept with a warning. Refs that are absent from both local mirrors and log lookup are dropped unless the caller sets `allow_unresolved_informed_by: true`.
