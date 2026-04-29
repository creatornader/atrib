# atrib-directory-bridge

Rust→WASM bridge wrapping Meta's [`akd`](https://github.com/facebook/akd) crate. Built once via `wasm-pack build --target nodejs --release`; the resulting `pkg/` artifacts are copied into `packages/directory/wasm/` (which IS checked into git) so the SDK package ships the WASM module inline.

The bridge exposes the four directory operations spec [§6](../../atrib-spec.md#6-key-directory) normatively requires (publish, lookup, history, prove_absence) plus the operations supporting per-operation anchoring (current_epoch, current_root, audit_proof) and the [§6.3](../../atrib-spec.md#63-verifier-consultation-algorithm) 9-step verifier consultation algorithm.

WASM was chosen over NAPI per the benchmark dated 2026-04-29, see [D034](../../DECISIONS.md#d034-public-key-directory-architecture-akd-unblinded-vrf-blinded-mode-available-for-downstream-consumers) consequences. Lookup latency at 100K labels: 1.8ms p95. Distribution simplicity (single artifact) and sandboxing made WASM the right tradeoff even though NAPI would be ~5x faster.

AKD parallelism is gated to `disabled()` because WASM lacks a Tokio runtime. Insert throughput drops to ~6.3K labels/sec single-threaded; this is comfortably above the per-operation anchoring cadence in [§6.2.4](../../atrib-spec.md#624-anchor-cross-reference-into-the-tessera-log).

## Build

```bash
cd packages/directory-bridge
wasm-pack build --target nodejs --release
cp pkg/atrib_directory_bridge.{js,d.ts} pkg/atrib_directory_bridge_bg.wasm \
   ../directory/wasm/
```

The built artifacts in `packages/directory/wasm/` are checked into git. Rebuild and re-copy when changing `src/lib.rs`.

## Why bridge ↔ SDK split

The Rust crate produces WASM + a thin JS shim. `@atrib/directory` is the consumer-facing TypeScript SDK that wraps the WASM exports with idiomatic TS types, signing helpers, and per-operation anchoring logic. Keeping the bridge crate-only avoids mixing Rust + TypeScript builds in a single package.
