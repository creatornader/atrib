# `services/log/` - atrib production Merkle log _(not yet built)_

This directory is a placeholder for the production atrib transparency log: a [Tessera](https://github.com/transparency-dev/tessera)-backed Merkle log implementing the [C2SP tlog-tiles](https://c2sp.org/tlog-tiles) specification, deployed at `log.atrib.dev/v1`.

**Status:** Not yet implemented. Tracked in [`DECISIONS.md`](../../DECISIONS.md). Work has not started in this directory.

Until this service ships, all local development, testing, and customer demos use the in-process [`@atrib/log-dev`](../../packages/log-dev/README.md) stub, which speaks the same spec [§2.6.1](../../atrib-spec.md#261-submit-entry) wire format but stores entries in memory and returns placeholder Merkle hashes.

## Why this lives outside the TypeScript monorepo

The TypeScript packages under `packages/` are SDK code; they ship to merchants, agent builders, and verifiers. The log is **infrastructure**: a long-lived service that any third party (a merchant, an auditor, a witness) can run on their own infrastructure, and that one operator (atrib) runs at `log.atrib.dev/v1` as the canonical instance.

Tessera is a Go library, so this service is Go. Mixing a Go service into a TypeScript pnpm monorepo would force every TS contributor to install the Go toolchain to run a build that they will never touch. Keeping it under `services/` (and eventually a sibling `go.mod`) preserves the SDK monorepo's invariant: `pnpm install && pnpm build` is enough.

## Planned scope

When implemented, this service will:

1. **Implement the spec [§2](../../atrib-spec.md#2-merkle-log-protocol) endpoints in full**, including the ones that `@atrib/log-dev` deliberately stubs out:
   - `POST /v1/entries` ([§2.6.1](../../atrib-spec.md#261-submit-entry)), submit a signed attribution record. Validate signature, enforce idempotency by `record_hash`, return inclusion proof.
   - `GET /v1/checkpoint` ([§2.5.1](../../atrib-spec.md#251-checkpoint-endpoint)), current checkpoint, signed-note format per c2sp.org/signed-note.
   - `GET /v1/tile/{level}/{index}` ([§2.5.2](../../atrib-spec.md#252-tile-endpoints)), tile data per c2sp.org/tlog-tiles.
   - `GET /v1/entries/{index}`: retrieve a stored entry by log index.
   - Witnessing endpoints per [§2.9](../../atrib-spec.md#29-witnessing-and-cosignatures) (cosignature collection from third-party witnesses).

2. **Honor the `X-atrib-Priority` admission header** so transaction records are admitted ahead of pending tool_call records during ingestion congestion (matches what `@atrib/log-dev` already does, see [`packages/log-dev/src/storage.ts`](../../packages/log-dev/src/storage.ts)).

3. **Use Tessera's storage backends**: `tessera/cmd/storage` supports GCP, AWS, MySQL, and POSIX filesystem. The canonical `log.atrib.dev/v1` deployment will likely target GCP Spanner + GCS tile storage; self-hosted deployments can use any supported backend.

4. **Stay wire-compatible with `@atrib/log-dev`**: anything that flows through the dev stub MUST also be accepted by this service, and vice versa. This is tested by pointing the integration tests in [`packages/integration/`](../../packages/integration/) at both backends.

## Why "not table stakes" was wrong

The production log was initially deprioritized in favor of completing the TypeScript SDK. That sequencing is now recognized as a misalignment with end-to-end verifiability requirements: a merchant cannot independently verify a recommendation against `@atrib/log-dev` because the dev stub returns placeholder Merkle hashes; the verifier's strict path will reject them. A customer trying to run the protocol end-to-end (signed records → Merkle log → verifier returning `valid: true`) needs the real log.

What's true is that the **wire format** and the **client-side SDK** can both be finished before the Go service exists, and that's where the work has been concentrated. When the SDK is stable enough that customers want to run the full loop, the work in this directory becomes the next blocker.

## Spec references

| Spec section | What this service will implement                                                  |
| ------------ | --------------------------------------------------------------------------------- |
| [§2.3](../../atrib-spec.md#23-log-entry-format)         | Log entry encoding (`AtribLogEntry`, 90-byte fixed format)                        |
| [§2.4](../../atrib-spec.md#24-checkpoint-format)         | Checkpoint format (signed-note over tlog-tiles tree head)                         |
| [§2.5](../../atrib-spec.md#25-tile-api-read-interface)         | Read API (checkpoint, tiles, entry retrieval)                                     |
| [§2.6](../../atrib-spec.md#26-submission-api-write-interface)         | Submission API (POST /v1/entries with [§2.6.1](../../atrib-spec.md#261-submit-entry) wire format and [§2.6.2](../../atrib-spec.md#262-inclusion-proof-response) proof bundle) |
| [§2.7](../../atrib-spec.md#27-inclusion-proof-verification)         | Inclusion proof verification (server-side, also exposed for clients to verify)    |
| [§2.8](../../atrib-spec.md#28-proof-bundle-format)         | Proof bundle format (c2sp.org/tlog-proof@v1)                                      |
| [§2.9](../../atrib-spec.md#29-witnessing-and-cosignatures)         | Witnessing and cosignatures                                                       |

## See also

- [`@atrib/log-dev`](../../packages/log-dev/README.md), the in-memory dev stub that speaks the same wire format
- [`atrib-spec.md` §2](../../atrib-spec.md), the Merkle log protocol specification
- [`DECISIONS.md` D025](../../DECISIONS.md), context for why the dev stub exists and how it relates to this service
- [Tessera](https://github.com/transparency-dev/tessera), the Go transparency log library this service will use
- [C2SP tlog-tiles](https://c2sp.org/tlog-tiles), the wire-level tile format specification
