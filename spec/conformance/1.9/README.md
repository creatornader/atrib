# atrib spec §1.9 conformance corpus

Test fixtures for key rotation and revocation per spec §1.9 (D033).

This corpus is the shared contract between every implementation that
processes `key_revocation` records and applies the `'revoked_after_revocation'`
verification state. It is used by `@atrib/verify`, `services/graph-node`, and
any third-party implementation that consumes atrib records.

## Status

**Skeleton.** The cases are enumerated below; the JSON fixtures will be
generated alongside the rotation implementation in  of the implementation
plan. The skeleton exists so external implementers reading the spec know the
exact set of cases that will arrive.

## What will be in the corpus

```
spec/conformance/1.9/
  README.md           # this file
  manifest.json       # corpus metadata + index (generated)
  cases/
    valid-rotation.json                       # signed by retired key, with successor
    valid-retirement.json                     # signed by retired key, no successor
    valid-compromise-emergency.json           # signed by emergency key registered before revocation
    invalid-wrong-signer.json                 # signed by an unrelated key (rejected)
    invalid-emergency-not-registered.json     # emergency key not in directory before revocation (rejected)
    invalid-emergency-for-non-compromise.json # emergency-key signing with reason='rotation' (rejected)
    post-revocation-record.json               # record signed by retired key after revocation log index → 'revoked_after_revocation'
    pre-revocation-record.json                # record signed by retired key before revocation log index → 'signature_valid'
```

## Each case file shape

```json
{
  "name": "valid-rotation",
  "spec_section": "1.9",
  "description": "...",
  "input": {
    "log_entries": [
      { "log_index": 0, "record": { ... }, "comment": "..." },
      { "log_index": 1, "record": { ... }, "comment": "key_revocation here" },
      { "log_index": 2, "record": { ... }, "comment": "post-revocation" }
    ],
    "directory_state": { ... }
  },
  "expected": {
    "verification_states": {
      "0": "signature_valid",
      "1": "signature_valid",
      "2": "revoked_after_revocation"
    }
  }
}
```

## How to run

A reference verifier consumes the manifest, processes log entries in order,
and asserts that each record's resulting verification_state matches the
expected value. Both `@atrib/verify` and `services/graph-node` MUST pass
every case.
