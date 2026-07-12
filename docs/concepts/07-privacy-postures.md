# Privacy postures

> The log stores commitments, not content. atrib lets the producer decide how much of the underlying content is observable, on a per-record basis, by choosing a salting posture.

**Status**: STUB
**Spec anchors**: [§8.3 Salted-Commitment Posture](../../atrib-spec.md#83-salted-commitment-posture) · [§2.10 What the Log Stores](../../atrib-spec.md#210-what-the-log-stores-and-what-it-does-not) · [D045](../../DECISIONS.md)
**Builds on**: [Records & signing](01-records-and-signing.md), [The Merkle log](02-the-merkle-log.md)
**Enables**: enterprise / regulated deployments where what-the-log-exposes matters

## What this teaches

What the log commits to vs. what it exposes, why "salting" lets you make arbitrary content commitments revealable selectively, and the three privacy postures atrib supports (transparent, salted, fully-private with separate body archive).

## What to cover when this gets written

- The log entry is 90 bytes; there's no content in it (per [§2.3.1](../../atrib-spec.md#231-entry-serialization))
- `content_id` is a SHA-256 over the underlying content; it doesn't reveal content
- `args_commit` / `result_commit`: SHA-256 over (args/result + optional salt)
- The three postures:
  - **Transparent**: no salt; anyone who knows the content can verify the commitment
  - **Salted**: optional 16-byte salt; commitment is revealable only to parties holding the salt (the producer, anyone they share with)
  - **Body archive layer** ([§2.12](../../atrib-spec.md#212-record-body-archive-layer), [D070](../../DECISIONS.md)): the log commits to the hash; the actual body lives at the producer's mirror or a separate archive
- Why this matters: a public log without selective revelation would leak everything; a fully-private system would lose the multi-party verification property. The salting posture is the middle ground.
- Verifiability is tiered:
  - **Tier 1 (commitment)**: needs only the log
  - **Tier 2 (body retrieval)**: needs producer-mirror or archive
  - **Tier 3 (signature re-verification)**: needs Tier 2
- Worked example: same agent action recorded under each of the three postures, show what's visible to a stranger vs. a salt-holder

## See also

- Spec: [§8.3](../../atrib-spec.md#83-salted-commitment-posture), [§2.10](../../atrib-spec.md#210-what-the-log-stores-and-what-it-does-not), [§2.12](../../atrib-spec.md#212-record-body-archive-layer)
- Decisions: [D045 Privacy postures normative spec section](../../DECISIONS.md), [D070 Record Body Archive Layer](../../DECISIONS.md), [D007 Log stores commitments not content](../../DECISIONS.md)
- Concepts: [The Merkle log](02-the-merkle-log.md), [The trust model](06-trust-model.md)
