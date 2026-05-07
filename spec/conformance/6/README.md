# atrib spec [§6](../../../atrib-spec.md#6-key-directory) conformance corpus

Test fixtures for the public-key directory per spec [§6](../../../atrib-spec.md#6-key-directory) ([D034](../../../DECISIONS.md#d034-public-key-directory-architecture-akd-unblinded-vrf-blinded-mode-available-for-downstream-consumers)).

This corpus is the shared contract between every atrib directory implementation
(unblinded AKD mode) and every verifier that consults the directory. AKD's
VRF-blinded mode is intended for downstream consumers with privacy-preserving
lookup requirements; those consumers maintain their own corpora covering the
privacy properties of the blinded path.

## Status

**Initial subset shipped.** Two foundational cases are committed:
`valid-self-attested-claim.json` (membership branch) and
`valid-non-membership.json` (non-membership branch). Together they
exercise [§6.3](../../../atrib-spec.md#63-verifier-consultation-algorithm) step 6 (directory lookup) + step 8 (claim parsing) of the
9-step verifier consultation algorithm.

Both files are byte-identical regenerations of
`packages/log-dev/scripts/generate-conformance-6.ts` (run with
`pnpm --filter @atrib/log-dev exec tsx scripts/generate-conformance-6.ts`).

The reference implementation (`packages/verify/test/conformance-6.test.ts`)
loads each fixture, mocks the directory response per the case's
`directory_response`, and asserts the `resolveIdentity` output matches
the case's `verifier_output`.

Cases enumerated below that require live AKD proofs (anchor coherence,
append-only consistency, AKD proof validation, witness coverage,
capability envelopes) will generate when the corpus runner exercises
a live `directory-node` + `log-node` pair against fixtures end-to-end.

## What will be in the corpus

```
spec/conformance/6/
  README.md           # this file
  manifest.json       # corpus metadata + index (generated)
  cases/
    valid-self-attested-claim.json          # publish + lookup, proof verifies
    valid-domain-verified-claim.json        # claim with TXT-record proof; verifier re-confirms
    valid-history.json                      # two versions for one label; history returns chronologically
    valid-non-membership.json               # lookup unregistered key returns AKD non-membership proof
    valid-anchor-coherence.json             # directory_anchor on Tessera log matches actual root
    invalid-anchor-mismatch.json            # anchor's root differs → verifier rejects
    invalid-lookup-proof.json               # tampered AKD proof → verifier rejects
    revocation-applies.json                 # lookup against post-revocation timestamp respects §1.9
```

## Each case file shape

```json
{
  "name": "valid-self-attested-claim",
  "spec_section": "6",
  "description": "...",
  "input": {
    "directory_operations": [
      { "op": "publish", "claim": { ... }, "comment": "..." },
      { "op": "lookup", "label": "<base64url-key>" }
    ]
  },
  "expected": {
    "lookup_results": [
      {
        "found": true,
        "claim_subject": "...",
        "proof_validates": true
      }
    ]
  }
}
```

## How to run

A reference verifier replays directory operations against an AKD instance
configured for unblinded mode. Each lookup MUST return the expected result
AND its proof MUST validate against the directory_root. A failing proof is
a fatal corpus failure regardless of whether the data was correct.
