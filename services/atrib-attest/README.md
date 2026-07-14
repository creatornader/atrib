# `@atrib/attest`

atrib's write-verb home. One `attest` tool signs observations, annotations,
and revisions under the agent's own atrib identity. The legacy `emit`,
`atrib-annotate`, and `atrib-revise` tool names stay mounted as permanent
aliases over the same handler, so records are byte-identical in canonical
form regardless of which name signed them. This is the attest/recall rename
([D163](../../DECISIONS.md#d163-attestrecall-verb-rename-and-primitive-surface-collapse)).

## Install

```bash
pnpm add @atrib/attest
```

Verify a local build with `pnpm --filter @atrib/attest test`.

## Why this exists

`@atrib/mcp` middleware auto-signs every MCP tool call as it passes through.
That captures the mechanical record-of-tool-call. But agents do cognitive
work that doesn't go through MCP: reasoning steps, decisions, annotations
against prior records, and revisions of a prior position all live in the
agent's prose, not in a tool invocation. `attest` is the explicit signing
tool the agent calls when it wants on-chain provenance for one of these.

## The `attest` tool

One handler, one `ref` argument decides the record shape:

```typescript
attest({
  // Required. Free-form semantic content; committed through the default
  // args_hash per D099. For annotations: { importance, summary, topics? }.
  // For revisions: { prior_position, new_position }.
  content: Record<string, unknown>,

  // Optional: the declared relationship decides the signed record shape.
  // There is no event_type argument; absent ref signs an observation.
  ref?: {
    kind: "annotates",
    target: string,               // sha256:<64-hex> record_hash to annotate
  } | {
    kind: "revises",
    target: string,               // sha256:<64-hex> record_hash to revise
    reason: string,               // REQUIRED for a revision; composed into content
  },

  // Optional, same as the legacy emit tool
  context_id?: string,
  informed_by?: string[],
  allow_unresolved_informed_by?: boolean,
  chain_root?: string,
  provenance_token?: string,
  tool_name?: string,
  args_hash?: string,
  result_hash?: string,
  producer?: string,              // sidecar label override; defaults to 'atrib-attest'
})
```

### Ref mapping

| `ref` argument | Signed record | Signed field carried |
| --- | --- | --- |
| absent | observation | none |
| `{ kind: "annotates", target, ... }` | annotation | signed `annotates` field |
| `{ kind: "revises", target, reason, ... }` (`reason` required) | revision | signed `revises` field |

The three shapes route through the same `handleEmit` funnel used by the
legacy tools. There is no separate signing path for `attest`: the ref
argument decides which event_type byte and which signed field get attached
before the record goes through the shared sign-and-mirror pipeline.

## Legacy write tools stay mounted

`emit`, `atrib-annotate`, and `atrib-revise` remain mounted as permanent
aliases during the alias window described in the attest/recall rename
([D163](../../DECISIONS.md#d163-attestrecall-verb-rename-and-primitive-surface-collapse)).
Calling `atrib-annotate` and calling `attest` with `ref.kind: "annotates"`
against the same target produce byte-identical annotation records: same key,
same chain state, same `handleEmit` funnel. Only the `_local.producer`
sidecar label differs between the two call paths.

## Byte-identity

A verifier cannot distinguish a record signed through `attest` from one
signed through the legacy `emit`/`atrib-annotate`/`atrib-revise` names. Same
signing key, same canonical form, same chain composition. The only
observable difference is the `_local.producer` sidecar label, which is
metadata for local mirror consumers, not signed protocol bytes.

## Bins

- **`atrib-attest`**: the MCP server. Long-lived stdio child. Serves the
  four-tool write union: `attest` plus the three legacy write tool names
  (`emit`, `atrib-annotate`, `atrib-revise`).
- **`atrib-attest-cli`**: an in-process CLI, same wire contract as
  `atrib-emit-cli`. Reads one JSON envelope on stdin, signs the record
  in-process, writes the output JSON to stdout. Default producer label is
  derived from the invoked bin name (`atrib-attest-cli` for this bin,
  `atrib-emit-cli` when invoked under that name).

The legacy bins `atrib-emit`, `atrib-emit-cli`, `atrib-local-substrate`,
`atrib-annotate`, and `atrib-revise` still forward to this package's
handlers through the `@atrib/emit`, `@atrib/annotate`, and `@atrib/revise`
re-export shims.

## Programmatic surface

```typescript
import {
  createAtribAttestServer,       // mounts the four-tool write union
  createAtribEmitServer,          // legacy factory; also mounts attest
  createAtribAnnotateServer,      // legacy factory; also mounts attest
  createAtribReviseServer,        // legacy factory; also mounts attest
  handleAttest,
  attestInProcess,

  // Re-exported legacy emit surface
  handleEmit,
  emitInProcess,
  EmitInput,
  resolveKey,
  emitSessionCheckpoint,
} from "@atrib/attest";
```

Each legacy factory (`createAtribEmitServer`, `createAtribAnnotateServer`,
`createAtribReviseServer`) mounts `attest` alongside its own named tool, so
any MCP host wired to a legacy factory still gets the two-verb surface.

## Configuration

Environment variables are unchanged from the legacy emit surface:
`ATRIB_PRIVATE_KEY`, `ATRIB_KEY_FILE`, `ATRIB_MIRROR_FILE`,
`ATRIB_LOG_ENDPOINT`, `ATRIB_CONTEXT_ID`, `ATRIB_AUTOCHAIN_SOURCE`,
`ATRIB_AGENT`, `ATRIB_KEYCHAIN_ACCOUNT`, `ATRIB_KEY_RESOLVE_RETRY_MS`,
`ATRIB_REQUIRE_EXPLICIT_CONTEXT_ID`, `CLAUDE_CODE_SESSION_ID`,
`CODEX_THREAD_ID`, `ATRIB_PARENT_RECORD_HASH`,
`ATRIB_LOCAL_SUBSTRATE_ENDPOINT`, `ATRIB_LOCAL_SUBSTRATE_MODE`,
`ATRIB_LOCAL_SUBSTRATE_TIMEOUT_MS`. See
[`services/atrib-emit/README.md`](../atrib-emit/README.md) for the full
table with descriptions; the values and resolution order carried over
unchanged.

## Conformance

The attest/recall byte-identity, ref-mapping, and alias-window guarantees
are pinned by the shared corpus at
[`spec/conformance/attest-recall/`](../../spec/conformance/attest-recall/):
byte-identity, ref-mapping, read-equivalence, alias-window,
persisted-labels, and frozen-constants.

## Part of atrib

atrib is an open protocol for verifiable agent actions. Every action becomes
a signed, chain-linked record that anyone can verify against a public
Merkle log, with no operator to trust. This package is one entrypoint. See
the [full package family](https://github.com/creatornader/atrib#packages)
and the [protocol spec](../../atrib-spec.md).
