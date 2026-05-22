---
"@atrib/emit": minor
---

Add `doctor` subcommand and `--describe` flag to `atrib-emit-cli`. Both inherit ergonomic patterns from the printingpress-generated [`atrib-log-pp-cli`](https://github.com/creatornader/atrib-log-pp-cli) without changing the existing emit contract.

**`atrib-emit-cli doctor`** runs three substrate-readiness checks in parallel: key resolves (env / file / Keychain / 1Password, with the bounded timeouts from [D081](../DECISIONS.md#d081-in-process-emit-for-hook-class-producers-emitinprocess)), the log endpoint's `/v1/checkpoint` responds with a parseable signed-note, and the local mirror's parent directory is writeable. Renders a text summary by default or machine-readable JSON with `--json`. Exits 0 on pass, non-zero on any failure — differs from the always-0 contract of `emit` because doctor is operator-facing diagnostic and scripts need a real signal.

**`atrib-emit-cli --describe`** emits a stable JSON description of the CLI's contract on stdout (subcommands, options, envelope schema with required + optional field documentation, output shape, environment variables, [§1.3](../atrib-spec.md#13-canonical-serialization) / [§5.8](../atrib-spec.md#58-degradation-contract) spec references, [D079](../DECISIONS.md#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface) / [D081](../DECISIONS.md#d081-in-process-emit-for-hook-class-producers-emitinprocess) / [D082](../DECISIONS.md#d082-cli-binary-distribution-of-emitinprocess-supersedes-d081s-integration-shape) ADR references). Designed for LLM / tooling introspection: an agent that has never seen the binary can pipe `atrib-emit-cli --describe` to discover the full surface without reading source.

The existing default behavior (read envelope on stdin, sign, write EmitOutput JSON to stdout, always exit 0) is unchanged. `atrib-emit-cli emit` is now also a recognized explicit subcommand spelling, identical to the default.
