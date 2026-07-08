# @atrib/annotate

MCP server exposing the `atrib-annotate` tool for Atrib's verifiable action layer. Marks a past signed record with importance, a one-line summary, and topics, so future recall can surface what mattered without re-scanning every record flat.

Closes the producer-side recall-fidelity gap: an agent reading back its own past loses enormous nuance compared to the agent that signed it. An annotation lets the agent at signing time say "future-self: this one is critical, and here's why in one line", and the graph carries that judgment forward.

## Install

```bash
pnpm add @atrib/annotate
```

Verify a local build with `pnpm --filter @atrib/annotate test`.

## Tool

```
mcp__atrib-annotate__atrib-annotate({
  annotates: "sha256:<64-hex>",         // REQUIRED: target record_hash
  importance: "critical" | "high" | "medium" | "low" | "noise",
  summary: string,                       // ≤ 2048 chars; one-line gist
  topics?: string[],                     // up to 16 lowercase-hyphenated tags
  context_id?: "<32-hex>",               // defaults to ATRIB_CONTEXT_ID
  informed_by?: ["sha256:<64-hex>", ...] // optional lineage refs
})
→ {
  record_hash: "sha256:<64-hex>",       // the new annotation record
  log_index: number | null,
  inclusion_proof: ProofBundle["inclusion_proof"] | null,
  context_id: string,
  warnings: string[]
}
```

## Writes

Signs an `annotation` record per spec [§1.2.4](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#124-event_type-values) (event_type `0x05`, promoted via [D058](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d058-promote-annotation-to-atrib-normative-event_type-byte-0x05)) and persists it through the same pipeline `@atrib/emit` uses: same key resolution, same chain composition, same JSONL mirror at `ATRIB_MIRROR_FILE`. A verifier cannot distinguish annotation records signed via this tool from annotation records signed via `@atrib/emit`'s polymorphic surface; the wire format is identical.

The graph layer derives an ANNOTATES edge from the new record to the `annotates` target per spec [§3.2.4](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#324-edge-derivation-rules) step 8. Recall pipelines that filter or rank by importance can use this edge to surface the annotation alongside its target.

## Behaviors

- **Required-field enforcement**: `annotates`, `importance`, and `summary` are required. The Zod schema rejects calls missing any of these before the signing pipeline runs.
- **Spec validators**: `annotates` is rejected on non-annotation event_types per spec [§1.2.7](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#127-annotates) (the underlying `handleEmit` enforces this; the tool's narrow schema prevents it from happening here).
- **Env-honoring**: `ATRIB_CONTEXT_ID` is honored as the default `context_id` per [D078](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default) when the caller omits the field. Per [D083](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers), when `ATRIB_CONTEXT_ID` is also unset, `CLAUDE_CODE_SESSION_ID` (and any future registered harness env var) is consulted via `@atrib/mcp`'s `resolveEnvContextId` so MCP children spawned by harnesses inherit the session's context_id automatically.
- **Producer label**: signed records carry `_local.producer = 'atrib-annotate'` in the mirror sidecar, distinguishing them from `@atrib/emit`-signed annotation records. Mirror consumers (the SessionStart by-producer aggregation, recall filters, audit tooling) can bucket annotation records by their producing surface without inspecting envelopes. The signed `AtribRecord` bytes do not include producer; this is sidecar metadata only.
- **Multi-producer chain composition**: inherits chain state from the mirror or `ATRIB_CHAIN_TAIL_<context_id>` env per [D067](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d067-multi-producer-chain-composition-precedence-contract), the same way `@atrib/emit` does.
- **Graceful degradation**: signing failures surface in `warnings`; never throws to the agent per spec [§5.8](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#58-degradation-contract).

## Wire-up

Add to your MCP host config (e.g. `~/.claude.json` `mcpServers`):

```json
{
  "atrib-annotate": {
    "command": "node",
    "args": ["/path/to/atrib-annotate/dist/main.js"]
  }
}
```

Or run as a one-off subprocess via `pnpm --filter @atrib/annotate start`.

### Env vars (inherited from `@atrib/emit`)

- `ATRIB_PRIVATE_KEY` / `ATRIB_KEY_FILE` / macOS Keychain `atrib-creator-<ATRIB_AGENT>` / `ATRIB_OP_REFERENCE`: key resolution chain.
- `ATRIB_MIRROR_FILE`: JSONL mirror destination (where the signed annotation persists).
- `ATRIB_AUTOCHAIN_SOURCE`: optional cross-producer chain inheritance source.
- `ATRIB_LOG_ENDPOINT`: log.atrib.dev override (e.g. for self-hosted log nodes).
- `ATRIB_CONTEXT_ID`: default context_id per [D078](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default).
- `ATRIB_LOCAL_SUBSTRATE_ENDPOINT` + `ATRIB_LOCAL_SUBSTRATE_MODE=shadow`: opt-in P042 local-substrate shadow probe inherited from `@atrib/emit`. The annotation is still signed, mirrored, and queued locally.
- `ATRIB_LOCAL_SUBSTRATE_TIMEOUT_MS`: optional timeout for that shadow probe.

## Relationship to @atrib/emit

`@atrib/annotate` depends on `@atrib/emit` per the package layering documented in [D079](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface). Each is a monomorphic agent-facing tool with one narrow purpose, but the underlying signing, chain composition, and mirror-writing pipeline is shared via `@atrib/emit`'s `handleEmit` export. When the canonical write pipeline evolves (chain-composition fixes, env-honoring extensions, cross-attestation), `@atrib/annotate` inherits the change automatically.

## Status

Initial scaffold (v0.2.0). Cognitive primitive #2 per [D079](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface). Builds clean against `@atrib/mcp` and `@atrib/emit`'s public exports introduced in `@atrib/emit@0.8.0`. The companion specialized writer `@atrib/revise` covers the contradiction-handling primitive (revision event_type).

## License

Apache-2.0.
