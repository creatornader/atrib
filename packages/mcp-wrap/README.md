# @atrib/mcp-wrap

Generic config-driven MCP wrapper for atrib's verifiable action layer. Spawns
any upstream MCP server and applies the `@atrib/mcp` middleware so every tool
call becomes a signed, chain-linked record submitted to the atrib log.

This is the fastest path for existing MCP tools to gain action-layer behavior:
per-tool config can gate the call before execution, sign the outcome after
execution, preserve chain context, and keep local mirrors for later recall,
handoff, or verification.

## Install

```bash
pnpm add @atrib/mcp-wrap
```

Verify a local build with `pnpm --filter @atrib/mcp-wrap test`.

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

Install the package, then point an MCP host at the `atrib-wrap` binary it
ships:

```bash
pnpm add @atrib/mcp-wrap
npx atrib-wrap path/to/wrap-config.json
```

In an MCP host config, set the server `command` to `atrib-wrap` (or
`npx -y @atrib/mcp-wrap`) with the config path as the argument, or set
`ATRIB_WRAP_CONFIG` in the host's MCP server entry. With no argument and no env
var, the wrapper reads `~/.atrib/wrap-config.json`. From a monorepo checkout,
`node packages/mcp-wrap/dist/main.js path/to/wrap-config.json` runs the built
binary directly.

