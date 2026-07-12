# The Merkle log

> Records live in a public, append-only, tamper-evident log. Anyone can prove a record was committed at a given position, and anyone can prove the log hasn't been rewritten.

**Status**: STUB
**Spec anchors**: [§2 Merkle Log Protocol](../../atrib-spec.md#2-merkle-log-protocol)
**Builds on**: [Records & signing](01-records-and-signing.md)
**Enables**: [Identity & the directory](03-identity-and-directory.md), [Graph derivation](05-graph-derivation.md), [The trust model](06-trust-model.md), [Privacy postures](07-privacy-postures.md)

## What this teaches

Why atrib uses C2SP tlog-tiles + RFC 6962 inclusion proofs + signed-note checkpoints, what the log stores vs. doesn't, and how the transparency-log lineage (CT, Sigstore) informs atrib's design.

## What to cover when this gets written

- Why a transparency log and not a blockchain (per [D006](../../DECISIONS.md))
- What a Merkle tree gives you: O(log n) inclusion + consistency proofs
- The 90-byte log entry: version + record_hash + creator_key + context_id + timestamp + event_type
- Checkpoints: signed-note format (per C2SP spec), what they commit to
- The tile API (read interface) and submission API (write interface)
- Witnessing: independent parties cosigning checkpoints (defense against equivocation)
- Cross-log replication (optional, [D050](../../DECISIONS.md))
- What the log **stores** vs. **doesn't** (commitments, not content; see [§2.10](../../atrib-spec.md#210-what-the-log-stores-and-what-it-does-not))
- Worked example: submit a record, get back an inclusion proof, verify it locally

## See also

- Spec: [§2](../../atrib-spec.md#2-merkle-log-protocol)
- Decisions: [D006 Merkle log, not blockchain](../../DECISIONS.md), [D007 Log stores commitments not content](../../DECISIONS.md), [D050 Cross-log replication](../../DECISIONS.md)
- Concepts: [Privacy postures](07-privacy-postures.md) (what the log exposes), [The trust model](06-trust-model.md)
- External: [C2SP tlog-tiles spec](https://c2sp.org/tlog-tiles), [RFC 6962](https://datatracker.ietf.org/doc/html/rfc6962)
