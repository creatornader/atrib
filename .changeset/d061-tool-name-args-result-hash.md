---
"@atrib/mcp": minor
"@atrib/verify": minor
---

D061: add `tool_name`, `args_hash`, `result_hash` to the §1.2.1 canonical record schema.

Closes the spec gap where §8.2 (opaque-name posture) and §8.3 (salted-commitment posture) referenced record fields that had never been added to the §1.2 canonical shape. Verifier surfaces for both postures now have structural inputs to detect against.

`@atrib/mcp` `AtribRecord` type gains three optional fields with documented JCS-canonical sort positions:
- `tool_name?` — last in current schema (`t-o-...` after `t-i-...`)
- `args_hash?` — between `annotates` and `args_salt`
- `result_hash?` — between `provenance_token` and `result_salt`

All three default to absence (preserving the §8.1 default posture). Backward-compatible: existing records continue to verify identically.

`@atrib/verify` `PostureAnnotation` gains `tool_name_form: 'hashed' | 'plain' | null`. Detection per the D061 fix to §8.2's regex ambiguity:
- `'hashed'` when value matches `^sha256:[0-9a-f]{64}$` (unambiguous)
- `'plain'` for any other present value (verbatim and opaque-label NOT structurally distinguishable; both surface as plain)
- `null` when the field is absent

5 new verifier tests + 4 conformance-corpus reference tests added; verify package now at 267 passing tests. New `spec/conformance/8.2/` corpus (4 cases) ships alongside.

§8.2 prose updated to acknowledge the regex ambiguity. §8.3 prose clarifies that `args_hash` / `result_hash` are §1.2.1 MAY fields. §1.2.1 standard-shape example record + field table extended with all three fields.

Middleware-side opt-in (config-gated emission of the new fields) is a separate follow-up; this change is verifier-only and spec-only and does not change the bytes any existing record produces.
