# atrib spec §1.2.3 multi-producer chain composition conformance corpus

Test fixtures for the chain-root resolution precedence ordering when
multiple producers participate in one agent session under one identity.

The corpus is the shared contract between every producer implementation
that signs records under the same `creator_key` for the same `context_id`
across process boundaries: the wrapper middleware in `@atrib/mcp`, the
`atrib-emit` cognitive-primitive subprocess, third-party wrappers, future
producers in other languages. Honoring the precedence ordering is what
keeps records on the same context coherent under producer composition.

See [D067](../../../DECISIONS.md#d067-multi-producer-chain-composition-precedence-contract)
for the decision rationale and the alternative paths considered.

## Precedence (highest to lowest)

| Layer | Source | When it fires |
|---|---|---|
| 1. inbound | `inboundRecordHashHex` (decoded from MCP `_meta.atrib`, W3C tracestate `atrib=...`, or `X-Atrib-Chain` header per [§1.5.2](../../../atrib-spec.md#152-http-transport-tracestate)) | The agent SDK threads the upstream record's hash explicitly into this call. The new record MUST chain to it. |
| 2. auto-chain | `autoChainTailHex` (in-memory tail) | The producer signed a previous record under the same context in this process and remembers its hash. Within-process continuity. |
| 3. env-tail | `ATRIB_CHAIN_TAIL_<context_id>` env var, value matching `^sha256:[0-9a-f]{64}$` | A parent process spawned this producer with the env var set. Cross-producer handoff. |
| 4. mirror-tail | `mirrorTailHex` (caller pre-reads a mirror file filtered to this context_id) | A peer producer wrote to a shared on-disk mirror; we inherit its tail. File-as-IPC fallback. |
| 5. genesis | `sha256:hex(SHA-256(UTF-8(context_id)))` per [§1.2.3](../../../atrib-spec.md#123-chain_root-for-genesis-records) | No upstream chain context exists. |

## Cases

| File | Asserts |
|---|---|
| `cases/inbound-wins.json` | All four resolution sources present; inbound wins. |
| `cases/auto-chain-wins.json` | No inbound; in-memory autoChain tail wins over env + mirror. |
| `cases/env-tail-wins.json` | No inbound, no auto-chain; ATRIB_CHAIN_TAIL_<ctx> wins over mirror. |
| `cases/mirror-tail-wins.json` | Only mirror tail present; producer chains to it. |
| `cases/genesis-fallback.json` | No signals; synthetic genesis chain_root. |
| `cases/env-tail-malformed-falls-through.json` | Env var set but malformed; resolver MUST fall through (does not treat the bad value as a chain anchor). |
| `cases/env-tail-namespace-isolation.json` | Env var set for a DIFFERENT context_id; MUST NOT be consulted. |

## Reference implementation

`@atrib/mcp`'s `resolveChainRoot` in `packages/mcp/src/chain-root.ts`. The
unit tests at `packages/mcp/test/chain-root.test.ts` exercise the same
precedence ordering, and the corpus reference test at
`packages/mcp/test/conformance-1.2.3-multi-producer.test.ts` consumes
each case JSON and asserts the resolver returns the expected chain_root.

The orchestration helper `inheritChainContext` in
`packages/mcp/src/mirror.ts` builds on `resolveChainRoot` to handle the
mirror-file I/O and context_id inheritance. Its decision tree is tested
in `packages/mcp/test/mirror.test.ts`. The mirror filter-by-context_id
invariant (a mirror tail on a DIFFERENT context_id MUST NOT be inherited
when caller supplies a context_id) is part of the multi-producer
contract; producers that read mirrors directly MUST honor it.

## Generator

`packages/log-dev/scripts/generate-conformance-1.2.3-multi-producer.ts`. Run with:

```sh
pnpm --filter @atrib/log-dev exec tsx scripts/generate-conformance-1.2.3-multi-producer.ts
```

Seeds and timestamps are hardcoded so successive regenerations produce
byte-identical files. Regenerate when:

- The precedence ordering changes
- A new precedence layer is added
- The env-var name format changes (`ATRIB_CHAIN_TAIL_<context_id>`)
- New test cases are needed
