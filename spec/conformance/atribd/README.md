# atribd daemon conformance corpus

This corpus is the executable design gate for
[D148](../../../DECISIONS.md#d148-atribd-is-the-public-stateless-native-local-daemon-for-the-primitive-runtime),
the public stateless-native local daemon that consolidates the seven cognitive
primitives. It pins the daemon contract before and independent of the MCP
TypeScript SDK's stateless-transport release: the transport sits behind an
adapter, and every family here must pass regardless of which adapter
implementation serves it.

The corpus tests one rule set: the daemon changes topology and transport,
never record semantics. No record field, event type, cognitive primitive, or
graph edge is added, and a verifier cannot distinguish a daemon-signed record
from a standalone-server record.

## Case families

| Family | What it pins |
| --- | --- |
| `cases/stateless-transport/` | No-session requests are served, legacy `Mcp-Session-Id` headers are ignored (never 404), a legacy `initialize` is answered without session issuance, and an identical read replayed against a fresh instance returns an equivalent result. |
| `cases/routing-headers/` | SEP-2243: `Mcp-Method` / `Mcp-Name` headers matching the body are accepted; every mismatch axis is HTTP 400 with a JSON-RPC error and nothing routed, including adversarial header/body divergence. |
| `cases/context-resolution/` | The context-identity ladder consumed exactly as spec [§1.5.4](../../../atrib-spec.md#154-mcp-transport-params_meta) with the [§1.5.3](../../../atrib-spec.md#153-http-fallback-x-atrib-chain) `X-Atrib-Chain` fallback defines it: explicit argument, then `_meta.atrib`, then the `atrib=` tracestate entry, then `X-Atrib-Chain`. Missing context on HTTP rejects writes with a typed tool error. stdio-shim env vectors reuse the [D078](../../../DECISIONS.md#d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default)/[D083](../../../DECISIONS.md#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers) ladder, and an interaction vector re-runs the whole [§1.2.3 multi-producer corpus](../1.2.3/multi-producer/) to prove `resolveChainRoot` output is unchanged. |
| `cases/record-byte-parity/` | With an injected fixed key and frozen timestamp, the same emit, annotate, and revise calls through (a) a standalone stdio server, (b) daemon HTTP, and (c) the daemon alias mount produce byte-identical canonical records and identical `_local.producer` labels. |
| `cases/health-gates/` | [D127](../../../DECISIONS.md#d127-primitive-runtime-health-gates-recall-contract-freshness) (recall contract), [D129](../../../DECISIONS.md#d129-primitive-runtime-health-gates-every-mounted-primitive-surface) (tool-surface contracts), and [D130](../../../DECISIONS.md#d130-primitive-runtime-health-uses-non-mutating-behavioral-probes) (behavioral probes, write primitives skipped) carried over; the retired `sessions` block is absent and a `requests` counter block replaces it. |
| `cases/degradation/` | [§5.8](../../../atrib-spec.md#58-degradation-contract): an unreachable log endpoint still yields a signed record with a mirror receipt; probe and call timeouts degrade instead of killing the process; malformed `_meta` carriers parse leniently per the [D018](../../../DECISIONS.md#d018-w3c-trace-context-and-baggage-conformance-leftmost-atrib-lenient-parse-evict-from-end-on-overflow) posture. |
| `cases/concurrent-writer-serialization/` | The 2026-07-10 chain-fork measurement gate: N concurrent writes to one `context_id` through one daemon yield a linear chain with zero forks, mixed-producer concurrent writes stay linear, and a documented-boundary case shows an outside-daemon writer can still fork (corpus-scoped resolution narrows that window; only daemon routing eliminates it). |

## Reference test

`services/atribd/test/conformance-atribd.test.ts` walks `manifest.json` and
executes every case against the live implementation: HTTP vectors run against
`bindAtribdHttpHost` on an ephemeral loopback port, stdio-env vectors run
against `resolveEnvContextId`, chain-root vectors run against
`resolveChainRoot`, and the parity plus serialization families mount the real
primitive servers with the fixed fill(42) test seed, per-case temp mirrors,
and an unreachable log endpoint.

```sh
pnpm --filter atribd... build
pnpm --filter atribd test
```

## Regenerating fixtures

Only the `record-byte-parity/` cases are generated; the rest are hand-authored
vectors. Regenerate after any intentional change to the signing path:

```sh
cd services/atribd
node scripts/generate-conformance-record-byte-parity.mjs
```

The generator freezes `Date.now`, injects the public fill(42) test seed, and
signs through the standalone servers, so a changed fixture hash means the
signed bytes changed, which is exactly what the family exists to catch.
