# atrib spec §6 conformance corpus

Test fixtures for the public-key directory per spec §6 (D034).

This corpus is the shared contract between every atrib directory implementation
(unblinded AKD mode) and every verifier that consults the directory. AKD's
VRF-blinded mode is intended for downstream consumers with privacy-preserving
lookup requirements; those consumers maintain their own corpora covering the
privacy properties of the blinded path.

## Status

**Skeleton.** The cases are enumerated below. JSON fixtures land in Phase 3
alongside the directory implementation.

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
