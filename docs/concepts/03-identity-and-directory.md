# Identity & the directory

> Public keys are not identity. The directory binds public keys to identity claims (names, organizations, capabilities), verifiable without trusting a central CA.

**Status**: STUB
**Spec anchors**: [§6 Key Directory](../../atrib-spec.md#6-key-directory)
**Builds on**: [Records & signing](01-records-and-signing.md), [The Merkle log](02-the-merkle-log.md)
**Enables**: [Payments integration](08-payments-integration.md) (counterparty key discovery), [The trust model](06-trust-model.md) (Layer 2)

## What this teaches

How atrib uses Auditable Key Directories (AKD, the Facebook/Microsoft-research crate) to publish identity claims that anyone can verify — and how directory anchoring composes with the Merkle log for cross-verification.

## What to cover when this gets written

- Why a directory at all: signatures alone don't tell you *who* signed; the directory binds keys to claims
- AKD overview: append-only, history-hiding, key transparency
- The `directory_anchor` event type (byte `0x04`, per [D056](../../DECISIONS.md))
- Per-operation log anchoring ([§6.2.4](../../atrib-spec.md#624-anchor-cross-reference-into-the-tessera-log)): directory writes commit to the atrib log automatically
- Key rotation and revocation ([§1.9](../../atrib-spec.md#19-key-rotation-and-revocation), [D033](../../DECISIONS.md))
- Capability declarations ([§6.7](../../atrib-spec.md#67-capability-declarations), [D051](../../DECISIONS.md)) — optional; verifiers can flag out-of-envelope records
- The trust delegation: an atrib log operator could equivocate, but the directory commits ITS history to the same log, so equivocation is detectable
- Worked example: publish an identity claim, look it up, verify the AKD proof + the log inclusion proof

## See also

- Spec: [§6](../../atrib-spec.md#6-key-directory)
- Decisions: [D033 Key rotation/revocation](../../DECISIONS.md), [D034 Public-key directory](../../DECISIONS.md), [D051 Capability-scoped records](../../DECISIONS.md), [D056 directory_anchor byte 0x04](../../DECISIONS.md)
- Concepts: [The Merkle log](02-the-merkle-log.md), [The trust model](06-trust-model.md)
- External: [facebook/akd](https://github.com/facebook/akd), [Microsoft Research AKD paper](https://eprint.iacr.org/2020/1158)
