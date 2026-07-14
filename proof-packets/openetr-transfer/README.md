# OpenETR transfer proof artifact

This proof signs an OpenETR-shaped transfer-control flow through `@atrib/mcp-wrap`.

## Action path

`openetr_issue -> openetr_transfer_initiate -> openetr_transfer_accept -> openetr_query_state -> openetr_recognize_title_transfer`

## What ran

- Upstream surface: OpenETR Python source at the pinned commit, executed against a local WebSocket Nostr relay and surfaced through MCP-shaped tools.
- atrib path: `@atrib/mcp-wrap` around an MCP stdio server.
- Record policy: public records keep selected tool names plus `args_hash` and `result_hash`.
- Verification: `@atrib/mcp` verifies each Ed25519 record signature after the wrapper writes its mirror.
- Log proof: public atrib log.
- Publish policy: `accepted-run-after-verification`

## Record refs

| Tool                             | Record hash                                                             | Log index |
| -------------------------------- | ----------------------------------------------------------------------- | --------- |
| openetr_issue                    | sha256:6394952c63101e200ef3d70696cb08aa83e4b85a5e91a2ad64fa265993bd5da8 | 67520     |
| openetr_transfer_initiate        | sha256:398e49b26fd66ec51f19afa33072d935a3f9d803d057fbb6d0c21314e20f03c8 | 67521     |
| openetr_transfer_accept          | sha256:39f86c2a63846a0cffaad1cacaf3aefe7446f4edfe41123537b76c2f80dafd2b | 67522     |
| openetr_query_state              | sha256:174749c7c0d00251227651dcd10d0d69b219705da87e476986821552bd8e3f83 | 67523     |
| openetr_recognize_title_transfer | sha256:3802a1db11a84e6514b4a6c01ad6a024a6a22bf1a4e44d5f93e6ec9588e9db5c | 67524     |

## Redaction line

The packet saw private OpenETR-shaped payloads: object digest, document label,
controller keys, relay URL, and event ids. The public artifact stores only
hashes for those fields. See `redaction-manifest.json`.

## Control-plane fit

OpenETR is the transferable-record control chain. atrib signs the agent action
chain around it. This packet sits before a system recognizes title transfer,
releases goods, updates an official register, or settles against the record.

A verifier can see which OpenETR-shaped actions ran, that the action records
verify, that raw OpenETR payloads stayed private, and that recognition
ran only after public relay event evidence, controller evidence, title authority evidence, legal/MLETR evidence, and a matching authorization basis were present.

## Policy decision artifact

`policy-decision.json` models the next gate after the OpenETR accept event:
`recognize_title_transfer_with_operator_demo_evidence`. It binds to the signed OpenETR-shaped records,
local log indexes, verifier result, and redaction boundary.

Allowed without review: `internal_state_query`, `proof_packet_review`.

Escalated before execution: `recognize_transfer`, `release_goods`, `settle_against_warehouse_receipt`, `update_official_title_register`.

Policy decision hash: `sha256:c69acf4157e94f86d8cf95a7cdae2d6d6664c1620de26fabb5d07cd3ff36ee36`.

The policy decision file is deterministic and hash-bound to the signed records.
The stop-before-recognition decision is also signed as an atrib control record.

## Signed control records

The packet signs the title-recognition policy decision as atrib control evidence
before the risky recognition action can run.

| Kind            | Tool                             | Record hash                                                             | Log index |
| --------------- | -------------------------------- | ----------------------------------------------------------------------- | --------- |
| policy_decision | openetr_recognize_title_transfer | sha256:03cf5ce10301a84d618e798c19c3ab90eae2a183ebab7991bb2f388c640f9c46 | 67525     |
| policy_outcome  | openetr_recognize_title_transfer | sha256:fbcacfe6e0e5f66aa684875a271da1e90d0eb7ef5325aad7197e0c26dc4909ae | 67526     |

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

Recognition tool executed under `operator_demo_evidence`. The packet supplied
public event availability evidence, controller-semantics evidence, title
authority evidence, legal/MLETR evidence, and an MLETR source checklist.

Authorization basis: `operator_demo_evidence`.

Authorized by evidence: `true`.

Legacy fixture authorization: `false`.

Controller semantics: `resolved_by_authority_attestation`.

Title authority evidence: `sha256:fc2651538de6ccb3da77abbe2472ba62ef270d68954acf98b4a1a2f22ad08cd4` (`operator_demo_tta`).

Legal/MLETR evidence: `sha256:be1dd2d46097675c9785cec96752b2814a0e9546b62b14de9ae4dafe8769ba5d` (`operator_demo_attestation`).

MLETR source checklist: `source_backed_criteria_present`.

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

This is a source-backed public-relay operator-demo recognition proof. It checks
OpenETR source entrypoints, public relay event availability, wrapper record
chain, hash-only disclosure, verifier path, signed control records, controller
semantics, a Nostr-shaped operator-demo TTA event, and signed operator-demo
legal/MLETR evidence. It does not prove a real title registry decision, legal
advice, or a jurisdictional legal conclusion.

## Regenerate

```bash
OPENETR_SOURCE_DIR=/path/to/trbouma/openetr \
OPENETR_PUBLIC_RELAY_URLS=wss://relay.example \
OPENETR_PUBLIC_RELAY_PUBLISH=1 \
OPENETR_OPERATOR_DEMO_TTA=1 \
OPENETR_OPERATOR_DEMO_LEGAL_ATTESTOR=1 \
ATRIB_PACKET_PUBLIC_LOG=1 \
ATRIB_PACKET_WRITE_ARTIFACTS=1 \
pnpm --filter @atrib/integration openetr-transfer-source-packet
```

## Live upstream path

Source-backed mode runs the pinned OpenETR implementation. Public proof mode can
publish to public relays, check exact event availability, ingest a configured
external TTA Nostr event, or generate an operator-demo TTA Nostr event. It can
also verify external legal/MLETR attestations or sign an operator-demo reviewer
attestation before executing title recognition and submitting accepted atrib
records to the public log when `ATRIB_PACKET_PUBLIC_LOG=1`.
