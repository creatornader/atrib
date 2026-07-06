# SPDX-License-Identifier: Apache-2.0
"""JCS canonicalization (RFC 8785) for atrib records (§1.3).

Uses the ``rfc8785`` package (the reference Python JCS implementation) so
number serialization matches ECMAScript exactly — a record canonicalized
here is byte-identical to one canonicalized by the ``canonicalize`` npm
package in ``@atrib/mcp``.

The signing input is the JCS serialization of the record with the
``signature`` field removed (§1.4.2). The record hash preimage is the JCS
serialization of the COMPLETE record including ``signature`` (§1.2.3).
Never conflate the two.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, cast

import rfc8785


def jcs(value: object) -> bytes:
    """JCS-serialize any JSON-compatible value to UTF-8 bytes.

    Non-I-JSON inputs (integers outside the 2^53-1 float domain, lone
    UTF-16 surrogates) raise ValueError subclasses. This is a deliberate,
    documented cross-implementation boundary: the JS runtime canonicalizes
    such inputs (lossily for big integers) because JS numbers are already
    doubles and JS strings tolerate lone surrogates, while RFC 8785 §3.2.2.3
    + I-JSON put them out of interoperable range. Rejecting keeps Python
    from producing content commitments no other implementation can
    reproduce. Key-position surrogates are normalized to the same error
    class as value-position ones (rfc8785 otherwise leaks the codec error).
    """
    # Type-only cast: rfc8785.dumps is annotated with a recursive JSON
    # union (its private _Value alias); this API deliberately accepts any
    # JSON-compatible object and lets rfc8785 raise on non-JSON input.
    try:
        out = rfc8785.dumps(cast(Any, value))
    except UnicodeEncodeError as exc:
        raise rfc8785.CanonicalizationError(
            "input contains non-UTF-8 codepoints"
        ) from exc
    if isinstance(out, str):  # rfc8785 < 0.1 compatibility
        return out.encode("utf-8")
    return out


def canonical_signing_input(record: Mapping[str, object]) -> bytes:
    """§1.4.2: JCS of the record with ``signature`` removed entirely."""
    unsigned = {key: value for key, value in record.items() if key != "signature"}
    return jcs(unsigned)


def canonical_record(record: Mapping[str, object]) -> bytes:
    """Canonical form of a signed record, including ``signature`` (for hashing)."""
    return jcs(dict(record))


def canonical_cross_attestation_input(record: Mapping[str, object]) -> bytes:
    """§1.7.6 (D052): JCS of the record with ``signers`` set to ``[]`` and the
    top-level ``signature`` omitted. All transaction signers sign these bytes."""
    rest = {
        key: value for key, value in record.items() if key not in ("signature", "signers")
    }
    rest["signers"] = []
    return jcs(rest)
