# `@atrib/verify`

**Independent verification of atrib records and settlement documents. Re-runs the spec [§4.6](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#46-the-calculation-algorithm) calculation algorithm locally and checks the result against what a recommendation document claims. Verifies any signed record against its creator key. No trust in any intermediary required.**

This is the **verifier half** of the atrib protocol, used by merchants closing transactions, auditors checking agent activity, regulators querying historical state, and any party that needs to validate atrib data independently. The agent and tool servers produce signed attribution records. The Merkle log stores them. This package answers the questions any verifier has to answer: _given the graph and the policy, is this distribution actually correct? Was this record actually signed by the key it claims? Did this action actually happen at the time it claims?_

## Quick start

```typescript
import { AtribVerifier } from '@atrib/verify'

const verifier = new AtribVerifier({
  merchantKey: process.env.ATRIB_MERCHANT_KEY, // optional, base64url Ed25519 seed
  graphEndpoint: 'https://graph.atrib.dev/v1', // defaults to atrib.dev endpoints
  logEndpoint: 'https://log.atrib.dev/v1',
})

const result = await verifier.verify(recommendationDoc)
// {
//   valid: true,
//   signatureOk: true,
//   calcMatch: true,
//   distribution: { 'sha256:...': 0.4, 'sha256:...': 0.6 },
//   warnings: [],
//   graph_node_count: 7,
// }
```

`valid === true` means **both** the document's Ed25519 signature verified against the calculator's published key **and** the local recalculation produced the same distribution within `1e-9`. Either failing flips `valid` to `false` and the specific failure is reported in `signatureOk` / `calcMatch` / `warnings` so you know exactly what went wrong.

## What `verify()` actually does (per spec [§5.5.2](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#552-verifying-a-settlement-recommendation))

1. **Resolves the calculator's public key** from `recommendationDoc.calculated_by`. For the well-known `resolve.atrib.dev` service, the key is fetched from the `/pubkey` endpoint. For other calculators, the merchant supplies the key out-of-band.
2. **Verifies the Ed25519 signature** over the JCS-canonicalized recommendation document (excluding the `signature` field).
3. **Fetches the attribution graph** at `recommendationDoc.graph_tree_size` from the configured graph endpoint. Pinning to a specific tree size makes the verification reproducible; the graph is fixed, not "live."
4. **Fetches the session policy record** referenced by `policy_record_id`, or uses the spec [§4.3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#43-the-default-policy) default policy if `policy_record_id === 'default'`.
5. **Re-runs `calculate(graph, policy, sessionPolicyRecord)`** locally; a pure function with no network calls and no randomness.
6. **Compares distributions** using `distributionsMatch()` (within `1e-9` per recipient, accounting for floating-point drift across implementations).

The key invariant per spec [§4.6](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#46-the-calculation-algorithm): any party with the same graph and the same policy MUST get the same distribution. If they don't, either the calculator cheated, the document was tampered with, or one party has a buggy implementation. Either way the merchant should not pay against this document.

## Post-hoc calculation ([§5.5.3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#553-post-hoc-calculation-no-agent-sdk))

If the agent that drove the session was not atrib-aware (no `@atrib/agent` middleware), the merchant can still produce a signed recommendation after the fact, as long as the tools were attributed:

```typescript
const recommendation = await verifier.calculate({
  context_id: 'sess_abc123...',
  policy: 'default', // or a full PolicyDocument
  signWith: 'merchant', // signs with merchantKey if present
})
// → fully-shaped RecommendationDocument, ready to settle against
```

Per the [§5.8](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#58-degradation-contract) degradation contract, this never throws on a missing key; if `signWith === 'merchant'` but `merchantKey` is unset, the document is returned **unsigned** with a warning rather than crashing the merchant pipeline.

## API reference

### `new AtribVerifier(options)`

| Field             | Type     | Default                       | Description                                                             |
| ----------------- | -------- | ----------------------------- | ----------------------------------------------------------------------- |
| `logEndpoint`     | `string` | `https://log.atrib.dev/v1`     | The Merkle log to fetch checkpoints and proofs from.                    |
| `graphEndpoint`   | `string` | `https://graph.atrib.dev/v1`   | The graph query endpoint (spec [§3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#3-graph-query-interface)).                                     |
| `resolveEndpoint` | `string` | `https://resolve.atrib.dev/v1` | Reserved for v2 remote calculation.                                     |
| `merchantKey`     | `string` | unset                         | Base64url Ed25519 32-byte seed. Optional. `verify()` works without it. |

### `verify(doc, options): Promise<VerificationResult>`

Independently re-runs the [§4.6](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#46-the-calculation-algorithm) calculation and verifies the document signature. Always returns a result object; never throws. Inspect `valid`, `signatureOk`, `calcMatch`, and `warnings` to understand the outcome.

This method operates on `RecommendationDocument` shapes (settlement-recommendation flow per spec [§5.5.2](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#552-verify)). When the caller supplies `ap2ViEvidence`, the verifier attaches the async AP2 / VI result as `ap2_vi_evidence`. That block is tiered and does not change the base recommendation signature or calculation checks. For verifying individual `AtribRecord`s, see `verifyRecord` below.

### `verifyRecord(record, options): Promise<RecordVerificationResult>`

Per-record verification. Verifies a single signed record's Ed25519 signature and surfaces per-record annotations defined by spec sections [§1.2.5](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#125-informed_by) ([D041](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d041-informed_by-linking-primitive-and-informed_by-edge-type)), [§1.2.6](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#126-provenance_token) ([D044](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d044-provenance_token-field-for-cross-session-causal-anchoring)), [§6.7](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#67-capability-declarations) ([D051](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d051-capability-scoped-records-via-directory-published-envelopes)), and [§8.4](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#84-coarsened-timing-posture) ([D045](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d045-privacy-postures-normative-spec-section)).

```typescript
import { verifyRecord } from '@atrib/verify'

const result = await verifyRecord(record, {
  upstreamCandidate,         // optional, for provenance_token resolution
  informedByCandidates: [],  // optional, for informed_by[] resolution
  identityClaim,             // optional, for capability_check (caller does directory lookup)
  ap2ViEvidence,             // optional, transaction-only AP2 / VI evidence bundle
  ap2ViEvidenceOptions,      // optional, passed to verifyAp2ViEvidenceAsync()
})
// result: {
//   valid: boolean
//   signatureOk: boolean
//   posture: { timestamp_granularity, timestamp_consistent, timestamp_granularity_explicit }
//   provenance?:              { token, upstream_record_hash, upstream_resolved }
//   informed_by_resolution?:  { resolved: string[], dangling: string[] }
//   capability_check?:        { envelope, in_envelope, mismatches, unresolvable }
//   ap2_vi_evidence?:         Ap2ViEvidenceVerification
//   warnings: string[]
// }
```

**Implemented per-record annotations:**

- `provenance`: `{ token, upstream_record_hash, upstream_resolved }` per session-genesis record carrying `provenance_token` ([D044](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d044-provenance_token-field-for-cross-session-causal-anchoring) / [§1.2.6](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#126-provenance_token)). The 16-byte token truncation is irreversible: `upstream_record_hash` populates only when the caller supplies a candidate whose canonical-form SHA-256[:16] matches the token.
- `informed_by_resolution`: `{ resolved: string[], dangling: string[] }` per record carrying `informed_by` ([D041](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d041-informed_by-linking-primitive-and-informed_by-edge-type) / [§1.2.5](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#125-informed_by)). Dangling references are flagged but do not fail verification: they signal "the verifier has not seen upstream context," not "the record is invalid."
- `posture`: `{ timestamp_granularity, timestamp_consistent, timestamp_granularity_explicit, args_commitment_form, result_commitment_form, tool_name_form }` ([D045](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d045-privacy-postures-normative-spec-section) / [D061](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d061-add-tool_name-args_hash-result_hash-fields-to-§121) / [§8.2](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#82-opaque-name-posture) / [§8.3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#83-salted-commitment-posture) / [§8.4](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#84-coarsened-timing-posture)). Always populated. Surfaces (a) the declared timing granularity, whether the timestamp value structurally matches the spec's trailing-zero invariant, and whether the field was explicitly set vs defaulted; (b) the structurally-detected `args_hash` / `result_hash` commitment scheme: `'salted-sha256'` when `args_salt` / `result_salt` is present, `'plain-sha256'` otherwise (the `'hmac-sha256'` variant from [§8.3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#83-salted-commitment-posture) is signaled out-of-band and is not structurally detectable); and (c) the [§8.2](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#82-opaque-name-posture) `tool_name_form`: `'hashed'` when `tool_name` matches `^sha256:[0-9a-f]{64}$`, `'plain'` for any other present value, `null` when the field is absent. Per [D061](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d061-add-tool_name-args_hash-result_hash-fields-to-121) the [§8.2](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#82-opaque-name-posture) verbatim-vs-opaque distinction is NOT structurally detectable, both surface as `'plain'`.
- `capability_check`: `{ envelope, in_envelope, mismatches, unresolvable }` ([D051](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d051-capability-scoped-records-via-directory-published-envelopes) / [§6.7](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#67-capability-declarations)). Populated only when the caller passes a resolved `identityClaim` in options. Checks the record's `event_type` against the envelope's `event_types` allowlist and the record's `timestamp` against `expires_at`. `tool_names` (against tool_call records), `max_amount`, and `counterparties` (against transaction records) flag `unresolvable: true` because the constraints depend on data not yet on the standard record shape (`tool_name`) or out-of-band protocol events (payment amount + counterparty). Per [§6.7.3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#673-out-of-envelope-records) out-of-envelope is a signal, not invalidation: mismatches do not flip `valid` to false. The caller is responsible for fetching the active envelope at the record's timestamp via `@atrib/directory`'s `lookup()` (or a cached equivalent); `@atrib/verify` intentionally has no `@atrib/directory` dependency.
- `cross_attestation`: `{ signers_count, signers_valid, missing }` ([D052](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records) / [§1.7.6](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#176-cross-attestation-requirement-for-transaction-records)). Populated only on transaction records (`event_type = transaction`). Each entry in `signers[]` is verified against the cross-attestation canonical bytes (JCS form with `signers: []` and the top-level `signature` field omitted, per [§1.7.6](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#176-cross-attestation-requirement-for-transaction-records)). `missing: true` when fewer than 2 signers verify, atrib's normative minimum. Per [§1.7.6](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#176-cross-attestation-requirement-for-transaction-records) missing is a SIGNAL not invalidation: `valid` stays true if the underlying signature path holds. Legacy single-signer transaction records (no `signers[]` array, only top-level `signature`) surface as `signers_count: 0, missing: true` so consumers can flag them while accepting the cryptographic validity.
- `ap2_vi_evidence`: the async AP2 / VI verifier result ([D094](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d094-ap2--vi-evidence-attaches-to-verifier-results-as-a-tiered-block) / [§5.5.4](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#554-ap2--verifiable-intent-evidence-checks)). Populated only when the caller passes `ap2ViEvidence` for a transaction record. It does not alter `valid`, `signatureOk`, or `cross_attestation`; consumers inspect `ap2_vi_evidence.valid` for AP2 authorization evidence.

**Pending per-record annotations** (tracked as a Pending decision in [DECISIONS.md P005](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#p005-reconcile-atribverify-readme-per-record-annotations-with-actual-code-surface)):

- `cross_log_proof_count` / `cross_log_threshold_met` / `cross_log_equivocation_detected` ([D050](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d050-cross-log-replication-for-equivocation-defense) / [§2.11](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#211-cross-log-replication)): requires multi-log proof-bundle parsing and trusted-log-set config.
(Note: `tool_name_form`, `args_commitment_form`, and `result_commitment_form` per [§8.2](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#82-opaque-name-posture)/[§8.3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#83-salted-commitment-posture) are all now implemented under `posture` above. [D061](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d061-add-tool_name-args_hash-result_hash-fields-to-121) added `tool_name`, `args_hash`, and `result_hash` to the [§1.2.1](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#121-field-definitions) canonical record schema, completing the structural inputs.)

Each pending annotation is its own ADR scope when external consumers need it.

### `verifyAp2ViEvidence(...)` and `verifyAp2ViEvidenceAsync(...)`

AP2 / Verifiable Intent evidence checking for merchants and auditors. This runs outside the transaction detector path. It does not alter the graph, the settlement calculation, or record validity. It answers a narrower question: did the AP2 receipts and VI mandate chain form a coherent evidence bundle?

```typescript
import { verifyAp2ViEvidence, verifyAp2ViEvidenceAsync } from '@atrib/verify'

const result = verifyAp2ViEvidence({
  trustedIssuerKeys: [issuerJwk],
  ap2: {
    paymentReceipt,
    checkoutReceipt,
    closedPaymentMandate,
    closedCheckoutMandate,
  },
  vi: {
    credentials: [
      { layer: 'L1', sdJwt: issuerCredential },
      { layer: 'L2', sdJwt: userMandate },
      { layer: 'L3_PAYMENT', sdJwt: agentPaymentMandate, parentPresentation },
      { layer: 'L3_CHECKOUT', sdJwt: agentCheckoutMandate, parentPresentation },
    ],
  },
})
```

Use the async verifier when AP2 receipts arrive as compact signed JWTs:

```typescript
const result = await verifyAp2ViEvidenceAsync(
  {
    receiptJwtIssuers: [
      {
        issuer: 'https://verifier.example',
        audience: 'merchant:checkout',
        metadataUrl: 'https://verifier.example/.well-known/ap2',
      },
    ],
    ap2: {
      paymentReceiptJwt,
      closedPaymentMandate,
    },
  },
  { receiptJwtPolicy: 'require' },
)
```

Checks performed when evidence is present:

- AP2 PaymentReceipt / CheckoutReceipt success, required fields, and `reference` binding to a closed mandate serialization or explicit closed-mandate hash.
- Compact AP2 receipt JWT verification with `jose`, using trusted local JWKS, `jwksUrl`, or verifier metadata containing inline `jwks` or `jwks_uri`.
- VI SD-JWT parsing for L1, L2, L3 payment, and L3 checkout credentials.
- Async VI SD-JWT / SD-JWT VC conformance with OpenWallet `@sd-jwt/core` and `@sd-jwt/sd-jwt-vc`.
- ES256 signatures: L1 via trusted issuer keys, L2 via L1 `cnf.jwk`, L3 via the L2 delegated agent key.
- `sd_hash` links, disclosure digest links, autonomous L2 `cnf.jwk` consistency, and final checkout/payment binding.
- Typed AP2 mandate constraints: merchant allowlists, checkout line items, payment amount ranges, allowed payees, allowed payment instruments, allowed PISPs, and execution windows.

The default signature policy is `require`. Missing keys or invalid signatures make `valid` false while still returning a structured result. Use `signaturePolicy: "best-effort"` for structural triage where issuer keys are not yet available.

The default receipt JWT policy is also `require`. Invalid receipt JWTs make `valid` false. Use `receiptJwtPolicy: "best-effort"` when decoded receipt objects are already available and JWT verification is an advisory signal.

The async verifier also defaults `sdJwtConformancePolicy` to `require` when VI credentials are present. Each credential result includes `sdJwtConformance.status`, `profile`, and an optional reason. Use `sdJwtConformancePolicy: "best-effort"` for advisory conformance checks, or `"off"` to keep the async result aligned with the decoded structural verifier. The default profile is `sd-jwt-vc`; callers may pass `sdJwtConformanceProfile: "sd-jwt"` for the core SD-JWT profile.

VC type metadata and status-list fetches are explicit. If a caller enables `sdJwtVc.loadTypeMetadata` or submits credentials with VC status references, it should provide `sdJwtVc.vctFetcher` or `sdJwtVc.statusListFetcher`. The verifier does not perform hidden network fetches for those checks.

The default constraint policy is `require`. Failed, unresolved, or unsupported disclosed AP2 constraints make `valid` false. Use `constraintPolicy: "best-effort"` to keep those findings advisory, or `"off"` to skip them. The lower-level `evaluateAp2ViConstraints(input, disclosures?)` helper is exported for decoded mandate material and fixture replay.

The local AP2 / VI corpus lives under `packages/agent/test/fixtures/ap2/`. It includes signed immediate evidence, signed autonomous success evidence, a decoded constraint replay case, and a named autonomous negative matrix.

The same evidence bundle can be passed to `verifyRecord(record, { ap2ViEvidence, ap2ViEvidenceOptions })` for transaction records or to `verifier.verify(doc, { ap2ViEvidence, ap2ViEvidenceOptions })` for settlement recommendation verification. Both APIs attach the result as `ap2_vi_evidence`; neither API fetches AP2 / VI material on its own.

### `calculate(options): Promise<RecommendationDocument>`

Post-hoc calculation when no agent SDK was present. Always returns a fully-shaped document, unsigned with a warning if the merchant key is missing.

### Lower-level primitives

For advanced use (custom calculators, alternative signing flows), the package also exports:

- `calculate(graph, policy, sessionPolicyRecord)`: the pure [§4.6](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#46-the-calculation-algorithm) calculation function
- `DEFAULT_POLICY`: the spec [§4.3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#43-the-default-policy) default policy document
- `isValidPolicy(doc)`: schema check for `PolicyDocument`
- `signRecommendation(unsigned, privateKey)`: JCS + Ed25519 signing
- `verifyRecommendationSignature(doc, publicKey)`: signature verification
- `evaluateAp2ViConstraints(input, disclosures?)`: decoded AP2 open-mandate constraint checking
- `verifyAp2ViEvidence(bundle, options?)`: decoded AP2 / VI receipt and mandate-chain evidence checking
- `verifyAp2ViEvidenceAsync(bundle, options?)`: compact AP2 receipt JWT verification, async VI SD-JWT / VC conformance, plus decoded evidence checks. `verifyRecord()` and `AtribVerifier.verify()` call this when supplied with `ap2ViEvidence`
- `recommendationSigningInput(doc)`: the canonical bytes that get signed
- `distributionsMatch(a, b)`: float-tolerant equality (within `1e-9` per recipient)
- `fetchGraph(endpoint, contextId, treeSize?)`, `fetchSessionPolicyRecord`, `fetchPolicyDocument`

## Why pure functions matter

The [§4.6](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#46-the-calculation-algorithm) calculation algorithm is intentionally a **pure function** of `(graph, policy)`:

- **No network calls** during calculation. The graph and policy are fetched up front and then `calculate()` runs in-memory.
- **No timestamps** beyond those already embedded in the records. Two runs an hour apart on the same inputs produce the same output.
- **No randomness**. No "tie-breaker by hash of current time" or anything like that. Ties are broken deterministically per the spec.
- **No floating-point ordering surprises**. The algorithm walks the graph in a deterministic order so two implementations on identical input produce identical output (within `1e-9` for the final distribution shares).

This is what makes verification possible: the merchant's local recalculation is the same code the calculator ran, producing the same output, so any disagreement is a real signal; not implementation drift.

## §5.8 degradation contract

Per the absolute invariant (also enforced in `@atrib/mcp` and `@atrib/agent`), atrib failures never break the host:

- Missing or invalid `merchantKey` → constructor logs `atrib: ...` warning, `merchantPrivateKey = null`, no throw.
- `verify()` errors during signature resolution, graph fetch, or calculation are caught and surfaced as `warnings: string[]` with `valid = false`.
- `calculate({ signWith: 'merchant' })` with a missing key returns an unsigned document plus a warning, rather than throwing.

The merchant's payment pipeline never crashes because of an atrib problem. It just gets `valid: false` and decides what to do with that.

## Test coverage

The test suite covers the [§4.6](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#46-the-calculation-algorithm) calculation algorithm, graph endpoint client, JCS canonicalization, Ed25519 signing, settlement recommendations, policy templates, policy builder, calculation edge cases, property-based testing with fast-check, AP2 / VI evidence checking, tiered AP2 / VI verifier attachment, and full `verify()` / `calculate()` paths including [§5.8](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#58-degradation-contract) degradation.

Run them with `pnpm --filter @atrib/verify test`.

## Spec references

| Spec section | What this package implements                         |
| ------------ | ---------------------------------------------------- |
| [§3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#3-graph-query-interface)           | Graph query interface (client side)                  |
| [§4.3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#43-the-default-policy)         | Default policy document                              |
| [§4.6](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#46-the-calculation-algorithm)         | Pure calculation algorithm                           |
| [§4.7](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#47-settlement-recommendation-document)         | Recommendation document signing/verification         |
| [§5.5](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#55-atribverify-merchant-verification-library)         | `AtribVerifier` class. `verify()` and `calculate()` |
| [§5.5.4](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#554-ap2--verifiable-intent-evidence-checks) | AP2 / VI evidence checks                             |
| [§5.8](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#58-degradation-contract)         | Degradation contract; failures never break the host |

The full protocol spec is at [`atrib-spec.md`](https://github.com/creatornader/atrib/blob/main/atrib-spec.md).

## See also

- [`@atrib/mcp`](https://github.com/creatornader/atrib/blob/main/packages/mcp/README.md), server-side middleware that produces the signed records `verify()` ultimately validates
- [`@atrib/agent`](https://github.com/creatornader/atrib/blob/main/packages/agent/README.md), agent-side interceptor + framework adapters
- [`@atrib/log-dev`](https://github.com/creatornader/atrib/blob/main/packages/log-dev/README.md), development-mode Merkle log stub. Returns placeholder Merkle hashes that **will not pass** strict cryptographic verification, fine for end-to-end shape testing, not for production verification.
- [`packages/integration/examples/end-to-end/`](https://github.com/creatornader/atrib/blob/main/packages/integration/examples/end-to-end/), runnable demo wiring everything together
- [`DECISIONS.md`](https://github.com/creatornader/atrib/blob/main/DECISIONS.md), architectural decision log

---

> **A note on documentation links.** The atrib protocol repository is currently private (in-progress public preparation). Links in this README to the spec and sister packages (`atrib-spec.md`, `packages/agent/README.md`, etc.) point at `github.com/creatornader/atrib/blob/main/...` URLs that will resolve once the repository goes public. Until then, see [`atrib.dev`](https://atrib.dev) for the protocol overview.
