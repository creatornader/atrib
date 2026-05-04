# @atrib/mcp-wrap

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
