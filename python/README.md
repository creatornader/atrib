# atrib (Python SDK)

Python client SDK for [atrib](https://atrib.dev) — verifiable agent
actions. Every action becomes signed context for the next.

This is the first non-TypeScript implementation of the atrib record layer
(spec [§1](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#1-attribution-record-format)) and SDK contract (spec [§5](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#5-sdk-specification)). The guarantee that matters:
**byte-identity**. Identical inputs produce identical JCS canonical forms
(RFC 8785), Ed25519 signatures over the same bytes, identical record
hashes, propagation tokens, and chain roots as the TypeScript
implementation — verified against the shared conformance corpora in
`spec/conformance/` (1.4 signing + adversarial, 1.2.6 provenance_token,
1.2.3 multi-producer chain composition, 2.6.1 submission validation) and a
cross-implementation determinism harness.

## Install

```bash
pip install atrib          # once published; unpublished today — install from source:
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

## Contracts honored

- **[§5.8](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#58-degradation-contract) degradation**: operational failures never raise and never block —
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
history/session_chain shapes over the local mirror. The anchor set
accepts bare endpoints or `{"endpoint": ..., "anchor_type": ...}` entries
(P043 headroom — non-atrib anchor types are skipped with a warning until
anchor plurality lands), and `atrib.evidence` carries the P042 universal
evidence-envelope types. Daemon-first transport
(Streamable HTTP to the local primitives runtime) lands with the
post-2026-07-28 stateless MCP transport rather than reimplementing the
current initialize-handshake session protocol. Summarize is not an SDK
verb — synthesis belongs to the calling harness.

## Known cross-implementation boundary (I-JSON)

Content outside I-JSON (RFC 7493) — integers beyond 2^53-1 or strings with
lone UTF-16 surrogates — cannot round-trip between JS and Python: the JS
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

The conformance corpora are consumed unmodified from `spec/conformance/`;
a port failure is a spec-bug discovery, not something to route around.
