# @atrib/runtime-log

`@atrib/runtime-log` builds and verifies proof manifests for host-owned agent
runtime logs in atrib's verifiable action layer.

A runtime log is the execution record a host uses to reconstruct, resume, fork,
compact, replay, or audit a run. atrib does not need the raw log body by
default. The package gives adapters one shared way to commit to a bounded run
window through a `log_window_manifest`.

## Install

```bash
pnpm add @atrib/runtime-log
```

Version 0.2.0 was first-published manually. Later releases use npm Trusted
Publisher through `release.yml`.

## When to use it

Use this package when a runtime already owns a run log and another agent,
reviewer, evaluator, or auditor needs to verify a claim about a bounded window
of that log.

| Situation                                                                      | Right surface                                                                                                                                  |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| You need to sign tool calls as they happen.                                    | Use `@atrib/mcp`, `@atrib/mcp-wrap`, or `@atrib/agent`.                                                                                        |
| You already emit OpenTelemetry or OpenInference spans.                         | Use `@atrib/openinference` beside your existing trace exporter.                                                                                |
| You need to prove a run window, fork, compaction, projection, or receipt root. | Use `@atrib/runtime-log`.                                                                                                                      |
| You need to observe an already-running local runtime without taking it over.   | Use an observation adapter under `@atrib/runtime-log`, then let the host commit each batch and cursor together.                                |
| You want a hosted trace dashboard, prompt analytics, cost charts, or eval UI.  | Use Langfuse, Phoenix, LangSmith, Braintrust, or your existing observability stack. atrib can sign evidence that points back to those systems. |

`@atrib/runtime-log` does not decide what a runtime should store. It gives the
runtime a verifier object when the runtime wants to prove a specific slice of
what it already stores. That lets teams coordinate handoffs, incidents,
approval gates, and later review without publishing raw run bodies by default.

## Basic use

```ts
import {
  buildRuntimeLogInspection,
  createLogWindowManifest,
  hashRuntimeLogEvent,
  renderRuntimeLogInspectionHtml,
  verifyLogWindowManifest,
} from '@atrib/runtime-log'

const events = [
  {
    event_id: 'evt-1',
    position: 1,
    event_hash: hashRuntimeLogEvent({
      type: 'tool_call',
      tool: 'browser.open',
      args_hash: 'sha256:54b7c5e58f7f4f36b0f91d8b7ec10c6d4b7b32afed0b4da30172c5f7c8b19c6d',
    }),
  },
]

const manifest = createLogWindowManifest({
  source: {
    id: 'activegraph.local',
    kind: 'activegraph-export',
    version: '0.1.0',
  },
  runtime: {
    name: 'activegraph',
    version: '0.1.0',
  },
  session: {
    id: 'run-42',
    digest: 'sha256:54b7c5e58f7f4f36b0f91d8b7ec10c6d4b7b32afed0b4da30172c5f7c8b19c6d',
  },
  window: {
    start: 1,
    end: 1,
  },
  events,
  privacy_posture: 'host-owned',
  verifier_policy: {
    require_event_root: true,
  },
})

const result = verifyLogWindowManifest(manifest, { events })

if (!result.valid) {
  throw new Error(result.errors.join(', '))
}

const inspection = buildRuntimeLogInspection({
  manifest,
  evidence: { events },
})
const html = renderRuntimeLogInspectionHtml(inspection)
```

## Verifier contract

`verifyLogWindowManifest()` returns both human text and machine-readable issue
codes:

```ts
const result = verifyLogWindowManifest(manifest, {
  session_definition: sessionDefinition,
  events,
  fork_parent_manifest: parentManifest,
  compaction_source_manifest: sourceManifest,
  compaction_events: compactedEvents,
})

for (const issue of result.issues) {
  console.error(issue.code, issue.message)
}
```

The package currently checks schema, trusted source, session-definition digest,
event root, event count, declared window bounds, required projection names,
projection roots, fork parent manifest hash, compaction source manifest hash,
compaction event root, required receipt protocols, side-effect receipt roots,
and manifest fields named by `redaction.fields`.

## Expected-surface coverage

A `coverage_manifest` states which capture boundaries a host expected for one
runtime window and accounts for each expected action as `captured`, `skipped`,
or `degraded`.

