# atrib spec [§1.9](../../../atrib-spec.md#19-key-rotation-and-revocation) conformance corpus

Test fixtures for key rotation and revocation per spec [§1.9](../../../atrib-spec.md#19-key-rotation-and-revocation) ([D033](../../../DECISIONS.md#d033-key-rotation-and-revocation)).

This corpus is the shared contract between every implementation that
processes `key_revocation` records and applies the `'revoked_after_revocation'`
verification state. It is used by `@atrib/verify`, `services/graph-node`, and
any third-party implementation that consumes atrib records.

## Status

**Initial subset shipped.** The two required cases are committed:
`pre-revocation-record.json` and `post-revocation-record.json`. They
share an input sequence (4 entries: 2 pre-revocation, the revocation
itself, 1 post-revocation) and assert the `verification_state` contract
that flips records signed by the retired key after the revocation's
`log_index`.

Both files are byte-identical regenerations of
`packages/log-dev/scripts/generate-conformance-1.9.ts` (run with
`pnpm --filter @atrib/log-dev exec tsx scripts/generate-conformance-1.9.ts`).

The reference implementation (`packages/verify/test/conformance-1.9.test.ts`)
loads each fixture, builds a revocation registry, and asserts every
expected verification_state matches.

The remaining cases enumerated below (compromise + emergency key,
malformed-signer rejections) generate when the live emergency-key path
matures. They're not blocking initial verifier conformance, verifiers
passing the two shipped cases prove the central contract.

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
