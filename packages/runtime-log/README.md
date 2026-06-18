# @atrib/runtime-log

`@atrib/runtime-log` builds and verifies proof manifests for host-owned agent
runtime logs.

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

| Situation | Right surface |
| --------- | ------------- |
| You need to sign tool calls as they happen. | Use `@atrib/mcp`, `@atrib/mcp-wrap`, or `@atrib/agent`. |
| You already emit OpenTelemetry or OpenInference spans. | Use `@atrib/openinference` beside your existing trace exporter. |
| You need to prove a run window, fork, compaction, projection, or receipt root. | Use `@atrib/runtime-log`. |
| You want a hosted trace dashboard, prompt analytics, cost charts, or eval UI. | Use Langfuse, Phoenix, LangSmith, Braintrust, or your existing observability stack. atrib can sign evidence that points back to those systems. |

`@atrib/runtime-log` does not decide what a runtime should store. It gives the
runtime a verifier object when the runtime wants to prove a specific slice of
what it already stores.

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

The shared conformance corpus lives at
[`spec/conformance/runtime-log/`](../../spec/conformance/runtime-log/). Adapter
authors can run their own verifier against those cases before publishing a new
runtime-log source.

The integration package includes a local reference source at
[`packages/integration/examples/reference-runtime-log/`](../integration/examples/reference-runtime-log/)
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

## Boundary

This package implements the proof object accepted in
[D121](../../DECISIONS.md#d121-runtime-log-proof-manifests-verify-host-owned-run-windows).
It does not sign atrib records, submit to the public log, store raw runtime
events, or replace a host runtime. Adapters use it to produce the manifest that
an atrib record can later commit to.

Raw event bodies can stay in the runtime store, a local mirror, a continuation
packet, a private evidence bundle, or the Record Body Archive Layer. The public
Merkle log only needs the signed commitment to the manifest.
