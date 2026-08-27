# Jiaozi transparency log and atrib: primary-source findings

Snapshot checked on 2026-08-26 UTC. The Jiaozi `main` branch resolved to commit
`e751102a4b9ecbcc1cd0211c91aa4f49d1c1c0ce`, whose commit message is `public mirror
snapshot 2026-08-25` and whose commit timestamp is 2026-08-26T06:20:35Z. The
local atrib source cited below is the committed checkout at
`a6e08cc56549a6a8b9874fd72325f7567d1e4fe5`. This note uses the three requested
W3C messages, the pinned Jiaozi repository, and atrib's protocol documents. It
does not treat secondary commentary or marketing claims as evidence.

Terms used in this note:

- **Observed** means the cited source states it or the cited source code does it.
- **Inferred** means a comparison or consequence derived from those observations.
- **Unknown** means the cited sources do not establish it. A direct probe is
  reported as a probe, not as proof of a permanent absence.

## Main comparison

| Dimension | Jiaozi `jiaozi.tlog.v1` | atrib protocol |
|---|---|---|
| Primary purpose | Transparency for one issuer's AI-agent credential lifecycle: issuance, suspension, reinstatement, and revocation. | Verifiable agent actions and declared relationships: tool calls, transactions, observations, directory anchors, annotations, revisions, and extensions. |
| Unit committed to the public log | Five-field canonical JSON metadata entry: schema, lifecycle event, certificate ID, log-acceptance timestamp, and detail-record hash. | A fixed 90-byte binary entry containing the hash of a complete signed record, creator key, context ID, timestamp, and event-type byte. |
| Record signer | The design signs the tree head. It does not require a separate signature on each lifecycle entry; the detail is retained by the issuer. | The creator signs each attribution record. A transaction record can carry multiple counterparty signatures. The log operator signs checkpoints. |
| Merkle construction | SHA-256 with RFC 9162 MTH, `0x00` leaf and `0x01` node prefixes, and no odd-leaf duplication. | SHA-256 with RFC 6962 MTH, the same domain-separated prefixes and non-duplicating tree decomposition. |
| Checkpoint surface | JSON STH with a protocol-specific Ed25519 shell, plus a C2SP `tlog-checkpoint` signed-note representation in revision -02. The design explicitly says this is not RFC 9162 wire compatibility. | C2SP `tlog-checkpoint` and `signed-note` are the primary checkpoint format; the read path is C2SP `tlog-tiles`. |
| Write path | Only the issuer's internal lifecycle pipeline may register entries. The public API is read-only; COSE Receipts and SCRAPI are planned for the second phase. | A signed record is submitted to `POST /v1/entries`; duplicate `record_hash` submission is idempotent and returns the existing proof. Producer SDK submission is asynchronous and non-blocking. |
| Public metadata tradeoff | Does not publish subject identity, public keys, or free-text reasons, but the sequential certificate ID exposes ordering and approximate issuance volume. | Publishes creator key, context ID, event type, and timestamp in every log entry. Producers can coarsen timestamps, hide tool names, and salt or HMAC args/result commitments. |
| Identity/status relationship | The transparency log supplements short-TTL signed `jiaozi.status.v1` current-state credentials. | atrib has no equivalent short-TTL credential. It has a public-key directory, signed records, key-revocation records, and verifier-side identity/capability facts. |

The shared Merkle algebra does not make the two logs interchangeable. Their leaf
bytes, log origins, signing keys, metadata, event vocabularies, and submission
contracts differ. This is an inference from the two protocol definitions.

## 1. What the Jiaozi sources say

### 1.1 Proposal, review, and current design position

The initial W3C post on 2026-08-11 describes Jiaozi as an open identity and
attestation layer for AI agents with Ed25519 `did:web` documents, short-TTL
signed status credentials, an open specification, and conformance vectors. It
proposes a transparency log for four credential lifecycle events so the issuing
service cannot silently present different histories. The post describes a
read-only REST API, daily Git anchoring of signed tree heads, and an initial
single-Postgres design with database-enforced append-only behavior. It asks for
review of the JSON STH encoding, the per-certificate lookup privacy risk, and
Git anchoring precedent. ([J-0008])

