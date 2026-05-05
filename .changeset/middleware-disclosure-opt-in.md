---
"@atrib/mcp": minor
---

Add opt-in `disclosure` option to `atrib()` middleware (D061 / §8.2 / §8.3).

`AtribOptions.disclosure` lets callers opt into producing records with `tool_name`, `args_hash`, and `args_salt` populated. Both dials default to `'omit'`, preserving the §8.1 default posture; existing callers see no behavior change and produce byte-identical records.

```ts
atrib(server, {
  creatorKey,
  serverUrl,
  disclosure: {
    tool_name: 'verbatim',     // 'omit' | 'verbatim' | 'hashed'
    args: 'salted-sha256',      // 'omit' | 'plain-sha256' | 'salted-sha256'
  },
})
```

- `tool_name: 'verbatim'` writes the raw tool name from the MCP request.
- `tool_name: 'hashed'` writes `sha256:<64 hex>` of the verbatim name.
- `args: 'plain-sha256'` writes `args_hash = sha256(JCS(arguments))`.
- `args: 'salted-sha256'` generates a 16-byte random salt per record and writes both `args_salt` and `args_hash = sha256(salt ‖ JCS(arguments))`.

Result-side commitment (`result_hash`/`result_salt`) is intentionally NOT in this surface because signing happens before the upstream handler returns (to support `preCallTransform`). A separate post-call signing path is the next ADR.

8 new middleware tests added; mcp package now at 384 passing tests.
