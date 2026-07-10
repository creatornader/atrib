# Calculation algorithm conformance corpus

Deterministic distribution vectors for the calculation algorithm.

**Ownership.** The vectors are unchanged by the
[P048](../../../DECISIONS.md#p048-payments-profile-spin-out-from-protocol-core)
payments spin-out; the corpus path is a stable identifier and does not
move. The normative owner of the algorithm is now
[payments profile §8](../../../docs/payments-profile.md#8-the-calculation-algorithm)
(relocated from core
[§4.6](../../../atrib-spec.md#46-the-calculation-algorithm), whose
anchor remains stable). The determinism requirement continues to hold:
two runs on identical input MUST produce identical output, and the
pure-function invariant (no network, no clock beyond record timestamps,
no randomness) remains binding.

Vectors: [`calculation-vectors.json`](calculation-vectors.json).
Consumed by the `@atrib/verify` calculation tests.
