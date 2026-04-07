# `@atrib/log-dev`

> ⚠️ **NOT FOR PRODUCTION USE.**
>
> This is an in-memory development log stub for local testing, examples, and CI fixtures. It does **not** implement the C2SP tlog-tiles specification, does **not** persist entries beyond process lifetime, does **not** produce real Merkle inclusion proofs, and is **not** witnessed.
>
> The production Atrib log lives at `log.atrib.io/v1` and is Tessera-backed per spec §2. Anything you submit to this stub is discarded when the process exits. Inclusion proofs returned by this stub are well-formed (correct field shapes per §2.6.2) but their hashes are deterministic placeholders, not real Merkle hashes — they will not pass `@atrib/verify`'s strict verification path.

## What this package is for

Three concrete use cases. None of them are "running a real attribution log."

1. **Local development of Atrib agents and merchants.** When building an agent or merchant integration, you want to point `ATRIB_LOG_ENDPOINT` at *something* so the submission queue doesn't silently buffer pending records or warn about an unreachable endpoint. This stub is that something.

2. **End-to-end demos and customer walkthroughs.** The runnable demo at [`packages/integration/examples/end-to-end/`](../integration/examples/end-to-end/) uses `@atrib/log-dev` so a viewer can run **`pnpm --filter @atrib/integration demo`** and watch real attribution records flow through a fake merchant tool, an agent, and a stubbed x402 payment — all in a single process — without standing up Tessera first. The visible behavior is faithful (real signatures, real chain hashes, real transaction detection) even though the cryptographic guarantees of the log itself are not.

3. **Test fixtures for `@atrib/mcp` and `@atrib/agent`.** Existing tests in those packages mock `globalThis.fetch` to capture submissions; new tests can spin up a real `@atrib/log-dev` instance, point the submission queue at it, and inspect the captured records via the inspection API. This is more faithful than mocking fetch because it exercises the real spec §2.6.1 wire format end-to-end (the kind of bug fixed in commit-when-this-was-introduced was caught precisely because of the spec/code drift between client and server — having a real server side catches more drift earlier).

4. **Reference consumer for the spec §2.6.1 conformance corpus.** The shared corpus at [`spec/conformance/2.6.1/`](../../spec/conformance/2.6.1/) is the contract every Atrib log implementation must honor. `@atrib/log-dev` consumes it via [`test/conformance.test.ts`](test/conformance.test.ts) — when the future Tessera-backed Go service ships at [`services/log/`](../../services/log/), it will consume the same corpus. The generator at [`scripts/generate-conformance-corpus.ts`](scripts/generate-conformance-corpus.ts) is here too because it needs `@atrib/mcp`'s canonical `signRecord`. Regenerate with `pnpm --filter @atrib/log-dev corpus`.

## What this package implements

The minimum subset of spec §2.6 that the existing Atrib client (`@atrib/mcp`'s submission queue) needs to talk to a log:

| Spec section | Endpoint | Status in `@atrib/log-dev` |
|---|---|---|
| §2.6.1 | `POST /v1/entries` (submission) | ✅ Implemented — accepts a bare signed record per spec, validates shape, stores it, returns a proof bundle |
| §2.6.2 | Inclusion proof response | ✅ Implemented — returns `{log_index, checkpoint, inclusion_proof, leaf_hash}` with the right shapes (placeholder hashes) |
| §2.5.1 | `GET /v1/checkpoint` | ⏳ Not implemented — Tessera handles this; not needed for the demo |
| §2.5.2 | Tile API (`/v1/tile/...`) | ⏳ Not implemented — Tessera handles this |
| §2.9 | Witnessing/cosignatures | ⏳ Not implemented — out of scope for a dev stub |
| **Extension** | Honors `X-Atrib-Priority` header | ✅ Implemented — high-priority submissions are admitted first when `maxConcurrent` is finite |

## What this package adds beyond spec §2.6

A small **inspection API** for tests and demos that wouldn't make sense on a real log:

- `devLog.entries` — array of every accepted record, in submission order
- `devLog.size` — count of accepted records
- `devLog.clear()` — reset to empty (for test isolation)
- `devLog.onSubmit(callback)` — fires for every accepted record (used by the end-to-end demo's CLI to print records as they flow)

## Quick start

```ts
import { startDevLog } from '@atrib/log-dev'
import { atrib } from '@atrib/mcp'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

// 1. Spin up the dev log on a free port.
const log = await startDevLog({ port: 0 })  // 0 = let OS pick
console.log(`dev log listening at ${log.url}`)

// 2. Point the @atrib/mcp middleware at it.
const server = new McpServer({ name: 'demo', version: '1.0.0' })
const wrapped = atrib(server, {
  creatorKey: process.env.ATRIB_PRIVATE_KEY!,
  serverUrl: 'https://demo.example.com',
  logEndpoint: `${log.url}/v1/entries`,
})

// 3. Use the server normally. Records flow into the dev log.
//    Inspect via log.entries / log.onSubmit / etc.
log.onSubmit((record) => {
  console.log('submitted:', record.event_type, record.context_id.slice(0, 8))
})

// 4. When done:
await wrapped.flush()
await log.close()
```

## Why this isn't published to npm

The `package.json` has `"private": true`. This package will never be published to the npm registry. It exists only inside the Atrib monorepo as a development and testing fixture. If someone tries to `pnpm publish` it, npm will refuse — and that's intentional. Customers should never see this package; they should use the production log at `log.atrib.io/v1` (when it exists) or run their own Tessera-backed instance.

## Replacement plan

When the real Tessera-backed log ships at `services/log/` (Go, per the eventual sequencing), this package stays — it's still useful as the lightweight test fixture. The relationship will be:

| Use case | What runs |
|---|---|
| Production attribution log | `services/log/` (Tessera, Go) → deployed at `log.atrib.io/v1` |
| Customer self-hosted log | `services/log/` (Tessera, Go) → deployed at customer infra |
| Local development | `@atrib/log-dev` (TypeScript, in-process) |
| CI / automated tests | `@atrib/log-dev` (TypeScript, in-process) |
| End-to-end demo / walkthrough | `@atrib/log-dev` (TypeScript, in-process) |

The dev log and the real log should accept the same wire format — that's the entire point of having both speak spec §2.6.1 — but they live in different runtimes with different operational profiles.
