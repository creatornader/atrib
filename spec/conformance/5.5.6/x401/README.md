# x401 Authorization Evidence Corpus

This corpus pins atrib's verifier-side treatment of x401 proof evidence for
spec section 5.5.6. The cases use decoded proof objects for readability. When a
case needs to exercise HTTP header names, the test harness encodes the decoded
objects into base64url x401 header values before verification.

The current-spec cases use `PROOF-REQUEST`, `PROOF-RESPONSE`, and
`PROOF-RESULT` semantics from the Proof x401 v0.2 draft. Legacy
`PROOF-REQUIRED` and `PROOF-PRESENTATION` cases remain here only as drift
guards, because public Proof SDK and demo surfaces may lag the draft.

Optional external fact cases cover agent-origin, issuer-trust, and
proof-payment binding verifier outcomes. Those cases pin atrib's evidence
contract only: explicit failed verifier outcomes fail the block, and public
details carry hashes for origin, trust-root, and binding references. They do
not define Proof's upstream trust-list, origin, or payment-binding semantics.