The current design file is `v1.0-design.2`, revision `-02`, dated 2026-08-25.
It still labels itself a design draft for public review and says its scope is
design only, with implementation to follow a separate work order. It adopts a
"zero-invention" rule: the tree and proof algorithms follow RFC 9162, while
roles, registration policy, and privacy boundaries follow RFC 9943. It now
describes itself as a **CT-derived checkpoint profile**, not a wire-compatible
RFC 9162 implementation. ([J-Design], §§0, 5-7)

Michael Beddows' 2026-08-18 review identified the main protocol risks: RFC 9162
uses an OID Log ID and a defined `TransItem`/TLS encoding, so the proposed JSON
STH should not imply CT v2 interoperability; STH transcript, canonicalization,
rejection, key bootstrap, and rotation rules needed normative definitions;
per-certificate queries disclose interest; the timestamp and MMD semantics were
inconsistent; a bare detail hash can be guessed; and Git only gives a weak
external channel unless independent parties retain and compare checkpoints. He
also suggested C2SP checkpoint and tlog-tiles integration. ([J-0017])

The 2026-08-26 reply accepts nearly all of those points. It says revision -02:

- calls D-1 a CT-derived checkpoint profile and drops any implication of
  RFC 9162 wire compatibility;
- requires a pinned key, treating the STH-carried key as informational;
- recommends full-log mirroring and demotes `entry?certId=` to a low-volume
  convenience endpoint with minimum query-log retention;
- measures MMD from log acceptance and separates occurrence-to-inclusion latency;
- adds a domain-separated detail object with a fresh nonce of at least 128 bits;
- documents sequential-ID ordering leakage without changing the existing ID
  scheme;
- classifies Git anchoring as a weak broadcast channel and makes independent
  retention and comparison normative for monitors and witnesses; and
- publishes a C2SP checkpoint signed note alongside each JSON STH, with witness
  cosigning and tlog-tiles on the second-phase roadmap. ([J-0027])

### 1.2 Jiaozi log object and lifecycle semantics

The design defines a closed set of four events mapped to existing certificate
state transitions: `cert_issued`, `cert_suspended`, `cert_reinstated`, and
`cert_revoked`. Suspension is reversible; revocation is not. New event types must
go through a version revision. ([J-Design], §4.1)

The public entry has exactly five fields and forbids extras:

```json
{
  "schema": "jiaozi.tlog.v1",
  "eventType": "cert_revoked",
  "certId": "JIAOZI-2026-000123",
  "timestamp": "2026-08-10T12:34:56.000Z",
  "contentHash": "sha256:<64 lowercase hex>"
}
```

`certId` is normalized to `JIAOZI` or `JP` plus a year and 6-9 digits. The
timestamp is the time the log accepts the event, not the business occurrence
time. `contentHash` commits to a private detail record. The detail can contain,
for example, an attestation summary or revocation reason, but those fields do
not enter the public log. Revision -02 requires the detail to be a
domain-separated canonical JSON object with a fresh random nonce of at least
128 bits, disclosed only when the issuer opens the commitment. ([J-Design],
§§4.2-4.3)

The design sets a 24-hour MMD from log acceptance to inclusion in a published
STH. It separately promises up to 24 hours from business occurrence to log
acceptance, making the stated worst-case occurrence-to-inclusion bound 48 hours.
Daily anchoring adds a stated worst-case of 48 hours from acceptance, or 72
hours from occurrence, to an anchored tree head. STHs must be published at least
hourly when new entries exist. ([J-Design], §8)

### 1.3 Proof, checkpoint, API, and anchoring model

The design uses the RFC 9162 MTH recursively: the empty tree is SHA-256 of the
empty string; leaves hash `0x00 || entry_bytes`; internal nodes hash
`0x01 || left || right`; and each non-power-of-two tree splits at the largest
power of two below its size. Inclusion and consistency proofs are the RFC 9162
algorithms, carried in JSON. ([J-Design], §§5-6)

The JSON STH payload has `schema`, URL-shaped `logId`, `treeSize`, `timestamp`,
and `rootHash`. Revision -02 requires the verifier to canonicalize the payload
itself, use a pinned public key, reject tree-size rollback, and reject conflicting
roots for the same size. The `publicKeyMultibase` field remains in the object
but is informational. ([J-Design], §§7.1-7.3)

Revision -02 also requires a parallel C2SP `tlog-checkpoint` signed note. The
checkpoint origin is the JSON `logId` without `https://`; its decimal tree size
and base64 root must match the JSON STH. The checkpoint has no timestamp, so the
JSON STH remains the time-bearing representation. ([J-Design], §7.4)

