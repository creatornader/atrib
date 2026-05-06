---
"@atrib/emit": patch
"@atrib/recall": patch
"@atrib/trace": patch
"@atrib/summarize": patch
---

Documentation refresh — package READMEs now reflect the post-rename names and the spec-aligned mirror filename convention.

`@atrib/recall` ships its first README (the package was previously internal and never had a public README).

`@atrib/emit`, `@atrib/trace`, `@atrib/summarize` README headers + body refs updated from the prior `@atrib/atrib-*` form to the `@atrib/<noun>` namespace pattern.

`@atrib/emit` README also genericizes a 1Password example that previously referenced a specific item title.

CHANGELOGs gain a callout explaining the version-skew between local-only workspace bumps and the first npm publish (e.g. `@atrib/emit` 0.4.0 was the first npm publish even though 0.2.0 + 0.3.0 entries appear in the changelog from the workspace-private period).

No code changes — purely docs + metadata for npmjs.com surface accuracy.
