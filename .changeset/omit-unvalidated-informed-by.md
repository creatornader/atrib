---
'@atrib/emit': patch
---

Drop unvalidated informed_by refs before signing.

`@atrib/emit` now keeps only refs found in local mirrors or through the configured log lookup. Missing or unvalidated refs are dropped with a warning unless the caller sets `allow_unresolved_informed_by: true`.

The package build also restores executable bits on `dist/main.js` and `dist/cli.js` after `tsc`, so local global installs keep the MCP and CLI binaries runnable.