The planned public surface is read-only and consists of:

- `GET /api/tlog/sth` for the latest JSON STH;
- `GET /api/tlog/sth-consistency?first=<m>&second=<n>`;
- `GET /api/tlog/proof-by-hash?hash=<leafHash>&treeSize=<n>`;
- `GET /api/tlog/entries?start=<i>&end=<j>` for a range plus an STH;
- `GET /api/tlog/entry?certId=<id>` for a convenience index; and
- `GET /api/tlog/log-info` for log parameters and public-key discovery.

Entries are registered only by the issuer pipeline. There is no public submit
endpoint. ([J-Design], §9)

The daily anchor writes both STH representations to a public Git directory at
UTC 00:10. The design now calls Git a weak broadcast channel: it provides
author provenance and a weak external timestamp, but no global consistency. A
monitor or witness must retain checkpoints and compare adjacent anchors, live
STHs, and the two checkpoint representations. Witness cosigning is planned as a
separate second-phase track. ([J-Design], §§10-11, 14.2)

### 1.4 Jiaozi status credential context

The companion `jiaozi.status.v1` specification defines a signed JSON status
credential with `certId`, `did`, `status`, `trustLevel`, `serial`, `signedAt`,
`expiresAt`, and `issuer`. The statuses are `active`, `suspended`, `revoked`,
and `unknown`. Verification is ordered as shape, optional key pin, signature,
expiry, optional issuer pin, and optional serial floor. The reference TTL is 60
seconds. This credential answers “what is the current status?”; the tlog design
answers “what lifecycle events did the issuer publicly commit to over time?”
([J-Status-Spec], §§1, 3, 7, 9)

## 2. What is actually in the pinned Jiaozi repository

The repository contains a private `@jiaozi-protocol/tlog-core` package at
version `0.1.0`. Its package description still names design version
`v1.0-design.1`, and its test script runs four unit-test files plus an
independent vector runner. The package is marked `"private": true`; no public
npm package or HTTP server is declared in the package manifest. ([J-tlog-package])

The committed source provides a useful reference implementation, but it is not
the revision -02 design in full:

| Surface | Observed source behavior | Difference from design -02 |
|---|---|---|
| Entry construction | `buildTlogEntry` accepts `eventType`, `certId`, `contentHash`, and an optional timestamp. It normalizes IDs, validates the five fields, canonicalizes JSON, and computes the leaf hash. ([J-entry]) | There is no detail-record input, domain-separation schema, or fresh nonce construction for `contentHash`. |
| Merkle/proof code | `merkle.ts` implements SHA-256, `0x00`/`0x01` domain separation, RFC-style MTH, inclusion paths, consistency paths, and JSON hash carriers. ([J-merkle]) | The mathematical tree and proof code match the stated profile. |
| STH verification | `sth.ts` signs canonical JSON with Ed25519 and has optional `trustedKeys`, `expectedLogId`, and `minTreeSize` checks. Its verifier checks the `publicKeyMultibase` carried by the STH and verifies with that same embedded key. ([J-sth]) | The design requires a separately pinned key and forbids using an embedded key as the authentication source. The source has no distinct pinned-key argument. It also does not reject extra STH payload fields even though the design requires an exact payload field set. |
| Log facade | `TransparencyLog` appends events, computes roots and proofs, signs JSON STHs, returns ranges, and indexes leaf positions by normalized certificate ID. ([J-log]) | No HTTP routes, C2SP checkpoint rendering, Git anchoring, witness service, or detail disclosure path appears in this package. |
| Storage | `MemoryTlogStorage` is the only implementation in the package. It keeps entries, leaf-hash indexes, certificate indexes, and STHs in process memory; it rejects out-of-order appends, duplicate leaf hashes, and decreasing STH tree sizes. ([J-storage]) | The design's Postgres schema, database permissions, trigger protection, and private detail table are not implemented in this package. Equal-size STHs are not rejected by the memory store. |
| Conformance vectors | The vector generator and JSON file contain concrete values, including 8 entries, 9 tree heads, 14 inclusion cases, 9 consistency cases, and 6 STH cases. The generator labels the vectors as design `v1.0-design.1`. ([J-vector-gen], [J-vectors]) | This predates the revision -02 vector structure, which the design says will be delivered with the implementation work order. |

