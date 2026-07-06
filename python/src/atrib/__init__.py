# SPDX-License-Identifier: Apache-2.0
"""atrib — verifiable agent actions, Python client SDK.

The first non-TypeScript implementation of the atrib record layer
(spec §1) and SDK contract (spec §5). Byte-identical to the TypeScript
implementation: identical inputs produce identical JCS canonical forms,
signatures, record hashes, and propagation tokens, verified against the
shared conformance corpora under ``spec/conformance/``.
"""

from .canon import (
    canonical_cross_attestation_input,
    canonical_record,
    canonical_signing_input,
    jcs,
)
from .attribution import (
    ATTRIBUTION_EXTENSION_KEY,
    ATTRIBUTION_LOG_SUBMISSION_STATUSES,
    AttributionReceiptBlock,
    AttributionReceiptConsistency,
    check_attribution_receipt_consistency,
    parse_attribution_receipt_block,
)
from .chain import chain_root, genesis_chain_root, resolve_chain_root
from .client import AnchorSpec, AtribClient, AttestRef, AttestResult, RecallOutcome
from .evidence import (
    EVIDENCE_TIERS,
    EvidenceConstraint,
    EvidenceEnvelope,
    EvidencePayload,
    EvidencePayloadRef,
    EvidenceResult,
    EvidenceVerifier,
    evidence_envelope_key,
    evidence_tier_rank,
)
from .content_id import compute_content_id, normalize_server_url
from .encoding import base64url_decode, base64url_encode, hex_decode, hex_encode
from .hashes import (
    derive_provenance_token,
    record_hash_bytes,
    record_hash_hex,
    record_hash_ref,
    sha256,
)
from .keys import ResolvedKey, resolve_key
from .mirror import (
    MirrorLine,
    append_mirror_line,
    default_mirror_read_path,
    default_mirror_write_path,
    mirror_tail_hash_hex,
    parse_mirror_line,
    read_mirror,
    read_mirror_tail,
)
from .records import (
    SYNTHETIC_SERVER_URL,
    build_and_sign_emit_record,
    content_hash,
    leaf_of_event_type_uri,
)
from .signing import (
    get_public_key,
    sign_record,
    sign_transaction_attestation,
    sign_transaction_record,
    verify_record,
)
from .submission import DEFAULT_LOG_ENDPOINT, SubmissionQueue, normalize_log_endpoint
from .token import DecodedToken, decode_token, encode_token
from .types import (
    EVENT_TYPE_ANNOTATION_URI,
    EVENT_TYPE_DIRECTORY_ANCHOR_URI,
    EVENT_TYPE_OBSERVATION_URI,
    EVENT_TYPE_REVISION_URI,
    EVENT_TYPE_TOOL_CALL_URI,
    EVENT_TYPE_TRANSACTION_URI,
    SPEC_VERSION,
    AtribRecord,
    SignerEntry,
    event_type_uri_to_byte,
    is_normative_event_type_uri,
    is_valid_event_type_uri,
    normalize_event_type,
)
from .validation import ValidationResult, validate_submission

__version__ = "0.1.0"

__all__ = [
    "ATTRIBUTION_EXTENSION_KEY",
    "ATTRIBUTION_LOG_SUBMISSION_STATUSES",
    "AnchorSpec",
    "AttributionReceiptBlock",
    "AttributionReceiptConsistency",
    "check_attribution_receipt_consistency",
    "parse_attribution_receipt_block",
    "AtribClient",
    "AtribRecord",
    "AttestRef",
    "AttestResult",
    "DecodedToken",
    "DEFAULT_LOG_ENDPOINT",
    "EVIDENCE_TIERS",
    "EvidenceConstraint",
    "EvidenceEnvelope",
    "EvidencePayload",
    "EvidencePayloadRef",
    "EvidenceResult",
    "EvidenceVerifier",
    "evidence_envelope_key",
    "evidence_tier_rank",
    "EVENT_TYPE_ANNOTATION_URI",
    "EVENT_TYPE_DIRECTORY_ANCHOR_URI",
    "EVENT_TYPE_OBSERVATION_URI",
    "EVENT_TYPE_REVISION_URI",
    "EVENT_TYPE_TOOL_CALL_URI",
    "EVENT_TYPE_TRANSACTION_URI",
    "MirrorLine",
    "RecallOutcome",
    "ResolvedKey",
    "SPEC_VERSION",
    "SignerEntry",
    "SubmissionQueue",
    "SYNTHETIC_SERVER_URL",
    "ValidationResult",
    "append_mirror_line",
    "base64url_decode",
    "base64url_encode",
    "build_and_sign_emit_record",
    "canonical_cross_attestation_input",
    "canonical_record",
    "canonical_signing_input",
    "chain_root",
    "compute_content_id",
    "content_hash",
    "decode_token",
    "default_mirror_read_path",
    "default_mirror_write_path",
    "derive_provenance_token",
    "encode_token",
    "event_type_uri_to_byte",
    "genesis_chain_root",
    "get_public_key",
    "hex_decode",
    "hex_encode",
    "is_normative_event_type_uri",
    "is_valid_event_type_uri",
    "jcs",
    "leaf_of_event_type_uri",
    "mirror_tail_hash_hex",
    "normalize_event_type",
    "normalize_log_endpoint",
    "normalize_server_url",
    "parse_mirror_line",
    "read_mirror",
    "read_mirror_tail",
    "record_hash_bytes",
    "record_hash_hex",
    "record_hash_ref",
    "resolve_chain_root",
    "resolve_key",
    "sha256",
    "sign_record",
    "sign_transaction_attestation",
    "sign_transaction_record",
    "validate_submission",
    "verify_record",
]
