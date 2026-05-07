# [§6.3](../../../atrib-spec.md#63-verifier-consultation-algorithm) Verifier consultation conformance corpus

Fixtures exercising the proof-verification primitives at the heart of spec [§6.3](../../../atrib-spec.md#63-verifier-consultation-algorithm)
steps 5 (append-only consistency via `audit_verify`) and 7 (lookup proof
verification via `lookup_verify`). Each case fixes the input (proof bytes,
anchored root, current epoch, label, vrf pubkey) and the expected verify
result (`true` or `false`). A third-party implementation can decode each
case and assert the same boolean.

## Coverage

The eleven cases split into two groups:

**Lookup-verify (5 cases)**

| Case | Behavior |
|---|---|
| `lookup-verify-accept` | Fresh proof against fresh anchored root verifies. |
| `lookup-verify-reject-root` | Single bit flipped in root → rejected. |
| `lookup-verify-reject-vrf` | Wrong VRF pubkey → rejected. |
| `lookup-verify-reject-label` | Wrong label → rejected. |
| `lookup-verify-reject-epoch` | `current_epoch < proof.version` → rejected (akd guard). |

**Audit-verify (6 cases)**

| Case | Behavior |
|---|---|
| `audit-verify-accept-2` | Clean 2-epoch chain verifies. |
| `audit-verify-accept-4` | Clean 4-epoch chain verifies. |
| `audit-verify-reject-start` | Tampered start hash → rejected. |
| `audit-verify-reject-end` | Tampered end hash → rejected. |
| `audit-verify-reject-mid` | Tampered intermediate hash in 4-epoch chain → rejected. |
| `audit-verify-reject-count` | Wrong epoch/hash count (`epochs+1 != hashes`) → rejected. |

## Out of scope

Other [§6.3](../../../atrib-spec.md#63-verifier-consultation-algorithm) steps surface as warnings or output fields rather than single
deterministic input/output pairs and are not fixture-replayable here:

- **Step 1** (anchor fetch) and **step 2** (anchor freshness) — depend on
  log fetch context that the verifier configures per-call.
- **Step 3** (witness coverage) — depends on witness threshold configuration.
- **Step 4** (directory checkpoint signature) — depends on the directory's
  out-of-band-published key, which varies per operator.
- **Step 9** (revocation registry) — surfaces as a `key_revocation_status`
  output field; spec [§1.9](../../../atrib-spec.md#19-key-rotation-and-revocation) conformance corpus covers revocation construction.

The corpus deliberately scopes to step 5 + step 7 because those are the only
ones whose verification reduces to a pure function over fixed bytes.

## Backend

Cases are generated against the reference AKD backend exposed by
`@atrib/directory`:

- **VRF**: `HardCodedAkdVRF` (32-byte deterministic pubkey, declared in
  `manifest.backend.vrf_public_key_b64u`).
- **Configuration**: `WhatsAppV1Configuration`.

Implementations using a different VRF backend or AKD configuration must
regenerate fixtures against their own backend; the wire format
(bincode-serialized proofs + 32-byte roots) is shared across backends but
the contents are configuration-coupled.

## Regenerating

```
pnpm --filter @atrib/log-dev exec tsx scripts/generate-conformance-6.3.ts
```

Re-run when:

- [§6.3](../../../atrib-spec.md#63-verifier-consultation-algorithm) verifier surface changes
- `akd` version bumps and produces different proof bytes
- New cases are added

## Reference test

`packages/directory/test/conformance-6.3.test.ts` decodes each case's
input fields and runs `verifyLookupProof` / `verifyAuditProof` against
the AKD backend, asserting the boolean matches `expected.verifies`. The
reference test catches drift between the corpus and the verifier surface
in the same atrib release.

## Fixture format

```jsonc
{
  "kind": "lookup" | "audit",
  "description": "human-readable summary",
  "input": {
    // Lookup cases
    "vrf_public_key_b64u": "...",
    "root_hash_hex": "...",
    "current_epoch": 1,
    "label": "...",
    "proof_b64u": "...",
    // Audit cases
    "root_hashes_hex": ["...", "..."],
    "proof_b64u": "..."
  },
  "expected": { "verifies": true | false }
}
```
