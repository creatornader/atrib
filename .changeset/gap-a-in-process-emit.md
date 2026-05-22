---
"@atrib/emit": minor
---

Add `emitInProcess`, an in-process signing entrypoint for hook-class producers that routes through the same `handleEmit` as the MCP server (records stay byte-identical), and bound the Keychain and `op` spawns in key resolution (`ATRIB_KEYCHAIN_TIMEOUT_MS`, `ATRIB_OP_TIMEOUT_MS`) so headless signing fails fast into the [§5.8](../atrib-spec.md#58-degradation-contract) pass-through path instead of hanging the MCP init handshake. See [D081](../DECISIONS.md#d081-in-process-emit-for-hook-class-producers-emitinprocess).
