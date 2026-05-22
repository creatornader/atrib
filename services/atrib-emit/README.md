# `@atrib/emit`

MCP server exposing the explicit `emit` tool, the producer-side cognitive primitive that lets an agent sign observations, annotations, and revisions under its own atrib identity, beyond what `@atrib/mcp` auto-signs.

## Why this exists

`@atrib/mcp` middleware auto-signs every MCP tool call as it passes through. That captures the *mechanical* record-of-tool-call. But agents do plenty of cognitive work that doesn't go through MCP:
- Built-in tool calls (Read, Edit, Bash) don't pass through any MCP server.
- Reasoning steps, decisions, and revisions live in the agent's prose, not in a tool invocation.
- Annotations against prior records ("this one mattered, future-self should weight it heavy") have no auto-emit hook.

`atrib-emit` is the explicit signing tool the agent calls when it wants on-chain provenance for one of these. It complements `@atrib/mcp` rather than replacing it: the wrapper handles the mechanical capture; `atrib-emit` handles the explicit cognitive emit.

## Tool surface

```typescript
mcp__atrib-emit__emit({
  // Required
  event_type: string,           // URI per spec §1.2.4. Common normative values:
                                // 'https://atrib.dev/v1/types/observation', '...annotation', '...revision'.
                                // Extension URIs in any namespace are also valid.
  content: Record<string, unknown>,  // Semantic content of the event. Stored in the local mirror,
                                     // committed on-chain via content_id derived from event_type leaf.

  // Optional
  context_id?: string,          // 32-hex. STRONGLY RECOMMENDED. Producers (cron jobs, watchers,
                                // hooks) should thread a stable per-session or per-job context_id.
                                // If omitted, atrib-emit applies the [§1.2.3.1](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#1231-multi-producer-chain-composition)
                                // [D067](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d067-multi-producer-chain-composition-precedence-contract)
                                // resolution cascade (caller > env-tail > mirror inheritance
                                // filtered to same context_id > fresh isolate); records signed
                                // without any of those signals land as a fresh-orphan with the
                                // warning `synthesized orphan context_id ... (caller passed no
                                // context_id; fix runtime to thread session_id per D072)` per
                                // [D072](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d072-orphan-handling--synthesize-fresh-never-inherit-from-mirror-tail).
  informed_by?: string[],       // sha256:<64-hex> record_hashes that informed this event.
                                // Sorted lexicographically before signing per §1.2.5.
  chain_root?: string,          // sha256:<64-hex>. Caller-managed chain_root, the hash of the
                                // immediately preceding record under this context_id. Required
                                // when caller threads chain state across emits (e.g. multi-record
                                // watcher pipelines that emit a sequence under one context_id).
                                // When omitted with context_id present, atrib-emit synthesizes
                                // the genesis chain_root per spec §1.2.3. Without context_id,
                                // chain_root is meaningless and returns warnings.
  provenance_token?: string,    // 22-char base64url cross-session causal anchor per spec §1.2.6
                                // / D044. Genesis-record-only: atrib-emit refuses to sign when
                                // chain_root is non-genesis, returning warnings rather than
                                // emitting a malformed record (§5.8 graceful-degradation).
})
```

Returns:

```typescript
{
  record_hash: string,             // sha256:<64-hex> of the signed canonical form
  log_index: number | null,        // Position in the log if submission succeeded synchronously
  inclusion_proof: object | null,  // Proof bundle if available; null if queued
  context_id: string,              // The context_id the record was signed under
  warnings: string[],              // E.g., 'submission queued, log unreachable'
}
```

## Key resolution

Same chain as the wrapper for the first three sources, plus a 1Password fallback for recovery:

1. `ATRIB_PRIVATE_KEY` env var (legacy / dev path)
2. `ATRIB_KEY_FILE` env var → file path containing the base64url-encoded 32-byte seed
3. macOS Keychain, services tried in order:
   - `atrib-creator-<ATRIB_AGENT>` (agent-scoped; matches wrapper, defaults `ATRIB_AGENT=claude-code`)
   - `atrib-creator` (generic fallback)
4. 1Password CLI recovery (off by default), set `ATRIB_OP_REFERENCE=op://<vault>/<item>/<field>` to enable. Optional `ATRIB_OP_ACCOUNT=<email-or-uuid>` pins a specific account for multi-account operators. Activated only when Keychain has nothing; designed to recover from a wiped Keychain. The operator must be signed in (`op signin`) and the read may prompt for biometric/master-password approval.

