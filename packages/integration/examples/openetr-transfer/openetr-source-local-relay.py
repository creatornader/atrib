# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import subprocess
from typing import Any

import websockets
from click.testing import CliRunner
from monstr.encrypt import Keys

from openetr.commands.publish import transfer_group
from openetr.services.issue_etr import publish_issue_etr
from openetr.services.query_etr import build_query_etr_result


EXPECTED_OPENETR_COMMIT = "c97eb84f5790ff041ad14a1c30df0f71ceb8d3d9"
DOCUMENT_BYTES = b"atrib openetr source backed local relay proof"


def stable_key(label: str) -> Keys:
    return Keys(priv_k=hashlib.sha256(label.encode("utf-8")).hexdigest())


def sha256_text(value: str) -> str:
    return f"sha256:{hashlib.sha256(value.encode('utf-8')).hexdigest()}"


def first_tag(event: dict[str, Any], name: str) -> str | None:
    for tag in event.get("tags", []):
        if isinstance(tag, list) and len(tag) > 1 and tag[0] == name:
            return str(tag[1])
    return None


def match_filter(event: dict[str, Any], event_filter: dict[str, Any]) -> bool:
    if "ids" in event_filter and event.get("id") not in event_filter["ids"]:
        return False
    if "authors" in event_filter and event.get("pubkey") not in event_filter["authors"]:
        return False
    if "kinds" in event_filter and event.get("kind") not in event_filter["kinds"]:
        return False
    for key, values in event_filter.items():
        if not key.startswith("#"):
            continue
        tag_name = key[1:]
        tag_values = {
            str(tag[1])
            for tag in event.get("tags", [])
            if isinstance(tag, list) and len(tag) > 1 and tag[0] == tag_name
        }
        if not tag_values.intersection({str(value) for value in values}):
            return False
    return True


class LocalNostrRelay:
    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []
        self._server: Any = None
        self.url = ""

    async def __aenter__(self) -> "LocalNostrRelay":
        logging.getLogger("websockets.server").setLevel(logging.CRITICAL)
        self._server = await websockets.serve(self._handler, "127.0.0.1", 0)
        port = self._server.sockets[0].getsockname()[1]
        self.url = f"ws://127.0.0.1:{port}"
        return self

    async def __aexit__(self, exc_type: object, exc: object, tb: object) -> None:
        self._server.close()
        await self._server.wait_closed()

    async def _handler(self, websocket: Any) -> None:
        async for raw_message in websocket:
            message = json.loads(raw_message)
            if not message:
                continue
            message_type = message[0]
            if message_type == "EVENT":
                event = message[1]
                if not any(existing.get("id") == event.get("id") for existing in self.events):
                    self.events.append(event)
                await websocket.send(json.dumps(["OK", event.get("id"), True, "stored"]))
            elif message_type == "REQ":
                subscription_id = message[1]
                filters = message[2:]
                matched = [
                    event
                    for event in self.events
                    if any(match_filter(event, event_filter) for event_filter in filters)
                ]
                limit = None
                for event_filter in filters:
                    candidate = event_filter.get("limit")
                    if isinstance(candidate, int):
                        limit = candidate if limit is None else min(limit, candidate)
                for event in matched[:limit]:
                    await websocket.send(json.dumps(["EVENT", subscription_id, event]))
                await websocket.send(json.dumps(["EOSE", subscription_id]))


def invoke_transfer(args: list[str], root_nsec: str, relays: str, input_text: str = "y\n") -> str:
    runner = CliRunner(env={"OPENETR_ROOT_NSEC": root_nsec, "OPENETR_HOME_RELAYS": relays})
    result = runner.invoke(transfer_group, args, input=input_text)
    if result.exit_code != 0:
        raise RuntimeError(f"openetr transfer command failed: args={args} output={result.output}")
    return result.output


def event_by_action(events: list[dict[str, Any]], action: str) -> dict[str, Any]:
    for event in reversed(events):
        if event.get("kind") == 31416 and first_tag(event, "action") == action:
            return event
    raise RuntimeError(f"missing OpenETR {action} event")


