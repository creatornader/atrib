# Source-bound evidence contract

Proposed normative text for [core §1.12](../atrib-spec.md#112-source-bound-evidence-statements). The reference packages do not yet implement this contract. [STATUS.md](../STATUS.md#spec-defined-not-yet-implemented) records that boundary. The acceptance cases below specify required behavior, not test results from today's verifier.

## 1. Conformance and carrier

_This section is normative._

An evidence statement consists of an atrib record and the private body committed by its args_hash. The signed event_type selects the body's contract. An evidence producer satisfies E01 through E14. An evidence receiver satisfies E02 and E04 through E22 where those rules describe reception. All grammar rules below apply to both. Generic signature verification and log admission are separate conformance targets.

Six extension URIs share the prefix `https://atrib.dev/evidence/v1/`: `request`, `authorization`, `observation`, `report`, `effect`, and `coverage`. They use byte 0xFF under core [§1.2.4](../atrib-spec.md#124-event_type-values). They do not allocate new core event bytes or require six stages for every operation. The attest/recall interface remains unchanged.

Bodies MUST follow this closed grammar. `?` means optional. Optional properties MUST be omitted rather than null. JSON means the RFC 8785 input domain. Hash MUST be `sha256:` followed by 64 lowercase hex characters. ScopedId MUST contain only namespace (absolute URI) and id (a nonempty source-assigned string). Times MUST be integer Unix milliseconds. Strings MUST be nonempty except JSON values within parameters and state. Unlisted properties MUST be rejected. Arrays MAY be empty except where a rule requires an entry.

```typescript
type Body = {
  nonce: string
  subject: ScopedId
  assertion: Request | Authorization | Observation | Report | Effect | Coverage
  target?: { record_hash: Hash }
  source: {
    kind: 'declared' | 'boundary' | 'query' | 'receipt' | 'manifest'
    identity: ScopedId
    method: string
    observed_at?: number
    locator?: string
  }
  basis: Array<{
    relation: 'authority' | 'source' | 'binding' | 'expected' | 'captured'
    kind: 'record' | 'artifact'
    hash: Hash
    media_type?: string
    locator?: string
  }>
}
type Descriptor = {
  service: string
  operation: string
  resource: ScopedId
  parameters: JSON
  version?: string
}
type Request = { descriptor: Descriptor; execution: ScopedId }
type Authorization = {
  decision: 'allow' | 'deny' | 'escalate'
  authority_version: string
  not_before: number
  expires_at: number
}
type Observation = ExecutionObservation | CaptureObservation
type ExecutionObservation = {
  phase: 'dispatch' | 'response' | 'failure'
  descriptor: Descriptor
  execution: ScopedId
  native_invocation: ScopedId
  delivery: ScopedId
  destination_request?: ScopedId
  outcome: 'pending' | 'success' | 'error' | 'unknown'
}
type CaptureObservation = {
  phase: 'capture'
  occurrence: ScopedId
  artifact_hash: Hash
}
type Report = { status: 'success' | 'failure' | 'unknown'; text: string }
type Effect = {
  object: ScopedId
  version: string
  state: JSON
  binding?: { observation_record: Hash; destination_request: ScopedId }
}
type Coverage = {
  surface: ScopedId
  start: string
  end: string
  expected: ScopedId[]
  captured: ScopedId[]
  gaps: Array<{ id?: ScopedId; reason: string }>
}
```

The assertion MUST use the shape selected by the signed type URI. A caller-provided schema URL MUST NOT redefine a recognized type. Unknown types retain generic integrity verification without inferred evidence semantics.

## 2. Commitment and retention

_This section is normative._

E01. Producers MUST generate nonce from at least 16 cryptographically random bytes, encode it as unpadded base64url, and retain it in the body. args_hash MUST be the prefixed SHA-256 of UTF-8 JCS(body). These statements MUST NOT carry args_salt: the private nonce randomizes the existing plain commitment. It is not an idempotency key or authorization token. Whole-body disclosure reveals the nonce; selective field disclosure is not provided.

E02. Receivers MUST reopen that exact args_hash. result_hash, arbitrary sidecar content, a URL or a verifier-envelope tier cannot substitute for the opening. Modified bodies are rejected. Missing bodies leave their dependent conclusions unresolved and fail evidence conformance. A receiver MUST NOT interpret uncommitted fields as this statement's evidence. Core [§5.5.7](../atrib-spec.md#557-universal-evidence-envelope) attachments remain inputs to fresh verification, not signed verdicts.

E03. Producers MUST retain the record and complete opening as one recoverable durable unit before acknowledging durable recording. Body loss is not successful recording. Plaintext bodies remain outside the public record. Disclosure and archive submission require explicit policy separate from signing. A public salt or a separately published bare descriptor digest does not protect guessable private parameters.

## 3. Assertion rules

_This section is normative._

E04. A request MUST omit target. Its subject identifies one invocation in its minting source's namespace. execution identifies one execution attempt, possibly with several deliveries. descriptor.service MUST be an absolute URI. operation, resource, parameters and any version describe the exact normalized operation. The producer MUST preserve the descriptor it authorized or observed, rather than reconstruct it from later narrative. Source.kind MUST be declared or boundary.

E05. Authorization MUST target the exact request record hash, use that request's subject, include at least one authority basis entry, and use source.kind declared. Its producer MUST open and inspect the request before approving. not_before MUST be less than expires_at. An allow authorizes only that opened descriptor and execution within the interval and authority version. deny and escalate confer no permission. Broader grants remain authority inputs, such as core [§1.11](../atrib-spec.md#111-delegation-certificates) certificates; an authorization statement is not itself a universal grant format.

E06. ExecutionObservation MUST target the request, use its subject, record the actual descriptor and execution at its boundary, use source.kind boundary with observed_at, and include source basis. Dispatch MUST have outcome pending. Response MUST have success or error. Failure MUST have error or unknown. native_invocation and delivery identify the source occurrence and delivery attempt. destination_request MUST be included only when available from the source. A timeout after dispatch MUST remain unknown absent affirmative failure evidence. A handler's success response does not confirm destination state.

A CaptureObservation MUST use source.kind boundary with observed_at, set subject equal to occurrence, omit target, and bind artifact_hash through a source basis artifact entry. It records a native message/event without inventing a request, execution or delivery. It MUST NOT satisfy dispatch, request-binding, authority or effect conclusions. A later execution observation may cite it as source basis only when the source mechanism verifies the actual relationship. Captured reports remain accounts of a message at that boundary, not destination truth.

E07. Report MUST target the request, use its subject and use source.kind declared. It attributes the report to its signer and does not accept an application result. A host recording an unsigned agent message MUST instead use CaptureObservation and bind the message as source material. It MUST NOT represent its key as the agent's signature.

E08. Effect MUST target the request, use its subject, use source.kind query or receipt with observed_at, and include source basis. object, version and state describe what the destination showed. When a destination has no version token, version is the hash of captured response bytes, not an invented destination revision. If binding is present, the receiver MUST resolve observation_record, check its exact request target, subject and execution, and compare destination_request against both that observation and the destination evidence. Without this join, destination state can be supported while causal attribution remains unresolved. Shared time, context or resource names cannot supply the join.

E09. Coverage MUST omit target, set subject equal to surface, and use source.kind manifest with observed_at. start/end are source-native exclusive-start/inclusive-end cursors ordered by source.method. A complete conclusion MUST verify source basis for the named window, expected basis establishing the expected set independently of the claimed captured set, captured basis for every captured ID, and membership of every expected ID in captured. Receivers MUST reject duplicate IDs and MUST NOT report completeness with a declared gap or missing expected material. An empty expected set MUST have affirmative source evidence. The claim concerns only the named surface/window. Existing runtime-log manifests may serve as artifacts without automatically establishing independent expected coverage.

For coverage to satisfy request-level reliance, a receiver MUST resolve an ExecutionObservation targeting that exact request, match its source.identity to coverage.surface, and verify from hash-bound source artifacts that its native_invocation lies inside the coverage window and both expected and captured sets. The approved source mechanism MUST expose the observation's native cursor and verify window membership using its cursor-order contract. CaptureObservation can similarly be checked using occurrence, but cannot become request execution evidence. An unrelated complete manifest MUST NOT satisfy required coverage. Missing membership evidence is unresolved; a demonstrated different surface/window is rejected.

## 4. Binding and source boundaries

_This section is normative._

E10. Every basis entry is a dependency. Receivers MUST resolve record hashes under core [§1.3](../atrib-spec.md#13-canonical-serialization) and artifact hashes over exact bytes. Missing dependencies MUST remain unresolved; invalid dependencies MUST reject dependent reliance. Locators are retrieval hints, never hash substitutes. Receipt sources MUST pass native signature verification. Query sources MUST have receiver-approved provenance for the captured response. source.method MUST be an absolute URI naming a versioned source-verification contract. A host account of a query is not a destination signature. Merely signing a source reference cannot authenticate its content.

E11. Receivers MUST open request and observation bodies separately, then compare descriptors by JCS equality and scoped IDs by namespace/id equality. They MUST resolve the exact target record, not a convenient matching public ID. Changed parameters, target, version or execution reject the binding. Independent nonces and whole-body hashes need not match. A new execution retry requires a new request and applicable authority. Transport redelivery retains request/execution and gets its own delivery ID. It does not establish another effect or exactly-once execution.

E12. Evidence projections MUST preserve authors and conflicting accounts. informed_by remains declared reasoning. Chronology, shared context and CONVERGES_ON edges MUST NOT be presented as observed operational causality. Disclosed typed relationships do not add public base-graph edges or authorize public indexing of private bodies.

E13. Boundary producers MUST derive observations from intercepted source data. An isolated signer that accepts arbitrary agent-authored observations as host facts does not conform. Different keys do not establish independent administrative control. A captured agent report remains a captured report, not an observed effect.

E14. Observational capture failure MAY permit work to continue, but MUST surface degraded capture and retain a diagnostic/gap when storage permits. Producers MUST NOT label post-call fallback as durable pre-action intent. An executor explicitly configured to require durable intent before a protected effect MUST refuse that effect when retention fails. This is a path-specific guarantee, not a universal fail-closed tool policy. Coverage never extends to uninstrumented paths by implication.

## 5. Receiver policy and results

_This section is normative._

E15. Reception MUST receive an immutable policy snapshot and evaluation time. The snapshot MUST use the following closed shape. Receivers MUST compare URIs, keys and IDs exactly. max_age_ms MUST be a nonnegative integer. required MUST contain unique entries. Empty rules MUST confer no trust.

```typescript
type Policy = {
  id: string
  rules: Array<{
    type: string
    signer_keys: string[]
    source: ScopedId
    methods: string[]
    subject_namespace: string
    max_age_ms: number
    authority_versions: string[]
    authorized_descriptors: Descriptor[]
    authority_basis: Hash[]
  }>
  required: Array<'source' | 'binding' | 'authority' | 'effect' | 'coverage'>
}
```

type, subject_namespace and methods entries MUST be absolute URIs. signer_keys MUST contain valid Ed25519 keys. A caller MAY compile checked principal/delegation resolution into the snapshot, retaining the resolution and revocation inputs in the bundle. An authorization's version MUST match authority_versions and its request descriptor MUST JCS-match an authorized_descriptors entry on the same rule. Its authority basis MUST resolve and contain at least one hash pinned by authority_basis on that rule. Empty arrays confer no authorization authority. This v1 contract uses exact descriptors and pinned authority documents, not wildcard operations or generic grant inference. A rule MAY still trust the source for observation. Policy format does not replace execution policy or introduce a role registry.

The policy snapshot is the receiver's explicit trust root. authority_basis pins the exact grant/state documents under which it accepts that signer/version/descriptor. The policy author is responsible for its grant interpretation. The receiver MUST verify the pinned document bytes and required validity/revocation snapshots; it MUST NOT infer additional scope from a document it cannot interpret. A deployment requiring delegation compilation MUST supply its versioned mechanism and retained inputs, or leave authority unresolved. Different policy compilers are not claimed to agree without the same interpretation contract. The pinned exact-descriptor path remains deterministic without a universal grant language.

E16. A matching rule MUST match type, signer, source identity, method and subject namespace and authenticate the supplied source mechanism. Receivers MUST compute age as evaluation time minus source.observed_at for observations/effects/coverage, and minus signer timestamp for declared statements. Negative age or age above max_age_ms MUST leave freshness unresolved. A source time remains a source assertion. A receiver MUST require not_before <= relevant decision time < expires_at and verified authority/revocation at that time. Historical reception MUST use supported dispatch time and matching authority snapshots to establish permission at dispatch, rather than applying today's evaluation time retroactively. Reception of current permission MUST use evaluation time explicitly.

E17. Missing policy, unknown source mechanism, or unavailable identity, revocation or source inputs MUST remain unresolved. Receivers MUST reject source reliance for a known key excluded by a complete supplied policy, MUST leave unknown type semantics unresolved, and MUST reject evidence conformance for recognized malformed bodies. Evidence-envelope results MUST be recomputed rather than inherited.

E18. Results MUST identify input record hashes, policy id/JCS hash, evaluation time, and separate integrity, source, binding, authority, effect, coverage and publication dimensions. Each has state `supported | rejected | unresolved | conflict | not_applicable`, basis Hash[], and reasons string[]. Generic verifyRecord.valid remains a structural result. It MUST NOT imply these dimensions are supported.

The standard reasons are body_missing, opening_mismatch, schema_invalid, dependency_missing, dependency_invalid, source_untrusted, policy_missing, freshness_unknown, target_mismatch, descriptor_mismatch, execution_mismatch, authority_invalid, effect_unbound, coverage_gap and not_submitted. Additional reasons use absolute URI names. Missing bodies do not invalidate an otherwise valid signature; the integrity dimension reports separately whether the record and body checks passed.

E19. Receivers MUST report authority supported only for an applicable allow with supported exact binding, pinned authority basis, descriptor scope and time checks. They MUST report effect supported only for authenticated destination state and a supported request join. A separate destination-state fact MAY be supported while effect attribution stays unresolved. Coverage MUST be not_applicable without a coverage assertion and MUST remain unresolved without request-window membership when required for request reliance. Publication MUST require verified inclusion/checkpoint evidence with its actual scope. An unsubmitted local record MUST remain unresolved for publication, not invalid for signature integrity.

E20. Set evaluation MUST preserve per-statement facts and expose conflict for contradictory supported accounts about the same request and dimension. Receivers MUST NOT choose a winner by timestamp or erase independently verified facts because another type is unknown. Missing dependencies MUST affect dependent conclusions only. Receivers MUST accept reliance only when integrity and every required policy dimension are supported for the evaluated request. not_applicable MUST NOT satisfy required. A receiver MUST report deficient dimensions rather than collapsing them into a truth boolean.

E21. Reception MUST NOT itself grant execution permission or change an application's accepted state. The application owns its state/version checks. A report, command response, observed destination state and accepted result are separate facts. Search and summaries may locate evidence but cannot upgrade it. Daily continuation and incident reconstruction use the same accounts and expose the same gaps.

## 6. Disclosure and acceptance corpus

_This section is normative._

E22. A bundle MUST include selected signed records/openings, resolved basis artifacts or explicit missing entries, policy snapshot/hash, evaluation time, and any publication proofs. It MUST distinguish captured queries from destination-signed receipts. Mutable URLs alone are insufficient. Public submission is unnecessary for checking supplied local signatures and commitments.

These cases are required before a reference implementation can claim conformance. Each E01 through E22 and each grammar constraint needs positive and negative executable fixtures. This proposal contains acceptance definitions; it does not claim that executable receiver corpus already exists.

| Case | Input variation                                                      | Required result                                                              |
| ---- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| C01  | Complete opened request/allow/observation/effect with pinned sources | Integrity/source/binding/authority/effect supported; coverage not_applicable |
| C02  | Request opening withheld                                             | Opening and dependent parameter checks unresolved; reliance not accepted     |
| C03  | One committed parameter modified without resigning                   | Integrity rejected, opening_mismatch                                         |
| C04  | Only result_hash supplied, no args_hash body commitment              | Evidence conformance rejected; no body inferred                              |
| C05  | Approve descriptor A, dispatch B                                     | Binding rejected, descriptor_mismatch; actual dispatch retained              |
| C06  | Same descriptor, new execution identity on retry                     | Binding rejected, execution_mismatch                                         |
| C07  | Redelivery under same execution with new delivery ID                 | One request, two deliveries; no second effect inferred                       |
| C08  | Dispatch timeout plus agent success report                           | Outcome unknown, report retained, effect unresolved                          |
| C09  | Trusted destination state without native request join                | State supported, effect unresolved, effect_unbound                           |
| C10  | Valid signature from source outside pinned policy                    | Integrity supported, source rejected, source_untrusted                       |
| C11  | Policy or revocation snapshot unavailable                            | Dependent reliance unresolved                                                |
| C12  | Allow expired at supported dispatch time                             | Authority rejected, authority_invalid                                        |
| C13  | Coverage expected-source set unavailable                             | Coverage unresolved, never complete                                          |
| C14  | Expected ID missing or declared gap                                  | Coverage rejected, coverage_gap, scoped to the window                        |
| C15  | Trusted sources disagree on same destination object/version          | Conflict preserved; latest timestamp does not win                            |
| C16  | Private record has no publication proof                              | Integrity can pass, publication unresolved, not_submitted                    |
| C17  | Unknown extension URI                                                | Generic integrity may pass; evidence semantics unresolved                    |
| C18  | Artifact at locator changes bytes                                    | Dependency rejected, dependency_invalid                                      |
| C19  | Protected intent retention fails                                     | Effect refused; observational-only path can proceed with gap                 |
| C20  | Receipt from another invocation shares context/time                  | No supported causal join                                                     |

Further required cases:

| Case | Input variation                                                        | Required result                                                                |
| ---- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| C21  | Host captures a report without an executable request                   | CaptureObservation supports source capture only; no invented request or effect |
| C22  | Pinned authorizer approves a descriptor outside its exact policy scope | Authority rejected, authority_invalid                                          |
| C23  | Complete coverage manifest belongs to another source/window            | Cannot satisfy request coverage; demonstrated membership mismatch rejected     |

No format repairs universally omitted activity, proves hidden reasoning, or makes a compromised host's observation true. This contract retains Ed25519, JCS, record hashes, log leaves and ordinary cognitive records.