Signing runs through `@atrib/mcp`, so it inherits the [§5.8](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#58-degradation-contract)
degradation contract: a per-call signing or log-submission failure is caught
and never changes the upstream tool's response.

## Filesystem smoke

Run this when a maintainer wants to see the wrapper against a real upstream MCP
server before reading the internals:

```bash
pnpm --filter @atrib/mcp-wrap smoke:filesystem
```

The smoke script creates a temp fixture file, starts a local log receiver,
wraps `@modelcontextprotocol/server-filesystem` through `atrib-wrap`, calls
`read_file` through a normal MCP client, and checks that a signed mirror record
plus a local log submission were produced. It needs network access the first
time `npx` fetches the upstream filesystem server, but it does not need an LLM
API key or the production atrib log.

## Config shape

```jsonc
{
  "name": "agent-bridge",
  "agent": "claude-code",
  "upstream": {
    "type": "stdio",
    "command": "agent-bridge",
    "args": [],
    "env": { "AGENT_BRIDGE_URL": "...", "AGENT_BRIDGE_KEY": "..." },
  },
  "serverUrl": "mcp://agent-bridge.local",
  "logEndpoint": "https://log.atrib.dev/v1/entries",
  "archiveSubmission": { "endpoint": "https://archive.atrib.dev/v1" },
  "localSubstrate": {
    "mode": "shadow",
    "endpoint": "http://127.0.0.1:8787/atrib/local-substrate",
    "timeoutMs": 50,
  },
  "autoChain": true,
  "contextIdSource": "harness",
  "autoChainFallback": "fresh",
  "autoDetectInformedByFromArgs": false,
  "evidenceMode": "verifiable-action",
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

| Field                          | Required        | Default                                 | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------ | --------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                         | yes             | (no default)                            | Logical wrapper name. Surfaced to host as McpServer name + used in default file paths.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `agent`                        | no              | `claude-code`                           | Identity hint. Picks the `atrib-creator-<agent>` Keychain service before falling back to `atrib-creator`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `upstream.type`                | no              | `stdio`                                 | Upstream transport. Use `stdio` for spawned MCP servers or `http` for Streamable HTTP MCP endpoints.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `upstream.command`             | yes for `stdio` | (no default)                            | Binary to spawn for the upstream MCP server.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `upstream.args`                | no              | `[]`                                    | Args for the upstream binary.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `upstream.env`                 | no              | inherited                               | Extra env merged with the parent process env (parent wins on conflicts).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `upstream.url`                 | yes for `http`  | (no default)                            | Streamable HTTP MCP endpoint URL. Keep secrets out of committed config files when the upstream requires query-string credentials.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `upstream.headers`             | no              | unset                                   | Headers for Streamable HTTP upstream requests. Do not commit bearer tokens or provider keys here.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `serverUrl`                    | yes             | (no default)                            | Canonical URL for `content_id` derivation per spec [§1.2.2](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#122-content_id-derivation). Path segment for `agent` is appended automatically.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `logEndpoint`                  | no              | `https://log.atrib.dev/v1/entries`      | Submission endpoint. Override for local development against `@atrib/log-dev` or a local log-node.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `archiveSubmission`            | no              | unset                                   | Optional Record Body Archive submission config. Set `{ "endpoint": "https://archive.atrib.dev/v1" }` only for records whose bodies and selected verifier evidence may be public. The wrapper passes it through to `@atrib/mcp`; archive submission happens after log proof and does not send local sidecar args or results.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `localSubstrate`               | no              | unset                                   | Optional startup-spawn local-substrate path. Set `{ "mode": "shadow", "endpoint": "http://127.0.0.1:8787/atrib/local-substrate" }` to send the exact unsigned record body while the wrapper still signs, mirrors, and submits locally. Set `mode` to `"commit"` to skip the wrapper's local log-submission queue only after the coordinator accepts the same `record_hash`. Both modes log coordinator status for rollout telemetry.                                                                                                                                                                                                                                                                                                                                                                          |
| `autoChain`                    | no              | `true`                                  | Chain successive tool calls within this wrapper's process lifetime. Required for CHAIN_PRECEDES edges from stdio hosts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `contextIdSource`              | no              | `none`                                  | Set to `harness` to read the active host session from `@atrib/mcp` harness discovery when inbound MCP metadata is absent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `autoChainFallback`            | no              | `stable-process`                        | `stable-process` keeps the historical wrapper-wide context when no caller context exists. `fresh` gives no-context calls separate genesis contexts while still chaining calls that have a resolved context.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `autoDetectInformedByFromArgs` | no              | `false`                                 | Extracts refs from structured record-reference fields such as `record_hash`, `record_hashes`, `accepted_record_hashes`, `annotates`, and `revises`. It does not scan prose, commitment hashes, or nested `informed_by` envelopes. Prefer `informedByPaths` when a service has exact reference paths.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `evidenceMode`                 | no              | `verifiable-action`                     | The wrapper's signed evidence posture. The default commits hashed tool identity plus salted argument and result hashes. Set `minimal` for the [§8.1](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#81-default-posture) omission posture.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `disclosure`                   | no              | unset                                   | Optional [§8](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#8-security-considerations-and-threat-model) dials that override `evidenceMode`: `tool_name` (`omit`, `verbatim`, `hashed`), `args` (`omit`, `plain-sha256`, `salted-sha256`), and `result` (`omit`, `plain-sha256`, `salted-sha256`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `tools[<name>]`                | no              | (none)                                  | Per-tool overrides. `transactionTool: true` emits a `transaction` event_type record for the terminal outcome. `injectReceiptId: true` enables [D057](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d057-pre-call-signing-hook-precalltransform-for-cross-tool-causal-embedding) preCallTransform. In the default verifiable-action mode, the wrapper commits a `tool_call` request before execution and a linked terminal outcome afterward, including error, cancellation, and invalid-result outcomes. `informedByPaths` lists exact argument paths that contain durable or verifier-accepted record_hash refs; refs are resolver-checked before signing per [D116](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d116-producer-side-informed_by-validation-is-source-aware). |
| `logFile`                      | no              | `~/.atrib/logs/<name>-<agent>.log`      | Wrapper debug log (jsonl). Set to `""` to disable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `recordFile`                   | no              | `~/.atrib/records/<name>-<agent>.jsonl` | Signed-record mirror (jsonl). Set to `""` to disable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## Parent-child threading

If an upstream runtime spawns this wrapper as a child producer and already has the parent spawn record hash, use `@atrib/mcp` `buildSubagentProducerEnv()` to build the child process env. The helper sets `ATRIB_CONTEXT_ID=<parent-context-id>`, `ATRIB_CHAIN_TAIL_<parent-context-id>=<latest-tail-record-hash>`, and `ATRIB_PARENT_RECORD_HASH=<parent-dispatch-record-hash>` when the inputs are canonical. The underlying `@atrib/mcp` middleware reads `ATRIB_PARENT_RECORD_HASH` at startup and applies the valid hash to the first committed wrapper-signed record's `informed_by` field per [D115](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d115-agent-to-subagent-handoff-uses-a-three-signal-producer-bundle). Invalid values are ignored. Ordinary failed calls do not consume the seed. A receipt-bearing request in verifiable-action mode does consume it because the request is committed before execution.

`informedByPaths` is intentionally exact and should point only at record hashes the upstream service has already verified or made durable. Before signing, the wrapper checks the configured wrapper mirror, then checks sibling local mirrors under `ATRIB_AUTOCHAIN_SOURCE`, `ATRIB_MIRROR_FILE`, and `ATRIB_RECORDS_DIR` / `~/.atrib/records` with a 500ms local scan budget before falling back to the log lookup endpoint. Refs that are missing or unvalidated are dropped and logged as wrapper warnings. Do not point `informedByPaths` at temp smoke outputs, body commitments, transcript snippets, or human-readable proof labels. Those belong in sidecar evidence or a Pattern 3 packet, not in signed `informed_by`.

## Local substrate modes

`localSubstrate` supports two startup-spawn postures.

Shadow mode is the default:

1. `@atrib/mcp` builds the same unsigned record body it would sign directly.
2. The wrapper sends that body to the configured endpoint with request `mode: "shadow_probe"` and a startup-spawn producer envelope.
3. The wrapper signs, mirrors, and queues the record locally as before.
4. The coordinator signs or rejects the body without owning queue or mirror side effects.
5. The wrapper log records the coordinator status, elapsed time, expected local hash, returned hash, and whether the hashes matched.

Commit mode delegates queue ownership after hash match:

1. `@atrib/mcp` signs locally so the wrapper can attach outbound context, inject receipt ids when configured, and persist the local sidecar.
2. For ordinary calls, the wrapper sends the same unsigned body after the upstream tool succeeds. For a verifiable-action receipt-injection pair, it sends the request body before execution and the terminal outcome body afterward.
3. If the coordinator accepts and returns the same `record_hash`, the wrapper skips its own log-submission queue.
4. If the coordinator rejects the request, times out, returns an invalid response, or returns a mismatched hash, the wrapper submits through the local queue.
5. `flush()` waits for pending coordinator commit attempts before draining local submissions, so shutdown preserves the commit-or-fallback decision.

Commit mode does not move local mirror append or outbound context ownership to the coordinator. Those stay in the wrapper because the sidecar and tool result are local to the MCP call.

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
3. Adds signed tool-identity, argument, and result commitments under the
   default `verifiable-action` mode.
4. Forwards to the upstream MCP server.
5. For `injectReceiptId` tools, emits a linked request/outcome pair. The
   request supplies the stable pre-action receipt. The outcome commits the
   result and points back through `chain_root` and `informed_by`.
6. On success, persists the signed record to the local jsonl mirror
   (closes the chain seed → pubkey → record signature → log inclusion
   verification path).
7. Submits to the log endpoint via the priority queue.
8. If `archiveSubmission` is set, submits the signed record body, log proof,
   and selected verifier evidence to the archive.
9. If `localSubstrate` is set, sends a shadow or commit request and logs the outcome.
10. autoChain bookkeeping advances so the next call links to this one.

When the subagent env bundle carries `ATRIB_PARENT_RECORD_HASH`, step 1 also adds that parent hash to the first successful record's `informed_by` set before signing.

Records are byte-identical to those signed by `@atrib/agent` or any other
caller of `@atrib/mcp` middleware. The wrapper is a transport, not a
protocol participant.

## Library surface

```ts
import { buildRecordReferenceResolver, parseConfig, wrap } from '@atrib/mcp-wrap'

const config = parseConfig(JSON.parse(rawJson))
const { proxy } = await wrap(config)
await proxy.server.connect(transport)
```

Useful when you want the wrapper's plumbing but a different bootstrap
(custom config source, embedded inside another long-running service, etc.).
`buildRecordReferenceResolver()` exposes the same
[D116](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d116-producer-side-informed_by-validation-is-source-aware)
resolver guard used by `wrap()` when custom bootstraps need to pass
`recordReferenceResolver` manually.

## Part of atrib

atrib is an open protocol for verifiable agent actions. Every action becomes a signed, chain-linked record that anyone can verify against a public Merkle log, with no operator to trust. This package is one entrypoint. See the [full package family](https://github.com/creatornader/atrib#packages) and the [protocol spec](https://github.com/creatornader/atrib/blob/main/atrib-spec.md).