`atrib-emit` signs records under the **agent's** identity, the same key as the wrapper. There's no separate "emit identity"; skills don't have identities, the agent always signs as itself.

If a 1Password item stores the seed with a `ATRIB_PRIVATE_KEY=<value>` label prefix, the prefix is stripped before decoding so both shapes work, useful for items that live alongside other env-prefixed credentials.

## Configuration

| Env var | Required | Purpose |
|---|---|---|
| `ATRIB_PRIVATE_KEY` | one of these | base64url Ed25519 seed (32 bytes) |
| `ATRIB_KEY_FILE` | three | path to a 0600 file containing the seed |
| (Keychain) | | macOS only; falls back here last |
| `ATRIB_LOG_ENDPOINT` | optional | log submission endpoint; defaults to `https://log.atrib.dev/v1/entries` |
| `ATRIB_MIRROR_FILE` | optional | JSONL path emit WRITES its own envelope mirror to; if unset, mirroring is skipped |
| `ATRIB_AUTOCHAIN_SOURCE` | optional | JSONL path emit READS to inherit the wrapper's session context_id; defaults to the wrapper's local mirror under `~/.atrib/records/`. Splitting read/write paths lets emit write its own envelope mirror while still inheriting the wrapper's chain |
| `ATRIB_AGENT` | optional | agent name for the agent-scoped Keychain service `atrib-creator-<agent>`; defaults to `claude-code` |
| `ATRIB_KEYCHAIN_ACCOUNT` | optional | Keychain account; defaults to `userInfo().username` |
| `ATRIB_CONTEXT_ID` | optional | 32-hex default `context_id` when the caller's input omits one. Lets per-arm experimental harnesses (and any spawner) thread a deterministic context_id into spawned `atrib-emit` subprocesses without modifying tool input. Invalid values fall through silently to the standard chain-composition path. Explicit `context_id` in the tool input always wins. |
| `ATRIB_PARENT_RECORD_HASH` | optional | `sha256:<64-hex>` of a parent producer's record. When set to a valid value, `atrib-emit` auto-prepends it to the caller's `informed_by` array per [§1.2.5](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#125-informed_by), then dedupes via `Set`. Producers that spawn child processes (subagents, worker nodes, multi-agent framework children) set this to their parent's signed record_hash so causal lineage threads through the existing primitive, no spec change. Invalid values are silently ignored; valid caller-supplied `informed_by` entries that overlap with the env-seed are deduplicated. See the parent-child agent representation entry in `DECISIONS.md` for the layered design (this is the cheap producer-side baseline; a dedicated `handoff` event_type remains pending). |

## Two binaries

The package ships two binaries from the same `src/index.ts` signing path:

- **`atrib-emit`** — the MCP server. Long-lived in an agent's MCP host (Claude Code, Claude Desktop). Surfaces the six [D079](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface) cognitive primitives to the agent at tool-discovery time. Use this for interactive in-session signing.
- **`atrib-emit-cli`** — a thin command-line wrapper around `emitInProcess` per [D082](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d082-cli-binary-distribution-of-emitinprocess-supersedes-d081s-integration-shape). Reads one JSON envelope on stdin, signs the record in-process, writes the `EmitOutput` JSON to stdout. Use this for hook-class producers (Claude Code PostToolUse + lifecycle hooks, watchers, batch jobs) that spawn a short-lived signer rather than holding an MCP server warm.

Records signed by either binary are byte-identical at the canonical-form level — [§1.3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#13-canonical-serialization) does not surface the transport.

### atrib-emit-cli quick reference

```bash
npm install -g @atrib/emit   # puts both binaries on $PATH

# Default: read envelope on stdin, sign, write EmitOutput JSON to stdout.
echo '{"event_type":"https://atrib.dev/v1/types/observation","content":{"what":"hello"},"context_id":"deadbeef00000000deadbeef00000000"}' \
  | atrib-emit-cli --log-endpoint https://log.atrib.dev/v1/entries

# Substrate-readiness check (text by default, --json for machine-readable):
atrib-emit-cli doctor                  # exits 0 if key + log + mirror all ok, non-zero otherwise

# Introspect the CLI's contract (subcommands, envelope schema, env vars, ADR refs):
atrib-emit-cli --describe              # stable JSON description for agent / tooling discovery
```

Exit code on `emit` is always 0 per [§5.8](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#58-degradation-contract); failures surface as warnings inside the result JSON or as a stderr diagnostic line. `doctor` exits non-zero on failure — operator-facing diagnostic, not hook-safe.

## Installation in an MCP host

For Claude Code or Claude Desktop, add to the MCP config:

```jsonc
{
  "mcpServers": {
    "atrib-emit": {
      "command": "node",
      "args": ["/abs/path/to/atrib/services/atrib-emit/dist/main.js"],
      "env": {
        "ATRIB_LOG_ENDPOINT": "https://log.atrib.dev/v1/entries",
        "ATRIB_MIRROR_FILE": "/abs/path/to/.atrib/mirror.jsonl"
      }
    }
  }
}
```

Key resolution falls through to Keychain on macOS, so `ATRIB_PRIVATE_KEY` doesn't need to be in the env block (and shouldn't be, in production).

## Architecture

Five files do the work:

- `src/index.ts`, McpServer registration + the `emitInProcess` library entrypoint ([D081](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d081-in-process-emit-for-hook-class-producers-emitinprocess)); the `emit` tool calls `handleEmit` which orchestrates sign + submit + mirror.
- `src/main.ts`, MCP stdio binary entrypoint (`atrib-emit`); spins up the McpServer over stdio.
- `src/cli.ts`, CLI binary entrypoint (`atrib-emit-cli`, [D082](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d082-cli-binary-distribution-of-emitinprocess-supersedes-d081s-integration-shape)); reads a JSON envelope on stdin, calls `emitInProcess`, writes the result JSON to stdout. Exit code always 0 per [§5.8](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#58-degradation-contract).
- `src/sign.ts`, Builds and signs the AtribRecord. Pure aside from the signing primitive itself; reuses `@atrib/mcp`'s `signRecord`, `computeContentId`, `getPublicKey`. Records produced by emit are byte-identical in canonical form to wrapper-signed records (verifier MUST NOT distinguish them).
- `src/keys.ts`, Bounded key resolution ([D081](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d081-in-process-emit-for-hook-class-producers-emitinprocess)). `ATRIB_PRIVATE_KEY` (base64url) → `ATRIB_KEY_FILE` → macOS Keychain (`ATRIB_KEYCHAIN_TIMEOUT_MS` default 3s) → 1Password CLI (`ATRIB_OP_TIMEOUT_MS` default 10s). Timeouts prevent unbounded hangs in headless contexts.
- `src/storage.ts`, Best-effort JSONL mirror of full record + proof, for local recall.

Per [§5.8](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#58-degradation-contract) degradation contract: nothing in `atrib-emit` throws to the agent. Missing key → warning in the response. Sign failure → warning. Network failure → submission queued for retry.

## Chain context resolution (post-[D067](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d067-multi-producer-chain-composition-precedence-contract) / [D072](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d072-orphan-handling--synthesize-fresh-never-inherit-from-mirror-tail))

atrib-emit delegates to `@atrib/mcp`'s [`inheritChainContext`](https://github.com/creatornader/atrib/blob/main/packages/mcp/src/mirror.ts) helper, the single source of truth for [multi-producer chain composition](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#1231-multi-producer-chain-composition) per [D067](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d067-multi-producer-chain-composition-precedence-contract). The resolver cascades through five tiers in this exact order:

1. **Caller-supplied verbatim**: when both `context_id` and `chain_root` are passed, atrib-emit uses them verbatim. Used by consumers that manage chain state themselves (nightly observation pipelines, multi-record watcher runs).
2. **Caller `context_id` only**: atrib-emit synthesizes a genesis `chain_root` per [§1.2.3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#123-chain_root-for-genesis-records). Fresh chain initiated under the named context.
3. **Inbound propagation token**: when an upstream agent passed a context handoff via `ATRIB_CHAIN_TAIL_<context_id>` env var, atrib-emit adopts that context_id + its tail's chain_root.
4. **Mirror-file inheritance** (filtered): atrib-emit reads `~/.atrib/records/` (override with `ATRIB_AUTOCHAIN_SOURCE`) and inherits chain_root from the most-recent record **whose context_id matches the caller's**. Without a caller context_id, this tier is skipped (per [D072](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d072-orphan-handling--synthesize-fresh-never-inherit-from-mirror-tail), atrib-emit no longer absorbs context-less records into the mirror tail's session, which would silently merge unrelated sessions).
5. **Fresh-orphan synthesis**: when no prior tier produced a context_id, atrib-emit generates a random 16-byte context_id with a fresh genesis chain_root and surfaces the warning `synthesized orphan context_id <hex> (caller passed no context_id; fix runtime to thread session_id per D072)`. The warning is the substrate's way of pointing at the upstream miswire so the producer's call site can be patched.

### Producer ergonomics: how to thread a stable context_id

The right shape depends on whether the producer is a discrete-session emitter or a continuous-session emitter:

- **Discrete sessions** (each producer invocation is a logical new session, e.g. a nightly batch watcher, an ad-hoc script run): generate a fresh UUID at the top of the run and thread it through every emit in that run. Watchers that produce a chain of records under one logical session typically maintain `chain_state` and call `chain_state.setdefault("ctx", fresh_context_id())` once per run.
- **Continuous sessions** (every invocation is part of the same long-lived logical session, e.g. a periodic heartbeat cron, a long-running daemon's beacon emissions): derive a deterministic context_id from a stable seed via `sha256("<unique-job-name>")[:32]`. The shell idiom is `printf '%s' '<unique-job-name>' | shasum -a 256 | cut -c1-32`. Every fire chains into one coherent session-of-records without a state file.
- **Inbound handoff** (records signed in response to an external agent's request): adopt the caller's context_id verbatim from inbound trace context (W3C `traceparent` / `tracestate` per [§1.5](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#15-context-propagation-w3c-trace-context-and-baggage)) so cross-agent chains compose. This is what `@atrib/mcp` middleware does automatically.

Both line shapes are accepted at read time: bare `AtribRecord` (the wrapper's convention) and `{record, proof, written_at}` envelope (atrib-emit's storage convention).

## What v1 does NOT do

- **No semantic validation of `content`.** Caller passes any shape; the verifier eventually derives edges based on the spec for normative event types. v2 could add per-event-type schemas.
- **No annotation-specific tool.** v1 has one `emit` tool that handles all event types. v2 will add `atrib-annotate` with annotation-specific affordances (importance picker, automatic `annotates` linkage to most recent action).
- **No batch mode.** One emit per call. v2 if a high-volume producer needs it.

## Test strategy

`test/setup.ts` installs a fetch guard that refuses any submission to a production atrib endpoint (log/graph/directory/explore.atrib.dev). Same pattern as `@atrib/mcp` and `@atrib/agent`.
