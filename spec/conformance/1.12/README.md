# Source-bound evidence offline corpus

This corpus exercises the proposed [source-bound evidence contract](../../../docs/source-bound-evidence.md)
and [core §1.12](../../../atrib-spec.md#112-source-bound-evidence-statements).
The receiver JSON inputs and expected assertions are canonical vectors, jointly
normative with core Appendix A. Existing core Appendix A vectors still apply.
Receiver cases use the test-only receiver and body schemas under
`packages/verify/test/source-bound-*`.
They do not export a public receiver API. C19 executor cases are non-normative
examples of one configured host policy. They define neither protocol nor receiver
conformance requirements.
The source adapter uses synthetic test artifacts. Passing it does not establish
an installed capture/execution boundary or package publication.

## Run

From the repository root, after dependency installation:

```sh
pnpm --filter @atrib/mcp build
pnpm --filter @atrib/verify test -- conformance-1.12.test.ts source-bound-schemas.test.ts source-bound-adversarial.test.ts
pnpm --filter @atrib/verify exec tsx test/run-source-bound-fixture.ts ../../spec/conformance/1.12/cases/C01-complete.json
```

Regenerate fixed signed inputs with:

```sh
pnpm --filter @atrib/verify exec tsx test/generate-source-bound-corpus.ts
pnpm exec prettier --write 'spec/conformance/1.12/cases/*.json' spec/conformance/1.12/manifest.json 'spec/conformance/1.12/objects/*.json'
```

The generator uses the existing atrib signing/canonicalization helpers. It does
not import the evaluator's verdict function or compute expected verdicts from
actual output. Each expected assertion is authored in the case table. All seeds
and fixed nonces are public test material. Never use these keys or nonce
construction in a deployment.

## Fixture and result format

`manifest.json` enumerates every case file. Each case carries input, expected,
protects, fails_when, no_claim and rule IDs. Signed records, private openings,
policies, evaluations and artifact maps refer to shared entries in three
content-addressed stores: `objects/json-values.json`, `objects/artifacts.json`
and `objects/artifact-maps.json`. Store files are pretty-printed. JSON value
references use JCS hashes; artifact references hash decoded bytes. The artifact
map uses a closed typed wrapper, and its reader checks the hash of the fully
materialized map. The test reader verifies referenced entries and reconstructs
complete receiver inputs before evaluation. Missing, malformed or mismatched
entries fail the reader. Expected assertions remain explicit in each case. No
URL is fetched.

Expected objects are partial assertions against the receiver result, not a
requirement that unrelated facts disappear. `invalid_kind` is a schema-vector
shorthand: every record of that type must have rejected body integrity, and
unmutated types must retain supported body integrity. It is not a receiver input.
Case IDs beginning C map to the contract's acceptance cases. F IDs name additional
adversarial conditions. Schema cases remove required fields or add an unknown
field while retaining a genuine signature over the malformed body.

Each entry in `expected.statements` selects a statement by its exact record hash
and asserts only the listed fields. Request dimensions stay scoped to the
selected request and dispatch. `C10-selected-untrusted-dispatch` covers contract
C10. The retained `C10-untrusted-injection` case covers C10b: an extra untrusted
response leaves the selected trusted dispatch's reliance intact. C23 and the
other-surface variant assert rejected statement coverage with `target_mismatch`
and unresolved request coverage with `dependency_missing`.

The October 16 corpus revision retains all 167 prior case IDs and adds eight
cases, for 175 total. Four cases cover raw JCS openings with an own
`__proto__` property in request parameters and effect state, including a valid
opening and a same-hash mutated opening for each assertion. Two cases reject
invalid-port and malformed-IPv6 locators. One positive case accepts a relative
locator. A separate policy case tests a parsed own `__proto__` key in the
authorized descriptor while leaving C01's signed inputs unchanged. C11 now
checks the source dimension's `policy_missing` reason. The three C19 executor examples remain
non-normative. Expected results come from the contract rules and case table,
independently of receiver output.

The private-unpublished case asserts `not_submitted`. A valid inclusion under a
pinned checkpoint supports publication even when another proof in the same
bundle is invalid. An invalid-only bundle rejects. C16 covers the valid and
invalid-only cases. A separate production-receiver companion test covers the
mixed-bundle behavior. The log uses a separate fixed test key. These checks
validate proofs against supplied trust, without implying that independent
organizations operate the fixture keys.

The three C19 executor-model cases have `input.mode: executor`. They vary
retention outcomes and check whether the effect handler ran under one configured
host policy. Their expected outcomes are non-normative examples, outside protocol
and receiver conformance requirements. The checks do not establish filesystem
durability, installed middleware or a protected path in a deployment. Host
execution policy is specified separately from the evidence contract.

Keep implementation evidence for E01, E03, E13 and E14 in the operational
evidence ledger. These fixtures do not establish live interception, durable
record/opening retention or pre-action durability.

## Synthetic source mechanism

The test-only URI `https://atrib.dev/conformance/method/signed-snapshot-v1`
verifies an Ed25519 signature over JCS(payload). The artifact contains payload,
signer_key and signature. Policy source_keys pins the permitted artifact keys.
The payload's claim binds the subject, assertion, target and source fields from
the statement, excluding its nonce and basis to avoid a commitment cycle. Its
authority array authenticates the exact allow-record references used at dispatch.
Its integer cursor is a source coordinate for exclusive-start/inclusive-end
numeric windows. Expected and captured manifests authenticate surface/window/ID
sets separately. The method models a single native destination request per
delivery. Other adapters must declare their own multiplicity and source rules.

For coverage, the signed dispatch payload also commits `native_event_hash`.
The hash addresses exact JCS bytes containing the source surface, native ID,
cursor and execution assertion. The source adapter checks those bytes against
the dispatch claim. Signed expected and captured manifests carry `native_events`
entries binding IDs to the same event bytes. The receiver compares these
authenticated hashes through its existing callback facts. Equal IDs with
different event bytes reject coverage. A missing native hash leaves it unresolved.
This hash representation belongs to this synthetic method. Other approved
methods may define a different authenticated join.

Three synthetic method variants exercise policy differences. The
`signed-snapshot-multiple-v1` variant permits multiple destination requests per
delivery. `signed-snapshot-other-cursor-v1` has a distinct cursor contract, so its
window cannot be compared with the base method. The
`signed-snapshot-unknown-cursor-v1` comparator returns unknown. Each URI uses the
same `https://atrib.dev/conformance/method/` prefix and signature mechanism.

This repairs the earlier ID-only synthetic method. Six inputs from the previous
144-case corpus change: `C13-expected-set-missing`, `C14-capture-gap`,
`C23-other-window`, `coverage-complete`, `coverage-captured-material-missing` and
`coverage-other-surface`. Their dispatch and coverage source artifacts now bind
native bytes. Their dimension-state expectations remain unchanged. The other
138 inputs remain unchanged. This is the explicit input exception to the
earlier frozen corpus, not a claim that the old ID-only proof was sufficient.

Source records, native query snapshots and destination receipts are different
evidence. This fixture signature authenticates the controlled fixture account; it
does not prove an external service answered, a sandbox was intact, or two keys had
independent operators. All fixture keys are controlled by one generator.

## Coverage and external obligations

| Rule family      | Offline check                                                                                                                 | Still required outside this corpus                                                                                  |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| E01-E02, grammar | Real signatures, complete openings, required fields, type/source constraints and prohibited carrier fields                    | Production random nonce generation and producer APIs                                                                |
| E04-E11          | Exact request/execution/subject/authority/source/window bindings, timeout and destination facts                               | Native integration fidelity and source adapter validation against real captures                                     |
| E12, E18-E20     | No chronology-based joins, separate dimensions/deliveries, deterministic order, missing/conflicting facts and scoped reliance | Independently implemented receiver parity for supported production source methods                                   |
| E03, E14         | C19 provides non-normative host-policy examples, not conformance checks for these rules                                       | Durable recording acknowledgements, record/opening recovery, capture diagnostics and pre-action durability evidence |
| E13              | Signed source artifacts must match authenticated facts and pinned keys                                                        | Actual signer isolation, truthful interception and administrative independence                                      |
| E15-E17          | Pinned source/authority policy, rule overlap, declared/run-key semantics and current/historical time                          | Real delegation compilation and historical revocation snapshots                                                     |
| E21              | Evaluation leaves the input accounts unchanged and does not implement app-state transitions                                   | Real app reducers preserve report/observed/accepted distinctions                                                    |
| E22, publication | Self-contained snapshots, explicit unpublished state, exact RFC 6962 inclusion and checkpoint signature rejection             | Production export/import UX and live public inclusion/checkpoint integration under core section 2                   |

The public `verifyEvidenceSet` implementation limits source-reference traversal
to 32 hops, 256 references and 16 MiB of artifact bytes per traversal, with 1 MiB
per artifact. Its input preflight visits at most 100,000 JSON nodes and 64 MiB
combined string and artifact bytes, stopping at depth 64. If an opening contains
a subtree below that depth, preflight marks the opening limited and does not
count the unvisited descendants. These are implementation defenses, not
normative §1.12 limits. The standalone corpus oracle does not exercise the
preflight depth guard. Coverage may use one hash-bound manifest for many IDs.
Missing or corrupt source/authority/coverage material must not be silently
treated as complete. A known unavailable claim is not evidence that no event
occurred.

Passing these vectors establishes the selected offline distinctions. It does not
establish complete producer/receiver conformance, installed capture, publication,
application acceptance, or prevention of unobserved activity. The implementation
boundary remains in [STATUS.md](../../../STATUS.md#spec-defined-not-yet-implemented).
