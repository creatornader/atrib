# @atrib/mcp-wrap

Generic config-driven MCP wrapper. Spawns any upstream MCP server and applies
the `@atrib/mcp` middleware so every tool call becomes a signed, chain-linked
record submitted to the atrib log.

## Why this exists

`createAtribProxy` from `@atrib/mcp` does the MCP plumbing: spawn an upstream,
forward tool calls, apply `atrib()` middleware. But every wrapper that calls
it ends up reinventing the same operational shell: key resolution (env / file
/ Keychain / 1Password), file logging, signed-record mirror persistence,
autoChain seed loading from disk, secure file permissions, per-tool gating for
the preCallTransform hook. That's hundreds of lines of boilerplate per
upstream MCP server.

`@atrib/mcp-wrap` lifts the operational shell into a reusable service and
exposes the upstream + per-tool behavior via a JSON config. Wrap any
upstream by writing a config; no per-server code.

## Install + run

The wrapper is a workspace package; build then point an MCP host at the
binary:

```bash
pnpm --filter @atrib/mcp-wrap build
node ~/repos/atrib/services/mcp-wrap/dist/main.js path/to/wrap-config.json
```

Or set `ATRIB_WRAP_CONFIG` in the host's MCP server entry. With no argument
and no env var, the wrapper reads `~/.atrib/wrap-config.json`.

## Config shape

```jsonc
{
  "name": "agent-bridge",
  "agent": "claude-code",
  "upstream": {
    "command": "agent-bridge",
    "args": [],
    "env": { "AGENT_BRIDGE_URL": "...", "AGENT_BRIDGE_KEY": "..." },
  },
  "serverUrl": "mcp://agent-bridge.local",
  "logEndpoint": "https://log.atrib.dev/v1/entries",
  "autoChain": true,
  "contextIdSource": "harness",
  "autoChainFallback": "fresh",
  "autoDetectInformedByFromArgs": false,
  "disclosure": {
    "tool_name": "verbatim",
    "args": "plain-sha256",
  },
  "tools": {
    "post_context": {
      "injectReceiptId": true,
      "informedByPaths": ["informed_by", "metadata.message_envelope.informed_by"],
    },
    "checkout": { "transactionTool": true },
  },
}
```