async def run_source_e2e() -> dict[str, Any]:
    source_dir = os.environ.get("OPENETR_SOURCE_DIR")
    if not source_dir:
        raise RuntimeError("OPENETR_SOURCE_DIR must point at a trbouma/openetr checkout")
    commit = subprocess.check_output(
        ["git", "-C", source_dir, "rev-parse", "HEAD"],
        text=True,
    ).strip()
    if commit != EXPECTED_OPENETR_COMMIT:
        raise RuntimeError(f"unexpected OpenETR commit {commit}, expected {EXPECTED_OPENETR_COMMIT}")

    seller = stable_key("atrib-openetr-seller")
    buyer = stable_key("atrib-openetr-buyer")
    digest = hashlib.sha256(DOCUMENT_BYTES).hexdigest()

    async with LocalNostrRelay() as relay:
        issue = await publish_issue_etr(
            filename="atrib-openetr-source-proof.txt",
            size_bytes=len(DOCUMENT_BYTES),
            digest=digest,
            relays=relay.url,
            signer_nsec=seller.private_key_bech32(),
            comment="source-backed OpenETR issue",
            publish_wait=0.2,
            timeout=2,
            limit=20,
        )
        initiate_output = await asyncio.to_thread(
            invoke_transfer,
            [
                "initiate",
                "--prior-event",
                issue["event_id"],
                "--transferee",
                buyer.public_key_bech32(),
                "--as-user",
                seller.private_key_bech32(),
                "--relays",
                relay.url,
                "--force",
                "--publish-wait",
                "0.2",
                "--query-timeout",
                "2",
                "--limit",
                "20",
                "--verify",
                "any",
            ],
            seller.private_key_bech32(),
            relay.url,
        )
        initiate_event = event_by_action(relay.events, "initiate")
        accept_output = await asyncio.to_thread(
            invoke_transfer,
            [
                "accept",
                "--initiate-event",
                initiate_event["id"],
                "--as-user",
                buyer.private_key_bech32(),
                "--relays",
                relay.url,
                "--force",
                "--publish-wait",
                "0.2",
                "--query-timeout",
                "2",
                "--limit",
                "20",
                "--verify",
                "any",
            ],
            seller.private_key_bech32(),
            relay.url,
            "y\n",
        )
        accept_event = event_by_action(relay.events, "accept")
        query = await build_query_etr_result(digest=digest, relays=relay.url, timeout=2, limit=20)

    origin_event = next(event for event in relay.events if event.get("kind") == 31415)
    current_controller = query.get("current_controller") or {}
    current_controller_npub = current_controller.get("npub")
    checks = {
        "origin_kind_31415": origin_event.get("kind") == 31415,
        "initiate_kind_31416": initiate_event.get("kind") == 31416,
        "accept_kind_31416": accept_event.get("kind") == 31416,
        "initiate_action_tag": first_tag(initiate_event, "action") == "initiate",
        "accept_action_tag": first_tag(accept_event, "action") == "accept",
        "initiate_p_tag_matches_buyer": first_tag(initiate_event, "p") == buyer.public_key_hex(),
        "accept_p_tag_matches_initiator": first_tag(accept_event, "p") == seller.public_key_hex(),
        "query_controller_is_buyer": current_controller_npub == buyer.public_key_bech32(),
        "query_controller_is_initiator": current_controller_npub == seller.public_key_bech32(),
    }
    return {
        "schema": "atrib.openetr.source_local_relay_run.v1",
        "source": {
            "repo": "https://github.com/trbouma/openetr",
            "commit": commit,
            "entrypoints": [
                "openetr.services.issue_etr.publish_issue_etr",
                "openetr.commands.publish.transfer initiate",
                "openetr.commands.publish.transfer accept",
                "openetr.services.query_etr.build_query_etr_result",
            ],
        },
        "runtime": {
            "relay": "local-websocket-nostr-relay",
            "live_public_relay": False,
            "openetr_user_config_written": False,
        },
        "object": {
            "digest": digest,
            "document_hash": sha256_text(DOCUMENT_BYTES.decode("utf-8")),
        },
        "parties": {
            "issuer_npub": seller.public_key_bech32(),
            "issuer_pubkey_hex": seller.public_key_hex(),
            "buyer_npub": buyer.public_key_bech32(),
            "buyer_pubkey_hex": buyer.public_key_hex(),
        },
        "commands": {
            "issue": issue,
            "transfer_initiate_output": initiate_output,
            "transfer_accept_output": accept_output,
        },
        "events": {
            "origin": origin_event,
            "initiate": initiate_event,
            "accept": accept_event,
        },
        "query": {
            "current_controller": current_controller,
            "summary_control_chains": query.get("summary_control_chains", []),
        },
        "checks": checks,
        "warnings": [
            {
                "id": "accept_p_tag_points_to_initiator",
                "present": checks["accept_p_tag_matches_initiator"],
            },
            {
                "id": "query_reports_initiator_after_accept",
                "present": checks["query_controller_is_initiator"],
            },
        ],
    }


def main() -> None:
    print(json.dumps(asyncio.run(run_source_e2e()), sort_keys=True))


if __name__ == "__main__":
    main()
