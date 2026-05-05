# @atrib/cli

## 0.1.3

### Patch Changes

- Updated dependencies [79199ee]
- Updated dependencies [8abcb67]
- Updated dependencies [3161e59]
- Updated dependencies [a3d24f9]
- Updated dependencies [d7c806c]
  - @atrib/mcp@0.2.0

## 0.1.2

### Patch Changes

- edf710f: Refine package descriptions for accuracy and consistency.
  - `@atrib/cli`: previous description listed macOS Keychain as if required (it's an optional backend; CLI works on any platform via `--key-file`) and singled out "publish identity claims" as the headline (one of several capabilities). New description: "Key management, identity-claim publishing, and revocation."
  - `@atrib/directory`: dropped "AKD-backed" (implementation detail) from the headline; replaced with "with cryptographic proofs" which captures the value proposition without leaking the implementation choice into the package summary. Also disambiguated "spec §6" to "atrib spec §6" since the npm package page strips surrounding context.
  - `@atrib/verify`: removed awkward double-"re-" stutter ("re-derivation" + "re-calculation"); replaced with "Independent" which carries the verifier semantic without the verb-stacking. Also disambiguated "§4.6" to "atrib spec §4.6".

- Updated dependencies [edf710f]
  - @atrib/directory@0.1.2

## 0.1.1

### Patch Changes

- 5809fc2: Refresh package descriptions and READMEs for npm consistency.
  - All 6 descriptions now follow the consistent shape `<noun> for atrib. <specific value>.`
  - Removed em dashes per the writing rules
  - `@atrib/mcp-wrap` description no longer mentions an arbitrary "~30 MCPs" cap (it works for any MCP)
  - Lowercased "Atrib" to "atrib" across author + description fields per the brand convention
  - Wrote READMEs for `@atrib/cli` and `@atrib/directory` (previously had none)
  - Rewrote 115 broken relative links across mcp/agent/verify READMEs to absolute github URLs that auto-heal at public-flip
  - Stripped temporary `repository` field from package.jsons (404s while repo is private; restored at public-flip)

- Updated dependencies [5809fc2]
  - @atrib/mcp@0.1.2
  - @atrib/directory@0.1.1
