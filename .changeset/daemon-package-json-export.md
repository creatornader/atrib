---
"@atrib/daemon": patch
---

Export the `./package.json` subpath so registry consumers can resolve the
manifest through the exports map, matching the fix CI caught for
`@atrib/attest` (health contracts read dependency versions via
`require.resolve('<pkg>/package.json')`).
