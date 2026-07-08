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
3. **Routing** — the SDK is daemon-first by default (`daemon.mode:
   'prefer'` probes the local primitives runtime at
   `$ATRIB_PRIMITIVES_HTTP_ENDPOINT`, default
   `http://127.0.0.1:8796/mcp`); this example pins `daemon: { mode:
   'off' }` to stay hermetic and deterministic. Every result still
   reports which path served the call
   (`via: 'daemon' | 'in-process' | 'none'`). Flip the mode to
   `'prefer'` to watch daemon routing, knowing records then land on the
   daemon's mirror and its anchors (including the public log).
4. **Degradation** — a client built with `key: null` and no daemon
   returns a pass-through result with warnings instead of throwing.
5. **Anchor set + posture** — the client's `anchors` config carries two
   members (the unroutable atrib-log endpoint plus a registered
   non-atrib-log `opentimestamps` entry), meeting the
   [D138](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d138-anchor-plurality-as-the-default-trust-posture)
   plurality bar ([§2.11.12](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#21112-producer-side-anchor-posture))
   without `allowSingleAnchor`. `observed.anchor_posture` and any fan-out
   warnings print after the observation attest, then
   `client.flushAnchors()` runs before `client.close()`. Anchor posture is
   present only on in-process attest results — a daemon-served result
   never carries it, because the daemon owns its own anchor set.
6. **Evidence envelope build + validate** —
   [`buildEvidenceEnvelope`](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#557-universal-evidence-envelope)
   and `validateEvidenceEnvelope` compose the
   [D137](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d137-universal-evidence-envelope-as-the-single-protocol-level-attachment-model)
   universal envelope: `payload.hash` is computed from `payload.material`
   via the default JCS hash rule, the envelope is validated through the
   optional `@atrib/verify` peer (present in this workspace), and the
   built envelope is round-tripped through `validateEvidenceEnvelope` on
   its own.
7. **Attribution receipt checks** — two distinct
   [D141](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d141-devatribattribution-first-class-mcp-extension-sep-2133)
   `dev.atrib/attribution` checks over the same synthetic receipt block,
   deliberately not unified. The block is built
   [§6.2](https://github.com/creatornader/atrib/blob/main/docs/extensions/dev.atrib-attribution/v0.1.md#62-receipt-block)-well-formed
   from the newest signed record in the temp mirror: a top-level `token`
   plus all six receipt string fields. Three outcomes print:
   `verifyAttributionReceipt` — the extension's
   [§6.2](https://github.com/creatornader/atrib/blob/main/docs/extensions/dev.atrib-attribution/v0.1.md#62-receipt-block)
   structural/internal-consistency check over the raw block alone —
   reports `valid: true` (the record-less log-submission case passes
   that check by design); `checkAttributionReceiptConsistency` with no
   record has nothing to check the claims against and conservatively
   reports `receipt_valid: false` with `mismatched_fields: ['record']`;
   `checkAttributionReceiptConsistency` with the mirror-tail record
   reports `receipt_valid: true` — the claims match the signed record
   they name.

The example writes its mirror to a temp directory (`ATRIB_MIRROR_FILE`)
so it never touches `~/.atrib/records/`, and points log submission at an
unroutable localhost anchor so nothing leaves the machine. Point
`anchors` at `https://log.atrib.dev/v1/entries` (the default when the
option is omitted) to submit real commitments.

The Python sibling (`python/`) exposes the same verbs; see
[`python/README.md`](../../../../python/README.md).
