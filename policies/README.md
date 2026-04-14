# Attribution Policies

An attribution policy controls how value is distributed across the tools and creators that contributed to a transaction. Without a custom policy, the [default](../atrib-spec.md#43-the-default-policy) splits credit proportional to call count with no modifiers or constraints.

These templates are ready to use. Copy one, adjust the numbers, and serve it at `/.well-known/atrib-policy.json` on your domain.

## Templates

| Template | Who uses it | What it does |
| --- | --- | --- |
| [equal-split.json](equal-split.json) | Merchant | Same as the default. Every signed tool call has equal weight. |
| [recency-weighted.json](recency-weighted.json) | Merchant | Tools called closer to the purchase get more credit. 1-minute half-life. |
| [chain-position.json](chain-position.json) | Merchant | Tools directly upstream of the purchase (chain-adjacent) get 2x weight. Deeper tools penalized. |
| [creator-floor-10pct.json](creator-floor-10pct.json) | Creator | Guarantees at least 10% share when this creator's tools appear in a session. |
| [merchant-capped-40pct.json](merchant-capped-40pct.json) | Merchant | No single contributor exceeds 40%. Everyone gets at least 5%. Slight recency bias (2-minute half-life). |
| [full-stack.json](full-stack.json) | Merchant | Everything at once: chain position weighting, recency decay, call count boost, floor, and cap. |

## How policies compose

A single policy document can combine any or all of:

- **Edge weights** control base credit by structural relationship (chain-adjacent, parallel, cross-session)
- **Modifiers** adjust scores after weighting (temporal decay, chain depth penalty, call count boost). Applied in array order.
- **Constraints** set floors and caps on the final distribution

These are all fields on one document. They compose naturally. `full-stack.json` uses all three.

## Building policies in code

`@atrib/verify` exports `buildPolicy` and `policyFrom` helpers for composing policies programmatically:

```typescript
import { policyFrom } from '@atrib/verify'

// Start from default, add recency decay and a cap
const policy = policyFrom({
  modifiers: [{ type: 'temporal_decay', half_life_ms: 60000 }],
  constraints: { maximum_share: 0.40 },
})

// Or build on top of an existing policy
import { buildPolicy } from '@atrib/verify'
import basePolicy from './recency-weighted.json'

const customPolicy = buildPolicy(basePolicy, {
  constraints: { minimum_share: 0.05 },
  modifiers: [{ type: 'chain_depth_penalty', penalty_per_level: 0.1 }],
})
```

`buildPolicy` merges edge weights and constraints (override replaces base per field) and concatenates modifiers (base modifiers first, then additions). It throws if the result is invalid.

## How creator and merchant policies interact

Creators and merchants publish separate policies. The agent negotiates between them at session start (spec §4.5). The rules:

1. **Merchant sets the weights and modifiers.** The merchant's `edge_weights`, `modifiers`, and `distribution` fields are used.
2. **Creator sets their own floor.** A creator's `minimum_own_share` becomes a floor in the session policy record.
3. **Conflicts are resolved by the spec's 7 rules** (§4.5.2). If a creator's floor exceeds the merchant's cap, the negotiation protocol handles it.

In practice: the merchant says how to weight contributions. The creator says their minimum acceptable share. The protocol merges them.

**Example combination:**

A merchant publishes `recency-weighted.json` (temporal decay, no constraints).
A creator publishes `creator-floor-10pct.json` (10% minimum share).

The negotiated session policy uses the merchant's weights and decay, plus the creator's 10% floor. The calculation applies temporal decay first, then raises the creator to 10% if they fell below, scaling others down proportionally.

## Choosing the right template

**If you're a merchant and don't know where to start:** Use `recency-weighted.json`. It gives more credit to tools called right before the purchase, which is the most intuitive model for most commerce scenarios.

**If you're a creator and want protection:** Use `creator-floor-10pct.json`. Adjust the `0.10` to whatever floor makes sense for your tool's contribution. This guarantees your share regardless of how many other tools are in the session.

**If you want fine-grained control:** Start with `full-stack.json` and tune the numbers:

| Parameter | What it controls | Increase to... | Decrease to... |
| --- | --- | --- | --- |
| `CHAIN_PRECEDES` weight | Credit for tools directly upstream in the chain | Reward being structurally close to the purchase | Flatten structural advantage |
| `SESSION_PARALLEL` weight | Credit for tools called in parallel | Include parallel tools equally | Discount parallel contributions |
| `temporal_decay.half_life_ms` | How fast old contributions lose credit | Keep old contributions relevant longer | Concentrate credit on recent tools |
| `chain_depth_penalty.penalty_per_level` | How much deeper chain positions are penalized | Penalize tools far from the purchase | Reduce the depth penalty |
| `call_count_boost.multiplier_per_call` | Bonus for tools called multiple times | Reward frequently-used tools more | Reduce the repeat-use bonus |
| `call_count_boost.cap` | Maximum multiplier from repeated calls | Allow higher repeat bonuses | Limit how much repetition counts |
| `minimum_share` | Floor for any single contributor (node level) | Ensure every contributor gets a meaningful share | Allow small contributors to wash out |
| `maximum_share` | Cap for any single contributor (node level) | Let dominant contributors take more | Spread credit more evenly |

## Publishing your policy

Serve your policy JSON at `/.well-known/atrib-policy.json` on your domain. The agent fetches it at session initialization.

```
GET https://my-tool.example.com/.well-known/atrib-policy.json
Content-Type: application/json

{
  "spec_version": "atrib/1.0",
  "role": "creator",
  ...
}
```

If you're using `@atrib/mcp`, pass the policy as an init option and it will be served automatically (once §5.3.6 is implemented):

```typescript
const server = atrib(new McpServer({ name: 'my-tool', version: '1.0.0' }), {
  creatorKey: process.env.ATRIB_PRIVATE_KEY,
  serverUrl: 'https://my-tool.example.com',
  policy: require('./my-policy.json'),
})
```

Until the SDK serves the endpoint, you can serve the JSON from any static file host, CDN, or as a route in your existing web server.

## Spec reference

- [§4.2 Policy Document Format](../atrib-spec.md#42-policy-document-format), full schema
- [§4.3 The Default Policy](../atrib-spec.md#43-the-default-policy), what happens with no custom policy
- [§4.5 Session Negotiation](../atrib-spec.md#45-session-negotiation), how creator and merchant policies merge
- [§4.6 The Calculation Algorithm](../atrib-spec.md#46-the-calculation-algorithm), how the distribution is computed
