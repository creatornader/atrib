# @atrib/sdk client example

The consolidated client SDK in one runnable file: `attest()` writes signed
context, `recall()` reads it back, and every operational failure degrades
instead of throwing per
[§5.8](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#58-degradation-contract).

```bash
ATRIB_PRIVATE_KEY=$(node -e 'console.log(Buffer.from(crypto.randomBytes(32)).toString("base64url"))') \
  npx tsx packages/integration/examples/client-sdk/integration.ts
```

Run from the repo root after `pnpm install && pnpm --filter @atrib/sdk... build`.

## What it shows

1. **attest()** — an observation, then a revision chained to it via
   `ref: { kind: 'revises' }`. Both records sign through `@atrib/emit`'s
   `handleEmit` pipeline (no SDK-local signing implementation) and land in
   the local mirror with chain continuity (`chain_root` of the second
   record = record hash of the first).
2. **recall()** — the history shape reading those records back, newest
   first, with `signature_verified` on each entry.
3. **Daemon-first routing** — the client probes the local primitives
   runtime (`$ATRIB_PRIMITIVES_HTTP_ENDPOINT`, default
   `http://127.0.0.1:8796/mcp`) and reports which path served each call
   (`via: 'daemon' | 'in-process' | 'none'`). The example works with or
   without a running daemon.
4. **Degradation** — a client built with `key: null` and no daemon
   returns a pass-through result with warnings instead of throwing.

The example writes its mirror to a temp directory (`ATRIB_MIRROR_FILE`)
so it never touches `~/.atrib/records/`, and points log submission at an
unroutable localhost anchor so nothing leaves the machine. Point
`anchors` at `https://log.atrib.dev/v1/entries` (the default when the
option is omitted) to submit real commitments.

The Python sibling (`python/`) exposes the same verbs; see
[`python/README.md`](../../../../python/README.md).