The tests cover canonical entry ordering, ID normalization, all four lifecycle
events, malformed entries, RFC-known Merkle roots for tree sizes 1-8, inclusion
and consistency sweeps, tampering, STH signature and key/ID/size failures, log
range behavior, duplicate/out-of-order appends, and STH regression. ([J-entry-test],
[J-merkle-test], [J-sth-test], [J-log-test]) They do not establish a
working public service, Git anchor history, independent witness, Postgres
deployment, C2SP dual-representation output, nonce-bound detail commitments,
or revision -02 pinned-key behavior.

## 3. What atrib defines

The atrib specification makes a signed attribution record the atomic provenance
unit. A record binds one event to its creator, chain position, context, and
timestamp. The standard event vocabulary covers `tool_call`, `transaction`,
`observation`, `directory_anchor`, `annotation`, and `revision`; valid absolute
URI extensions are allowed. `chain_root`, `informed_by`, `provenance_token`,
`annotates`, and `revises` express structural or declared relationships. The
spec explicitly keeps declared structure separate from inferred causality.
([Atrib-record], [Atrib-events])

The public log entry is a fixed 90-byte binary struct containing:

```text
version | record_hash | creator_key | context_id | timestamp_ms | event_type
  1B        32B            32B           16B          8B           1B
```

`record_hash` is SHA-256 of the complete JCS-canonical signed record, including
its signature. `creator_key` and `context_id` make actor and session visible in
the commitment layer. The event-type byte is a fast filter; the URI in the
record remains authoritative, and unknown extension URIs use `0xFF`.
([Atrib-log-entry])

The log uses the RFC 6962 Merkle algorithm and C2SP tlog-tiles read interface.
Its C2SP checkpoint is a three-line signed note containing the scheme-less log
origin, tree size, and base64 root. The log public key is published in C2SP
verifier-key form and JSON form. The proof bundle follows C2SP tlog-proof.
([Atrib-log], §§2.1-2.8)

`POST /v1/entries` accepts a complete signed record. The log verifies its
signature and schema, validates the URI, checks timestamp bounds, and returns an
inclusion proof only after the entry is in a signed checkpoint. Re-submitting
the same `record_hash` returns the existing proof. The producer middleware does
not wait for submission before returning a tool response; it queues submission,
retries, and caches a failed record locally. ([Atrib-submit], [Atrib-submit-runtime])

The log does not store full record bodies. A producer-local mirror and an
optional content-addressed Record Body Archive can supply them later. The
archive contract distinguishes `404` never archived from `410` retention
expiry and supports evidence projections. Verifiers therefore have three
tiers: commitment, body retrieval, and signature re-verification.
([Atrib-archive])

atrib's privacy section exposes configurable postures: verbatim, opaque, or
hashed tool names; plain, salted-SHA-256, or HMAC commitments for args and
results; and millisecond through day-level timestamp granularity. The public
log still exposes creator key and context ID by default. ([Atrib-privacy])

For equivocation and availability threats, atrib defines operator-signed
checkpoints, independent witness cosignatures, optional replication to multiple
logs, and a generalized anchor interface for services such as RFC 3161,
OpenTimestamps, or Rekor. Witness thresholds and anchor plurality remain
consumer policy. ([Atrib-witness], [Atrib-anchors])

Identity is a separate layer. The AKD-backed directory maps creator keys to
identity claims, publishes directory anchors into the Merkle log, and lets
verifiers consult the directory at an anchored version. Key rotation and
revocation use signed `key_revocation` records and log position, not only a
signer-controlled timestamp. ([Atrib-directory], [Atrib-revocation])

## 4. Inferred comparison and interoperability boundary

### 4.1 Same proof family, different protocol objects

Both projects use the same basic transparency-log argument: signed checkpoints
commit to an append-only, domain-separated SHA-256 tree, and inclusion or
consistency proofs can be checked locally. Jiaozi's revision -02 C2SP
checkpoint companion could make checkpoint tooling reusable at the format level.
That does not make a Jiaozi proof verifiable as an atrib proof. A verifier still
needs the correct log origin, key, leaf encoding, tree size, and root. This is
an inference from [J-Design], §7.4 and [Atrib-log], §2.3.

### 4.2 Different trust questions

Jiaozi's log is an issuer history for credential state. Its lifecycle entry says
that the Jiaozi issuer accepted a particular event for a certificate ID, and its
private detail commitment can be opened later by that issuer. The log does not
itself prove that an agent performed a tool call, that a status assertion is
truthful, or that a private detail was honestly disclosed.

