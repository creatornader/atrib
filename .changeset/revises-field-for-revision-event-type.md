---
"@atrib/atrib-emit": minor
---

Add `revises` field for revision event_type (D059 / spec §1.2.9).

`atrib-emit` now accepts a top-level `revises: "sha256:<64-hex>"` field on the `emit` tool input. REQUIRED when `event_type` is `https://atrib.dev/v1/types/revision`; FORBIDDEN on any other event_type. The require/forbid invariant surfaces as a warnings-only response per §5.8 rather than producing a malformed signed record.

`BuildEmitRecordInput.revises` flows through `buildAndSignEmitRecord` into the signed `AtribRecord`. JCS canonical-form ordering puts `revises` after `provenance_token` (r > p) and before `session_token` (r < s), handled automatically by `canonicalize`.

This mirrors the `annotates` plumbing shipped in the previous release. Required for retrospective-extraction producers that classify cognitive events as revisions and need to emit them with a referent record_hash pointing at the predecessor being superseded.

Three new integration tests cover round-trip emit, the require-when-revision invariant, and the FORBIDDEN-elsewhere invariant.
