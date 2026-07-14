# atrib (Python SDK)

Python client SDK for [atrib](https://atrib.dev): verifiable agent
actions. Every action becomes signed context for the next.

This is the first non-TypeScript implementation of the atrib record layer
(spec [§1](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#1-attribution-record-format)) and SDK contract (spec [§5](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#5-sdk-specification)). The guarantee that matters:
**byte-identity**. Identical inputs produce identical JCS canonical forms
(RFC 8785), Ed25519 signatures over the same bytes, identical record
hashes, propagation tokens, and chain roots as the TypeScript
implementation, verified against the shared conformance corpora in
`spec/conformance/` (1.4 signing + adversarial, 1.2.6 provenance_token,
1.2.3 multi-producer chain composition, 2.6.1 submission validation) and a
cross-implementation determinism harness.

## Install

```bash
pip install atrib          # once published; unpublished today, install from source:
pip install -e python/
```

Dependencies: `cryptography` (Ed25519), `rfc8785` (JCS), `typing_extensions`.

## Usage

```python
from atrib import AtribClient, AttestRef

client = AtribClient()  # key from ATRIB_PRIVATE_KEY / ATRIB_KEY_FILE

result = client.attest(
    {"what": "chose sqlite over postgres", "why_noted": "deployment constraint"},
)

client.attest(
    {"summary": "supersedes the sqlite decision", "reason": "scale changed"},
    ref=AttestRef(kind="revises", record_hash=result.record_hash),
)

history = client.recall(shape="history", limit=10)
client.flush()
```

The record layer is directly importable for hosts that own their pipeline:

```python
from atrib import (
    build_and_sign_emit_record, sign_record, verify_record,
    resolve_chain_root, genesis_chain_root, record_hash_ref,
    encode_token, decode_token, derive_provenance_token,
)
```

## API reference

Everything below is importable from the package root (`from atrib import …`).
The client layer (`AtribClient` and its result dataclasses) sits on top of a
fully exposed record layer; hosts can use either level.

### `AtribClient`

```python
AtribClient(
    *,
    key=...,                  # ResolvedKey | None | unset
    context_id=None,          # str | None (32 lowercase hex)
    anchors=None,             # list[AnchorSpec] | None
    allow_single_anchor=False,  # §2.11.12 rule 3 opt-in
    producer="atrib-sdk-py",  # _local.producer sidecar label (DEFAULT_PRODUCER)
    mirror_write_path=None,   # Path | str | None
    mirror_read_path=None,    # Path | str | None
    env=None,                 # Mapping[str, str] | None (default os.environ)
)
```

Constructor parameters (all keyword-only):

| Parameter | Default | Meaning |
| --- | --- | --- |
| `key` | unset → lazy `resolve_key(env)` ladder | Pre-resolved `ResolvedKey`. Passing the parameter at all (including `None`) skips the ladder; `None` disables signing (pass-through per [§5.8](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#58-degradation-contract) rule 5). |
| `context_id` | `None` → env discovery | Per-client default context. Env discovery is the [D078](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default)/[D083](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers) subset: `ATRIB_CONTEXT_ID`, then `CLAUDE_CODE_SESSION_ID` / `CODEX_THREAD_ID` (UUID stripped of hyphens + lowercased to 32-hex). |
| `anchors` | `None` → `BUILT_IN_DEFAULT_ANCHOR_SET` (two anchors; the atrib-log member honors `$ATRIB_LOG_ENDPOINT`) | [D138](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d138-anchor-plurality-as-the-default-trust-posture) anchor set (`AnchorSpec = str \| Mapping`: bare [§2.6.1](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#261-submit-entry) endpoint shorthand for `{"url": ...}`, or an `AnchorDescriptor` mapping; `url` wins over `endpoint`). Skip rules mirror the TS `resolveAnchorSet` exactly: hostile shapes and `anchor_type` values outside the [§2.11.8](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#2118-anchor-type-registry) registry warn-and-skip (never raise) and are excluded from the plurality posture. Attests fan out to **every** usable atrib-log anchor through one non-blocking [§2.6.1](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#261-submit-entry) queue per endpoint; registered non-atrib-log types (`sigstore-rekor`, `rfc3161-tsa`, `opentimestamps`) count toward plurality but their legs are skipped with a warning: no Python transport yet (the TS reference stubs them too). |
| `allow_single_anchor` | `False` | [§2.11.12](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#21112-producer-side-anchor-posture) rule 3: states a < 2-anchor set is deliberate, silencing the sub-plurality warning and the `_local.anchor_config` sidecar degradation marker. |
| `producer` | `"atrib-sdk-py"` | `_local.producer` mirror-sidecar label ([§5.9](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#59-local-mirror-conventions)). |
| `mirror_write_path` | `default_mirror_write_path(env)` | Where new records are appended. |
| `mirror_read_path` | `default_mirror_read_path(env)` | Shared chain-inheritance read source. |
| `env` | `os.environ` | Injectable environment mapping (for tests and embedded hosts). |

The client is a context manager: `__exit__` flushes the submission queue
with a 5-second deadline and never raises.

#### `attest(content, *, ...) -> AttestResult`

```python
client.attest(
    content,                  # Mapping[str, object]: required, positional
    event_type=None,          # short name or absolute URI; default 'observation'
    ref=None,                 # AttestRef(kind='annotates'|'revises', record_hash=...)
    informed_by=None,         # list[str] of sha256:<64-hex> refs
    context_id=None,          # overrides the client default
    chain_root=None,          # explicit override (requires a context_id)
    provenance_token=None,    # §1.2.6 genesis-only anchor (see below)
    tool_name=None,
    args_hash=None,           # overrides the D099 default sha256(JCS(content))
    result_hash=None,
    timestamp_ms=None,        # clock injection for deterministic tests
)
```

Single write verb; signs in-process via the ported record layer and mirrors
+ submits per [§5.9](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#59-local-mirror-conventions)/[§5.3.5](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#535-log-submission).
The **only raise paths are contradictory inputs** (`ValueError`): an invalid
`event_type` URI, a `ref.kind` that contradicts an explicit `event_type`, an
unknown `ref.kind`, an `annotates`/`revises` ref that is not
`sha256:<64-hex>`, an annotation/revision `event_type` without the matching
`ref`, an explicit `chain_root` with no resolvable `context_id`, a
`context_id` that is not 32 lowercase hex, or a `provenance_token` on a
context that already has records on the local mirror (the
[§1.2.6](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#126-provenance_token)
genesis-only invariant). Everything operational degrades:

- No signing key → pass-through result (`via="none"`, `record_hash=None`)
  with a warning.
- No context_id anywhere → a fresh orphan context is synthesized
  ([§1.5.1](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#151-context_id-the-session-anchor);
  never inherited from the mirror tail) with a warning.
- Signing, mirror-write, or submission-enqueue failures append warnings and
  never raise.

The default `chain_root` comes from `resolve_chain_root` with the mirror
tail (write mirror preferred, then the read source, the `@atrib/emit`
inheritance ordering). The mirror sidecar carries
`{"producer": ..., "content": ...}`; the signed record commits to content
through the default `args_hash` per
[D099](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d099-explicit-emit-records-commit-local-content-through-default-args_hash).

`AttestRef` is a frozen dataclass: `AttestRef(kind, record_hash)` with
`kind` one of `'annotates'` / `'revises'` (deriving event types
`annotation` / `revision`).

`AttestResult` (frozen dataclass): `record_hash` (`sha256:<64-hex>` or
`None`), `context_id`, `via` (`'in-process' | 'none'`), `warnings`
(`atrib:`-prefixed strings), and `anchor_posture`, the resolved
[§2.11.12](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#21112-producer-side-anchor-posture)
posture dict `{"effective_anchor_count", "used_default_set", "warned"}`
(present even in pass-through mode). When a sub-plurality set lacks
`allow_single_anchor`, the mirror sidecar additionally carries the
`_local.anchor_config` degradation marker
`{"configured": <n>, "allow_single_anchor": false}`.

#### `recall(*, shape="history", ...) -> RecallOutcome`

```python
client.recall(
    shape="history",          # 'history' | 'session_chain' in v0
    context_id=None,          # session_chain defaults from the client
    event_type=None,          # short name or URI (normalized)
    creator_key=None,
    limit=10,
    since_ms=None,
    until_ms=None,
    verify_signatures=True,
)
```

Single read verb over the local mirror (read source + write mirror, newest
first). v0 serves the `history` and `session_chain` shapes; any other shape
degrades to `via="none"` with a warning pointing at the TypeScript SDK or
the primitives runtime, and never raises. With `verify_signatures=True`
(default), records failing
[§1.4.3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#143-verification-procedure)
verification are dropped and each returned entry carries
`signature_verified`. Entries carry `record_hash`, `event_type`,
`context_id`, `creator_key`, `timestamp`, and `local_content` when the
mirror sidecar kept the content.

`RecallOutcome` (frozen dataclass): `shape`, `via`
(`'in-process' | 'none'`), `data` (`{"total", "returned", "records"}` or
`None`), `warnings`.

#### `flush(deadline_s=30.0) -> None`

Bounded wait for pending log submissions on **every** anchor leg (one
queue per effective atrib-log anchor). Never raises.

### Record layer: signing and verification ([§1.4](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#14-signing-and-verification))

- `sign_record(record, private_key) -> AtribRecord`:
  [§1.4.2](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#142-signing-procedure):
  remove `signature`, JCS-serialize, Ed25519-sign with a 32-byte seed,
  base64url. Optional fields keep their exact presence/absence (omission ≠
  null).
- `verify_record(record, *, now_ms=None) -> bool`:
  [§1.4.3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#143-verification-procedure),
  all 8 steps (key decode, signature decode, JCS-minus-signature Ed25519
  verify (or the creator's `signers[]` entry over
  [§1.7.6](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#176-cross-attestation-requirement-for-transaction-records)
  cross-attestation bytes for transaction records), `spec_version`,
  `event_type` URI validity, timestamp not >5 min future, `context_id`
  shape). `now_ms` injects the clock for corpus tests; defaults to wall
  time. Returns `False` on any failure, never raises.
- `sign_transaction_record(record, private_key, counterparty_signers=None) -> AtribRecord`:
  signs the [§1.7.6](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#176-cross-attestation-requirement-for-transaction-records)
  cross-attestation bytes; the creator's signer entry comes first, followed
  by caller-supplied counterparty entries over the same canonical bytes.
- `sign_transaction_attestation(record, private_key) -> SignerEntry`: one
  counterparty signer entry over an existing transaction record's bytes;
  raises `ValueError` for non-transaction records.
- `get_public_key(private_key) -> bytes`: raw 32-byte Ed25519 public key
  for a 32-byte seed.

### Record construction

- `build_and_sign_emit_record(*, private_key, event_type, context_id, chain_root, content, informed_by=None, provenance_token=None, annotates=None, revises=None, tool_name=None, args_hash=None, result_hash=None, timestamp_ms=None) -> AtribRecord`:
  the port of `@atrib/emit`'s pipeline: synthetic `content_id` from
  `SYNTHETIC_SERVER_URL` + the event-type leaf, the
  [D099](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d099-explicit-emit-records-commit-local-content-through-default-args_hash)
  default `args_hash`, lexicographically sorted `informed_by`, and
  omission-not-null optional fields. Pure aside from signing; no I/O;
  `timestamp_ms` injects the clock.
- `SYNTHETIC_SERVER_URL`: `"mcp://atrib-emit"`, a frozen historical
  constant (embeds the original package name; MUST NOT change, or old
  records stop being content_id-compatible).
- `content_hash(content) -> str`: the
  [D099](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d099-explicit-emit-records-commit-local-content-through-default-args_hash)
  default args commitment: `sha256:<hex(SHA-256(JCS(content)))>`.
- `leaf_of_event_type_uri(uri) -> str`: trailing path segment for
  atrib-namespace URIs; the URI itself for slash-less or trailing-slash
  inputs.

### Chain composition ([§1.2.3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#123-chain_root-for-genesis-records) / [§1.2.3.1](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#1231-multi-producer-chain-composition))

- `genesis_chain_root(context_id) -> str`:
  `"sha256:" + hex(SHA-256(UTF-8(context_id)))`.
- `chain_root(parent_record) -> str`: chain_root for a non-genesis record
  (hash of the parent's canonical signed form).
- `resolve_chain_root(*, context_id, inbound_record_hash_hex=None, auto_chain_tail_hex=None, mirror_tail_hex=None, env=None) -> str`:
  the bit-for-bit [D067](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d067-multi-producer-chain-composition-precedence-contract)
  port. Precedence, highest first: (1) inbound propagation token hex, (2)
  within-process auto-chain tail, (3) `ATRIB_CHAIN_TAIL_<context_id>` env
  var (accepted only as exact `sha256:<64-hex>`; malformed falls through),
  (4) mirror tail (bare 64-hex; caller pre-filters by context_id), (5)
  synthetic genesis. Pure and synchronous; pass a stub `env` in tests.

### Hashes and tokens

- `sha256(data) -> bytes`.
- `record_hash_bytes(record) -> bytes` / `record_hash_hex(record) -> str` /
  `record_hash_ref(record) -> str`: SHA-256 over the JCS-canonical
  COMPLETE signed record including `signature`, as raw bytes, bare 64-hex,
  and `sha256:<64-hex>` reference form respectively.
- `derive_provenance_token(upstream) -> str`:
  [§1.2.6](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#126-provenance_token):
  base64url (no padding) of the first 16 bytes of the upstream record
  hash; always 22 characters.
- `encode_token(record) -> str` / `decode_token(token) -> DecodedToken | None`:
  the [§1.5.2](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#152-http-transport-tracestate)
  propagation token (`base64url(record_hash) + "." + base64url(creator_key)`,
  max 87 chars). Decoding is lenient per
  [D018](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d018-w3c-trace-context-and-baggage-conformance-leftmost-atrib-lenient-parse-evict-from-end-on-overflow):
  malformed tokens return `None` (meaning genesis), never raise.
  `DecodedToken` is a frozen dataclass of two 32-byte values.

### Canonicalization ([§1.3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#13-canonical-serialization))

- `jcs(value) -> bytes`: RFC 8785 via the `rfc8785` package; raises
  `ValueError` subclasses on non-I-JSON input (see the boundary section
  below).
- `canonical_signing_input(record)`: JCS with `signature` removed
  ([§1.4.2](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#142-signing-procedure)).
- `canonical_record(record)`: JCS of the complete signed record (the
  record-hash preimage).
- `canonical_cross_attestation_input(record)`: JCS with `signers: []` and
  no top-level `signature`
  ([§1.7.6](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#176-cross-attestation-requirement-for-transaction-records)).

### Content identity ([§1.2.2](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#122-content_id-derivation))

- `compute_content_id(server_url, tool_name) -> str`:
  `"sha256:" + hex(SHA-256(UTF-8(normalized + ":" + tool)))`.
- `normalize_server_url(url) -> str`: reproduces the WHATWG-parser
  behaviors the TS implementation relies on (special-scheme slash
  collapsing and required hosts, default-port dropping, opaque-host case
  preservation, trailing-slash trim, query/fragment drop), with the same
  lowercase fallback for unparsable input.

### Submission ([§2.6.1](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#261-submit-entry) / [§5.3.5](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#535-log-submission))

- `validate_submission(record, *, now_ms=None) -> ValidationResult`:
  client-side parity with the log's submission checks (spec_version,
  event_type URI, integral non-negative timestamp within the server's
  10-minute future-skew window, context_id shape, required string fields,
  `sha256:<64-hex>` shapes, `session_token`/`informed_by` types).
  `ValidationResult` is a frozen dataclass `(ok, status, error)`.
  `now_ms` injects the clock.
- `SubmissionQueue(log_endpoint=None, *, timeout_s=5.0)`: fire-and-forget
  submitter on a bounded daemon worker thread. `submit(record, priority="normal")`
  never raises; retry is exponential backoff, max 3 attempts inside a
  30-second window; 4xx responses are permanent rejects (dropped);
  transaction records POST with a high `X-atrib-Priority` header. The POST
  body is the bare signed record, never the mirror envelope
  ([§5.9.4](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#594-submission-path-invariant)).
  `get_proof(record_hash_bare_hex)` reads the proof-bundle cache (keyed by
  bare hex, no `sha256:` prefix). `flush(deadline_s=30.0)` waits, bounded,
  never raises.
- `DEFAULT_LOG_ENDPOINT`: `https://log.atrib.dev/v1/entries`.
- `normalize_log_endpoint(endpoint) -> str`: appends `/v1/entries` to a
  bare origin, mirroring the TS helper.

### Keys ([§5.6](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#56-key-management))

- `resolve_key(env=None) -> ResolvedKey | None`: the portable subset of
  `@atrib/emit`'s ladder: `ATRIB_PRIVATE_KEY` (base64url 32-byte seed),
  then `ATRIB_KEY_FILE`. The macOS-Keychain and 1Password rungs are
  platform/tool-coupled and intentionally not ported; hosts needing them
  resolve the seed themselves and pass it explicitly. Never raises:
  malformed material degrades to `None` with a stderr warning, and absence
  of a key is pass-through, not an error.
- `ResolvedKey`: frozen dataclass: `private_key` (32-byte seed), `source`
  (`'env' | 'file'`).

### Mirror ([§5.9](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#59-local-mirror-conventions))

- `MirrorLine`: frozen dataclass `(record, sidecar, proof, written_at)`;
  the normalized view of one mirror line.
- `parse_mirror_line(line) -> MirrorLine | None`: tolerates all three
  [§5.9.2](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#592-the-envelope-shape)
  line shapes; malformed lines yield `None` (skip).
- `read_mirror(path) -> list[MirrorLine]`: missing file → empty list; a
  malformed or non-UTF-8 line is skipped, never fatal.
- `read_mirror_tail(path, context_id=None) -> AtribRecord | None`: newest
  record, optionally filtered by context.
- `mirror_tail_hash_hex(path, context_id) -> str | None`: bare-hex hash of
  the newest same-context record, in the shape
  `resolve_chain_root(mirror_tail_hex=…)` expects.
- `append_mirror_line(path, record, *, sidecar=None, proof=None) -> None`:
  appends an envelope line; best-effort (failures warn on stderr). The
  `_local` sidecar lives at envelope level, never inside `record`, and
  never reaches the public log.
- `default_mirror_write_path(env=None)`: `$ATRIB_MIRROR_FILE`, else
  `~/.atrib/records/atrib-emit-<agent>.jsonl` with `<agent>` from
  `$ATRIB_AGENT` (default `claude-code`).
- `default_mirror_read_path(env=None)`: `$ATRIB_AUTOCHAIN_SOURCE`, then
  `$ATRIB_MIRROR_FILE`, then `~/.atrib/records/<agent>.jsonl`.

### Event types and record shape

- `SPEC_VERSION`: `"atrib/1.0"`.
- `AtribRecord` / `SignerEntry`: `TypedDict` shapes; optional fields use
  `NotRequired` because omission (never null) changes the JCS form and
  signature.
- `EVENT_TYPE_TOOL_CALL_URI`, `EVENT_TYPE_TRANSACTION_URI`,
  `EVENT_TYPE_OBSERVATION_URI`, `EVENT_TYPE_DIRECTORY_ANCHOR_URI`,
  `EVENT_TYPE_ANNOTATION_URI`, `EVENT_TYPE_REVISION_URI`: the six
  normative URIs.
- `normalize_event_type(value) -> str`: short alias / known typo path →
  canonical URI; unknown values pass through unchanged.
- `is_valid_event_type_uri(value) -> bool`:
  [§1.4.5](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#145-event_type-uri-validation)
  syntactic validation (extension URIs pass; the length limit counts UTF-16
  code units exactly like the JS reference).
- `is_normative_event_type_uri(uri) -> bool`: normative-set membership
  (informational only).
- `event_type_uri_to_byte(uri) -> int`: the
  [§2.3.1](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#231-entry-serialization)
  byte mapping; extensions map to `0xFF`.

### Anchor plurality ([D138](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d138-anchor-plurality-as-the-default-trust-posture), [§2.11.7-§2.11.13](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#2117-anchors-generalizing-the-replication-target))

`atrib.anchors` is the Python port of the producer-side anchor surface in
`packages/mcp/src/anchors.ts`. Anchoring never touches signed bytes and
never blocks a write; `AtribClient` uses this module for its per-anchor
fan-out (see the constructor table above).

- `ANCHOR_TYPES`: the [§2.11.8](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#2118-anchor-type-registry)
  v1 registry: `("atrib-log", "sigstore-rekor", "rfc3161-tsa", "opentimestamps")`.
- `BUILT_IN_DEFAULT_ANCHOR_SET`: the two-anchor zero-config default
  ([§2.11.12](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#21112-producer-side-anchor-posture) rule 1),
  value-identical to the TS constant.
- `AnchorDescriptor` / `AnchorSetConfig`: `TypedDict` config shapes
  (`url` wins over `endpoint`; absent `anchor_type` means `atrib-log`).
- `resolve_anchor_posture(config) -> AnchorPostureResolution`: the pure
  [§2.11.12](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#21112-producer-side-anchor-posture) precedence rules (default set / ≥ 2 as given /
  `allow_single_anchor` opt-in / warn + sidecar marker). Field names match
  the conformance corpus (`spec/conformance/2.11/anchors/`). Never raises.
- `resolve_effective_anchors(config) -> list[AnchorDescriptor]`: the
  effective set a producer submits to.
- `anchor_claim_artifact(record_hash) -> bytes`: the
  [§2.11.10](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#21110-the-anchoring-signature-claim-artifact)
  claim bytes `UTF-8("atrib-anchor/v1:" + record_hash)`, byte-identical to
  the TS `anchorClaimArtifact`; raises `ValueError` on a malformed hash
  (pure builder for programmer input).
- `ANCHOR_CLAIM_PREFIX`: `"atrib-anchor/v1:"`.

### Attribution receipts ([D141](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d141-devatribattribution-first-class-mcp-extension-sep-2133), `dev.atrib/attribution` v0.1)

Consumer-side receipt handling for the MCP extension (see
`docs/extensions/dev.atrib-attribution/`). Receipts are advisory: trust
derives from verifying signed records, never from the receipt.

- `ATTRIBUTION_EXTENSION_KEY`: `"dev.atrib/attribution"`, the `_meta` key.
- `ATTRIBUTION_LOG_SUBMISSION_STATUSES`: `("queued", "submitted",
  "disabled", "failed")`; a queue status, never an awaited proof
  ([§5.3.5](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#535-log-submission)).
- `parse_attribution_receipt_block(meta) -> AttributionReceiptBlock | None`:
  lenient extraction from a tool result's `_meta`: anything malformed
  yields `None` without raising; wrong-typed fields drop.
- `verify_attribution_receipt(block) -> AttributionReceiptVerification`:
  the extension-spec [§6.2](https://github.com/creatornader/atrib/blob/main/docs/extensions/dev.atrib-attribution/v0.1.md#62-receipt-block) consumer check over the RAW result block
  (structural well-formedness plus token ↔ receipt ↔ optional-record
  internal consistency), the exact port of `@atrib/mcp`'s
  `verifyAttributionReceipt`; hostile input yields
  `mismatched=["malformed"]`. Internal consistency only; Tier-3 assurance
  additionally verifies the attached record (`verify_record`) and log
  inclusion.
- `check_attribution_receipt_consistency(block, record=None) ->
  AttributionReceiptConsistency`: record-side consistency of a parsed
  block against the signed record it names; no record at all →
  `receipt_valid=False, mismatched_fields=["record"]` (conservative).

### Evidence envelopes ([D137](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d137-universal-evidence-envelope-as-the-single-protocol-level-attachment-model), [§5.5.7](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#557-universal-evidence-envelope))

`atrib.evidence` implements the universal envelope, the single
attachment model for external evidence (the legacy `protocol` string set
is frozen). Envelopes live outside signed bytes. Conformance:
`spec/conformance/evidence-envelope/` (all case families).

- `EVIDENCE_TIERS`: `("declared", "shape", "attested", "verified")`;
  `EVIDENCE_REF_KINDS`, `EVIDENCE_CONSTRAINT_STATUSES`: the other closed
  vocabularies.
- `EvidenceEnvelope`, `EvidencePayload`, `EvidencePayloadRef`,
  `EvidenceConstraint`, `EvidenceResult`, `EvidenceVerifier`: `TypedDict`
  shapes matching the TS `EvidenceEnvelope` family field-for-field.
- `evidence_envelope_key(envelope) -> str`: dedup identity
  `(profile, payload.hash)`; `evidence_tier_rank(tier) -> int`: `0`
  (declared) … `3` (verified), unknown tiers `-1`.
- `validate_envelope(envelope) -> EnvelopeValidation` /
  `is_valid_envelope(envelope) -> bool`: the normative [§5.5.7](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#557-universal-evidence-envelope) shape
  rules, reason-for-reason with the TS validator (closed reason-code set,
  e.g. `profile_uri`, `payload_hash`, `inline_without_inline_kind`).
  Rejecting an envelope never rejects the record it attaches to.
- `build_evidence_envelope(*, profile, tier, ...) -> (envelope | None,
  warnings)`: producer-side builder: computes `payload.hash` from
  `payload_material` (JCS rule, `jcs_sha256`) or `payload_material_utf8`
  (raw rule, `raw_sha256`), fills the default `result`, validates, and
  drops the envelope (never the record) on rejection. Raises `ValueError`
  only on contradictory input.
- `classify_profile(uri, registry=ATRIB_PROFILE_REGISTRY) ->
  ProfileClassification`: full-URI profile identity; a foreign domain
  reusing an atrib profile name is a valid third-party profile, never the
  atrib profile.
- `map_legacy_evidence_block(block) -> EvidenceEnvelope` (spec-named alias
  `from_legacy_evidence_block`): the deterministic legacy [§5.5.6](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#556-generic-authorization-evidence-blocks) mapping
  through the frozen five-row table (`FROZEN_LEGACY_PROTOCOLS`,
  `LEGACY_PROTOCOL_TO_PROFILE`); unknown protocols raise `ValueError`
  (the one normative MUST-reject).
- `order_envelope_instances(instances)`: tier desc, `checked_at_ms`
  desc, verifier name asc; `is_relay_identity_swap(original, relayed)`:
  flags a verifier-block-only difference; `assess_reproducibility(envelope)`:
  `verified` + `ref.kind: "withheld"` is well-formed but
  claimed-not-reproducible; `render_envelope_opaque(envelope)`: the
  unknown-profile preservation surface (never drop, never affect record
  validity).
- `jcs_sha256(value)` / `raw_sha256(text)`: the two [§5.5.7](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#557-universal-evidence-envelope) payload hash
  rules.

### Encoding

- `base64url_encode(data)` / `base64url_decode(value)`: RFC 4648 §5, no
  padding; decode raises `ValueError` on malformed input.
- `hex_encode(data)` / `hex_decode(value)`: lowercase hex.

## Contracts honored

- **[§5.8](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#58-degradation-contract) degradation**: operational failures never raise and never block:
  missing key means pass-through, network failures are silent with bounded
  retry (3 attempts / 30s window), all warnings carry the `atrib:` prefix.
  The only raise paths are contradictory inputs.
- **[§1.2.3.1](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#1231-multi-producer-chain-composition) chain composition**: `resolve_chain_root` is a bit-for-bit
  port of the [D067](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d067-multi-producer-chain-composition-precedence-contract) reference (`packages/mcp/src/chain-root.ts`), tested
  against `spec/conformance/1.2.3/multi-producer/`.
- **[§5.9](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#59-local-mirror-conventions) mirror conventions**: JSONL envelopes under `~/.atrib/records/`,
  all three line shapes tolerated on read, `_local` sidecar never enters
  signed bytes or the public log.
- **[§2.6.1](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#261-submit-entry) submission**: bare signed record POST, priority header,
  idempotent-safe retry, proof bundles cached by record hash.

## Scope (v0)

The write verb (`attest`) signs in-process; `recall` covers the
history/session_chain shapes over the local mirror. Anchor plurality
([D138](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d138-anchor-plurality-as-the-default-trust-posture))
fans out to every usable atrib-log anchor; registered non-atrib-log
anchor types count toward the posture but have no Python transport yet
(their legs are skipped with a warning. The TS reference stubs them
too). `atrib.evidence` implements the
[D137](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d137-universal-evidence-envelope-as-the-single-protocol-level-attachment-model)
envelope surface (validation, builder, legacy mapping, tier semantics)
and `atrib.attribution` the
[D141](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d141-devatribattribution-first-class-mcp-extension-sep-2133)
receipt checks. Daemon-first transport
(Streamable HTTP to the local primitives runtime) lands with the
post-2026-07-28 stateless MCP transport rather than reimplementing the
current initialize-handshake session protocol. Summarize is not an SDK
verb. Synthesis belongs to the calling harness.

## Known cross-implementation boundary (I-JSON)

Content outside I-JSON (RFC 7493), integers beyond 2^53-1 or strings with
lone UTF-16 surrogates, cannot round-trip between JS and Python: the JS
runtime canonicalizes such content (lossily for big integers, because JS
numbers are already doubles) while this SDK's RFC 8785 implementation
rejects it with a `ValueError`. Rejection is deliberate: silently
reproducing JS precision loss would corrupt caller data, and a commitment
only one implementation can reproduce is worse than an error. Keep attest
`content` within I-JSON. The rejection contract is pinned in
`tests/test_port_parity.py`.

## Tests

```bash
pip install -e "python/[dev]"
pytest python/tests
mypy  # configured in pyproject.toml
```

Generated API documentation (from the inline docstrings) uses
[pdoc](https://pdoc.dev), included in the `[dev]` extras:

```bash
python -m pdoc atrib -o docs-build/   # static HTML
python -m pdoc atrib                  # live server
```

CI runs the same suites plus the cross-implementation determinism judge on
Python 3.10 and 3.12 via `.github/workflows/python-sdk.yml`, path-scoped to
the byte-identity surface (`python/`, `packages/sdk/`, `packages/mcp/`,
`services/atrib-emit/`, `spec/conformance/`). The judge step fails loudly
if it would silently skip.

The conformance corpora are consumed unmodified from `spec/conformance/`;
a port failure is a spec-bug discovery, not something to route around.

## Part of atrib

atrib is an open protocol for verifiable agent actions. Every action becomes a signed, chain-linked record that anyone can verify against a public Merkle log, with no operator to trust. This package is one entrypoint. See the [full package family](https://github.com/creatornader/atrib#packages) and the [protocol spec](https://github.com/creatornader/atrib/blob/main/atrib-spec.md).