atrib's record and log answer a different question: which creator key signed a
specific action-shaped record, where it sits in a declared chain and context,
and whether its commitment was included in a public log. A transaction can add
counterparty signatures, and verifier-side directory or evidence checks can add
identity and authorization facts. Neither source defines the other system as a
trusted identity provider.

Therefore, a Jiaozi `cert_revoked` event must not be treated as an atrib
`key_revocation` record, and an atrib log commitment must not be treated as a
Jiaozi status credential. The fields, signers, authority rules, and verification
semantics are different. This is an inference from [J-Design], §4 and
[Atrib-revocation].

### 4.3 Metadata and privacy are different choices

Jiaozi minimizes the lifecycle entry's public metadata by omitting subject
identity, keys, and reasons. Its unavoidable product identifier is sequential,
so the design acknowledges ordering and approximate-volume leakage. atrib
publishes more linkage metadata by default: creator key, context ID, event type,
and precise time. In exchange, the atrib record can expose a verifiable action
chain, and producers can choose structural privacy postures per field.

A bridge that copies Jiaozi `certId` into an atrib public record would add a
cross-system correlation that neither current specification requires. A bridge
that needs this correlation should define its disclosure and trust policy
explicitly. No such binding appears in the cited sources.

### 4.4 Status freshness versus historical continuity

Jiaozi `status.v1` is intentionally short-lived and fail-closed when stale. The
tlog is historical and has an explicit acceptance/MMD/anchoring schedule. atrib
records are durable signed events; producer log submission is deliberately
non-blocking, so a caller can receive a signed record before it has a log proof.
These timings serve different operational goals and should not be collapsed into
one “verified” state.

### 4.5 Possible integration seam, not a current contract

The narrowest plausible seam is external evidence: an application could retain
a Jiaozi status or tlog proof alongside an atrib record, then let a verifier
check each proof under its own trust root. A stronger seam would need a
first-party mapping between a Jiaozi certificate/DID and an atrib `creator_key`,
plus rules for issuer trust, status freshness, and disclosure of private detail.
The current sources define neither mapping, evidence profile, nor cross-log
proof conversion. These are inferred integration requirements, not existing
protocol behavior.

## 5. Unknown or unverified as of 2026-08-26

- Direct GET probes to the documented Jiaozi paths `/api/tlog/sth`,
  `/api/tlog/log-info`, `/api/tlog/entries?start=0&end=0`, and
  `/api/tlog/entry?certId=JIAOZI-2026-000001` returned HTTP 404 JSON route errors
  on 2026-08-26 UTC. This is consistent with the design's “no implementation”
  scope, but it does not rule out a private deployment, another host, or a later
  rollout. ([J-live-sth], [J-live-info], [J-live-entries], [J-live-entry])
- The pinned repository tree contains no `docs/tlog-anchors` path and no visible
  C2SP checkpoint, witness cosignature, tlog-tiles mirror, COSE Receipt, SCRAPI
  endpoint, or Postgres service. The live probes likewise found no public tlog
  routes. ([J-tree])
- The pinned Jiaozi tree has source tests and an independent vector runner, but
  this note did not execute that test suite. Passing the package tests would not
  prove that the second-phase HTTP, anchor, or witness surfaces exist.
- No cited Jiaozi source defines a cryptographic binding from `certId`, DID, or
  status credential to atrib's `creator_key`, `context_id`, or 90-byte log entry.
- No cited atrib source defines a Jiaozi credential verifier, a Jiaozi tlog leaf
  adapter, or acceptance of Jiaozi's JSON STH as an atrib checkpoint.
- The W3C thread records design review and the author's stated adoption of
  revision -02. It does not independently verify deployment, external witness
  operation, customer use, or security properties beyond the specified
  algorithms and procedures.

## Sources

