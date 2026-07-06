# SPDX-License-Identifier: Apache-2.0
"""The canonical atrib attribution record (§1.2) and event vocabulary (§1.2.4).

Records are plain dicts at the wire/canonicalization boundary (JCS operates
on the JSON value, and optional-field OMISSION — not null — changes the
signature). ``AtribRecord`` is a TypedDict so the shape is fully typed
without forcing a serialization-visible container.
"""

from __future__ import annotations

import re
from typing import TypedDict

from typing_extensions import NotRequired

SPEC_VERSION = "atrib/1.0"

EVENT_TYPE_TOOL_CALL_URI = "https://atrib.dev/v1/types/tool_call"
EVENT_TYPE_TRANSACTION_URI = "https://atrib.dev/v1/types/transaction"
EVENT_TYPE_OBSERVATION_URI = "https://atrib.dev/v1/types/observation"
EVENT_TYPE_DIRECTORY_ANCHOR_URI = "https://atrib.dev/v1/types/directory_anchor"
EVENT_TYPE_ANNOTATION_URI = "https://atrib.dev/v1/types/annotation"
EVENT_TYPE_REVISION_URI = "https://atrib.dev/v1/types/revision"

EVENT_TYPE_SHORT_TO_URI: dict[str, str] = {
    "tool_call": EVENT_TYPE_TOOL_CALL_URI,
    "transaction": EVENT_TYPE_TRANSACTION_URI,
    "observation": EVENT_TYPE_OBSERVATION_URI,
    "directory_anchor": EVENT_TYPE_DIRECTORY_ANCHOR_URI,
    "annotation": EVENT_TYPE_ANNOTATION_URI,
    "revision": EVENT_TYPE_REVISION_URI,
}

NORMATIVE_EVENT_TYPE_URIS = frozenset(EVENT_TYPE_SHORT_TO_URI.values())

# Agent-facing compatibility aliases mirroring @atrib/mcp types.ts: short
# names plus atrib.dev typo paths whose final leaf is already normative.
EVENT_TYPE_ALIAS_TO_URI: dict[str, str] = dict(EVENT_TYPE_SHORT_TO_URI)
for _name, _uri in EVENT_TYPE_SHORT_TO_URI.items():
    for _path in ("/event/", "/events/", "/v1/event/", "/v1/events/"):
        EVENT_TYPE_ALIAS_TO_URI[f"https://atrib.dev{_path}{_name}"] = _uri

# §2.3.1 log entry event_type byte mapping.
EVENT_TYPE_URI_TO_BYTE: dict[str, int] = {
    EVENT_TYPE_TOOL_CALL_URI: 0x01,
    EVENT_TYPE_TRANSACTION_URI: 0x02,
    EVENT_TYPE_OBSERVATION_URI: 0x03,
    EVENT_TYPE_DIRECTORY_ANCHOR_URI: 0x04,
    EVENT_TYPE_ANNOTATION_URI: 0x05,
    EVENT_TYPE_REVISION_URI: 0x06,
}
EVENT_TYPE_EXTENSION_BYTE = 0xFF


class SignerEntry(TypedDict):
    """One entry in the §1.7.6 transaction-record signers array."""

    creator_key: str
    signature: str


class AtribRecord(TypedDict):
    """A signed attribution record (§1.2). Optional fields MUST be omitted
    (never null) when absent — presence changes the JCS form and signature."""

    spec_version: str
    content_id: str
    creator_key: str
    chain_root: str
    event_type: str
    context_id: str
    timestamp: int
    signature: NotRequired[str]
    annotates: NotRequired[str]
    args_hash: NotRequired[str]
    args_salt: NotRequired[str]
    result_hash: NotRequired[str]
    result_salt: NotRequired[str]
    revises: NotRequired[str]
    informed_by: NotRequired[list[str]]
    provenance_token: NotRequired[str]
    session_token: NotRequired[str]
    timestamp_granularity: NotRequired[str]
    tool_name: NotRequired[str]
    signers: NotRequired[list[SignerEntry]]


# Port of the TS regex /^([A-Za-z][A-Za-z0-9+\-.]*):(.+)$/ — in JS, `.`
# excludes newlines and `$` anchors at the true end of string, so Python
# needs no DOTALL and \Z (not $, which would accept a trailing newline).
_EVENT_TYPE_SCHEME_RE = re.compile(r"^([A-Za-z][A-Za-z0-9+\-.]*):(.+)\Z")


def normalize_event_type(value: str) -> str:
    """Normalize a short alias / known typo path to its canonical URI.
    Unknown values pass through unchanged."""
    return EVENT_TYPE_ALIAS_TO_URI.get(value, value)


def is_valid_event_type_uri(value: object) -> bool:
    """§1.4.5 syntactic validation — port of @atrib/mcp isValidEventTypeUri.
    Does NOT check normative-set membership; extension URIs pass."""
    if not isinstance(value, str):
        return False
    if len(value) == 0 or len(value) > 256:
        return False
    if "#" in value:
        return False
    match = _EVENT_TYPE_SCHEME_RE.match(value)
    if not match:
        return False
    scheme, rest = match.group(1), match.group(2)
    if len(rest) == 0:
        return False
    if scheme in ("http", "https"):
        if not rest.startswith("//"):
            return False
        after_authority = rest[2:]
        host = re.split(r"[/?]", after_authority, maxsplit=1)[0]
        if len(host) == 0:
            return False
    return True


def is_normative_event_type_uri(uri: str) -> bool:
    """True iff the URI is in atrib's normative set (informational only)."""
    return uri in NORMATIVE_EVENT_TYPE_URIS


def event_type_uri_to_byte(uri: str) -> int:
    """§2.3.1 event_type byte for a URI; extensions map to 0xFF."""
    return EVENT_TYPE_URI_TO_BYTE.get(uri, EVENT_TYPE_EXTENSION_BYTE)
