# Source-bound evidence contract

Proposed normative text for [core §1.12](../atrib-spec.md#112-source-bound-evidence-statements). In-repository package source implements closed body validation and the explicit `verifyEvidenceSet` receiver. The [offline corpus](../spec/conformance/1.12/README.md) runs against that exported API with a test-only synthetic source adapter. [STATUS.md](../STATUS.md#spec-defined-not-yet-implemented) distinguishes these local implementations from publication, deployment and full operational conformance.

## 1. Conformance and carrier

_This section is normative._

An evidence statement consists of an atrib record and the private body committed by its args_hash. The signed event_type selects the body's contract. An evidence producer satisfies E01 through E14. An evidence receiver satisfies E02 and E04 through E22 where those rules describe reception. All grammar rules below apply to both. Generic signature verification and log admission are separate conformance targets.

Six extension URIs share the prefix `https://atrib.dev/evidence/v1/`: `request`, `authorization`, `observation`, `report`, `effect`, and `coverage`. They use byte 0xFF under core [§1.2.4](../atrib-spec.md#124-event_type-values). They do not allocate new core event bytes or require six stages for every operation. The attest/recall interface remains unchanged.

For these six URIs, the record MUST use the non-transaction signing shape. Required fields are spec_version, creator_key, chain_root, event_type, context_id, timestamp, args_hash and signature. content_id is optional. result_hash, result_salt, args_salt, signers, checkpoint, annotates and revises MUST be absent. Other core fields retain their core presence restrictions. Evidence reception MUST reject a prohibited field as schema_invalid even when the signature verifies. This shape does not require a fake tool response.

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
  payload_hash: Hash
  version: { kind: 'native' | 'snapshot'; value: string }
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

The execution boundary's versioned method contract MUST define normalization, including defaults and parameter transformations. The request MUST be minted after normalization and before authorization. The descriptor, including presence/value of version, MUST NOT change after approval. A later change requires a newly authorized request. Equal request/observation bytes from one boundary establish that boundary's consistent account, not independent corroboration.

E05. Authorization MUST target the exact request record hash, use that request's subject, include at least one authority basis entry, and use source.kind declared. Its producer MUST open and inspect the request before approving. not_before MUST be less than expires_at. An allow authorizes only that opened descriptor and execution within the interval and authority version. deny and escalate confer no permission. Broader grants remain authority inputs, such as core [§1.11](../atrib-spec.md#111-delegation-certificates) certificates; an authorization statement is not itself a universal grant format.

E06. ExecutionObservation MUST target the request, use its subject, record the actual descriptor and execution at its boundary, use source.kind boundary with observed_at, and include source basis. Dispatch MUST have outcome pending. Response MUST have success or error. Failure MUST have error or unknown. native_invocation and delivery identify the source occurrence and delivery attempt. destination_request MUST be included only when available from the source. A timeout after dispatch MUST remain unknown absent affirmative failure evidence. A handler's success response does not confirm destination state.

A CaptureObservation MUST use source.kind boundary with observed_at, set subject equal to occurrence, omit target, and bind artifact_hash through a source basis artifact entry. It records a native message/event without inventing a request, execution or delivery. It MUST NOT satisfy dispatch, request-binding, authority or effect conclusions. A later execution observation may cite it as source basis only when the source mechanism verifies the actual relationship. Captured reports remain accounts of a message at that boundary, not destination truth.

A protected dispatch MUST cite the exact allow record in basis with relation authority and kind record. Its source evidence MUST authenticate that reference. Historical authority MUST remain unresolved with authority_unordered when the dispatch does not cite an applicable allow. A hash reference establishes that the allow existed before the observation was signed. Permission before actual dispatch also depends on the trusted boundary enforcing its pre-effect check; a backdated host account does not prove real-world ordering by itself.

E07. Report MUST target the request, use its subject and use source.kind declared. It attributes the report to its signer and does not accept an application result. A host recording an unsigned agent message MUST instead use CaptureObservation and bind the message as source material. It MUST NOT represent its key as the agent's signature.

E08. Effect MUST target the request, use its subject, use source.kind query or receipt with observed_at, and include source basis. payload_hash MUST select the exact raw destination payload artifact from source basis. The source mechanism MUST authenticate how object, version and state derive from those bytes and any captured transport metadata. version.kind native identifies an actual destination revision. With kind snapshot, value MUST equal payload_hash; it is not a destination revision. The raw payload MUST be separate from the signed source wrapper so neither artifact contains its own hash. If binding is present, the receiver MUST resolve observation_record, check its exact request target, subject, execution, native invocation and delivery, and compare destination_request against the observation and destination evidence. Without this join, destination state can be supported while causal attribution remains unresolved. Shared time, context or resource names cannot supply the join.

Two supported destination accounts conflict only when object and native version match and JCS(state) differs. Different native versions and different snapshot digests MUST remain separate facts; they MUST NOT be collapsed into one current state by timestamps. A source adapter, not generic evidence reception, defines any destination-specific progression rule.

E09. Coverage MUST omit target, set subject equal to surface, and use source.kind manifest with observed_at. start/end are source-native exclusive-start/inclusive-end cursors ordered by source.method. A complete conclusion MUST verify source basis for the named window, expected basis establishing the expected set independently of the claimed captured set, captured basis for every captured ID, and membership of every expected ID in captured. Receivers MUST reject duplicate IDs and MUST NOT report completeness with a declared gap or missing expected material. An empty expected set MUST have affirmative source evidence. The claim concerns only the named surface/window. Existing runtime-log manifests may serve as artifacts without automatically establishing independent expected coverage.

When a source uses the existing runtime-bound coverage manifest
([D168](../DECISIONS.md#d168-coverage-manifests-make-capture-scope-verifiable)), that manifest
remains its canonical inventory. A coverage statement is a typed projection
that commits and authenticates facts from the manifest. It MUST NOT introduce
an independently mutable inventory. Its source mechanism MUST check the
projection against the exact manifest bytes. This preserves the independent
expected-set requirement above.

For coverage to satisfy request-level reliance, a receiver MUST resolve an ExecutionObservation targeting that exact request, match its source.identity to coverage.surface, and verify from hash-bound source artifacts that its native_invocation lies inside the coverage window and both expected and captured sets. The approved source mechanism MUST expose the observation's native cursor and verify window membership using its cursor-order contract. CaptureObservation can similarly be checked using occurrence, but cannot become request execution evidence. An unrelated complete manifest MUST NOT satisfy required coverage. Missing membership evidence is unresolved. A coverage statement claiming a demonstrated different surface/window MUST be rejected for that reliance. If no applicable manifest remains, request-level coverage stays unresolved under the aggregation rule below.

The source mechanism MUST establish that observation and inventory refer to the
same native event bytes. Equal IDs and cursors alone MUST NOT authenticate
different event content. Each versioned method defines its authenticated join;
this rule does not add a generic native-event hash field to the body grammar.
The runtime-coverage method requires exact native-event hash membership. Its
host-signed inventory establishes consistency within the pinned host's account,
not independent administrative observation.

## 4. Binding and source boundaries

_This section is normative._

E10. Every basis entry is a dependency. Receivers MUST resolve record hashes under core [§1.3](../atrib-spec.md#13-canonical-serialization) and artifact hashes over exact bytes. Missing dependencies MUST remain unresolved; invalid dependencies MUST reject dependent reliance. Locators are retrieval hints, never hash substitutes. Receipt sources MUST pass native signature verification. Query sources MUST have receiver-approved provenance for the captured response. source.method MUST be an absolute URI naming a versioned source-verification contract. A host account of a query is not a destination signature. Merely signing a source reference cannot authenticate its content.

Producers MUST NOT put credentials in locators, including bearer tokens or
pre-signed URLs. Receivers MUST reject recognizable credential forms and MUST
NOT dereference locators during reception. A receiver cannot establish that an
opaque path or value contains no credential. That limit does not relax the
producer prohibition. One captured/expected manifest artifact MAY account for
multiple IDs when the source mechanism verifies membership for each ID; one
basis entry per captured ID is not required.

E11. For an ExecutionObservation, receivers MUST open its body and the targeted request body separately, then compare descriptors by JCS equality and scoped IDs by namespace/id equality. CaptureObservation has no request descriptor and MUST NOT enter this comparison or acquire request-binding support. Receivers MUST resolve the exact target record, not a convenient matching public ID. Changed parameters, target, version or execution reject the binding. Independent nonces and whole-body hashes need not match. A new execution retry requires a new request and applicable authority. Transport redelivery retains request/execution and gets its own delivery ID. It does not establish another effect or exactly-once execution.

E12. Evidence projections MUST preserve authors and conflicting accounts. informed_by remains declared reasoning. Chronology, shared context and CONVERGES_ON edges MUST NOT be presented as observed operational causality. Disclosed typed relationships do not add public base-graph edges or authorize public indexing of private bodies.

E13. Boundary producers MUST derive observations from intercepted source data. An isolated signer that accepts arbitrary agent-authored observations as host facts does not conform. Different keys do not establish independent administrative control. A captured agent report remains a captured report, not an observed effect.

E14. Observational capture failure MAY permit work to continue, but MUST surface degraded capture and retain a diagnostic/gap when storage permits. Producers MUST NOT label post-call fallback as durable pre-action intent. An executor explicitly configured to require durable intent before a protected effect MUST refuse that effect when retention fails. This is a path-specific guarantee, not a universal fail-closed tool policy. Coverage never extends to uninstrumented paths by implication.

The protected retention check MUST run on the executor's own awaited path, outside observational trigger handlers whose exceptions are swallowed. It MUST return an explicit refusal without invoking the effect handler when retention fails. Generic observational middleware does not acquire that guarantee from logging configuration.

These explicitly enabled preconditions belong to host execution policy.
Default observational middleware retains the core
[§5.8 degradation contract](../atrib-spec.md#58-degradation-contract). Existing wrapper and SDK
action records acquire neither source-bound conformance nor destination-effect
proof merely because this contract exists. A host may integrate a selected
protected path without migrating its other harnesses.

## 5. Receiver policy and results

_This section is normative._

E15. Reception MUST receive an immutable policy snapshot and evaluation time. The snapshot MUST use the following closed shape. Receivers MUST compare URIs, keys and IDs exactly. max_age_ms MUST be a nonnegative integer. required MUST contain unique entries. Empty rules MUST confer no trust.

```typescript
type Policy = {
  id: string
  rules: Array<{
    type: string
    signer_keys: string[]
    source_keys: string[]
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

For this pinned-root contract, each pinned authority snapshot MUST be a closed JSON object with version (nonempty string), not_before and expires_at (integer Unix milliseconds, not_before < expires_at), and revoked (boolean). The receiver MUST require its version to equal authority_version, revoked false, and its validity interval to contain decision time. The policy binds that exact snapshot to the listed signer/descriptor scope. These are receiver-root assertions compiled from grants, not self-authenticating external credentials. Additional grant/delegation records may be retained as basis, but their scope MUST NOT be inferred without the named compilation mechanism. Missing snapshots leave authority unresolved; invalid or revoked snapshots reject authority. An unavailable authority dependency does not erase a separately authenticated observation of dispatch.

Rule matching MUST use creator_key directly, not an implicit principal walk. A compiled delegation MUST list the run key explicitly and retain its checked resolution inputs. source_keys pins any independent artifact-signing keys used by the named source mechanism; a method MUST NOT consult ambient trust keys. Policies MUST reject overlapping rules when type, source, subject namespace, at least one signer key and at least one method all intersect. Array order MUST NOT select a permissive rule. An invalid policy leaves source/authority reliance unresolved with policy_invalid.

The reserved method `https://atrib.dev/evidence/v1/method/declared` MUST be used for source.kind declared. It authenticates only the signed account by creator_key, not event truth. observed_at MUST be absent for declared sources. No source artifact is required for that method. Other methods MUST authenticate their source facts from hash-bound artifacts and explicitly pinned keys.

E16. Reception MUST receive Evaluation with purpose current or historical and an integer evaluated_at. Historical purpose MUST also name one dispatch_record hash. That record MUST be a source-supported dispatch ExecutionObservation targeting the evaluated request; its source.observed_at is the authorization decision time. Missing or unsupported dispatch evidence MUST leave historical authority unresolved. Current purpose MUST omit dispatch_record and use evaluated_at as the authorization decision time. A receiver MUST require not_before <= decision time < expires_at and verified authority/revocation at that time. Historical permission does not grant permission now.

Current purpose is pre-dispatch evaluation only. If any source-supported dispatch for the request is supplied, current purpose MUST leave authority unresolved with purpose_mismatch instead of relabeling historical permission at today's time. Its non-executed result MUST include no_dispatch_observed. Historical request dimensions concern only the explicitly selected dispatch; the result MUST identify it and MUST retain all other deliveries. Applications evaluating all activity MUST evaluate each observed dispatch, rather than choose a favorable delivery time.

A matching rule MUST match type, signer, source identity, method and subject namespace and authenticate the supplied source mechanism. In both purposes, receivers MUST compute evidence age as evaluated_at minus source.observed_at for observations/effects/coverage, and minus signer timestamp for declared statements. Negative age or age above max_age_ms MUST leave freshness unresolved. This is evidence freshness at reception, separate from authorization validity at dispatch. An archival policy may permit older evidence explicitly; historical purpose MUST NOT silently disable freshness checks. A source time remains a source assertion.

Freshness failure MUST set source.state unresolved with freshness_unknown and propagate only to dependent conclusions. An archival policy may deliberately differ from a live-action policy. The two policies do not claim equal reliance results. Evidence age MUST NOT be used as an execution timeout or proof that a handler stopped.

E17. Missing policy, unknown source mechanism, or unavailable identity, revocation or source inputs MUST remain unresolved. Receivers MUST reject source reliance for a known key excluded by a complete supplied policy, MUST leave unknown type semantics unresolved, and MUST reject evidence conformance for recognized malformed bodies. Evidence-envelope results MUST be recomputed rather than inherited.

E18. Results MUST identify input record hashes, policy id/JCS hash, evaluation time, and separate integrity, source, binding, authority, effect, coverage and publication dimensions. Each has state `supported | rejected | unresolved | conflict | not_applicable`, basis Hash[], and reasons string[]. Generic verifyRecord.valid remains a structural result. It MUST NOT imply these dimensions are supported.

The result MUST follow this shape. The record_hash in a StatementResult identifies the complete signed record. Record integrity and body integrity remain separate. The outer integrity state is supported only when both are supported. A missing opening leaves body integrity unresolved without changing a supported signature result. Request-level results are absent for a capture-only evaluation. Implementations MUST sort statement results by record hash and MUST sort/deduplicate basis, reasons and deficient arrays lexicographically.

```typescript
type Evaluation =
  | { purpose: 'current'; evaluated_at: number }
  | { purpose: 'historical'; evaluated_at: number; dispatch_record: Hash }
type State = 'supported' | 'rejected' | 'unresolved' | 'conflict' | 'not_applicable'
type Dimension = { state: State; basis: Hash[]; reasons: string[] }
type Dimensions = {
  integrity: Dimension & { record: Dimension; body: Dimension }
  source: Dimension
  binding: Dimension
  authority: Dimension
  effect: Dimension
  coverage: Dimension
  publication: Dimension
}
type EvidenceSetResult = {
  policy: { id: string; hash: Hash } | null
  evaluation: Evaluation
  statements: Array<{ record_hash: Hash; dimensions: Dimensions }>
  request: null | {
    record_hash: Hash
    dimensions: Dimensions
    execution: {
      deliveries: Array<{
        delivery: ScopedId
        state: 'success' | 'error' | 'unknown' | 'conflict'
        basis: Hash[]
      }>
    }
    destination_states: Array<{
      record_hash: Hash
      object: ScopedId
      version: { kind: 'native' | 'snapshot'; value: string }
      state: JSON
      source: Dimension
      binding: Dimension
    }>
    reliance: { accepted: boolean; deficient: Array<keyof Dimensions> }
  }
}
```

The caller MUST select at most one request record hash for request-level evaluation. Each source verifier is selected by the exact versioned method URI pinned in policy. It MUST verify artifact bytes and return normalized source facts used in the body checks, including any descriptor, native identifiers, object/version/state and cursor/window claims it authenticates. It MUST NOT consume supplied verdicts or policy results as authenticated source facts. Unknown mechanisms leave source reliance unresolved. The mechanism contract MUST define its input artifacts, trust keys, fact mapping and rejection conditions. A method name alone is not a verification mechanism. Source adapters MUST have their own positive and negative fixtures before receivers rely on their facts.

Request-level aggregation MUST use the following rules. A source-supported statement has supported record/body integrity and source authentication/freshness, including dependencies needed to authenticate that source. Other typed dependencies MUST constrain their dependent binding, authority or coverage conclusions rather than erase separately authenticated capture. Receivers MUST resolve every cited dependency for that dimension even when another qualifying witness is available. Reference order MUST NOT select which dependency failures count. Untrusted or unopened additions MUST remain in statement results without overwriting independently supported facts. Selecting a non-request record as the request MUST NOT produce a request-level verdict.

| Dimension   | Applicable accounts and reduction                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| integrity   | The selected request's record and opening, not all unrelated input records. Rejected beats unresolved; both supported yields supported.                                                                                                                                                                                                                                                                                                                                                       |
| source      | The selected request for current purpose, or selected dispatch for historical purpose. No best-source substitution for that named dispatch.                                                                                                                                                                                                                                                                                                                                                   |
| binding     | Compare the selected dispatch with its exact request. Conflicting supported accounts of that same native invocation/delivery yield conflict. Other deliveries remain separately visible. Current pre-dispatch binding is not_applicable.                                                                                                                                                                                                                                                      |
| authority   | Current: applicable allow/deny/escalate accounts for the request. Historical: only exact authority record hashes authenticated in the selected dispatch's basis. No citation yields unresolved. An applicable deny/escalate yields rejected; contrary applicable decisions yield conflict. At least one supported allow and no unresolved cited grant yields supported. Invalid cited grants reject; unavailable cited grants leave unresolved.                                               |
| effect      | Source-supported effects joined through an observation with the selected dispatch's exact request/subject/execution/native invocation/delivery. A supported joined effect suffices unless a supported native-version/state contradiction yields conflict. Multiple destination_request IDs conflict only where the named method promises a single destination request per delivery. Otherwise retain separate effects. Unbound destination states remain visible without establishing effect. |
| coverage    | A manifest must prove membership of the selected dispatch's source/native invocation and cursor window. Any applicable supported manifest with an explicit gap rejects; otherwise one fully accounted applicable manifest supports. Missing applicable coverage is unresolved when coverage assertions were supplied; no coverage assertion gives not_applicable. Unrelated manifests cannot satisfy it.                                                                                      |
| publication | Only verified proof for the selected request under core section 2. No proof gives unresolved.                                                                                                                                                                                                                                                                                                                                                                                                 |

Within each delivery, two source-supported terminal observations with different outcomes MUST yield execution conflict. One terminal outcome MUST be retained; dispatch alone yields unknown, not proof of continuing execution. Different deliveries MAY legitimately have different outcomes; they MUST remain separate rather than be called contradictory. Reports MUST NOT feed observed execution results.

Receiver output MUST sort destination_states by record_hash and deliveries by JCS(delivery). For conformance equality, compare policy hash, evaluation, record hashes, all dimension states and standard reasons, execution delivery states/basis, destination records/object/version/state and reliance. URI-namespaced vendor reasons are informative and excluded from this equality projection. Supplied standard reasons MUST have the same rule-defined meaning across implementations.

The standard reasons are body_missing, opening_mismatch, schema_invalid, dependency_missing, dependency_invalid, source_untrusted, policy_missing, policy_invalid, freshness_unknown, target_mismatch, descriptor_mismatch, execution_mismatch, authority_invalid, authority_unordered, purpose_mismatch, no_dispatch_observed, effect_unbound, effect_conflict, source_conflict, coverage_gap, not_submitted, signature_invalid, unknown_type, dependency_cycle and resource_limit. Additional reasons use absolute URI names. Missing bodies do not invalidate an otherwise valid signature; the integrity dimension reports separately whether the record and body checks passed.

E19. Receivers MUST report authority supported only for an applicable allow with supported exact binding, pinned authority basis, descriptor scope and time checks. They MUST report effect supported only for authenticated destination state and a supported request join. A separate destination-state fact MAY be supported while effect attribution stays unresolved. Coverage MUST be not_applicable without a coverage assertion and MUST remain unresolved without request-window membership when required for request reliance. Publication MUST require verified inclusion/checkpoint evidence with its actual scope. An unsubmitted local record MUST remain unresolved for publication, not invalid for signature integrity.

E20. Set evaluation MUST preserve per-statement facts and expose conflict for contradictory supported accounts about the same request and dimension. Receivers MUST NOT choose a winner by timestamp or erase independently verified facts because another type is unknown. Missing dependencies MUST affect dependent conclusions only. Receivers MUST accept reliance only when integrity and every required policy dimension are supported for the evaluated request. not_applicable MUST NOT satisfy required. A receiver MUST report deficient dimensions rather than collapsing them into a truth boolean.

An explicit empty required array selects integrity-only reliance. It MUST NOT
upgrade source, authority or any other dimension. An accepted integrity-only
result grants no execution permission and does not satisfy a host policy that
requires source, binding or authority. Applications MUST inspect the reported
dimensions and their own execution policy before acting.

E21. Reception MUST NOT itself grant execution permission or change an application's accepted state. The application owns its state/version checks. A report, command response, observed destination state and accepted result are separate facts. Search and summaries may locate evidence but cannot upgrade it. Daily continuation and incident reconstruction use the same accounts and expose the same gaps.

## 6. Disclosure and acceptance corpus

_This section is normative._

E22. A bundle MUST include selected signed records/openings, resolved basis artifacts or explicit missing entries, policy snapshot/hash, evaluation time, and any publication proofs. It MUST distinguish captured queries from destination-signed receipts. Mutable URLs alone are insufficient. Public submission is unnecessary for checking supplied local signatures and commitments.

Here, bundle names the disclosed material required for replay. It does not
require a separate bundle framework, export/import API, or publication API.
Existing local mirror retention, runtime-log inspection and core anchor-proof
verification may supply those functions. Any claimed publication support still
requires the verified proof in E19.

These cases are required before a reference implementation can claim conformance. Each E01 through E22 and each grammar constraint needs positive and negative executable fixtures. The [offline corpus](../spec/conformance/1.12/README.md) checks receiver cases through the exported receiver and a test-only source adapter. C19 separately exercises a test-only executor model. It does not exercise the production protected executor or prove filesystem durability. Its JSON input/expected assertions are the canonical vectors for these checks, jointly normative with core Appendix A. Its external-obligation ledger does not claim that offline vectors prove operational host capture, storage durability, administrative independence or app acceptance. The local implementation does not establish published, deployed or full producer/receiver conformance.

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
| C10  | Selected dispatch signed by a source outside pinned policy           | Integrity supported, selected source rejected, source_untrusted              |
| C10b | Untrusted extra response beside a supported selected dispatch        | Extra source rejected; preserve independently supported selected facts       |
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

| Case | Input variation                                                        | Required result                                                                                                   |
| ---- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| C21  | Host captures a report without an executable request                   | CaptureObservation supports source capture only; no invented request or effect                                    |
| C22  | Pinned authorizer approves a descriptor outside its exact policy scope | Authority rejected, authority_invalid                                                                             |
| C23  | Complete coverage manifest belongs to another source/window            | Statement's demonstrated membership mismatch rejected; request coverage unresolved without an applicable manifest |

No format repairs universally omitted activity, proves hidden reasoning, or makes a compromised host's observation true. This contract retains Ed25519, JCS, record hashes, log leaves and ordinary cognitive records.
