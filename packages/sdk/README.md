# @atrib/sdk

Consolidated atrib client SDK: two verbs over the substrate — **`attest()`**
(write) and **`recall()`** (read) — plus the complete §1 record layer
re-exported from `@atrib/mcp` so application code needs exactly one import.

This package is a consolidation, not a greenfield: it adds **no new
canonicalization, hashing, or signing implementation**. Every write
terminates in `@atrib/emit`'s `handleEmit` pipeline (records are
byte-identical to wrapper-signed and primitive-signed records), and every
cryptographic primitive is the existing `@atrib/mcp` one.

## Topology: daemon-first

Per D120 and the redesign upgrade path, the local primitives runtime is the
default peer. The SDK talks MCP Streamable HTTP to it
(`$ATRIB_PRIMITIVES_HTTP_ENDPOINT`, default `http://127.0.0.1:8796/mcp`)
and falls back to in-process engines when no daemon is reachable:

| Verb | Daemon path | In-process fallback |
| --- | --- | --- |
| `attest()` | `emit` tool (daemon-owned key) | `emitInProcess()` from `@atrib/emit` (caller-owned key) |
| `recall({shape: 'history'})` | `recall_my_attribution_history` | `recall()` from `@atrib/recall` |
| `recall({shape: 'verify'})` | `atrib-verify` | `handleAtribVerify()` from `@atrib/verify-mcp` |
| other recall shapes | matching runtime tool | degraded warning outcome (v0) |

The SDK is **semantically stateless** (stateless-MCP-native posture):
`context_id` and chain tokens are explicit per-request values; nothing
rides on the MCP protocol session, which remains a transport detail of the
current runtime until the 2026-07-28 stateless transport ships.

## Usage

```ts
import { createAtribClient } from '@atrib/sdk'

const client = createAtribClient()

// Write: observation (default), or annotate/revise via ref.kind
const result = await client.attest({
  content: { what: 'chose sqlite over postgres', why_noted: 'deployment constraint' },
})

await client.attest({
  content: { summary: 'supersedes the sqlite decision', reason: 'scale changed' },
  ref: { kind: 'revises', record_hash: result.record_hash! },
})

// Read: one verb, shape-discriminated
const history = await client.recall({ shape: 'history', limit: 10 })
const walk = await client.recall({ shape: 'walk', from_record_hash: result.record_hash! })

await client.close()
```

`summarize` is deliberately **not** a recall shape: synthesis belongs to
the calling harness/model; the SDK returns verified raw material.

## Degradation contract (§5.8)

Operational failures never throw and never block: daemon unreachable →
fallback; no signing key → pass-through result with a warning; log
submission is non-blocking with bounded retry (via the existing
`@atrib/mcp` submission queue). The only throw paths are contradictory
inputs (programmer error), e.g. `ref.kind: 'revises'` with
`event_type: 'annotation'`.

## Anchors

`anchors` config takes a **set** of §2.6.1 submission endpoints. Until
upgrade-path step 1 (anchor plurality) lands, only `anchors[0]` is
submitted to (default `https://log.atrib.dev/v1/entries`); extra anchors
produce a warning, not an error. The config shape is forward-compatible
with the ≥2-anchor default posture.

## Conformance

`test/` runs the shared corpora — `spec/conformance/1.4/` (signing +
adversarial), `1.2.6/` (provenance_token), `1.2.3/multi-producer/`
(chain-root precedence), `2.6.1/` (submission validation, client-side) —
against this package's exported surface. The corpora are fixtures, not
inspiration: any failure is a spec-bug discovery, not something to route
around.

## Status

v0.1.0, unpublished (first-publish pending; see
`docs/publishing-new-npm-package.md` and the Changesets ignore list).
