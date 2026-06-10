---
'@atrib/mcp-wrap': patch
---

Bound configured `informedByPaths` validation.

The wrapper still checks its configured mirror first, then sibling local mirrors
and log lookup per [D116](../DECISIONS.md#d116-producer-side-informed_by-validation-is-source-aware).
The sibling mirror scan now has a 500ms budget so a cold or large dogfood mirror
cannot stall the wrapped tool path. Timed-out lookups are treated as unvalidated
refs and dropped before signing.
