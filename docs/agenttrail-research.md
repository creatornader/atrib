# AgentTrail: local project telemetry and the evidence boundary

Research document, 2026-08-24. Not an ADR. This is a primary-source review of
AgentTrail and a comparison with atrib's operating-graph application model and
open protocol. It does not propose an integration or treat AgentTrail's local
status as verified application state.

AgentTrail was inspected at commit
[`41454d4`](https://github.com/sodiumsun/agenttrail/tree/41454d440c11d4fdc40d25ddb6287b72577f9c3f).
The npm release examined was `agenttrail@0.1.0`. The published daemon and static
UI are byte-identical to that commit; only README, package-discovery metadata,
brand assets, demo media, and `PLAN.md` changed after publication.
The atrib comparison was read from local commit
[`a6e08cc`](https://github.com/creatornader/atrib/tree/a6e08cc56549a6a8b9874fd72325f7567d1e4fe5).

## 1. Executive read

AgentTrail is a sharp, small answer to one operator question: where is a local
coding agent working right now? It turns an agent-maintained `PLAN.md`, repo file
writes, and Claude Code hook payloads into a polished component graph, file tree,
and live run cards. Its best product idea is the explicit split between what an
agent declared and what the filesystem shows. It can make reopened finished work
visible without forcing an operator through a transcript.

It is not a shared operating graph in atrib's sense. AgentTrail has no accepted
state, owner approval, handoff delivery, receipt, return path, signer identity,
append-only history, independent verifier, or cross-machine coordination. Its
`by:` and status fields are mutable agent-authored text. Its observed activity
shows that a path changed, not which process or person caused the write.

The products therefore overlap in operator UX, not in trust or coordination.
AgentTrail is a strong local observation lens. The commercial atrib application
is intended to coordinate accepted work across agents and runtimes. The atrib
protocol supplies signed, chain-linked evidence and verifier objects below that
application. A safe composition would ingest AgentTrail data as non-semantic
runtime observation. It must not promote a checkbox or file tick directly into
accepted state.

## 2. What is actually shipped

### Release and dependency state

The repository has no Git tags or GitHub Releases at the inspected revision.
The npm registry has one version, [`0.1.0`](https://registry.npmjs.org/agenttrail/0.1.0),
published on 2026-08-24. The package requires Node 20, exposes one ESM CLI, and
declares no runtime or development dependencies
([manifest](https://github.com/sodiumsun/agenttrail/blob/41454d440c11d4fdc40d25ddb6287b72577f9c3f/package.json#L1-L17)).
The daemon imports only Node built-ins
([source](https://github.com/sodiumsun/agenttrail/blob/41454d440c11d4fdc40d25ddb6287b72577f9c3f/bin/agenttrail.mjs#L5-L10)).

There is a release-provenance blemish. npm records `gitHead` as
[`ed751a8`](https://github.com/sodiumsun/agenttrail/commit/ed751a8090a33f42cbcfc9b7ce0389bdf2e8f024),
whose checked-in manifest still says `0.0.1`. The repository version bump appears
in later commit
[`28e0b45`](https://github.com/sodiumsun/agenttrail/commit/28e0b45bbe8f79774be60c7caec0650af8dc2d82).
The tarball itself is available and its core implementation matches the reviewed
head, but its recorded source revision does not contain the published version.

No test files, package test scripts, lockfile, CI workflow, benchmark artifact,
or security policy shipped in the inspected tree. The README says the watcher
was tested on a 78,000-file repo, but no reproducible result accompanies that
claim
([README](https://github.com/sodiumsun/agenttrail/blob/41454d440c11d4fdc40d25ddb6287b72577f9c3f/README.md#L126-L140)).

### Data model

`PLAN.md` is the semantic input. The parser recognizes components, tasks,
dependency and link edges, file globs, status, `by:`, `from:`, and a decisions
section
([parser](https://github.com/sodiumsun/agenttrail/blob/41454d440c11d4fdc40d25ddb6287b72577f9c3f/bin/agenttrail.mjs#L49-L107)).
Component status is derived from its task checkboxes. Blocked wins, then active,
then all-done.

The decisions section is parsed but not returned by the daemon's model, so it is
not rendered in the live board. The server response sends plan nodes, tree,
activity, runs, and sibling boards
([model](https://github.com/sodiumsun/agenttrail/blob/41454d440c11d4fdc40d25ddb6287b72577f9c3f/bin/agenttrail.mjs#L267-L277)).
The convention still gives decisions value as repo prose, but the current UI is
not a decision viewer.

The authoring convention is intentionally agent-mediated. `init` appends
instructions to both `CLAUDE.md` and `AGENTS.md`, creates a starter `PLAN.md`,
updates `.gitignore`, and installs Claude hooks
([initializer](https://github.com/sodiumsun/agenttrail/blob/41454d440c11d4fdc40d25ddb6287b72577f9c3f/bin/agenttrail.mjs#L413-L465)).
That makes adoption fast. It also means `init` is a repo mutation, while the
running dashboard is read-only. The README states that distinction accurately
([README](https://github.com/sodiumsun/agenttrail/blob/41454d440c11d4fdc40d25ddb6287b72577f9c3f/README.md#L128-L140)).

### Observation path

The default observer is a recursive `fs.watch` over the repo. Each accepted file
event updates the most recent path, component activity selected by `files:`
globs, and a twelve-item recent list
([watcher](https://github.com/sodiumsun/agenttrail/blob/41454d440c11d4fdc40d25ddb6287b72577f9c3f/bin/agenttrail.mjs#L290-L347)).
This is a liveness heuristic. The event does not include process identity,
content hashes, old and new bytes, or a stable event sequence.

Claude Code gets a richer path. Repo-local hooks relay `SessionStart`,
`PreToolUse`, `PostToolUse`, and `Stop` to every candidate localhost port from
5330 through 5344. The relay has a 400 ms timeout and ignores failures
([relay](https://github.com/sodiumsun/agenttrail/blob/41454d440c11d4fdc40d25ddb6287b72577f9c3f/bin/agenttrail.mjs#L36-L46),
[installation](https://github.com/sodiumsun/agenttrail/blob/41454d440c11d4fdc40d25ddb6287b72577f9c3f/bin/agenttrail.mjs#L447-L465)).
The daemon turns those payloads into a run, current tool, recent tool list,
todos, and component placement
([handler](https://github.com/sodiumsun/agenttrail/blob/41454d440c11d4fdc40d25ddb6287b72577f9c3f/bin/agenttrail.mjs#L145-L199)).

Codex and Cursor do not have equivalent run adapters. They receive file-watcher
activity and can maintain `PLAN.md` through `AGENTS.md`; only Claude has live run
cards and todos
([support table](https://github.com/sodiumsun/agenttrail/blob/41454d440c11d4fdc40d25ddb6287b72577f9c3f/README.md#L71-L77)).
AgentTrail is ambient across file-writing tools, but semantically ambient only
for Claude Code at this revision.

### Persistence and multi-repo behavior

AgentTrail rewrites one JSON snapshot under `~/.agenttrail`, keyed by the first
twelve hex characters of SHA-1 over the absolute repo path. It saves every 15
seconds and on `SIGINT` or `SIGTERM`
([state](https://github.com/sodiumsun/agenttrail/blob/41454d440c11d4fdc40d25ddb6287b72577f9c3f/bin/agenttrail.mjs#L201-L225)).
The snapshot preserves recent file and hook activity across daemon restarts. It
is mutable, not journaled, not atomically replaced, and not integrity checked.
Read and write errors are silently ignored.

Multi-repo means local sibling discovery. Each daemon probes fifteen localhost
ports every 30 seconds and puts the discovered boards in a tab switcher
([discovery](https://github.com/sodiumsun/agenttrail/blob/41454d440c11d4fdc40d25ddb6287b72577f9c3f/bin/agenttrail.mjs#L350-L365)).
There is no shared store, user or team identity, remote transport, merge rule,
or cross-machine view. A committed `PLAN.md` can travel through Git like any
other file, but live activity and runs stay on one machine.

### Product UX

The UI is one static HTML file driven by Server-Sent Events. Full models carry
the tree. Partial ticks carry runs and recent activity, avoiding repeated large
tree payloads
([server](https://github.com/sodiumsun/agenttrail/blob/41454d440c11d4fdc40d25ddb6287b72577f9c3f/bin/agenttrail.mjs#L267-L287),
[client](https://github.com/sodiumsun/agenttrail/blob/41454d440c11d4fdc40d25ddb6287b72577f9c3f/public/index.html#L81-L101)).
The graph has deterministic dependency depth, explicit links, component status,
zoom, pan, task expansion, and a repo explorer. User-visible strings are mostly
escaped before insertion
([rendering](https://github.com/sodiumsun/agenttrail/blob/41454d440c11d4fdc40d25ddb6287b72577f9c3f/public/index.html#L72-L150)).

The strongest UX choices are:

- show declared status beside observed file activity;
- light up completed work when it is touched again;
- make the no-plan state useful as a live activity feed;
- map work to 5 to 9 owner-readable components instead of transcript events;
- keep roadmap intent separate from near-term agent intent; and
- make large-tree truncation visible.

These are useful product patterns even without adopting AgentTrail's state or
trust model.

## 3. Trust, security, and privacy

### Trust model

AgentTrail trusts the current local files and any accepted localhost hook body.
`PLAN.md` status, dependency, authorship, and provenance labels are assertions
by whichever process last edited the file. `by: claude` is not authenticated.
A file watcher event establishes only that the host reported a path event.

The server binds to `127.0.0.1`, which limits direct network exposure
([listener](https://github.com/sodiumsun/agenttrail/blob/41454d440c11d4fdc40d25ddb6287b72577f9c3f/bin/agenttrail.mjs#L367-L411)).
That is useful isolation, but it is not request authentication. `/hook` accepts
an unauthenticated POST, has no Origin or token check, and buffers the body with
no size limit before parsing it
([route](https://github.com/sodiumsun/agenttrail/blob/41454d440c11d4fdc40d25ddb6287b72577f9c3f/bin/agenttrail.mjs#L382-L389)).
A local process can forge runs. A web page can also send a blind simple POST to
localhost when the browser's local-network protections allow it, even if CORS
prevents reading the response. The result is a local status-forgery and
denial-of-service surface, not a remote code-execution path in the inspected
code.

### Private content retained locally

Hook summaries can include a command, file path, pattern, URL, query, or prompt,
truncated to 90 characters
([tool detail](https://github.com/sodiumsun/agenttrail/blob/41454d440c11d4fdc40d25ddb6287b72577f9c3f/bin/agenttrail.mjs#L152-L155)).
Those summaries enter the mutable state snapshot. The writer does not set a
restrictive file mode or redact likely secrets. In the local smoke test on
macOS, the resulting file was mode `0644`. The no-telemetry claim is supported,
but local privacy is not zero-retention.

The product also exposes repo paths, plan text, and tool summaries through
unauthenticated localhost GET and SSE routes. That is reasonable for a personal
loopback dashboard, but it should not be treated as a shared-team security
boundary.

### Integrity and verification

There are no signatures, canonical bytes, hash-linked records, append-only
events, Merkle roots, inclusion or consistency proofs, trusted signer policy,
or verifier output. Restart persistence proves only that a snapshot was readable.
Filesystem checks and PLAN evidence lines can help a human inspect a claim, but
they do not let a receiver independently verify authorship or history.

By contrast, atrib records are Ed25519 signed, public-log inclusion uses RFC
6962 proofs, checkpoints support consistency checks, and graph edges are
deterministically derived
([atrib trust model](https://github.com/creatornader/atrib/blob/a6e08cc56549a6a8b9874fd72325f7567d1e4fe5/ARCHITECTURE.md#L186-L200)).
`informed_by` remains an agent-declared relationship, not inferred causation.
The signature makes the declaration attributable and tamper-evident; it does
not make the declaration true.

## 4. Comparison with atrib

| Surface                   | AgentTrail 0.1.0                                               | Commercial atrib application target                                                                      | Open atrib protocol                                                                   |
| ------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Primary object            | Mutable `PLAN.md` plus current local observation snapshot      | Shared, bounded operating view with accepted state, decisions, outcomes, conflicts, agents, and handoffs | Signed record plus chronology and declared relationships                              |
| Ambient observation       | All tools through file writes; rich hooks for Claude only      | Ambient Codex and Claude observation kept separate from semantic promotion                               | Runtime-log observation batch or signed producer record                               |
| State authority           | Last writer of repo text                                       | Owner-approved application policy and explicit conflict resolution                                       | Verifier policy over signed facts; protocol does not choose business state            |
| Coordination              | None beyond agents editing the same file                       | Addressed handoff and coordination across agent and runtime identities                                   | Handoff evidence and signed relationships; transport stays application-owned          |
| Delivery, receipt, return | None                                                           | Delivery capability, receipt, and returned result are separate states                                    | Signed action, outcome, and receipt evidence can bind those claims                    |
| Persistence               | One mutable local JSON snapshot plus repo file                 | Durable shared application state and bounded private bodies                                              | Local mirrors, optional archive bodies, Merkle log commitments, runtime-log manifests |
| Identity                  | Free-form `by:` and unauthenticated hook session ID            | Named participant mapped separately from observer and runtime subject                                    | Creator keys, optional delegation and trusted-set verifier policy                     |
| Multi-machine and team    | No. Only same-machine board discovery                          | Core product scope                                                                                       | Portable records and proofs; application supplies sharing and authorization           |
| Privacy                   | Localhost and no telemetry, but tool summaries persist locally | Private bodies and scoped review                                                                         | Public commitments by default, selected private evidence when authorized              |
| Control                   | Explicitly read-only during monitoring                         | Owner-approved coordination and optional protected actions                                               | `@atrib/action-gate` records a host's allow, block, or escalate decision and outcome  |

The public operating-graph reference pins the boundary behind the commercial
model. It verifies private bodies before projection, keeps conflicts visible,
requires a resolution to cite all active heads, and treats runtime observation
as non-semantic until a separate signed application event promotes it
([reference contract](https://github.com/creatornader/atrib/blob/a6e08cc56549a6a8b9874fd72325f7567d1e4fe5/apps/operating-graph/README.md#L1-L32),
[observation boundary](https://github.com/creatornader/atrib/blob/a6e08cc56549a6a8b9874fd72325f7567d1e4fe5/apps/operating-graph/README.md#L109-L131)).
AgentTrail's checkbox and watcher state would enter that model as observation or
proposal, never as accepted state by itself.

The runtime-log package is the natural protocol seam. It commits a bounded host
window while leaving raw logs host-owned, verifies named roots and bindings,
and distinguishes adapter reads from the caller's durable cursor acceptance
([runtime-log contract](https://github.com/creatornader/atrib/blob/a6e08cc56549a6a8b9874fd72325f7567d1e4fe5/packages/runtime-log/README.md#L1-L37),
[live observations](https://github.com/creatornader/atrib/blob/a6e08cc56549a6a8b9874fd72325f7567d1e4fe5/packages/runtime-log/README.md#L182-L220)).
AgentTrail has no stable event sequence, so an adapter would need to define its
own exact snapshot or event-window canonicalization before making a manifest.

## 5. Strengths and weaknesses

### Strengths

1. **Excellent problem selection.** It answers the return-to-a-long-run question
   without reproducing a full trace dashboard.
2. **Declared versus observed.** The UI exposes plan drift and reopened finished
   work instead of pretending agent-authored status is ground truth.
3. **Low adoption cost.** One dependency-free daemon, one static page, no account,
   and immediate value before `PLAN.md` exists.
4. **Useful component vocabulary.** Stable IDs, `needs`, `links`, file ownership,
   status, author, and intent provenance form a compact map that agents can keep
   current.
5. **Bounded display work.** Tree traversal caps depth, total nodes, and nodes per
   directory. Activity ticks avoid resending the whole tree on each change
   ([tree budget](https://github.com/sodiumsun/agenttrail/blob/41454d440c11d4fdc40d25ddb6287b72577f9c3f/bin/agenttrail.mjs#L227-L257),
   [broadcast path](https://github.com/sodiumsun/agenttrail/blob/41454d440c11d4fdc40d25ddb6287b72577f9c3f/bin/agenttrail.mjs#L280-L287)).
6. **Honest product boundary.** The README says the monitor does not control the
   agent and documents the weaker Codex and Cursor support.

### Weaknesses

1. **No durable trail.** The name suggests history, but the implementation keeps
   a replaceable snapshot and short recent lists. There is no replayable event
   ledger.
2. **No trustworthy attribution.** `by:` is prose, hook input is unauthenticated,
   and filesystem activity has no process identity.
3. **Uneven runtime coverage.** Claude gets session, tool, and todo visibility.
   Codex and Cursor get file activity plus an instruction convention.
4. **No coordination loop.** There is no addressed message, acceptance, delivery,
   receipt, response, handoff verification, or owner decision.
5. **Local-only topology.** The board switcher covers daemons on one machine, not
   teams, remote agents, or the same repo on another host.
6. **Security hardening is thin.** Local POST is unauthenticated and unbounded.
   Tool summaries persist without explicit permissions or redaction.
7. **No compatibility contract.** `/model`, `/events`, `/hook`, and the snapshot
   format have no schema version. A downstream adapter would have to pin an exact
   release.
8. **No automated proof of behavior.** There are no tests, CI, or reproducible
   performance results. Silent catch blocks make failures easy to miss.
9. **Decision data is dead in the UI.** The parser collects it, but the model drops
   it before transport.

## 6. Reuse candidates for atrib

### Reuse the UX grammar

- Add a declared-versus-observed overlay to bounded operating views. An accepted
  task can visibly receive new runtime activity without silently reopening or
  changing accepted state.
- Use component-first compression for an owner view. Keep detailed records and
  receipts behind drill-down.
- Preserve the useful zero state. Ambient activity should appear before an owner
  has modeled the whole workspace.
- Show an explicit abridged or incomplete indicator whenever a tree, observation
  window, or context view is bounded.

### Consider a narrow import adapter

An optional AgentTrail adapter could import:

- stable component and task IDs;
- `needs` and `links` as application metadata, not new protocol edges;
- file globs as claimed component scope;
- task status and `from:` as proposals;
- file ticks and Claude hook events as runtime observations; and
- the exact `PLAN.md` bytes or hash as the source snapshot.

The adapter should produce a
[D183](../DECISIONS.md#d183-runtime-observation-adapters-separate-reading-from-durable-acceptance)-style
portable batch with source revision, snapshot hash, observed host, gaps, and a
proposed cursor. The operating graph should then require a separate signed,
owner-authorized application event before changing accepted state. An AgentTrail
`by:` value should remain an observed label until mapped to a participant under
application policy.

### Do not reuse the trust or storage path

Do not adopt the mutable snapshot as shared state. Do not treat watcher activity
as execution evidence. Do not copy the unauthenticated hook route into a shared
service. Do not capture command or prompt summaries without explicit redaction,
retention, and file-permission policy.

A hardened local sidecar would need at least a per-daemon nonce, Origin checks,
bounded request bodies, secure atomic snapshot writes, explicit redaction,
schema versions, stable event IDs or source positions, and visible adapter
health. Those changes would improve the observation source. They would still not
turn it into the protocol evidence layer.

## 7. Commands and checks performed

The review used these read-only upstream and registry checks:

```text
git clone --filter=blob:none https://github.com/sodiumsun/agenttrail.git
git rev-parse HEAD
git describe --tags --always --dirty
git log --date=iso-strict
git tag
git shortlog -sne HEAD
curl https://api.github.com/repos/sodiumsun/agenttrail
curl https://api.github.com/repos/sodiumsun/agenttrail/releases
curl https://registry.npmjs.org/agenttrail
curl https://registry.npmjs.org/agenttrail/0.1.0
download and unpack agenttrail-0.1.0.tgz
sha256sum and diff published bin/public files against the pinned checkout
node --check bin/agenttrail.mjs
npm test
```

A disposable repo smoke test started the daemon on `127.0.0.1:5417`, read
`/whoami` and `/model`, posted `SessionStart`, `PreToolUse`, and `PostToolUse`
events to `/hook`, checked component placement and recent tool output, stopped
and restarted the daemon, and confirmed snapshot restoration. `lsof` confirmed
the loopback bind. The saved test snapshot was inspected for content and mode.

No upstream test suite was available. No GitHub Actions were run. No product
code was edited, no commit or push was made, and nobody was contacted. `npm test`
failed immediately with `Missing script: "test"`; this confirmed the missing
test entry rather than exercising a suite.

## 8. Bottom line

AgentTrail is worth watching because it has unusually good instincts about the
human view of agent work. It makes status drift visible, compresses activity
into an owner-readable component map, and earns immediate local value with very
little machinery.

It should not change atrib's protocol or commercial architecture. Its value is
the local observation and presentation layer that atrib deliberately leaves to
harnesses and applications. The right strategic response is to borrow the UX
grammar and, if demand appears, accept AgentTrail as one bounded observation
source. Keep owner approval, delivery, receipt, return, signer identity,
verification, and durable shared state on atrib's side of the boundary.
