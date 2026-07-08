# @atrib/revise

MCP server exposing the `atrib-revise` tool for atrib's verifiable action layer. Supersedes a prior signed position with a stated reason, so the contradiction lands as a first-class graph node rather than a silent edit.

Records are immutable per spec [§1.6](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#16-immutability): once signed, the bytes are fixed forever. When the agent now holds a position incompatible with a prior claim, the only honest move is to sign a revision that points at the prior record, names the prior position, names the new one, and gives the reason. The prior record stays in the graph; the revision adds a REVISES edge that supersedes it. A reader walking the graph sees both, and any policy or recall pipeline that respects revision can prefer the latest.

## Install

```bash
pnpm add @atrib/revise
```

Verify a local build with `pnpm --filter @atrib/revise test`.

## Tool

```
mcp__atrib-revise__atrib-revise({
  revises: "sha256:<64-hex>",          // REQUIRED: target record_hash to supersede
  prior_position: string,               // ≤ 4096 chars; what was previously held
  new_position: string,                 // ≤ 4096 chars; the new position
  reason: string,                       // ≤ 4096 chars; why the revision happened
  topics?: string[],                    // up to 16 lowercase-hyphenated tags
  context_id?: "<32-hex>",              // defaults to ATRIB_CONTEXT_ID
  informed_by?: ["sha256:<64-hex>", ...] // optional lineage refs
})
→ {
  record_hash: "sha256:<64-hex>",      // the new revision record
  log_index: number | null,
  inclusion_proof: ProofBundle["inclusion_proof"] | null,
  context_id: string,
  warnings: string[]
}
```

## Writes

Signs a `revision` record per spec [§1.2.4](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#124-event_type-values) (event_type `0x06`, promoted via [D059](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d059-promote-revision-to-atrib-normative-event_type-byte-0x06)) and persists it through the same pipeline `@atrib/emit` uses: same key resolution, same chain composition, same JSONL mirror at `ATRIB_MIRROR_FILE`. A verifier cannot distinguish revision records signed via this tool from revision records signed via `@atrib/emit`'s polymorphic surface; the wire format is identical.

The graph layer derives a REVISES edge from the new record to the `revises` target per spec [§3.2.4](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#324-edge-derivation-rules) step 9. Policies and recall pipelines that respect revision-aware filtering can demote or hide the superseded record in favor of the new position.

## Behaviors

- **Required-field enforcement**: `revises`, `prior_position`, `new_position`, and `reason` are required. The Zod schema rejects calls missing any of these before the signing pipeline runs.
- **Spec validators**: `revises` is rejected on non-revision event_types per spec [§1.2.9](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#129-revises) (the underlying `handleEmit` enforces this; the tool's narrow schema prevents it from happening here).
- **Env-honoring**: `ATRIB_CONTEXT_ID` is honored as the default `context_id` per [D078](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default) when the caller omits the field. Per [D083](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers), when `ATRIB_CONTEXT_ID` is also unset, `CLAUDE_CODE_SESSION_ID` (and any future registered harness env var) is consulted via `@atrib/mcp`'s `resolveEnvContextId` so MCP children spawned by harnesses inherit the session's context_id automatically.
- **Producer label**: signed records carry `_local.producer = 'atrib-revise'` in the mirror sidecar, distinguishing them from `@atrib/emit`-signed revision records. Mirror consumers (the SessionStart by-producer aggregation, recall filters, audit tooling) can bucket revision records by their producing surface without inspecting envelopes. The signed `AtribRecord` bytes do not include producer; this is sidecar metadata only.
- **Multi-producer chain composition**: inherits chain state from the mirror or `ATRIB_CHAIN_TAIL_<context_id>` env per [D067](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d067-multi-producer-chain-composition-precedence-contract), the same way `@atrib/emit` does.
- **Records are immutable**: the prior record is NOT mutated. The revision adds a new node + edge; the original stays in the graph for full lineage.
- **Graceful degradation**: signing failures surface in `warnings`; never throws to the agent per spec [§5.8](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#58-degradation-contract).

## Wire-up

Add to your MCP host config (e.g. `~/.claude.json` `mcpServers`):

```json
{
  "atrib-revise": {
    "command": "node",
    "args": ["/path/to/atrib-revise/dist/main.js"]
  }
}
```

Or run as a one-off subprocess via `pnpm --filter @atrib/revise start`.

### Env vars (inherited from `@atrib/emit`)

- `ATRIB_PRIVATE_KEY` / `ATRIB_KEY_FILE` / macOS Keychain `atrib-creator-<ATRIB_AGENT>` / `ATRIB_OP_REFERENCE`: key resolution chain.
- `ATRIB_MIRROR_FILE`: JSONL mirror destination (where the signed revision persists).
- `ATRIB_AUTOCHAIN_SOURCE`: optional cross-producer chain inheritance source.
- `ATRIB_LOG_ENDPOINT`: log.atrib.dev override (e.g. for self-hosted log nodes).
- `ATRIB_CONTEXT_ID`: default context_id per [D078](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default).
- `ATRIB_LOCAL_SUBSTRATE_ENDPOINT` + `ATRIB_LOCAL_SUBSTRATE_MODE=shadow`: opt-in P042 local-substrate shadow probe inherited from `@atrib/emit`. The revision is still signed, mirrored, and queued locally.
- `ATRIB_LOCAL_SUBSTRATE_TIMEOUT_MS`: optional timeout for that shadow probe.

## Relationship to @atrib/emit

`@atrib/revise` depends on `@atrib/emit` per the package layering documented in [D079](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface). Each is a monomorphic agent-facing tool with one narrow purpose, but the underlying signing, chain composition, and mirror-writing pipeline is shared via `@atrib/emit`'s `handleEmit` export. When the canonical write pipeline evolves (chain-composition fixes, env-honoring extensions, cross-attestation), `@atrib/revise` inherits the change automatically.

## Status

Initial scaffold (v0.2.0). Cognitive primitive #3 per [D079](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface). Builds clean against `@atrib/mcp` and `@atrib/emit`'s public exports introduced in `@atrib/emit@0.8.0`. The companion specialized writer `@atrib/annotate` covers the importance-and-meaning primitive (annotation event_type).

## License

Apache-2.0.

## Part of atrib

atrib is an open protocol for verifiable agent actions. Every action becomes a signed, chain-linked record that anyone can verify against a public Merkle log, with no operator to trust. This package is one entrypoint. See the [full package family](https://github.com/creatornader/atrib#packages) and the [protocol spec](https://github.com/creatornader/atrib/blob/main/atrib-spec.md).
