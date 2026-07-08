---
'@atrib/mcp-wrap': minor
---

Add the `extensionAttribution` config flag per [D141](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d141-devatribattribution-first-class-mcp-extension-sep-2133), letting the wrapper declare the `dev.atrib/attribution` extension on behalf of any upstream server; wrapping behavior is unchanged when the flag is unset.
