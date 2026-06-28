# Browserbase Stagehand proof artifact

This proof signs a Browserbase MCP shaped browser session through `@atrib/mcp-wrap`.

## Action path

`start -> navigate -> observe -> act -> extract -> end`

## What ran

- Upstream surface: Browserbase hosted Streamable HTTP MCP endpoint.
- Atrib path: `@atrib/mcp-wrap` around a hosted Streamable HTTP MCP upstream.
- Record policy: public records keep tool names plus `args_hash` and `result_hash`.
- Verification: `@atrib/mcp` verifies each Ed25519 record signature after the wrapper writes its mirror.
- Log proof: accepted records were submitted to `https://log.atrib.dev/v1/entries` after full-flow verification; inclusion was verified.
- Publish policy: `accepted-run-after-verification`

## Public record refs

| Tool     | Record hash                                                             | Public log index |
| -------- | ----------------------------------------------------------------------- | ---------------- |
| start    | sha256:535201b60e3660f1b2f5babcfdd85f09f3a1503f4ad73cfc419528285c696aae | 65792            |
| navigate | sha256:1f92f466f3bcbab058f9dc2fec99c5536a6d2f9f71fd21aa6b1b48417f1ad19d | 65793            |
| observe  | sha256:4fd3e736c98b2652fda30963ff5d379db210b4dff71db401c39805936a1361d4 | 65794            |
| act      | sha256:9295f755361578f90242fe7e5d3d59c99a76e36942dfd2f7b34277dcf70cb65c | 65795            |
| extract  | sha256:8910a05fcfc243096e9238c311218304af569c1cc7e71774ccd834531d2ec028 | 65796            |
| end      | sha256:a78400352f4daab9d03ae606854c36565bbd911dba736ece22535f8a8ffec4a6 | 65797            |

Representative public links:

- Explorer: <https://explore.atrib.dev/action/sha256:535201b60e3660f1b2f5babcfdd85f09f3a1503f4ad73cfc419528285c696aae>
- Log proof: <https://log.atrib.dev/v1/proof/535201b60e3660f1b2f5babcfdd85f09f3a1503f4ad73cfc419528285c696aae>

## Redaction line

The wrapper saw private Browserbase-shaped payloads: session id, replay URL, page snapshot, selector, form value, and extracted page text. The public artifact stores only hashes for those fields. See `redaction-manifest.json`.

## Weakness

This proof run signs the wrapper path, record chain, hash-only disclosure, public log inclusion, verifier path, and real Browserbase MCP command path. It still keeps Browserbase replay material private. Hosted Browserbase MCP can return temporary model-capacity errors; public publication starts only after the full six-step flow verifies.

## Demo boundary

This is a fixed proof artifact plus a rerunnable local command. The resettable
demo server lives in
`packages/integration/examples/browserbase-stagehand/live-demo/` and is deployed
at <https://atrib-browserbase-stagehand-demo.fly.dev/>. The demo page shows the
Browserbase session shape, Stagehand `observe`, `act`, and `extract` workflow,
and Atrib receipt table side by side. Raw Browserbase session and replay URLs
stay private.

## Regenerate

```bash
ATRIB_BROWSERBASE_STAGEHAND_LIVE=1 \
ATRIB_BROWSERBASE_UPSTREAM=hosted \
ATRIB_PACKET_PUBLIC_LOG=1 \
BROWSERBASE_API_KEY=... \
ATRIB_PACKET_WRITE_ARTIFACTS=1 \
  pnpm --filter @atrib/integration browserbase-stagehand-packet
```

## Self-hosted STDIO variant

```bash
ATRIB_BROWSERBASE_STAGEHAND_LIVE=1 \
ATRIB_PACKET_PUBLIC_LOG=1 \
BROWSERBASE_API_KEY=... \
BROWSERBASE_PROJECT_ID=... \
GEMINI_API_KEY=... \
ATRIB_PACKET_WRITE_ARTIFACTS=1 \
  pnpm --filter @atrib/integration browserbase-stagehand-packet
```
