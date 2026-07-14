# Browserbase Stagehand proof artifact

This proof signs a Browserbase MCP shaped browser session through `@atrib/mcp-wrap`.

## Action path

`start -> navigate -> observe -> act -> extract -> end`

## What ran

- Upstream surface: Browserbase hosted Streamable HTTP MCP endpoint.
- atrib path: `@atrib/mcp-wrap` around a hosted Streamable HTTP MCP upstream.
- Control path: `browserbase-action-gate-v0` signs the `act` decision and outcome before the Browserbase action runs.
- Record policy: public records keep tool names plus `args_hash` and `result_hash`.
- Verification: `@atrib/mcp` verifies each Ed25519 record signature after the wrapper writes its mirror.
- Log proof: accepted records were submitted to `https://log.atrib.dev/v1/entries` after full-flow verification; inclusion was verified.
- Publish policy: `accepted-run-after-verification`

## Public record refs

| Tool     | Record hash                                                             | Public log index |
| -------- | ----------------------------------------------------------------------- | ---------------- |
| start    | sha256:3fec4c4fe89b52120116e10df30738e735305622a5d11b5e6a58044bd79c8a35 | 69802            |
| navigate | sha256:310c9186053fc9aca97c18535634862e1698d29e94f10e611ededca406a349fd | 69803            |
| observe  | sha256:afb2d48ba555b06efd1ea7feaf052a0e630f8bb57167990782d0ade5c383030a | 69804            |
| act      | sha256:3afb35ced45576a91d7b870520adfeab16a8e20503eef8527c0b313cd2eea5c3 | 69805            |
| extract  | sha256:4dd3490d3eaed99cd2abc4ea112cf8d87970d9f591e5c73c0366c5cf270ccb85 | 69806            |
| end      | sha256:9a9a4833f9df89deb95742d8a61781695fe2435e514b688fd7b9efcc033dbf8c | 69807            |

Representative public links:

- Explorer: <https://explore.atrib.dev/action/sha256:3fec4c4fe89b52120116e10df30738e735305622a5d11b5e6a58044bd79c8a35>
- Log proof: <https://log.atrib.dev/v1/proof/3fec4c4fe89b52120116e10df30738e735305622a5d11b5e6a58044bd79c8a35>

## Action policy gate

The runner evaluates `browserbase-action-gate-v0` before `act`. The decision
record is signed before the Browserbase tool call. If the decision is `block`
or `escalate`, the runner stops before `act` and closes the session with
`end` when possible.

| Tool | Decision | Decision record                                                         | Decision index | Outcome record                                                          | Outcome index |
| ---- | -------- | ----------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------- | ------------- |
| act  | allow    | sha256:f69c1470d23ffc99eff13b53b9b623770db6671a72596683dfe925e1af16c113 | 69808          | sha256:d5ea20d9ef67977ba3d37dc1c1579fbc2c121d8ee160e9fa8a17b3bfd0874c0a | 69809         |

- Policy event type: `https://browserbase-action-gate.atrib.dev/v1/decision`
- Stopped before: none
- Blocked tool executed: false

## Redaction line

The wrapper saw private Browserbase-shaped payloads: session id, replay URL,
page snapshot, selector, form value, and extracted page text. The action policy
also saw target, action, and observed-state inputs. The public artifact stores
only hashes or public fixed instructions for those fields. See
`redaction-manifest.json`.

## Weakness

This proof run signs the wrapper path, record chain, hash-only disclosure,
public log inclusion, verifier path, real Browserbase MCP command path, and
signed action-policy records. It still keeps Browserbase Live View and replay
material private. Hosted Browserbase MCP can return temporary model-capacity
errors; public publication starts only after the full six-step flow verifies.

## Demo boundary

This is a fixed proof artifact plus a rerunnable local command. The resettable
demo server lives in
`packages/integration/examples/browserbase-stagehand/live-demo/` and is deployed
at <https://atrib-browserbase-stagehand-demo.fly.dev/>. The demo page shows the
agent-ready WebMCP target app that Browserbase controls, Stagehand `observe`,
`act`, and `extract` workflow, cursor/click playback, and atrib action-gate
receipts side by side. Fixture playback is deterministic. Live Browserbase
inspection refs, when present, are shown only as UI links and stay out of the
public proof artifact.

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