```ts
import {
  buildCoverageAttestationContent,
  createCoverageManifest,
  hashCoverageAttestationContent,
  verifyCoverageManifest,
} from '@atrib/runtime-log'

const coverage = createCoverageManifest({
  log_window_manifest: manifest,
  surfaces: [
    {
      id: 'mcp',
      boundary: 'mcp-server-dispatch',
      owner: '@atrib/mcp-wrap',
      required: true,
    },
  ],
  actions: [
    {
      action_id: 'runtime-event-2',
      surface_id: 'mcp',
      action_hash: events[0].event_hash,
      state: 'captured',
      record_hash: 'sha256:...',
    },
  ],
})

const content = buildCoverageAttestationContent(coverage)
const argsHash = hashCoverageAttestationContent(coverage)
```

Pass `content` to `@atrib/sdk` `attest()`. Its normal
[D099](../../DECISIONS.md#d099-explicit-emit-content-is-committed-and-direct-emits-have-a-default-mirror)
path signs `args_hash = sha256(JCS(content))`, which commits the
coverage-manifest hash and the bound runtime-window hash.
`verifyCoverageManifest()` can then compare the record's `args_hash`, the full
runtime-window manifest, runtime-owned expected action refs, and the captured
signed record hashes.

The verifier reports its basis as `manifest-claim` or `runtime-compared`.
Omission detection is only relative to the supplied runtime evidence. A
hostile host that removes an action from both its runtime log and coverage
manifest remains outside this proof boundary.

The shared conformance corpus lives at
[`spec/conformance/runtime-log/`](../../spec/conformance/runtime-log/). Adapter
authors can run their own verifier against those cases before publishing a new
runtime-log source.

### Source-bound projection

`projectCoverageEvidence()` projects the existing [D168 manifest](../../DECISIONS.md#d168-coverage-manifests-make-capture-scope-verifiable) into a
[§1.12 coverage body](../../docs/source-bound-evidence.md). Its output contains
the body and exact artifact bytes for private retention. It accepts the coverage
manifest, runtime-window manifest, event refs, both existing signed commitment
records, and captured observation units. Register `runtimeCoverageSourceVerifier`
under `RUNTIME_COVERAGE_METHOD` when calling `verifyEvidenceSet()`. The CLI
registers this method for retained-journal inspection.

The adapter derives `facts.claim.assertion` from the verified inventory and returns
its exact native hashes in `facts.native_events` for the receiver's membership join.

The versioned method is
`https://atrib.dev/evidence/v1/method/runtime-coverage/1`. Its bounded profile
requires one surface with exactly one `action_kinds` entry and at most 128 native
events. Event positions must be positive, contiguous safe integers. The coverage
start cursor is the first position minus one, and the end is the last position.
Both cursors use canonical decimal strings. Other cursor profiles are rejected.

`sourceIdentity.id` must equal the runtime manifest's source ID. Native
invocations use `sourceIdentity.namespace + '/invocations'`. Each typed observation
binds the JCS frame containing `event_id`, `context_id`,
`position`, `kind`, and the exact normalized `descriptor` observed at dispatch.
Its context must equal the signed observation's context and the runtime
manifest's session ID. The native ID and descriptor must match the execution
observation. The frame supplies those fields and the cursor. Subject, target,
execution, delivery, phase, outcome and authority references remain authenticated
host metadata. Capture this frame at
the host interception boundary through the protected executor's optional
`strictEvidence.capture` callback.

The verifier authenticates both manifest commitments with receiver-pinned host
keys. Coverage `observed_at` must equal the signed coverage attestation's
timestamp. It replays the native event root and derives the expected set from those
events. Each captured `action.record_hash` selects its own signed observation,
disclosed with its opening in a captured artifact. The projection groups these
`{record, opening}` items into JSON arrays no larger than 1 MiB. Flat frame
artifacts use binding basis entries, which keep arbitrary native fields separate
from manifest and disclosure selection. The verifier checks every captured
record's own signature, carrier, opening, source keys, method, timestamp and
context before checking that its frame bytes
match the event inventory. Request coverage also compares the selected dispatch's
authenticated native-event hash with that inventory. Reusing an ID and position
for different bytes cannot satisfy the join.
Missing openings or frames remain unresolved; present malformed or mismatched
material is rejected. Every captured signer must be source-pinned, but authorized
key rotation does not require equality with the inventory signer. The frame hash
commits its JCS bytes, not the original transport encoding.

Skipped, degraded, and omitted expected actions remain explicit gaps. Missing
expected or captured evidence leaves completeness unresolved. The proof covers
only this named host surface and window. The same host may sign both inventories;
expected-set provenance is independent of the captured list, not independent
administrative corroboration.

## Live observation adapters

The `@atrib/runtime-log/observation` subpath defines a source-neutral contract
for host-accessible runtime telemetry. A host supplies source discovery and
binding. The adapter reads from an expected cursor and returns observations,
coverage, gaps, and a proposed cursor without changing durable state.

```ts
import { verifyRuntimeObservationBatchTransition } from '@atrib/runtime-log/observation'
import { bindCodexRolloutObservationSource } from '@atrib/runtime-log/codex-rollout'

const { adapter, cursor } = await bindCodexRolloutObservationSource({
  path: selectedRolloutPath,
  source_handle: 'selected-codex-thread',
  session_id: selectedThreadId,
  runtime_id: 'runtime:codex',
  observer_ref: 'host:runtime-observer',
  subject_ref: 'runtime:codex',
})

const batch = await adapter.readBatch(cursor)
const transition = verifyRuntimeObservationBatchTransition(batch, cursor)
if (!transition.valid) throw new Error(transition.issues.map((issue) => issue.message).join(', '))

await localStore.transact(async (transaction) => {
  await transaction.appendObservationBatch(batch)
  await transaction.setAuthoritativeCursor(batch.proposed_cursor)
})
```

The final transaction is caller-owned and must commit the batch and
authoritative cursor together. A side cursor may be a rebuildable cache, but it
cannot acknowledge bytes before the observation batch is durable.

The first source profile is `@atrib/runtime-log/codex-rollout`. It attaches to
one explicitly selected Codex rollout JSONL file without spawning, resuming, or
replacing Codex. It commits exact event bytes and delimiter-aware frame bytes,
keeps the local path and transcript body out of portable output, reports
partial, malformed, oversized, truncated, replaced, and anchor-mismatch cases,
and carries compaction markers across adjacent batches.

The output proves only that the host observed the reported telemetry under the
stated coverage. It does not establish tool execution, runtime-vendor
provenance, accepted application state, effect outcome, or complete history
beyond the reported coverage. Backfill remains `bounded-backfill` even when it
starts at byte zero.

## Buzz observer source

The `@atrib/runtime-log/buzz` subpath converts host-captured Buzz NIP-AO kind
24200 telemetry into a bounded process-level manifest:

```ts
import { BuzzObserverRuntimeLogSource } from '@atrib/runtime-log/buzz'

const source = new BuzzObserverRuntimeLogSource({
  load_events: subscribeToCapturedObserverEvents,
  owner_pubkey: ownerPublicKey,
  capture_id: 'buzz-desktop-process-1',
  decrypt: decryptNip44ObserverEvent,
})

const bundle = await source.exportWindow({
  session_id: 'buzz-desktop-process-1',
  start: 41,
  end: 57,
})
```

Use `load_events` for a live host subscription or `path` for an archived JSONL
capture. The source requires exactly one. It verifies each Nostr event before
decryption, checks the owner and agent tags, validates known telemetry fields,
and commits the complete decrypted JSON object. Unknown fields remain covered
by `plaintext_hash` even when the typed projection does not expose them.

Sequence checks use the process-wide counter implemented by current
`buzz-acp`. Missing, duplicate, or out-of-order frames fail closed by default.
Set `sequence_policy: 'report-gaps'` only when an incomplete captured window is
acceptable and must stay explicit in the proof.

The decrypt callback and captured bodies remain host-owned. The manifest does
not claim relay admission, relay persistence, Buzz audit-log inclusion, runtime
execution, result truth, or completeness outside the supplied capture.

The integration package includes a local reference source at
[`packages/integration/examples/reference-runtime-log/`](../integration/examples/reference-runtime-log/)
and a runnable Buzz observer proof at
[`packages/integration/examples/buzz-observer-runtime-log/`](../integration/examples/buzz-observer-runtime-log/),
and a dogfood Agent Bridge source at
[`packages/integration/examples/dogfood-runtime-log/`](../integration/examples/dogfood-runtime-log/).
It also includes a secondary adapter-family proof at
[`packages/integration/examples/secondary-runtime-log/`](../integration/examples/secondary-runtime-log/).
The verifier UX example at
[`packages/integration/examples/runtime-log-verifier-ux/`](../integration/examples/runtime-log-verifier-ux/)
renders those manifests into file-backed static proof packets for human review.
The reference source uses append-only JSONL to exercise the source contract in
tests. The dogfood source uses sanitized local job-window evidence to prove the
same manifest shape over real Agent Bridge entries. The secondary proof pairs a
LangGraph-checkpoint runtime source with an OpenInference trace projection and
keeps their claims separate. Real hosts can use their own store behind the same
manifest boundary.

## File CLI

The package ships a file-only CLI:

```bash
atrib-runtime-log attest \
  --events events.jsonl \
  --session-definition session.json \
  --out manifest.json

atrib-runtime-log verify \
  --manifest manifest.json \
  --events events.jsonl \
  --session-definition session.json

atrib-runtime-log inspect --manifest manifest.json

atrib-runtime-log inspect \
  --mirror private-records.jsonl \
  --policy receiver-policy.json \
  --request sha256:REQUEST_RECORD_HASH \
  --evaluated-at 1792108800000

atrib-runtime-log inspect \
  --manifest manifest.json \
  --events events.jsonl \
  --session-definition session.json \
  --format html \
  --out proof.html
```

The CLI does not use the network, a signing key, the public log, or the archive
service. `attest` writes a `log_window_manifest`; `verify` exits nonzero when
the supplied local evidence does not match and prints the same issue codes as
the library API; `inspect` renders a proof packet as JSON or static HTML. The
inspection packet shows manifest hash, source identity, window bounds, event
root, projection root, receipt root, fork and compaction bindings, redaction
posture, optional signed record refs, supplied evidence, and verifier issue
codes. It never shows raw runtime-log bodies by default.

For retained evidence, `inspect --mirror` reads the existing private JSONL
mirror envelopes: each line contains a signed `record` and optional
`_local.evidence` metadata with an `opening` and `artifacts` entries containing
`hash` and canonical `base64` bytes. The CLI reads only the selected local
file. It does not fetch missing material.

Supply your receiver policy with `--policy` and pin the evaluation time with
`--evaluated-at`. The mirror cannot supply its own trusted policy. The CLI
passes records, openings, artifacts, and the authenticated host capture and
runtime coverage adapters to `@atrib/verify`'s `verifyEvidenceSet`. Each matching dispatch gets
its own historical evaluation. Use `--dispatch HASH` to select one explicitly.
Without an observed dispatch, inspection verifies retained intent and
authorization at the supplied evaluation time and marks execution unknown.
Select `--dispatch HASH` to evaluate missing evidence for a known dispatch.

JSON is the default. It retains record references, verifier dimensions,
delivery outcomes, destination states, reasons, and policy identity. Use
`--format text` for a short explanation of claims, observations, authority,
remote effect, and capture coverage. A captured response can support a local
execution observation while remote effect remains unresolved.

Exit 0 means the selected inspections satisfy the pinned policy. Missing or
invalid unrelated statements retain their own verdicts and do not reject an
otherwise supported request. Exit 1 preserves partial
inspection output when required evidence is missing or invalid. Exit 2 reports
invalid arguments or unreadable, malformed, torn, or corrupt mirror input.
The reader rejects a final line without a newline and limits its snapshot to
64 MiB. Private openings and artifacts stay in the mirror. Inspection does not
publish them or prove independent control of the host.

## Boundary

This package implements the proof objects accepted in
[D121](../../DECISIONS.md#d121-runtime-log-proof-manifests-verify-host-owned-run-windows)
and
[D168](../../DECISIONS.md#d168-coverage-manifests-make-capture-scope-verifiable).
It does not sign atrib records, submit to the public log, store raw runtime
events, or replace a host runtime. Adapters use it to produce manifests that an
atrib record can commit to through the existing `attest()` path.

Raw event bodies can stay in the runtime store, a local mirror, a continuation
packet, a private evidence bundle, or the Record Body Archive Layer. The public
Merkle log only needs the signed commitment to the manifest.

## Part of atrib

atrib is an open protocol for verifiable agent actions. Every action becomes a signed, chain-linked record that anyone can verify against a public Merkle log, with no operator to trust. This package is one entrypoint. See the [full package family](https://github.com/creatornader/atrib#packages) and the [protocol spec](https://github.com/creatornader/atrib/blob/main/atrib-spec.md).
