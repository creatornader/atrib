# `services/log/`, Atrib production Merkle log *(not yet built)*

This directory is a placeholder for the production Atrib transparency log: a [Tessera](https://github.com/transparency-dev/tessera)-backed Merkle log implementing the [C2SP tlog-tiles](https://c2sp.org/tlog-tiles) specification, deployed at `log.atrib.io/v1`.

**Status:** Not yet implemented. Tracked in [`DECISIONS.md`](../../DECISIONS.md) and [`internal planning doc`](../../internal planning doc). Work has not started in this directory.

Until this service ships, all local development, testing, and customer demos use the in-process [`@atrib/log-dev`](../../packages/log-dev/README.md) stub, which speaks the same spec §2.6.1 wire format but stores entries in memory and returns placeholder Merkle hashes.

## Why this lives outside the TypeScript monorepo

The TypeScript packages under `packages/` are SDK code, they ship to merchants, agent builders, and verifiers. The log is **infrastructure**: a long-lived service that any third party (a merchant, an auditor, a witness) can run on their own infrastructure, and that one operator (Atrib) runs at `log.atrib.io/v1` as the canonical instance.

Tessera is a Go library, so this service is Go. Mixing a Go service into a TypeScript pnpm monorepo would force every TS contributor to install the Go toolchain to run a build that they will never touch. Keeping it under `services/` (and eventually a sibling `go.mod`) preserves the SDK monorepo's invariant: `pnpm install && pnpm build` is enough.

## Planned scope

When implemented, this service will:

1. **Implement the spec §2 endpoints in full**, including the ones that `@atrib/log-dev` deliberately stubs out:
   - `POST /v1/entries` (§2.6.1), submit a signed attribution record. Validate signature, enforce idempotency by `record_hash`, return inclusion proof.
   - `GET /v1/checkpoint` (§2.5.1), current checkpoint, signed-note format per c2sp.org/signed-note.
   - `GET /v1/tile/{level}/{index}` (§2.5.2), tile data per c2sp.org/tlog-tiles.
   - `GET /v1/entries/{index}`, retrieve a stored entry by log index.
   - Witnessing endpoints per §2.9 (cosignature collection from third-party witnesses).

2. **Honor the `X-Atrib-Priority` admission header** so transaction records are admitted ahead of pending tool_call records during ingestion congestion (matches what `@atrib/log-dev` already does, see [`packages/log-dev/src/storage.ts`](../../packages/log-dev/src/storage.ts)).

3. **Use Tessera's storage backends**, `tessera/cmd/storage` supports GCP, AWS, MySQL, and POSIX filesystem. The canonical `log.atrib.io/v1` deployment will likely target GCP Spanner + GCS tile storage; self-hosted deployments can use any supported backend.

4. **Stay wire-compatible with `@atrib/log-dev`**, anything that flows through the dev stub MUST also be accepted by this service, and vice versa. This is tested by pointing the integration tests in [`packages/integration/`](../../packages/integration/) at both backends.

## Why "not table stakes" was wrong

Earlier sequencing (and reasoning that produced [D025](../../DECISIONS.md)) treated the production log as deferrable in favor of finishing the TypeScript SDK first. With hindsight that was a rationalization. A merchant cannot independently verify a recommendation against `@atrib/log-dev` because the dev stub returns placeholder Merkle hashes, the verifier's strict path will reject them. So a customer trying to actually run the protocol end-to-end (signed records → Merkle log → verifier returning `valid: true`) needs the real log.

What's true is that the **wire format** and the **client-side SDK** can both be finished before the Go service exists, and that's where the work has been concentrated. When the SDK is stable enough that customers want to run the full loop, the work in this directory becomes the next blocker.

## Spec references

| Spec section | What this service will implement |
|---|---|
| §2.3 | Log entry encoding (`AtribLogEntry`, 90-byte fixed format) |
| §2.4 | Checkpoint format (signed-note over tlog-tiles tree head) |
| §2.5 | Read API (checkpoint, tiles, entry retrieval) |
| §2.6 | Submission API (POST /v1/entries with §2.6.1 wire format and §2.6.2 proof bundle) |
| §2.7 | Inclusion proof verification (server-side, also exposed for clients to verify) |
| §2.8 | Proof bundle format (c2sp.org/tlog-proof@v1) |
| §2.9 | Witnessing and cosignatures |

## See also

- [`@atrib/log-dev`](../../packages/log-dev/README.md), the in-memory dev stub that speaks the same wire format
- [`atrib-spec.md` §2](../../atrib-spec.md), the Merkle log protocol specification
- [`DECISIONS.md` D025](../../DECISIONS.md), context for why the dev stub exists and how it relates to this service
- [Tessera](https://github.com/transparency-dev/tessera), the Go transparency log library this service will use
- [C2SP tlog-tiles](https://c2sp.org/tlog-tiles), the wire-level tile format specification
