# `@atrib/verify`

**Independent verification for atrib's verifiable action layer. Checks signed records, evidence blocks, handoff packets, and settlement documents. Re-runs the spec [§4.6](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#46-the-calculation-algorithm) calculation algorithm locally and checks the result against what a recommendation document claims. No trust in any intermediary required.**

This is the **verifier half** of the atrib protocol, used by merchants closing transactions, auditors checking agent activity, teams accepting handoffs, policy systems reviewing high-impact actions, regulators querying historical state, and any party that needs to validate atrib data independently. The agent and tool servers produce signed attribution records. The Merkle log stores them. This package answers the questions any verifier has to answer: _given the graph and the policy, is this distribution actually correct? Was this record actually signed by the key it claims? Did this action actually happen at the time it claims?_

## Install

```bash
pnpm add @atrib/verify
```

Verify a local build with `pnpm --filter @atrib/verify test`.

## Quick start

```typescript
import { AtribVerifier } from '@atrib/verify'

const verifier = new AtribVerifier({
  merchantKey: process.env.ATRIB_MERCHANT_KEY, // optional, base64url Ed25519 seed
  graphEndpoint: 'https://graph.atrib.dev/v1', // defaults to atrib.dev endpoints
  logEndpoint: 'https://log.atrib.dev/v1',
})

// recommendationDoc is a §4.7 settlement RecommendationDocument produced by a
// calculator or merchant (signed distribution over record hashes).
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

| Field             | Type     | Default                        | Description                                                                                                                  |
| ----------------- | -------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `logEndpoint`     | `string` | `https://log.atrib.dev/v1`     | The Merkle log to fetch checkpoints and proofs from.                                                                         |
| `graphEndpoint`   | `string` | `https://graph.atrib.dev/v1`   | The graph query endpoint (spec [§3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#3-graph-query-interface)). |
| `resolveEndpoint` | `string` | `https://resolve.atrib.dev/v1` | Reserved for v2 remote calculation.                                                                                          |
| `merchantKey`     | `string` | unset                          | Base64url Ed25519 32-byte seed. Optional. `verify()` works without it.                                                       |

### `verify(doc, options): Promise<VerificationResult>`

Independently re-runs the [§4.6](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#46-the-calculation-algorithm) calculation and verifies the document signature. Always returns a result object; never throws. Inspect `valid`, `signatureOk`, `calcMatch`, and `warnings` to understand the outcome.

This method operates on `RecommendationDocument` shapes (settlement-recommendation flow per spec [§5.5.2](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#552-verify)). When the caller supplies `ap2ViEvidence`, the verifier attaches the async AP2 / VI result as `ap2_vi_evidence`. That block is tiered and does not change the base recommendation signature or calculation checks. For verifying individual `AtribRecord`s, see `verifyRecord` below.

### `verifyRecord(record, options): Promise<RecordVerificationResult>`

Per-record verification. Verifies a single signed record's Ed25519 signature and surfaces per-record annotations defined by spec sections [§1.2.5](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#125-informed_by) ([D041](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d041-informed_by-linking-primitive-and-informed_by-edge-type)), [§1.2.6](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#126-provenance_token) ([D044](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d044-provenance_token-field-for-cross-session-causal-anchoring)), [§6.7](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#67-capability-declarations) ([D051](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d051-capability-scoped-records-via-directory-published-envelopes)), and [§8.4](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#84-coarsened-timing-posture) ([D045](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d045-privacy-postures-normative-spec-section)).

```typescript
import { verifyRecord } from '@atrib/verify'

const result = await verifyRecord(record, {
  upstreamCandidate, // optional, for provenance_token resolution
  informedByCandidates: [], // optional, for informed_by[] resolution
  identityClaim, // optional, for capability_check (caller does directory lookup)
  resolvedFacts, // optional, caller-resolved facts for capability_check
  authorizationEvidence, // optional, OAuth/MCP, AAuth, or x401 evidence blocks
  ap2ViEvidence, // optional, transaction-only AP2 / VI evidence bundle
  ap2ViEvidenceOptions, // optional, passed to verifyAp2ViEvidenceAsync()
  trustedCreatorKeys, // optional, trusted transaction signer keys
  delegationCertificates, // optional, certificates for the §1.11 walk
  proofBundle, // optional, post-signing anchor proofs for this record
  anchorTrust, // required with proofBundle; caller-owned anchor trust policy
})
// result: {
//   valid: boolean
//   signatureOk: boolean
//   posture: { timestamp_granularity, timestamp_consistent, timestamp_granularity_explicit }
//   provenance?:              { token, upstream_record_hash, upstream_resolved }
//   informed_by_resolution?:  { resolved: string[], dangling: string[] }
//   capability_check?:        { envelope, in_envelope, mismatches, unresolvable }
//   evidence?:                EvidenceVerificationBlock[]
//   ap2_vi_evidence?:         Ap2ViEvidenceVerification
//   cross_attestation?:       CrossAttestationAnnotation
//   delegation?:              DelegationOutcome
//   anchor_plurality?:        AnchorPluralityVerdict
//   warnings: string[]
// }
```

**Implemented per-record annotations:**

- `provenance`: `{ token, upstream_record_hash, upstream_resolved }` per session-genesis record carrying `provenance_token` ([D044](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d044-provenance_token-field-for-cross-session-causal-anchoring) / [§1.2.6](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#126-provenance_token)). The 16-byte token truncation is irreversible: `upstream_record_hash` populates only when the caller supplies a candidate whose canonical-form SHA-256[:16] matches the token.
- `informed_by_resolution`: `{ resolved: string[], dangling: string[] }` per record carrying `informed_by` ([D041](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d041-informed_by-linking-primitive-and-informed_by-edge-type) / [§1.2.5](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#125-informed_by)). Dangling references are flagged but do not fail verification: they signal "the verifier has not seen upstream context," not "the record is invalid."
- `posture`: `{ timestamp_granularity, timestamp_consistent, timestamp_granularity_explicit, args_commitment_form, result_commitment_form, tool_name_form }` ([D045](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d045-privacy-postures-normative-spec-section) / [D061](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d061-add-tool_name-args_hash-result_hash-fields-to-§121) / [§8.2](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#82-opaque-name-posture) / [§8.3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#83-salted-commitment-posture) / [§8.4](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#84-coarsened-timing-posture)). Always populated. Surfaces (a) the declared timing granularity, whether the timestamp value structurally matches the spec's trailing-zero invariant, and whether the field was explicitly set vs defaulted; (b) the structurally-detected `args_hash` / `result_hash` commitment scheme: `'salted-sha256'` when `args_salt` / `result_salt` is present, `'plain-sha256'` otherwise (the `'hmac-sha256'` variant from [§8.3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#83-salted-commitment-posture) is signaled out-of-band and is not structurally detectable); and (c) the [§8.2](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#82-opaque-name-posture) `tool_name_form`: `'hashed'` when `tool_name` matches `^sha256:[0-9a-f]{64}$`, `'plain'` for any other present value, `null` when the field is absent. Per [D061](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d061-add-tool_name-args_hash-result_hash-fields-to-121) the [§8.2](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#82-opaque-name-posture) verbatim-vs-opaque distinction is NOT structurally detectable, both surface as `'plain'`.
- `capability_check`: `{ envelope, in_envelope, mismatches, unresolvable }` ([D051](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d051-capability-scoped-records-via-directory-published-envelopes) / [§6.7](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#67-capability-declarations)). Populated only when the caller passes a resolved `identityClaim` in options. Checks the record's `event_type` against the envelope's `event_types` allowlist and the record's `timestamp` against `expires_at`. `tool_names`, `max_amount`, and `counterparties` are checked when the caller supplies `resolvedFacts` from the local body or protocol event. Missing facts flag `unresolvable: true` rather than passing silently. Per [§6.7.3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#673-out-of-envelope-records) out-of-envelope is a signal, not invalidation: mismatches do not flip `valid` to false. The caller is responsible for fetching the active envelope at the record's timestamp via `@atrib/directory`'s `lookup()` (or a cached equivalent); `@atrib/verify` intentionally has no `@atrib/directory` dependency.
- `cross_attestation`: `{ signers_count, signers_valid, missing }` ([D052](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records) / [§1.7.6](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#176-cross-attestation-requirement-for-transaction-records)). Populated only on transaction records (`event_type = transaction`). Each entry in `signers[]` is verified against the cross-attestation canonical bytes (JCS form with `signers: []` and the top-level `signature` field omitted, per [§1.7.6](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#176-cross-attestation-requirement-for-transaction-records)). `signatureOk` requires a valid signer entry whose `creator_key` matches the record's top-level `creator_key`; unrelated counterparty signers do not validate the record on behalf of its creator. `missing: true` when fewer than 2 distinct signer keys verify, atrib's normative minimum. Duplicate entries from one key do not inflate `signers_valid`. Per [§1.7.6](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#176-cross-attestation-requirement-for-transaction-records) missing is a signal, not invalidation: `valid` stays true if the underlying signature path holds. Agent-side Path 2 fallback records usually surface as `signers_count: 1, missing: true` until a counterparty signs the same bytes. Legacy single-signer transaction records (no `signers[]` array, only top-level `signature`) surface as `signers_count: 0, missing: true` so consumers can flag them while accepting the cryptographic validity.
  - Trusted signer composition ([D149](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d149-cross-attestation-composes-with-a-trust-set-for-sybil-resistance) / [§1.7.6](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#176-cross-attestation-requirement-for-transaction-records)): pass `trustedCreatorKeys` to `verifyRecord` and the annotation additionally carries `signers_trusted` (distinct verified keys that are in the trust set) and `sybil_suspected` (`signers_valid >= 2` but `signers_trusted < 2`, e.g. two untrusted keys signing the same bytes). `signers_valid` counts verified keys, not trusted ones, so a consumer requiring non-malleable authority MUST gate on the exported `isTrustedCrossAttested(annotation)` (i.e. `signers_trusted >= 2`), not on `signers_valid >= 2` alone. `trust_evaluated` is always present on transaction cross_attestation: `false` is a loud signal that no trust set was supplied and only the trust-blind count was computed, so a consumer gating an action can tell the trust check was skipped. `signers_trusted` / `sybil_suspected` are omitted until a trust set is passed, and, like `missing`, are a signal that never flips `valid`.
- `delegation`: the §1.11.4 certificate walk. Pass `delegationCertificates` and, when available, the context genesis record and revoked-key set. The result identifies a principal at depth one, certificate validity, window and context facts, scope facts, revocation, ambiguity, and unresolved commitments. It never changes signature validity.
- `anchor_plurality`: the D138 §2.11 result. Pass both `proofBundle` and `anchorTrust`. The result reports verified, pending, malformed, and independent anchor counts, plurality and single-anchor tier facts, and cross-log hard-rejection facts. The bundle must commit to the record's canonical hash. A missing paired option, a mismatched bundle, or a hard anchor rejection adds a warning.

- `resolveAttestationCorroboration(options)` / `isCorroborated(result, N)` ([D150](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d150-attestation-is-corroboration-generalized-off-transactions-extension-first) / [§8.7.6](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#876-attestation-corroboration-extension)): the general form of Layer 5 corroboration, lifted off transactions. An attestation is a separate signed extension-URI record (`https://atrib.dev/v1/extensions/attestation`) in which a signer that is NOT the target's producer vouches for a target record by reference, content `{ attests: 'reliable', target, reason? }` committed via `args_hash`. `resolveAttestationCorroboration` aggregates distinct verified attestors of a target and, reusing the [D149](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d149-cross-attestation-composes-with-a-trust-set-for-sybil-resistance) trust-set model, surfaces `attestors_valid` / `attestors_trusted` / `under_corroborated` / `trust_evaluated`. It counts ONLY `attests: 'reliable'` records (never annotation records) and rejects self-attestation, so recall-tagging cannot masquerade as trust. `isCorroborated(result, N)` (`attestors_trusted >= N`, default 2) is the guarded gate. Signal only: never flips `valid`; the fail-closed requirement lives in `@atrib/action-gate` `requireCorroborated`.
- `evidence`: generic tiered external authorization evidence blocks ([D109](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d109-mcpoauth-authorization-evidence-uses-generic-tiered-evidence-blocks) / [§5.5.6](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#556-generic-authorization-evidence-blocks)). Populated when the caller passes `authorizationEvidence` or when AP2 / VI evidence is mirrored into the generic shape. Each block has `{ valid, protocol, issuer, subject, scope, attenuation_ok, delegation_ok, constraints, errors, warnings }`. Current authorization adapters are MCP/OAuth, AAuth, and x401. These blocks do not alter `valid`, `signatureOk`, or `capability_check`.
- `ap2_vi_evidence`: the async AP2 / VI verifier result ([D094](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d094-ap2--vi-evidence-attaches-to-verifier-results-as-a-tiered-block) / [§5.5.4](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#554-ap2--verifiable-intent-evidence-checks)). Populated only when the caller passes `ap2ViEvidence` for a transaction record. It does not alter `valid`, `signatureOk`, or `cross_attestation`; consumers inspect `ap2_vi_evidence.valid` for AP2 authorization evidence.

### `verifyHandoffClaims(claims, options): Promise<HandoffVerificationResult>`

Verifier-side Pattern 3 handoff acceptance. Use this when one agent receives another agent's `record_hash` claim and needs to verify the supplied record, private body material, and proof before signing its own `informed_by` follow-up.

```typescript
import { handoffClaimsFromEvidencePacket, verifyHandoffClaims } from '@atrib/verify'

const claims = handoffClaimsFromEvidencePacket({
  required_record_hashes: [record_hash],
  records: [
    {
      record_hash,
      record,
      proof,
      _local: { content: body },
    },
  ],
})

const handoff = await verifyHandoffClaims(claims, {
  trusted_creator_keys: [agentAPublicKey],
  allowed_context_ids: [expectedContextId],
  require_body: true,
  require_body_commitment: true,
  require_log_inclusion: true,
  log_public_key: logPublicKey,
  max_age_ms: 60_000,
})

if (handoff.all_accepted) {
  const informedBy = handoff.accepted_record_hashes
  // Sign the receiving agent's next record with informed_by: informedBy.
}
```

Checks performed:

- Record hash binding: supplied record hash must equal the claimed `record_hash`.
- Signature: `verifyRecord()` must accept the signed record.
- Trust set: `creator_key` must be in `trusted_creator_keys` when supplied.
- Context policy: `context_id` must be in `allowed_context_ids` when supplied.
- Freshness: record timestamp must be within `max_age_ms` when supplied.
- Body commitments: supplied `body`, `args`, or `result` must match `args_hash` / `result_hash` when required.
- Log proof: supplied proof must bind to the serialized log entry for that record, verify the inclusion path, and verify the C2SP checkpoint signature when `log_public_key` is supplied.

`handoffClaimsFromEvidencePacket()` accepts parsed [D062](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d062-local-mirror-sidecar--two-tier-private-local--public-canonical-persistence) local mirror envelopes, private continuation packets, or arrays of evidence entries. It preserves missing required hashes as verifier rejections. The helper never fetches private material. Callers provide records, body material, and proof bundles from a local mirror, private handoff packet, Record Body Archive Layer, log lookup, or another channel. Rejected claims carry named reasons such as `wrong_signer`, `wrong_context`, `stale`, `body_hash_mismatch`, and `proof_invalid`.

The library helper backs the `@atrib/verify-mcp` `atrib-verify` primitive promoted by [D106](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d106-verify-is-promoted-to-cognitive-primitive-7). The MCP wrapper handles agent-facing use; this package remains the verifier library.

### `verifyOAuthAuthorizationEvidence(evidence): Promise<OAuthAuthorizationEvidenceVerification>`

Verifier-side OAuth / MCP authorization evidence checking. This runs outside the record signature path and does not fetch tokens, mint credentials, call token-introspection endpoints, or contact authorization servers. Callers supply a compact access-token JWT plus trusted JWKS, caller-verified claims, or a caller-supplied OAuth token-introspection response from a path they control. Hosts that want a library helper for the live step can call `introspectOAuthToken()` first, then pass its result into `verifyRecord()`.

```typescript
import { verifyRecord } from '@atrib/verify'

const result = await verifyRecord(record, {
  authorizationEvidence: [
    {
      protocol: 'mcp_oauth',
      accessTokenJwt,
      jwks: [issuerJwk],
      issuer: 'https://auth.example',
      audience: 'https://mcp.example/mcp',
      protectedResourceMetadata: {
        resource: 'https://mcp.example/mcp',
        authorization_servers: ['https://auth.example'],
      },
      requiredScopes: ['files:read'],
      expectedClientId: 'https://client.example/client.json',
    },
  ],
})
```

For opaque access tokens, keep live network policy at the host boundary:

```typescript
import {
  introspectOAuthToken,
  oauthEvidenceFromIntrospectionResult,
  verifyRecord,
} from '@atrib/verify'

const introspection = await introspectOAuthToken({
  endpoint: 'https://auth.example/oauth/introspect',
  token: opaqueAccessToken,
  clientAuthentication: {
    method: 'basic',
    clientId: process.env.OAUTH_CLIENT_ID ?? '',
    clientSecret: process.env.OAUTH_CLIENT_SECRET ?? '',
  },
  expectedIssuer: 'https://auth.example',
  expectedAudience: 'https://mcp.example/mcp',
})

const result = await verifyRecord(record, {
  authorizationEvidence: [
    oauthEvidenceFromIntrospectionResult(introspection, {
      protocol: 'mcp_oauth',
      requiredScopes: ['files:read'],
    }),
  ],
})
```

Checks performed when evidence is present:

- JWT signature, `iss`, `aud`, `exp`, `nbf`, and clock-skew checks when `accessTokenJwt` and `jwks` are supplied.
- MCP protected-resource binding through `aud`, token `resource`, and protected-resource metadata.
- Required OAuth scopes from `scope` or `scp`.
- Optional RFC 9396-style `authorization_details` constraints by `type`, `actions`, and `locations`.
- Optional `client_id`, subject, actor subject, and `cnf.jkt` checks.
- Optional DPoP proof checks for `htm`, `htu`, `ath`, `jti`, `iat`, nonce when supplied, and `cnf.jkt` binding.

The default signature policy is `require`. Missing trusted keys or unverified decoded claims make the evidence block invalid. Use `signaturePolicy: "best-effort"` only for advisory triage. DPoP replay state stays caller-owned: pass `seenJtis` for one-process checks, `MemoryDpopReplayCache` for one-process services, or `createFetchDpopReplayCache()` when a deployment exposes a shared atomic replay-cache endpoint. A Cloudflare Worker and Durable Object reference for the HTTP replay-cache endpoint and host-owned introspection proxy lives at [`packages/integration/examples/cloudflare-agents/oauth-evidence-infra/`](https://github.com/creatornader/atrib/blob/main/packages/integration/examples/cloudflare-agents/oauth-evidence-infra/).

```typescript
import { createFetchDpopReplayCache, verifyRecord } from '@atrib/verify'

const dpopReplayCache = createFetchDpopReplayCache({
  endpoint: 'https://replay-cache.example.com/v1/dpop/check',
  headers: { Authorization: `Bearer ${process.env.REPLAY_CACHE_TOKEN}` },
})

const result = await verifyRecord(record, {
  authorizationEvidence: [
    {
      protocol: 'mcp_oauth',
      claims,
      claimsVerified: true,
      dpopProof,
      dpopReplayCache,
    },
  ],
})
```

The shared endpoint must atomically remember the posted key until `expires_at_seconds` and return `{ "accepted": true }` for a new proof or `{ "accepted": false }` for replay. The storage backend can be Redis, Durable Objects, Postgres, or another compare-and-set primitive owned by the host.

Producer-side MCP capture lives in `@atrib/mcp` behind the opt-in `authorizationEvidence` option. The producer writes evidence into the local-only sidecar without storing raw bearer tokens by default. Verifiers can pass that sidecar's `authorizationEvidence` and `resolvedFacts` to `verifyRecord()`.

### `verifyX401AuthorizationEvidence(evidence): X401AuthorizationEvidenceVerification`

Verifier-side x401 proof evidence checking. This runs outside the record signature path and does not verify OpenID4VP credentials, fetch remote credential results, call issuers, exchange OAuth tokens, or mint verification tokens. Callers supply decoded x401 objects or base64url JSON header values, then pass `resultVerified: true` or `tokenVerified: true` only after their own credential or token verifier accepts the result.

```typescript
import { encodeX401HeaderObject, verifyRecord } from '@atrib/verify'

const result = await verifyRecord(record, {
  authorizationEvidence: [
    {
      protocol: 'x401',
      x401: {
        headers: {
          'PROOF-REQUEST': encodeX401HeaderObject(proofRequest),
          'PROOF-RESPONSE': encodeX401HeaderObject(resultArtifact),
        },
        resultVerified: true,
        expectedRequestId: 'proof-template-financial-customer-v1',
        expectedAgentId: 'did:web:agent.example',
        expectedAgentOrigin: 'https://agent.example/origin',
        agentOrigin: 'https://agent.example/origin',
        agentOriginVerified: true,
        issuerTrustVerified: true,
        issuerTrustRootType: 'proof-trust-list',
        issuerTrustRootRef: 'https://trust.example/x401.json',
        proofPaymentBindingVerified: true,
        proofPaymentBindingRef: 'ap2-receipt:checkout-123',
        requiredSatisfiedRequirements: ['kyc:basic'],
      },
    },
  ],
})
```

Checks performed when evidence is present:

- x401 envelope, version, `credential_requirements.digital.requests[]`, and OAuth token endpoint.
- Request id and result-artifact binding when both are present.
- Visible OpenID4VP nonce from the credential request.
- Result artifact or x401 token object shape.
- Optional agent id, credential protocol, and satisfied requirement ids.
- Optional caller-owned agent-origin, issuer-trust, and proof-payment binding verifier facts.
- `PROOF-RESULT` error objects.
- Payment separation: x401 `payment` hints are reported as informational and do not satisfy x402, MPP, AP2, ACP, or UCP.

The default verification policy is `require`. A decoded proof response without `resultVerified: true` or `tokenVerified: true` is invalid, because parsing a header is not credential verification. Use `verificationPolicy: "best-effort"` for advisory review or `"off"` when another layer has already enforced the requirement. Optional agent-origin, issuer-trust, and proof-payment binding fields record caller-owned verifier outcomes. Explicit `false` values fail the evidence block. References are hashed in public details. Older draft names such as `PROOF-REQUIRED`, `PROOF-PRESENTATION`, and `presentation_requirements` are accepted with warnings by default; set `allowLegacyHeaders: false` or `allowLegacyFields: false` to reject them.

The returned `details` object is safe for archive projection and Explorer rendering by default. It exposes proof request, response, and result hashes, `proof_gate` status, `payment_separation`, hashed origin, trust-root, and proof-payment binding references, the visible request id, visible nonce, agent id, credential protocol, and whether a `credential_result_uri` was present. It does not expose raw credential payloads, raw proof-response header values, raw verification tokens, trust-list documents, proof-payment binding documents, or fetched result-by-reference bodies.

The offline x401 corpus lives at [`spec/conformance/5.5.6/x401/`](https://github.com/creatornader/atrib/blob/main/spec/conformance/5.5.6/x401/). It covers current headers, result artifacts, token responses, result-by-reference, request-id mismatch, proof-result errors, unverified proof failures, legacy-header strict mode, payment-hint separation, external origin facts, issuer-trust facts, and proof-payment binding facts.

### `verifyAAuthAuthorizationEvidence(evidence): Promise<AAuthAuthorizationEvidenceVerification>`

Verifier-side AAuth authorization evidence checking. This runs outside the record signature path and does not fetch AAuth metadata, fetch JWKS, mint tokens, call a PS, call an AS, or perform user interaction. Callers supply a compact AAuth JWT plus trusted JWKS, caller-verified claims, or decoded claims under an explicit `signaturePolicy`.

```typescript
import { verifyRecord } from '@atrib/verify'

const result = await verifyRecord(record, {
  authorizationEvidence: [
    {
      protocol: 'aauth',
      tokenKind: 'auth_token',
      accessMode: 'auth-token',
      tokenJwt: authTokenJwt,
      jwks: [issuerJwk],
      issuer: 'https://ps.example',
      audience: 'https://api.example',
      resource: 'https://api.example',
      requiredScopes: ['files:read'],
      expectedAgent: 'aauth:researcher@example.com',
      expectedActSubject: 'aauth:researcher@example.com',
      httpSignature: {
        verified: true,
        scheme: 'jwt',
        coveredComponents: ['@method', '@authority', '@path', 'signature-key'],
        signingKeyJkt,
      },
    },
  ],
})
```

Checks performed when evidence is present:

- AAuth JWT type (`aa-agent+jwt`, `aa-resource+jwt`, or `aa-auth+jwt`), signature, `iss`, `aud`, `exp`, `iat`, and clock-skew checks when `tokenJwt` and `jwks` are supplied.
- Resource binding through `aud`, token `resource`, and caller-supplied `aauth-resource.json` facts such as `access_mode`.
- Required scopes from the token `scope` claim.
- Agent, subject, `parent_agent`, `act.sub`, and mission reference checks.
- HTTP Message Signature evidence: caller-verified signature status, covered components, `Authorization` coverage for `AAuth-Access`, and signing-key binding through `cnf.jwk` / `agent_jkt`.
- Optional R3 document hash checks when the caller supplies R3 evidence.

The default signature policy is `require`. Missing trusted keys or unverified decoded claims make the evidence block invalid. Use `signaturePolicy: "best-effort"` or `"off"` only for advisory review where the caller has already made its own trust decision. The offline corpus for this adapter lives at [`spec/conformance/5.5.6/aauth/`](https://github.com/creatornader/atrib/blob/main/spec/conformance/5.5.6/aauth/).

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
- Receipt JWT hardening for unsupported `alg`, `alg: "none"`, missing `kid`, unexpected `crit`, malformed compact JWTs, unsupported JWKS keys, duplicate `kid`, metadata precedence, issuer key isolation, and clock-edge behavior.
- VI SD-JWT parsing for L1, L2, L3 payment, and L3 checkout credentials.
- Async VI SD-JWT / SD-JWT VC conformance with OpenWallet `@sd-jwt/core` and `@sd-jwt/sd-jwt-vc`.
- VI SD-JWT structural checks for duplicate disclosures, duplicate digest references, unused disclosures, unsupported `_sd_alg`, and future `nbf`.
- ES256 signatures: L1 via trusted issuer keys, L2 via L1 `cnf.jwk`, L3 via the L2 delegated agent key.
- `sd_hash` links, disclosure digest links, autonomous L2 `cnf.jwk` consistency, and final checkout/payment binding.
- Typed AP2 mandate constraints: merchant allowlists, checkout line items, payment amount ranges, allowed payees, allowed payment instruments, allowed PISPs, execution windows, and `payment.reference`.

The default signature policy is `require`. Missing keys or invalid signatures make `valid` false while still returning a structured result. Use `signaturePolicy: "best-effort"` for structural triage where issuer keys are not yet available.

The default receipt JWT policy is also `require`. Invalid receipt JWTs make `valid` false. Use `receiptJwtPolicy: "best-effort"` when decoded receipt objects are already available and JWT verification is an advisory signal.

The async verifier also defaults `sdJwtConformancePolicy` to `require` when VI credentials are present. Each credential result includes `sdJwtConformance.status`, `profile`, and an optional reason. Use `sdJwtConformancePolicy: "best-effort"` for advisory conformance checks, or `"off"` to keep the async result aligned with the decoded structural verifier. The default profile is `sd-jwt-vc`; callers may pass `sdJwtConformanceProfile: "sd-jwt"` for the core SD-JWT profile.

VC type metadata and status-list fetches are explicit. If a caller enables `sdJwtVc.loadTypeMetadata` or submits credentials with VC status references, it should provide `sdJwtVc.vctFetcher` or `sdJwtVc.statusListFetcher`. The verifier does not perform hidden network fetches for those checks.

The default constraint policy is `require`. Failed, unresolved, or unsupported disclosed AP2 constraints make `valid` false. Use `constraintPolicy: "best-effort"` to keep those findings advisory, or `"off"` to skip them. The lower-level `evaluateAp2ViConstraints(input, disclosures?)` helper is exported for decoded mandate material and fixture replay.

Checkout line-item checks accept both atrib's decoded `line_items[]` fixture shape and VI checkout JWT payloads that carry purchased products under `cart.items[].sku`. `payment.reference` is evaluated against the open checkout mandate disclosure digest and the same final checkout-payment binding surfaced as `checkoutPaymentBindingOk`.

The local AP2 / VI evidence corpus lives under `packages/agent/test/fixtures/ap2/`. It includes signed immediate evidence, signed autonomous success evidence, a decoded constraint replay case, and a named autonomous negative matrix. The integration package also carries upstream-generated AP2 / VI artifacts under `packages/integration/test/fixtures/ap2-vi-reference/`. The crypto conformance corpus lives under `spec/conformance/ap2-vi-crypto/`. It pins offline JOSE, JWKS, metadata, SD-JWT, and clock-edge cases for the async verifier.

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
- `verifyAuthorizationEvidence(evidence)`: generic external authorization evidence dispatch for `verifyRecord()` evidence blocks
- `verifyOAuthAuthorizationEvidence(evidence)`: OAuth / MCP authorization evidence checks for access-token JWTs or caller-verified claims
- `verifyAAuthAuthorizationEvidence(evidence)`: AAuth authorization evidence checks for agent, resource, and auth tokens plus caller-verified HTTP signature facts
- `verifyX401AuthorizationEvidence(evidence)`: x401 proof evidence checks for proof request, proof response, proof result, and caller-verified proof outcomes
- `encodeX401HeaderObject(value)` / `decodeX401HeaderObject(value)`: base64url JSON helpers for x401 proof headers
- `introspectOAuthToken(options)`: host-owned OAuth token introspection helper for opaque-token evidence
- `oauthEvidenceFromIntrospectionResult(result, base?)`: adapter from host-owned introspection result to OAuth evidence input
- `createFetchDpopReplayCache(options)`: HTTP-backed DPoP replay-cache adapter for fleet-shared replay checks
- `MemoryDpopReplayCache`: in-process implementation of the `DpopReplayCache` contract for tests and single-worker deployments
- `verifyHandoffClaims(claims, options?)`: Pattern 3 handoff claim acceptance before a receiving agent signs an `informed_by` follow-up
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

- Missing or invalid `merchantKey` → constructor logs an `atrib: ...` warning, sets `merchantPrivateKey = null`, and does not throw.
- `verify()` errors during signature resolution, graph fetch, or calculation are caught and surfaced as `warnings: string[]` with `valid = false`.
- `calculate({ signWith: 'merchant' })` with a missing key returns an unsigned document plus a warning, rather than throwing.

The merchant's payment pipeline never crashes because of an atrib problem. It just gets `valid: false` and decides what to do with that.

## Test coverage

The test suite covers the [§4.6](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#46-the-calculation-algorithm) calculation algorithm, graph endpoint client, JCS canonicalization, Ed25519 signing, settlement recommendations, policy templates, policy builder, calculation edge cases, property-based testing with fast-check, AP2 / VI evidence checking, AP2 / VI crypto conformance, x401 proof evidence checking, x401 authorization evidence conformance, tiered AP2 / VI verifier attachment, and full `verify()` / `calculate()` paths including [§5.8](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#58-degradation-contract) degradation.

Run them with `pnpm --filter @atrib/verify test`.

## Spec references

| Spec section                                                                                                       | What this package implements                        |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| [§3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#3-graph-query-interface)                        | Graph query interface (client side)                 |
| [§4.3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#43-the-default-policy)                        | Default policy document                             |
| [§4.6](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#46-the-calculation-algorithm)                 | Pure calculation algorithm                          |
| [§4.7](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#47-settlement-recommendation-document)        | Recommendation document signing/verification        |
| [§5.5](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#55-atribverify-merchant-verification-library) | `AtribVerifier` class. `verify()` and `calculate()` |
| [§5.5.4](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#554-ap2--verifiable-intent-evidence-checks) | AP2 / VI evidence checks                            |
| [§5.8](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#58-degradation-contract)                      | Degradation contract; failures never break the host |

The full protocol spec is at [`atrib-spec.md`](https://github.com/creatornader/atrib/blob/main/atrib-spec.md).

## See also

- [`@atrib/mcp`](https://github.com/creatornader/atrib/blob/main/packages/mcp/README.md), server-side middleware that produces the signed records `verify()` ultimately validates
- [`@atrib/agent`](https://github.com/creatornader/atrib/blob/main/packages/agent/README.md), agent-side interceptor + framework adapters
- [`@atrib/log-dev`](https://github.com/creatornader/atrib/blob/main/packages/log-dev/README.md), development-mode Merkle log stub. Returns placeholder Merkle hashes that **will not pass** strict cryptographic verification, fine for end-to-end shape testing, not for production verification.
- [`packages/integration/examples/end-to-end/`](https://github.com/creatornader/atrib/blob/main/packages/integration/examples/end-to-end/), runnable demo wiring everything together
- [`DECISIONS.md`](https://github.com/creatornader/atrib/blob/main/DECISIONS.md), architectural decision log

---

> **A note on documentation links.** The atrib protocol repository is currently private (in-progress public preparation). Links in this README to the spec and sister packages (`atrib-spec.md`, `packages/agent/README.md`, etc.) point at `github.com/creatornader/atrib/blob/main/...` URLs that will resolve once the repository goes public. Until then, see [`atrib.dev`](https://atrib.dev) for the protocol overview.

## Part of atrib

atrib is an open protocol for verifiable agent actions. Every action becomes a signed, chain-linked record that anyone can verify against a public Merkle log, with no operator to trust. This package is one entrypoint. See the [full package family](https://github.com/creatornader/atrib#packages) and the [protocol spec](https://github.com/creatornader/atrib/blob/main/atrib-spec.md).
