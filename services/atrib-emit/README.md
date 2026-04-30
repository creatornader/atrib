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

Same chain as the wrapper, in order:

1. `ATRIB_PRIVATE_KEY` env var (legacy / dev path)
2. `ATRIB_KEY_FILE` env var → file path containing the base64url-encoded 32-byte seed
3. macOS Keychain (`atrib-creator` service; override account name with `ATRIB_KEYCHAIN_ACCOUNT`)

`atrib-emit` signs records under the **agent's** identity, the same key as the wrapper. There's no separate "emit identity"; skills don't have identities, the agent always signs as itself.

## Configuration

| Env var | Required | Purpose |
|---|---|---|
| `ATRIB_PRIVATE_KEY` | one of these | base64url Ed25519 seed (32 bytes) |
| `ATRIB_KEY_FILE` | three | path to a 0600 file containing the seed |
| (Keychain) | | macOS only; falls back here last |
| `ATRIB_LOG_ENDPOINT` | optional | log submission endpoint; defaults to `https://log.atrib.dev/v1/entries` |
| `ATRIB_MIRROR_FILE` | optional | JSONL path for local content mirror; if unset, mirroring is skipped |

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

## What v1 does NOT do

- **No semantic validation of `content`.** Caller passes any shape; the verifier eventually derives edges based on the spec for normative event types. v2 could add per-event-type schemas.
- **No autoChain integration with the wrapper's context.** Emits default to fresh genesis records. Inheriting the wrapper's `context_id` (so emits chain with the agent's mechanical tool calls in the same session) is design-question #2 in the scope doc; needs a JSONL handshake convention first.
- **No annotation-specific tool.** v1 has one `emit` tool that handles all event types. v2 will add `atrib-annotate` with annotation-specific affordances (importance picker, automatic `annotates` linkage to most recent action).
- **No batch mode.** One emit per call. v2 if a high-volume producer needs it.

## Test strategy

`test/setup.ts` installs a fetch guard that refuses any submission to a production atrib endpoint (log/graph/directory/explore.atrib.dev). Same pattern as `@atrib/mcp` and `@atrib/agent`.
