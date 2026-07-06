# @atrib/sdk

Consolidated atrib client SDK: two verbs over the substrate — **`attest()`**
(write) and **`recall()`** (read) — plus the complete [§1](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#1-attribution-record-format) record layer
re-exported from `@atrib/mcp` so application code needs exactly one import.

This package is a consolidation, not a greenfield: it adds **no new
canonicalization, hashing, or signing implementation**. Every write
terminates in `@atrib/emit`'s `handleEmit` pipeline (records are
byte-identical to wrapper-signed and primitive-signed records), and every
cryptographic primitive is the existing `@atrib/mcp` one.

## Topology: daemon-first

Per [D120](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d120-local-substrate-coordinator-keeps-startup-spawn-sidecars-wrapper-owned) and the redesign upgrade path, the local primitives runtime is the
default peer. The SDK talks MCP Streamable HTTP to it
(`$ATRIB_PRIMITIVES_HTTP_ENDPOINT`, default `http://127.0.0.1:8796/mcp`)
and falls back to in-process engines when no daemon is reachable:

| Verb | Daemon path | In-process fallback |
| --- | --- | --- |
| `attest()` | `emit` tool (daemon-owned key) | `emitInProcess()` from `@atrib/emit` (caller-owned key) |
| `recall({shape: 'history'})` | `recall_my_attribution_history` | `recall()` from `@atrib/recall` (optional peer) |
| `recall({shape: 'verify'})` | `atrib-verify` | `handleAtribVerify()` from `@atrib/verify-mcp` (optional peer) |
| other recall shapes | matching runtime tool | degraded warning outcome (v0) |

`@atrib/recall` and `@atrib/verify-mcp` are **optional peer dependencies**
loaded lazily (the P047 pattern): without them installed, those two
in-process fallbacks degrade to a typed unavailable outcome with a
warning instead of an import failure. `@atrib/emit` stays a hard
dependency so the write path always works.

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

## Degradation contract ([§5.8](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#58-degradation-contract))

Operational failures never throw and never block: daemon unreachable →
fallback; no signing key → pass-through result with a warning; log
submission is non-blocking with bounded retry (via the existing
`@atrib/mcp` submission queue). The only throw paths are contradictory
inputs (programmer error), e.g. `ref.kind: 'revises'` with
`event_type: 'annotation'`.

## Anchors

`anchors` config takes a **set** of [§2.6.1](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#261-submit-entry) submission endpoints —
bare strings or `{ endpoint, anchor_type? }` objects (the P043 headroom:
absent/`'atrib-log'` today; `rekor`/`rfc3161-tsa` anchors are skipped
with a warning until upgrade-path step 1 lands). Only the first atrib-log
anchor is submitted to (default `https://log.atrib.dev/v1/entries`);
extras warn, never error. `allowSingleAnchor` is the explicit escape
hatch once the ≥2-anchor default posture activates.

## Extension receipts (opt-in)

With `attributionReceipts: true`, the daemon client parses
`dev.atrib/attribution` attestation receipts from tool results' `_meta`
(P049 draft): the propagation token, a receipt naming the record the
server already signed (`log_submission` is a queue status, never an
awaited proof), and optionally the full signed record for immediate
Tier-3 re-verification. Receipts surface as `attribution_receipt` on
attest/recall results; they are advisory — trust derives from verifying
signed records, never from the receipt.

## Evidence envelopes

`EvidenceEnvelope` types model the P042 universal envelope (profile type
URI, four-tier ladder `declared → shape → attested → verified`, payload
commitment, verifier facts). Types only in v0: the legacy `protocol`
string set is frozen; every new evidence kind is an envelope profile.

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