| Field                          | Required | Default                                 | Notes                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------ | -------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                         | yes      | (no default)                            | Logical wrapper name. Surfaced to host as McpServer name + used in default file paths.                                                                                                                                                                                                                                                                              |
| `agent`                        | no       | `claude-code`                           | Identity hint. Picks the `atrib-creator-<agent>` Keychain service before falling back to `atrib-creator`.                                                                                                                                                                                                                                                           |
| `upstream.command`             | yes      | (no default)                            | Binary to spawn for the upstream MCP server.                                                                                                                                                                                                                                                                                                                        |
| `upstream.args`                | no       | `[]`                                    | Args for the upstream binary.                                                                                                                                                                                                                                                                                                                                       |
| `upstream.env`                 | no       | inherited                               | Extra env merged with the parent process env (parent wins on conflicts).                                                                                                                                                                                                                                                                                            |
| `serverUrl`                    | yes      | (no default)                            | Canonical URL for `content_id` derivation per spec [§1.2.2](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#122-content_id-derivation). Path segment for `agent` is appended automatically.                                                                                                                                                           |
| `logEndpoint`                  | no       | `https://log.atrib.dev/v1/entries`      | Submission endpoint. Override for local development against `@atrib/log-dev` or a local log-node.                                                                                                                                                                                                                                                                   |
| `autoChain`                    | no       | `true`                                  | Chain successive tool calls within this wrapper's process lifetime. Required for CHAIN_PRECEDES edges from stdio hosts.                                                                                                                                                                                                                                             |
| `contextIdSource`              | no       | `none`                                  | Set to `harness` to read the active host session from `@atrib/mcp` harness discovery when inbound MCP metadata is absent.                                                                                                                                                                                                                                           |
| `autoChainFallback`            | no       | `stable-process`                        | `stable-process` keeps the historical wrapper-wide context when no caller context exists. `fresh` gives no-context calls separate genesis contexts while still chaining calls that have a resolved context.                                                                                                                                                         |
| `autoDetectInformedByFromArgs` | no       | `false`                                 | Broadly scans params for `sha256:<64hex>` references. Prefer `informedByPaths` for structured references; set this true only when free-text hash mentions should become provenance claims.                                                                                                                                                                          |
| `disclosure`                   | no       | `{}`                                    | Optional [§8](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#8-security-considerations-and-threat-model) disclosure dials passed to `@atrib/mcp`: `tool_name` (`omit`, `verbatim`, `hashed`), `args` (`omit`, `plain-sha256`, `salted-sha256`), and `result` (`omit`, `plain-sha256`, `salted-sha256`).                                              |
| `tools[<name>]`                | no       | (none)                                  | Per-tool overrides. `transactionTool: true` emits a `transaction` event_type record. `injectReceiptId: true` enables [D057](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d057-pre-call-signing-hook-precalltransform-for-cross-tool-causal-embedding) preCallTransform. `informedByPaths` lists exact argument paths that contain record_hash refs. |
| `logFile`                      | no       | `~/.atrib/logs/<name>-<agent>.log`      | Wrapper debug log (jsonl). Set to `""` to disable.                                                                                                                                                                                                                                                                                                                  |
| `recordFile`                   | no       | `~/.atrib/records/<name>-<agent>.jsonl` | Signed-record mirror (jsonl). Set to `""` to disable.                                                                                                                                                                                                                                                                                                               |

## Parent-child threading

If an upstream runtime spawns this wrapper as a child producer and already has the parent spawn record hash, set `ATRIB_PARENT_RECORD_HASH=<sha256:...>` in the wrapper process env. The underlying `@atrib/mcp` middleware reads it at startup and applies the valid hash to the first successful wrapper-signed record's `informed_by` field per [D104](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d104-parent-child-threading-uses-atrib_parent_record_hash). Invalid values are ignored. Failed tool calls do not consume the seed.

## Key resolution

The wrapper picks the signing key in this order (first hit wins):

1. `ATRIB_PRIVATE_KEY` env var (legacy / dev path).
2. `ATRIB_KEY_FILE` env var → 0600-mode file containing the base64url seed.
3. macOS Keychain entry for the current user, services tried in order:
   - `atrib-creator-<agent>` (agent-scoped; matches the wrapper convention).
   - `atrib-creator` (generic fallback).
4. 1Password CLI (`op read`) as a recovery path. Set `ATRIB_OP_REFERENCE` to a
   valid `op://<vault>/<item>/<field>` reference. Off by default; activates
   only when the env var is set.

If none yields a key, the wrapper exits non-zero. Operator misconfiguration
should surface immediately rather than silently degrading.

## What you get end-to-end

For each tool call through the wrapped MCP:

1. Wrapper signs the record (Ed25519 over the JCS-canonical record).
2. Optionally injects the [§1.5.2](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#152-http-transport-tracestate) receipt token into the upstream args
   (when `tools[<name>].injectReceiptId === true`).
3. Optionally adds signed `tool_name`, `args_hash`, and `result_hash`
   fields when `disclosure` asks for them. `result_hash` is omitted on
   tools using `injectReceiptId`, because those records are signed before
   the upstream result exists.
4. Forwards to the upstream MCP server.
5. On success, persists the signed record to the local jsonl mirror
   (closes the chain seed → pubkey → record signature → log inclusion
   verification path).
6. Submits to the log endpoint via the priority queue.
7. autoChain bookkeeping advances so the next call links to this one.

When `ATRIB_PARENT_RECORD_HASH` is set, step 1 also adds that parent hash to the first successful record's `informed_by` set before signing.

Records are byte-identical to those signed by `@atrib/agent` or any other
caller of `@atrib/mcp` middleware. The wrapper is a transport, not a
protocol participant.

## Library surface

```ts
import { wrap, parseConfig } from '@atrib/mcp-wrap'

const config = parseConfig(JSON.parse(rawJson))
const { proxy } = await wrap(config)
await proxy.server.connect(transport)
```

Useful when you want the wrapper's plumbing but a different bootstrap
(custom config source, embedded inside another long-running service, etc.).
