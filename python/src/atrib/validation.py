# SPDX-License-Identifier: Apache-2.0
"""§2.6.1 submission validation (client-side parity).

Port of ``packages/mcp/src/validation.ts``: Steps 2–5 plus required-field
presence checks. Step 1 (Ed25519 verification) lives in
:func:`atrib.signing.verify_record`; Step 6 (idempotency) is server state.
The 10-minute future-skew window matches the log server's tolerance
(client-side §1.4.3 verification uses the tighter 5-minute window).
"""

from __future__ import annotations

import re
import time
from collections.abc import Mapping
from dataclasses import dataclass

from .types import SPEC_VERSION, is_valid_event_type_uri

_MAX_FUTURE_SKEW_MS = 10 * 60 * 1000
_SHA256_REF_RE = re.compile(r"^sha256:[0-9a-f]{64}\Z")
_CONTEXT_ID_RE = re.compile(r"^[0-9a-f]{32}\Z")


@dataclass(frozen=True)
class ValidationResult:
    ok: bool
    status: int | None = None
    error: str | None = None


def _reject(error: str) -> ValidationResult:
    return ValidationResult(ok=False, status=400, error=error)


def _is_integral_number(value: object) -> bool:
    """Port of JS Number.isInteger over parsed-JSON values: ints and
    integral floats qualify; bools (Python ints) do not — JS `typeof true`
    is not 'number'."""
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        return True
    return isinstance(value, float) and value.is_integer()


def validate_submission(
    record: object, *, now_ms: int | None = None
) -> ValidationResult:
    """Validate a §2.6.1 submission body. ``now_ms`` injects the clock so
    corpus harnesses can pin the manifest's reference time."""
    if not isinstance(record, Mapping):
        return _reject(f"spec_version must be '{SPEC_VERSION}'")

    # Step 2: spec_version.
    if record.get("spec_version") != SPEC_VERSION:
        return _reject(f"spec_version must be '{SPEC_VERSION}'")

    # Step 3: event_type syntactic URI validity (extensions pass).
    if not is_valid_event_type_uri(record.get("event_type")):
        return _reject("event_type must be a syntactically-valid absolute URI")

    # Step 4: timestamp integer, not >10min in the future. Integral floats
    # pass: JSON "1.0e12" parses to the same JS number as "1000000000000",
    # and the TS reference (Number.isInteger) accepts it — Python must not
    # be stricter on identical wire bytes.
    timestamp = record.get("timestamp")
    if not _is_integral_number(timestamp) or not isinstance(timestamp, (int, float)):
        return _reject("timestamp must be a non-negative integer")
    if timestamp < 0:
        return _reject("timestamp must be a non-negative integer")
    now = int(time.time() * 1000) if now_ms is None else now_ms
    if timestamp - now > _MAX_FUTURE_SKEW_MS:
        return _reject("timestamp is more than 10 minutes in the future")

    # Step 5: context_id exactly 32 lowercase hex chars.
    context_id = record.get("context_id")
    if not isinstance(context_id, str) or not _CONTEXT_ID_RE.match(context_id):
        return _reject("context_id must be 32 lowercase hex characters")

    # Required string fields for record_hash computation.
    for field in ("creator_key", "chain_root", "content_id", "signature"):
        if not isinstance(record.get(field), str):
            return _reject(f"{field} is required and must be a string")

    if not _SHA256_REF_RE.match(str(record.get("chain_root"))):
        return _reject("chain_root must match sha256:<64-hex>")

    if not _SHA256_REF_RE.match(str(record.get("content_id"))):
        return _reject("content_id must match sha256:<64-hex>")

    if "session_token" in record and not isinstance(record.get("session_token"), str):
        return _reject("session_token must be a string when present")

    if "informed_by" in record:
        informed_by = record.get("informed_by")
        if not isinstance(informed_by, list):
            return _reject("informed_by must be an array when present")
        for ref in informed_by:
            if not isinstance(ref, str) or not _SHA256_REF_RE.match(ref):
                return _reject("informed_by entries must each match sha256:<64-hex>")

    return ValidationResult(ok=True)
