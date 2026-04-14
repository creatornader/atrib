# `@atrib/verify`

**Independent merchant-side verification of atrib settlement recommendations. Re-runs the spec §4.6 calculation algorithm locally and checks the result against what a recommendation document claims. No trust in any intermediary required.**

This is the **merchant/auditor half** of the atrib protocol. The agent and tool servers produce signed attribution records. The Merkle log stores them. This package answers the question every merchant has to answer before paying anyone: _given the graph and the policy, is this distribution actually correct?_

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

## What `verify()` actually does (per spec §5.5.2)

1. **Resolves the calculator's public key** from `recommendationDoc.calculated_by`. For the well-known `resolve.atrib.dev` service, the key is fetched from the `/pubkey` endpoint. For other calculators, the merchant supplies the key out-of-band.
2. **Verifies the Ed25519 signature** over the JCS-canonicalized recommendation document (excluding the `signature` field).
3. **Fetches the attribution graph** at `recommendationDoc.graph_tree_size` from the configured graph endpoint. Pinning to a specific tree size makes the verification reproducible — the graph is fixed, not "live."
4. **Fetches the session policy record** referenced by `policy_record_id`, or uses the spec §4.3 default policy if `policy_record_id === 'default'`.
5. **Re-runs `calculate(graph, policy, sessionPolicyRecord)`** locally — a pure function with no network calls and no randomness.
6. **Compares distributions** using `distributionsMatch()` (within `1e-9` per recipient, accounting for floating-point drift across implementations).

The key invariant per spec §4.6: any party with the same graph and the same policy MUST get the same distribution. If they don't, either the calculator cheated, the document was tampered with, or one party has a buggy implementation. Either way the merchant should not pay against this document.

## Post-hoc calculation (§5.5.3)

If the agent that drove the session was not atrib-aware (no `@atrib/agent` middleware), the merchant can still produce a signed recommendation after the fact, as long as the tools were attributed:

```typescript
const recommendation = await verifier.calculate({
  context_id: 'sess_abc123...',
  policy: 'default', // or a full PolicyDocument
  signWith: 'merchant', // signs with merchantKey if present
})
// → fully-shaped RecommendationDocument, ready to settle against
```

Per the §5.8 degradation contract, this never throws on a missing key — if `signWith === 'merchant'` but `merchantKey` is unset, the document is returned **unsigned** with a warning rather than crashing the merchant pipeline.

## API reference

### `new AtribVerifier(options)`

| Field             | Type     | Default                       | Description                                                             |
| ----------------- | -------- | ----------------------------- | ----------------------------------------------------------------------- |
| `logEndpoint`     | `string` | `https://log.atrib.dev/v1`     | The Merkle log to fetch checkpoints and proofs from.                    |
| `graphEndpoint`   | `string` | `https://graph.atrib.dev/v1`   | The graph query endpoint (spec §3).                                     |
| `resolveEndpoint` | `string` | `https://resolve.atrib.dev/v1` | Reserved for v2 remote calculation.                                     |
| `merchantKey`     | `string` | unset                         | Base64url Ed25519 32-byte seed. Optional — `verify()` works without it. |

### `verify(doc): Promise<VerificationResult>`

Independently re-runs the §4.6 calculation and verifies the document signature. Always returns a result object — never throws. Inspect `valid`, `signatureOk`, `calcMatch`, and `warnings` to understand the outcome.

### `calculate(options): Promise<RecommendationDocument>`

Post-hoc calculation when no agent SDK was present. Always returns a fully-shaped document — unsigned with a warning if the merchant key is missing.

### Lower-level primitives

For advanced use (custom calculators, alternative signing flows), the package also exports:

- `calculate(graph, policy, sessionPolicyRecord)` — the pure §4.6 calculation function
- `DEFAULT_POLICY` — the spec §4.3 default policy document
- `isValidPolicy(doc)` — schema check for `PolicyDocument`
- `signRecommendation(unsigned, privateKey)` — JCS + Ed25519 signing
- `verifyRecommendationSignature(doc, publicKey)` — signature verification
- `recommendationSigningInput(doc)` — the canonical bytes that get signed
- `distributionsMatch(a, b)` — float-tolerant equality (within `1e-9` per recipient)
- `fetchGraph(endpoint, contextId, treeSize?)`, `fetchSessionPolicyRecord`, `fetchPolicyDocument`

## Why pure functions matter

The §4.6 calculation algorithm is intentionally a **pure function** of `(graph, policy)`:

- **No network calls** during calculation. The graph and policy are fetched up front and then `calculate()` runs in-memory.
- **No timestamps** beyond those already embedded in the records. Two runs an hour apart on the same inputs produce the same output.
- **No randomness**. No "tie-breaker by hash of current time" or anything like that. Ties are broken deterministically per the spec.
- **No floating-point ordering surprises**. The algorithm walks the graph in a deterministic order so two implementations on identical input produce identical output (within `1e-9` for the final distribution shares).

This is what makes verification possible: the merchant's local recalculation is the same code the calculator ran, producing the same output, so any disagreement is a real signal — not implementation drift.

## §5.8 degradation contract

Per the absolute invariant (also enforced in `@atrib/mcp` and `@atrib/agent`), atrib failures never break the host:

- Missing or invalid `merchantKey` → constructor logs `atrib: ...` warning, `merchantPrivateKey = null`, no throw.
- `verify()` errors during signature resolution, graph fetch, or calculation are caught and surfaced as `warnings: string[]` with `valid = false`.
- `calculate({ signWith: 'merchant' })` with a missing key returns an unsigned document plus a warning, rather than throwing.

The merchant's payment pipeline never crashes because of an atrib problem. It just gets `valid: false` and decides what to do with that.

## Test coverage

82 tests across 4 test files:

- **`calculate.test.ts`** — the §4.6 calculation algorithm: edge weight aggregation (`max()` not `sum()`), CONVERGES_ON handling, tie-breaking determinism, default policy correctness, constraint enforcement.
- **`graph-fetch.test.ts`** — graph endpoint client, session policy record fetch, policy document fetch, error handling.
- **`recommendation.test.ts`** — JCS canonicalization round-trips, Ed25519 signing/verification, `distributionsMatch()` floating-point tolerance, `recommendationSigningInput()` byte stability.
- **`verifier.test.ts`** — full `verify()` and `calculate()` paths, including the §5.8 degradation cases and the `valid === false` failure modes.

Run them with `pnpm --filter @atrib/verify test`.

## Spec references

| Spec section | What this package implements                         |
| ------------ | ---------------------------------------------------- |
| §3           | Graph query interface (client side)                  |
| §4.3         | Default policy document                              |
| §4.6         | Pure calculation algorithm                           |
| §4.7         | Recommendation document signing/verification         |
| §5.5         | `AtribVerifier` class — `verify()` and `calculate()` |
| §5.8         | Degradation contract — failures never break the host |

The full protocol spec is at [`atrib-spec.md`](../../atrib-spec.md).

## See also

- [`@atrib/mcp`](../mcp/README.md) — server-side middleware that produces the signed records `verify()` ultimately validates
- [`@atrib/agent`](../agent/README.md) — agent-side interceptor + framework adapters
- [`@atrib/log-dev`](../log-dev/README.md) — development-mode Merkle log stub. Returns placeholder Merkle hashes that **will not pass** strict cryptographic verification — fine for end-to-end shape testing, not for production verification.
- [`packages/integration/examples/end-to-end/`](../integration/examples/end-to-end/) — runnable demo wiring everything together
- [`DECISIONS.md`](../../DECISIONS.md) — architectural decision log
