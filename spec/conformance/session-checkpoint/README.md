# atrib session_checkpoint conformance corpus

Test fixtures for the `checkpoint` field and the
`https://atrib.dev/v1/types/session_checkpoint` event type per spec
[§1.2.10](../../../atrib-spec.md#1210-checkpoint) (P044 ADR,
[docs/adr-draft-p044-session-checkpoint.md](../../../docs/adr-draft-p044-session-checkpoint.md)).

The corpus is the shared contract between every implementation that
produces or consumes session checkpoints: producers building the RFC 6962
session tree, validators enforcing the checkpoint object schema at
log-side admission ([§2.6.1](../../../atrib-spec.md#261-submit-entry)),
and verifiers checking append-only consistency, equivocation, and
freshness facts. Leaf and node hashing reuse the
[§2.3.2](../../../atrib-spec.md#232-leaf-hash-computation) RFC 6962 rule
verbatim; leaf preimages here are the raw 32-byte record hashes of the
covered records, structurally disjoint from the log's 90-byte entries.

## Cases

| File | Asserts |
|---|---|
| `cases/schema-first-checkpoint.json` | Valid first checkpoint: `first_index` 0, `prior_checkpoint` omitted (not null), `retroactive` absent. JCS sorts `checkpoint` between `chain_root` and `content_id`. Signature round-trips; the `args_hash` commits `sha256(JCS({leaves}))` per [D099](../../../DECISIONS.md#d099-explicit-emit-records-commit-local-content-through-default-args_hash); freshness fact is `contemporaneous`. |
| `cases/schema-missing-checkpoint-rejected.json` | `checkpoint` REQUIRED on `session_checkpoint` records (the [§1.2.7](../../../atrib-spec.md#127-annotates) / [§1.2.9](../../../atrib-spec.md#129-revises) pattern). Signature valid; rejection at the policy layer. |
| `cases/schema-checkpoint-on-wrong-event-type-rejected.json` | `checkpoint` REJECTED on any other event_type (here: `observation`). |
| `cases/schema-first-index-bounds-rejected.json` | `0 ≤ first_index < tree_size` MUST hold; `first_index == tree_size` rejected. |
| `cases/schema-prior-present-at-first-index-zero-rejected.json` | `prior_checkpoint` MUST be present iff `first_index > 0`; present at 0 rejected. |
| `cases/schema-prior-absent-at-positive-first-index-rejected.json` | `prior_checkpoint` absent with `first_index > 0` rejected. |
| `cases/tree-1-leaf.json` | Single-leaf RFC 6962 root: `session_root = sha256(0x00 ‖ leaf_bytes)`; `tree_size` 1 is the minimum valid checkpoint. |
| `cases/tree-2-leaves.json` | Two-leaf root plus the raw-32-byte-leaf trap: a tree over the UTF-8 bytes of the `"sha256:<hex>"` strings MUST NOT reproduce `session_root`. |
| `cases/tree-5-leaves.json` | Odd/unbalanced five-leaf root. Leaf index 2 is the prior checkpoint's own record hash: checkpoints exclude themselves and become leaves in the next tree. |
| `cases/tree-empty-rejected.json` | `tree_size ≥ 1`; empty checkpoints prohibited. Pins the RFC 6962 empty-tree root sentinel (`sha256("")`) implementations must never commit to. |
| `cases/consistency-valid-extension.json` | Append-only K1 → K2: `prior_checkpoint` = hash(K1), `first_index` = K1.`tree_size`, identical leaf prefix, and a real RFC 6962 §2.1.4 consistency proof from `(root₁, 2)` to `(root₂, 5)` that MUST verify (truncated proofs MUST NOT). |
| `cases/consistency-equivocation-pair.json` | Two genuinely signed checkpoints from one `creator_key`, same `prior_checkpoint` and `tree_size`, divergent roots → categorical equivocation fact (the session-scale analogue of [§2.11](../../../atrib-spec.md#211-cross-log-replication) log equivocation). |
| `cases/retroactive-declared.json` | Attested backfill: checkpoint signed 3 days after its covered leaves with `retroactive: true` → freshness fact `declared-retroactive`; validators accept. |
| `cases/retroactive-false-rejected.json` | `retroactive: false` MUST NOT be emitted (present-only-when-true). |
| `cases/retroactive-absence-not-null.json` | Absence-not-null: the non-retroactive canonical form contains no `retroactive` key; adding `retroactive: true` to the identical payload changes signature and record hash (mirrors the [§1.2.6](../../../atrib-spec.md#126-provenance_token) omits-when-absent contract). |
| `cases/freshness-stale-undeclared.json` | Checkpoint 2 days past its max covered leaf timestamp without the flag → `stale-undeclared` against the 24h default bound. Signal, not block: validators still accept. |
| `cases/byte-uri-duality.json` | The same signed record encoded as a 90-byte log entry ([§2.3.1](../../../atrib-spec.md#231-entry-serialization)) under the pre-promotion `0xFF` extension byte and the post-promotion `0x08` byte. Entries differ ONLY at byte 89; canonical record bytes, signature, and record hash are identical (the [D073](../../../DECISIONS.md#d073-handoff-event_type-byte-placeholder-adr) staged-promotion pattern). |

## Generator

`packages/log-dev/scripts/generate-conformance-session-checkpoint.ts`. Run with:

```sh
pnpm --filter @atrib/log-dev exec tsx scripts/generate-conformance-session-checkpoint.ts
```

Seeds (`0x01..0x20` sequential agent seed) and timestamps are hardcoded so
successive regenerations produce byte-identical files. All roots,
consistency proofs, signatures, and record hashes are computed for real
(RFC 6962 over `@noble/hashes` sha256; Ed25519 over JCS via `@atrib/mcp`).
Regenerate when:

- The [§1.2.10](../../../atrib-spec.md#1210-checkpoint) checkpoint object schema changes
- Canonical record format ([§1.2](../../../atrib-spec.md#12-the-attribution-record) / [§1.3](../../../atrib-spec.md#13-canonical-serialization)) changes
- A new test case is added

## Reference implementation

`packages/verify/test/conformance-session-checkpoint.test.ts` loads each
committed case (never the generator), re-derives every root and proof with
an independent in-test RFC 6962 implementation, and asserts every expected
field. Conforming third-party implementations SHOULD load the same
fixtures and assert the same invariants.

## Status

**Initial seventeen-case corpus shipped.** The five families collectively
cover the [§1.2.10](../../../atrib-spec.md#1210-checkpoint) contract:
checkpoint object schema and presence rules, real RFC 6962 roots over
ordered record-hash leaves (1 / 2 / 5 leaves, empty invalid, hex-string
trap), append-only consistency plus equivocation, the
present-only-when-true `retroactive` flag with categorical freshness
facts, and the `0xFF`/`0x08` byte-URI duality over byte-identical signed
bytes. Future cases (ordering-consistency checks against resolved leaves,
foreign-`context_id` leaf hard fault, inclusion-proof selective-disclosure
vectors) can be added by extending the generator.
