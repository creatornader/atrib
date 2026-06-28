# OpenETR transfer proof artifact

This proof signs an OpenETR-shaped transfer-control flow through `@atrib/mcp-wrap`.

## Action path

`openetr_issue -> openetr_transfer_initiate -> openetr_transfer_accept -> openetr_query_state`

## What ran

- Upstream surface: OpenETR Python source at the pinned commit, executed against a local WebSocket Nostr relay and surfaced through MCP-shaped tools.
- Atrib path: `@atrib/mcp-wrap` around an MCP stdio server.
- Record policy: public records keep selected tool names plus `args_hash` and `result_hash`.
- Verification: `@atrib/mcp` verifies each Ed25519 record signature after the wrapper writes its mirror.
- Log proof: local fixture log only.
- Publish policy: `local-capture-only`

## Record refs

| Tool                      | Record hash                                                             | Local log index |
| ------------------------- | ----------------------------------------------------------------------- | --------------- |
| openetr_issue             | sha256:b1c6ab6216564c8e95d7701a8c9657f6d491673a57e788a4fce5b31d5717618c | 0               |
| openetr_transfer_initiate | sha256:4a38b1dc3b01c1a793527177ffbf33f94c1fa731bd12abc11b0e139dbb4dd236 | 1               |
| openetr_transfer_accept   | sha256:541dedbfe619a49e04bd1b8fb3bcb311caca14d3c19680ff2d59a76ea85568ba | 2               |
| openetr_query_state       | sha256:b30afb7f54fd43b5c7863d985cae6198c24489f7be3910735acc5629555a2975 | 3               |

## Redaction line

The fixture saw private OpenETR-shaped payloads: object digest, document label,
controller keys, relay URL, and event ids. The public artifact stores only
hashes for those fields. See `redaction-manifest.json`.

## Control-plane fit

OpenETR is the transferable-record control chain. atrib signs the agent action
chain around it. This packet sits before a system recognizes title transfer,
releases goods, updates an official register, or settles against the record.

A verifier can see which OpenETR-shaped actions ran, that the action records
verify, that raw OpenETR payloads stayed private, and that recognition still
requires attestor or title-transfer authority evidence.

## Policy decision artifact

`policy-decision.json` models the next gate after the OpenETR accept event:
`escalate_before_title_recognition`. It binds to the signed OpenETR-shaped records,
local log indexes, verifier result, and redaction boundary.

Allowed without review: `internal_state_query`, `proof_packet_review`.

Escalated before execution: `recognize_transfer`, `release_goods`, `settle_against_warehouse_receipt`, `update_official_title_register`.

Policy decision hash: `sha256:85dccc888a31df4263ce9ce30585f2add26501b55f14957cf48aeabafcdf8078`.

The policy decision file is deterministic and hash-bound to the signed records.
It is not a signed atrib record yet. The signed evidence in this packet is the
wrapped OpenETR-shaped tool-call chain.

## Source-backed OpenETR run

This artifact includes `source-run-output.json`, a sanitized summary of a real
OpenETR run from `trbouma/openetr` commit
`c97eb84f5790ff041ad14a1c30df0f71ceb8d3d9`.

The source-backed run executed:

- `openetr.services.issue_etr.publish_issue_etr`
- `openetr commands publish transfer initiate`
- `openetr commands publish transfer accept`
- `openetr.services.query_etr.build_query_etr_result`

Those calls ran against a local WebSocket Nostr relay. The proof still does not
use a public relay or a title-transfer authority. Raw OpenETR event ids, object
digest, party keys, relay URL, and event JSON stay out of the public artifact.

## Weakness

This is a source-backed local-relay proof. It checks the OpenETR implementation
entrypoints, local Nostr relay publish/query path, wrapper record chain,
hash-only disclosure, verifier path, and policy gate. It does not prove hosted
OpenETR relay behavior, a title-transfer authority decision, legal recognition,
or public Nostr event availability.

## Regenerate

```bash
OPENETR_SOURCE_DIR=/path/to/trbouma/openetr ATRIB_PACKET_WRITE_ARTIFACTS=1 pnpm --filter @atrib/integration openetr-transfer-source-packet
```

## Live upstream path

A live proof should wait until OpenETR has a pinned transfer-state fixture or a
stable adapter command. The live version should capture the OpenETR event ids
and relay query output as archive evidence, then submit only the verified atrib
records to the public log after the full flow passes.
