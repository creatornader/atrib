---
"@atrib/emit": minor
---

Add `atrib-emit-cli` binary ([D082](../DECISIONS.md#d082-cli-binary-distribution-of-emitinprocess-supersedes-d081s-integration-shape)): a thin command-line wrapper around `emitInProcess` that reads a JSON envelope from stdin, signs the record in-process, and writes the EmitOutput JSON to stdout. Exit code is always 0 per the [§5.8](../atrib-spec.md#58-degradation-contract) degradation contract; failures surface as warnings inside the result or as a stderr diagnostic line.

Per [D082](../DECISIONS.md#d082-cli-binary-distribution-of-emitinprocess-supersedes-d081s-integration-shape), this binary replaces the [D081](../DECISIONS.md#d081-in-process-emit-for-hook-class-producers-emitinprocess) "import `@atrib/emit` from the hook helper" integration shape. Operators install `@atrib/emit` globally (`npm install -g @atrib/emit`) and the hook helper spawns `atrib-emit-cli` instead of carrying a local `node_modules/`. Removing the npm workspace from the hook source directory eliminates a failure mode where Claude Code silently dropped hooks while the directory's package files were mutating.

Records signed via the CLI are byte-identical to MCP-server-signed and middleware-signed records (same canonical form per [§1.3](../atrib-spec.md#13-canonical-serialization), same `handleEmit` path, same `resolveKey` with the bounded `ATRIB_KEYCHAIN_TIMEOUT_MS` / `ATRIB_OP_TIMEOUT_MS` from [D081](../DECISIONS.md#d081-in-process-emit-for-hook-class-producers-emitinprocess)). The existing `atrib-emit` MCP-server binary is unchanged.
