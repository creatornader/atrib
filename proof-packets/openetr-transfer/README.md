# OpenETR transfer proof artifact

This proof signs an OpenETR-shaped transfer-control flow through `@atrib/mcp-wrap`.

## Action path

`openetr_issue -> openetr_transfer_initiate -> openetr_transfer_accept -> openetr_query_state -> openetr_recognize_title_transfer`

## What ran

- Upstream surface: OpenETR Python source at the pinned commit, executed against a local WebSocket Nostr relay and surfaced through MCP-shaped tools.
- Atrib path: `@atrib/mcp-wrap` around an MCP stdio server.
- Record policy: public records keep selected tool names plus `args_hash` and `result_hash`.
- Verification: `@atrib/mcp` verifies each Ed25519 record signature after the wrapper writes its mirror.
- Log proof: public atrib log.
- Publish policy: `accepted-run-after-verification`

## Record refs

| Tool                             | Record hash                                                             | Log index |
| -------------------------------- | ----------------------------------------------------------------------- | --------- |
| openetr_issue                    | sha256:10dcfd5dd70069c3bbad66d01e8b1dd1019278cdcb4bcc83c32a47cc2f193239 | 67285     |
| openetr_transfer_initiate        | sha256:4650779e83aa7700485f92146f1f441d0b4c5a06ff76ffca78246a89444e2282 | 67286     |
| openetr_transfer_accept          | sha256:0b9731064b1500502990b9ad45cbe795e0bef43c3625ee98d5fa3feecd32fe73 | 67287     |
| openetr_query_state              | sha256:6cc80fd0c7646e75550de7fd3e3d4c309f7c5349f5951f93d689fc857cad7eee | 67288     |
| openetr_recognize_title_transfer | sha256:2a517d6731303c198dca613ad23f5e27fcebb69bb1091f97674395dbf1d21686 | 67289     |

## Redaction line

The packet saw private OpenETR-shaped payloads: object digest, document label,
controller keys, relay URL, and event ids. The public artifact stores only
hashes for those fields. See `redaction-manifest.json`.

## Control-plane fit

OpenETR is the transferable-record control chain. atrib signs the agent action
chain around it. This packet sits before a system recognizes title transfer,
releases goods, updates an official register, or settles against the record.

A verifier can see which OpenETR-shaped actions ran, that the action records
verify, that raw OpenETR payloads stayed private, and that recognition ran only
after public relay event evidence, controller evidence, title authority
evidence, and legal/MLETR fixture evidence were present.

## Policy decision artifact

`policy-decision.json` models the next gate after the OpenETR accept event:
`recognize_title_transfer_with_fixture_attestations`. It binds to the signed OpenETR-shaped records,
local log indexes, verifier result, and redaction boundary.

Allowed without review: `internal_state_query`, `proof_packet_review`.

Escalated before execution: `recognize_transfer`, `release_goods`, `settle_against_warehouse_receipt`, `update_official_title_register`.

Policy decision hash: `sha256:a15330b883b5122fb8da0e7ee75e0f3fa07360c64ce3d4997cb17d73be09d70f`.

The policy decision file is deterministic and hash-bound to the signed records.
The stop-before-recognition decision is also signed as an atrib control record.

## Signed control records

The packet signs the title-recognition policy decision as atrib control evidence
before the risky recognition action can run.

| Kind            | Tool                             | Record hash                                                             | Log index |
| --------------- | -------------------------------- | ----------------------------------------------------------------------- | --------- |
| policy_decision | openetr_recognize_title_transfer | sha256:4ca37f5d92a2d7b438d2fac32b16eeda79e0404a874ddde7ef3694b85e4a1f3e | 67290     |
| policy_outcome  | openetr_recognize_title_transfer | sha256:9a639a30b2ed8343cf9d45f29fbada62f6ea2c6fe02b464a3236991fac904b21 | 67291     |

Stopped before: `none`.

Blocked tool executed: `false`.

## Public relay availability

`public-relay-availability.json` records the relay availability check status:
`events_available`.

Set `OPENETR_PUBLIC_RELAY_URLS=wss://relay.example,...` to probe public Nostr
relay availability for OpenETR event kinds. That probe checks relay connectivity
and Nostr responses. When `OPENETR_PUBLIC_RELAY_PUBLISH=1` is also set in
source-backed mode, the artifact also checks whether exact OpenETR events are
available from those relays.

Event availability status:
`available`.

## Recognition evidence

Recognition tool executed under signed fixture evidence. The fixture supplied a
title-transfer authority attestation, a legal/MLETR attestation, public event
availability evidence, and controller-semantics evidence.

Recognition authorized by fixture: `true`.

Controller semantics: `resolved_by_authority_attestation`.

Title authority attestation: `sha256:2ca76ce8f984f086ea2e66ffb63964883fb24b45d4b77fdc44c827966967e043`.

Legal/MLETR attestation: `sha256:f890ed223825a9c89a750a5a0ef64401d4c33ce4c7afbff22c7c962e8f5a9af8`.

## Source-backed OpenETR run

This artifact includes `source-run-output.json`, a sanitized summary of a real
OpenETR run from `trbouma/openetr` commit
`c97eb84f5790ff041ad14a1c30df0f71ceb8d3d9`.

The source-backed run executed:

- `openetr.services.issue_etr.publish_issue_etr`
- `openetr commands publish transfer initiate`
- `openetr commands publish transfer accept`
- `openetr.services.query_etr.build_query_etr_result`

Those calls always ran against a local WebSocket Nostr relay. When public relay
publish is enabled, the same OpenETR calls also publish to configured public
relays and this artifact checks exact event availability. Raw OpenETR event ids,
object digest, party keys, relay URL, and event JSON stay out of the public
artifact.

## Weakness

This is a source-backed public-relay fixture recognition proof. It checks
OpenETR source entrypoints, public relay event availability, wrapper record
chain, hash-only disclosure, verifier path, signed control records, controller
semantics, and signed fixture attestations. It does not prove a real title
registry decision, legal advice, or a jurisdictional legal conclusion.

## Regenerate

```bash
OPENETR_SOURCE_DIR=/path/to/trbouma/openetr \
OPENETR_PUBLIC_RELAY_URLS=wss://relay.example \
OPENETR_PUBLIC_RELAY_PUBLISH=1 \
OPENETR_FULL_RECOGNITION_FIXTURE=1 \
ATRIB_PACKET_PUBLIC_LOG=1 \
ATRIB_PACKET_WRITE_ARTIFACTS=1 \
pnpm --filter @atrib/integration openetr-transfer-source-packet
```

## Live upstream path

Source-backed mode runs the pinned OpenETR implementation. Full fixture mode can
publish to public relays, check exact event availability, sign demo authority
and legal attestations, execute title recognition, and submit accepted atrib
records to the public log when `ATRIB_PACKET_PUBLIC_LOG=1`.
