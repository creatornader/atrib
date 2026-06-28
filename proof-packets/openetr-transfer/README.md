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
| openetr_issue             | sha256:7c97724da8180d06df44ec21d638a13a9feab33b1d24ee4a3c5c61b084da4139 | 0               |
| openetr_transfer_initiate | sha256:634a24c5fc95f947d061ae54ceca963b8e6090d9792a8bcf867501ca66ed8245 | 1               |
| openetr_transfer_accept   | sha256:a6dd00d4ec0e748b5531a6cbbe510c2a28dbd1f02f02481deb60c7ba366a0882 | 2               |
| openetr_query_state       | sha256:f95bfb80f00bbbd8f47aec95ab91e22faf5c90ebc0b36fe133def30f2c8675c5 | 3               |

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

Policy decision hash: `sha256:d2f24676360b712d848cecfe821ab47d8e122695e35b52392ad1d9016842125a`.

The policy decision file is deterministic and hash-bound to the signed records.
The stop-before-recognition decision is also signed as an atrib control record.

## Signed control records

The packet signs the title-recognition policy decision as atrib control evidence
before the risky recognition action can run.

| Kind            | Tool                             | Record hash                                                             | Local log index |
| --------------- | -------------------------------- | ----------------------------------------------------------------------- | --------------- |
| policy_decision | openetr_recognize_title_transfer | sha256:a0489deac4104b10ed566bd735fae487e7893e2ca215c856a42c48acf86a74c8 | 4               |
| policy_outcome  | openetr_recognize_title_transfer | sha256:557f7a22c1babba6df9c9b63aafa6f7f118af076ed1dcdde96fbe118b5f18ef4 | 5               |

Stopped before: `openetr_recognize_title_transfer`.

Blocked tool executed: `false`.

## Public relay availability

`public-relay-availability.json` records the relay availability check status:
`not_requested`.

Set `OPENETR_PUBLIC_RELAY_URLS=wss://relay.example,...` to probe public Nostr
relay availability for OpenETR event kinds. That probe checks relay connectivity
and Nostr responses. It does not prove the transfer events were published to the
public relay.

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
