# Records & signing

> Every observable thing an agent does becomes a JSON object signed with Ed25519 over a canonicalized form. This is the atom of atrib.

**Status**: STUB
**Spec anchors**: [§1.2 Record Format](../../atrib-spec.md#12-the-attribution-record) · [§1.3 Canonical Serialization](../../atrib-spec.md#13-canonical-serialization) · [§1.4 Signing and Verification](../../atrib-spec.md#14-signing-and-verification)
**Builds on**: (none; this is the foundational atom)
**Enables**: every other concept

## What this teaches

What a record is, what fields it carries, why JCS canonicalization matters for signatures, and why atrib chose Ed25519 + 32-byte seeds over PKI/DIDs (per [D003](../../DECISIONS.md#d003-ed25519-not-dids-or-pki)).

## What to cover when this gets written

- The two record shapes: standard (single-signer) and transaction (multi-signer `signers` array)
- Field-by-field walkthrough: `spec_version`, `event_type`, `chain_root`, `creator_key`, `context_id`, `content_id`, `args_commit`, `result_commit`, `timestamp`, `signature` / `signers`
- Why JCS (RFC 8785) and not JSON-LD canonicalization: deterministic, simple, no schema lookups
- The signing procedure: serialize → sign → attach signature → record is immutable
- Why presence/absence of optional fields matters (it changes the canonical bytes, which changes the signature)
- Worked example: build a `tool_call` record from scratch, sign it, verify it

## See also

- Spec: [§1.2-1.4](../../atrib-spec.md#1-attribution-record-format)
- Decisions: [D003 Ed25519](../../DECISIONS.md), [D004 OTel trace-id as context_id](../../DECISIONS.md)
- Concepts: [The chain](04-the-chain.md), [The Merkle log](02-the-merkle-log.md)
