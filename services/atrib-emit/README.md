# `@atrib/atrib-emit`

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
  context_id?: string,          // 32-hex. If omitted, a fresh genesis context_id is generated.
  informed_by?: string[],       // sha256:<64-hex> record_hashes that informed this event.
                                // Sorted lexicographically before signing per §1.2.5.
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

If a 1Password item stores the seed with a `ATRIB_PRIVATE_KEY=<value>` label prefix (the convention used by the existing `Atrib key (current, haoZK4D1AXmy)` item), the prefix is stripped before decoding so both shapes work.

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

Three files do the work:

- `src/index.ts`, McpServer registration; the `emit` tool calls `handleEmit` which orchestrates sign + submit + mirror.
- `src/sign.ts`, Builds and signs the AtribRecord. Pure aside from the signing primitive itself; reuses `@atrib/mcp`'s `signRecord`, `computeContentId`, `getPublicKey`. Records produced by emit are byte-identical in canonical form to wrapper-signed records (verifier MUST NOT distinguish them).
- `src/submit.ts`, wraps `@atrib/mcp`'s `createSubmissionQueue`. Same priority semantics as the wrapper (cognitive events use 'normal' priority).
- `src/storage.ts`, Best-effort JSONL mirror of full record + proof, for local recall.

Per §5.8 degradation contract: nothing in `atrib-emit` throws to the agent. Missing key → warning in the response. Sign failure → warning. Network failure → submission queued for retry.

## autoChain inheritance from the wrapper

When `context_id` is omitted, atrib-emit reads the wrapper's local mirror under `~/.atrib/records/` (override with `ATRIB_AUTOCHAIN_SOURCE`) and inherits the most-recent record's `context_id`, chaining its own emit on top of that record's hash. This is the cognitive-feedback-loop convention: explicit observations, annotations, and revisions chain cleanly with the agent's mechanical tool calls in the same session, and a verifier sees one coherent chain per `context_id`.

Resolution order:
1. Caller-supplied `context_id` → genesis chain_root for that id (fresh chain).
2. Wrapper mirror present → inherit its most-recent record's `context_id`, chain on top.
3. No mirror → fresh genesis with random 16-byte context_id.

Both line shapes are accepted at read time: bare `AtribRecord` (the wrapper's convention) and `{record, proof, written_at}` envelope (atrib-emit's storage convention). When inheritance fires, the response's `warnings` array carries `inherited context_id from wrapper mirror: <id>` so the agent can confirm the session it landed in.

## What v1 does NOT do

- **No semantic validation of `content`.** Caller passes any shape; the verifier eventually derives edges based on the spec for normative event types. v2 could add per-event-type schemas.
- **No annotation-specific tool.** v1 has one `emit` tool that handles all event types. v2 will add `atrib-annotate` with annotation-specific affordances (importance picker, automatic `annotates` linkage to most recent action).
- **No batch mode.** One emit per call. v2 if a high-volume producer needs it.

## Test strategy

`test/setup.ts` installs a fetch guard that refuses any submission to a production atrib endpoint (log/graph/directory/explore.atrib.dev). Same pattern as `@atrib/mcp` and `@atrib/agent`.
