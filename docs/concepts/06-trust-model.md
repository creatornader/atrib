# The trust model

> atrib doesn't certify truth. It certifies signing. The trust an observer extends to any signed record is the composition of ten independent layers, each of which can be reasoned about separately.

**Status**: STUB
**Spec anchors**: [§8.7 Adversarial Threat Model](../../atrib-spec.md#87-adversarial-threat-model)
**Builds on**: every prior concept
**Enables**: how verifiers reason about what they're looking at

## What this teaches

The 10-layer trust stack: what each layer attests to, how it can fail, and what defense composes it with neighboring layers. This is the framework for answering "how much should I trust this signed record?"

## What to cover when this gets written

- The headline framing: atrib certifies signing, NOT truth
- The 10 layers, each as a separate guarantee:
  1. Signature validity (the math)
  2. Identity (does the key belong to the named entity? Leans on the directory)
  3. Capability (is this entity authorized for this kind of action?)
  4. Revocation (is the key still current?)
  5. Cross-attestation (≥2 distinct verified signer keys on transactions per [§1.7.6](../../atrib-spec.md#176-cross-attestation-requirement-for-transaction-records))
  6. Tool-side attestation (did the tool also attest to what happened?)
  7. External evidence (does the world outside atrib corroborate?)
  8. Witnessing (independent cosigners on log checkpoints)
  9. Cross-log replication (the same checkpoint appears in N independent logs)
  10. Structural anomaly detection (does the graph structure look suspicious?)
- Why a layer stack and not a single number: each layer defends against different attacker classes
- How verifiers compose layers: pick a subset, set thresholds, apply policy
- Worked example: a single transaction record reasoned about layer-by-layer, what could fail at each, what compositions catch it

## See also

- Spec: [§8.7](../../atrib-spec.md#87-adversarial-threat-model), [§2.9 Witnessing](../../atrib-spec.md#29-witnessing-and-cosignatures), [§2.11 Cross-log replication](../../atrib-spec.md#211-cross-log-replication)
- Decisions: [D050 Cross-log replication](../../DECISIONS.md), [D052 Cross-attestation](../../DECISIONS.md), [D051 Capability declarations](../../DECISIONS.md)
- Concepts: [Identity & the directory](03-identity-and-directory.md), [Privacy postures](07-privacy-postures.md)
