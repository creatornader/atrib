# Source-bound evidence offline corpus

This corpus exercises the proposed [source-bound evidence contract](../../../docs/source-bound-evidence.md)
and [core §1.12](../../../atrib-spec.md#112-source-bound-evidence-statements).
The JSON inputs and expected assertions are canonical vectors for these offline
checks. Existing core Appendix A vectors still apply. Receiver cases use the
test-only receiver and body schemas under `packages/verify/test/source-bound-*`.
They do not export a public receiver API. C19 cases use the isolated executor
model described below.
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

The October 16 review retained all 141 prior cases and their dimension states.
It added the selected-untrusted-dispatch case and two publication cases, and
strengthened explicit standard reason assertions. The corpus now has 144 cases.
These expectations come from the contract rules and case table, independently
of receiver output.

The private-unpublished case asserts `not_submitted`. The publication cases
supply an exact request inclusion proof with a pinned checkpoint key, then
corrupt the checkpoint root without resigning. The log uses a separate fixed
test key. This proves proof validation against the supplied trust configuration,
without implying that independent organizations operate the fixture keys.

Executor-model cases have `input.mode: executor`. They inject a retention failure
and check whether the effect handler ran. They test the contract model's ordering,
not filesystem durability or the installed middleware. They cannot establish a
protected path exists in a deployment.
The production strict host is separate implementation work in
[PR #706](https://github.com/creatornader/atrib/pull/706), including
`packages/action-gate/test/strict-protected-mcp.test.ts` and
`packages/mcp/test/strict-mirror.test.ts`. Those package tests are outside this
specification change and the canonical offline corpus.

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

Source records, native query snapshots and destination receipts are different
evidence. This fixture signature authenticates the controlled fixture account; it
does not prove an external service answered, a sandbox was intact, or two keys had
independent operators. All fixture keys are controlled by one generator.

## Coverage and external obligations

| Rule family      | Offline check                                                                                                                 | Still required outside this corpus                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| E01-E02, grammar | Real signatures, complete openings, required fields, type/source constraints and prohibited carrier fields                    | Production random nonce generation and producer APIs                                                                 |
| E04-E11          | Exact request/execution/subject/authority/source/window bindings, timeout and destination facts                               | Native integration fidelity and source adapter validation against real captures                                      |
| E12, E18-E20     | No chronology-based joins, separate dimensions/deliveries, deterministic order, missing/conflicting facts and scoped reliance | Independently implemented receiver parity for supported production source methods                                    |
| E03, E14         | Refusal/continuation ordering in an isolated executor model                                                                   | Atomic record/opening storage, actual crash/restart recovery, actual protected handler refusal and bypass boundaries |
| E13              | Signed source artifacts must match authenticated facts and pinned keys                                                        | Actual signer isolation, truthful interception and administrative independence                                       |
| E15-E17          | Pinned source/authority policy, rule overlap, declared/run-key semantics and current/historical time                          | Real delegation compilation and historical revocation snapshots                                                      |
| E21              | Evaluation leaves the input accounts unchanged and does not implement app-state transitions                                   | Real app reducers preserve report/observed/accepted distinctions                                                     |
| E22, publication | Self-contained snapshots, explicit unpublished state, exact RFC 6962 inclusion and checkpoint signature rejection             | Production export/import UX and live public inclusion/checkpoint integration under core section 2                    |

The receiver model has fixed defensive limits: 32 source-reference hops, 256
source dependencies per statement and 1 MiB per artifact. These are this corpus
profile's bounds, not universal deployment sizes. Coverage may use one hash-bound
manifest for many IDs. Missing or corrupt source/authority/coverage material must
not be silently treated as complete. A known unavailable claim is not evidence
that no event occurred.

Passing these vectors establishes the selected offline distinctions. It does not
establish complete producer/receiver conformance, installed capture, publication,
application acceptance, or prevention of unobserved activity. The implementation
boundary remains in [STATUS.md](../../../STATUS.md#spec-defined-not-yet-implemented).