[J-0008]: https://lists.w3.org/Archives/Public/public-credentials/2026Aug/0008.html
[J-0017]: https://lists.w3.org/Archives/Public/public-credentials/2026Aug/0017.html
[J-0027]: https://lists.w3.org/Archives/Public/public-credentials/2026Aug/0027.html
[J-Design]: https://github.com/jiaozi-protocol/jiaozi-app/blob/e751102a4b9ecbcc1cd0211c91aa4f49d1c1c0ce/standards/tlog-v1/DESIGN.md
[J-Status-Spec]: https://github.com/jiaozi-protocol/jiaozi-app/blob/e751102a4b9ecbcc1cd0211c91aa4f49d1c1c0ce/standards/status-v1/SPEC.md
[J-tlog-package]: https://github.com/jiaozi-protocol/jiaozi-app/blob/e751102a4b9ecbcc1cd0211c91aa4f49d1c1c0ce/packages/tlog-core/package.json
[J-entry]: https://github.com/jiaozi-protocol/jiaozi-app/blob/e751102a4b9ecbcc1cd0211c91aa4f49d1c1c0ce/packages/tlog-core/src/entry.ts
[J-merkle]: https://github.com/jiaozi-protocol/jiaozi-app/blob/e751102a4b9ecbcc1cd0211c91aa4f49d1c1c0ce/packages/tlog-core/src/merkle.ts
[J-sth]: https://github.com/jiaozi-protocol/jiaozi-app/blob/e751102a4b9ecbcc1cd0211c91aa4f49d1c1c0ce/packages/tlog-core/src/sth.ts
[J-log]: https://github.com/jiaozi-protocol/jiaozi-app/blob/e751102a4b9ecbcc1cd0211c91aa4f49d1c1c0ce/packages/tlog-core/src/log.ts
[J-storage]: https://github.com/jiaozi-protocol/jiaozi-app/blob/e751102a4b9ecbcc1cd0211c91aa4f49d1c1c0ce/packages/tlog-core/src/storage.ts
[J-entry-test]: https://github.com/jiaozi-protocol/jiaozi-app/blob/e751102a4b9ecbcc1cd0211c91aa4f49d1c1c0ce/packages/tlog-core/src/entry.test.ts
[J-merkle-test]: https://github.com/jiaozi-protocol/jiaozi-app/blob/e751102a4b9ecbcc1cd0211c91aa4f49d1c1c0ce/packages/tlog-core/src/merkle.test.ts
[J-sth-test]: https://github.com/jiaozi-protocol/jiaozi-app/blob/e751102a4b9ecbcc1cd0211c91aa4f49d1c1c0ce/packages/tlog-core/src/sth.test.ts
[J-log-test]: https://github.com/jiaozi-protocol/jiaozi-app/blob/e751102a4b9ecbcc1cd0211c91aa4f49d1c1c0ce/packages/tlog-core/src/log.test.ts
[J-vector-gen]: https://github.com/jiaozi-protocol/jiaozi-app/blob/e751102a4b9ecbcc1cd0211c91aa4f49d1c1c0ce/packages/tlog-core/vectors/generate-vectors.mjs
[J-vectors]: https://github.com/jiaozi-protocol/jiaozi-app/blob/e751102a4b9ecbcc1cd0211c91aa4f49d1c1c0ce/packages/tlog-core/vectors/test-vectors.json
[J-tree]: https://api.github.com/repos/jiaozi-protocol/jiaozi-app/git/trees/e751102a4b9ecbcc1cd0211c91aa4f49d1c1c0ce?recursive=1
[J-live-sth]: https://www.jiaozi.io/api/tlog/sth
[J-live-info]: https://www.jiaozi.io/api/tlog/log-info
[J-live-entries]: https://www.jiaozi.io/api/tlog/entries?start=0&end=0
[J-live-entry]: https://www.jiaozi.io/api/tlog/entry?certId=JIAOZI-2026-000001
[Atrib-record]: ../atrib-spec.md#12-the-attribution-record
[Atrib-events]: ../atrib-spec.md#124-event_type-values
[Atrib-log-entry]: ../atrib-spec.md#231-entry-serialization
[Atrib-log]: ../atrib-spec.md#2-merkle-log-protocol
[Atrib-submit]: ../atrib-spec.md#26-submission-api-write-interface
[Atrib-submit-runtime]: ../atrib-spec.md#535-log-submission
[Atrib-archive]: ../atrib-spec.md#212-record-body-archive-layer
[Atrib-privacy]: ../atrib-spec.md#8-privacy-postures
[Atrib-witness]: ../atrib-spec.md#29-witnessing-and-cosignatures
[Atrib-anchors]: ../atrib-spec.md#211-cross-log-replication
[Atrib-directory]: ../atrib-spec.md#6-key-directory
[Atrib-revocation]: ../atrib-spec.md#19-key-rotation-and-revocation
