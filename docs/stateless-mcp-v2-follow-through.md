# Stateless MCP v2 follow-through

Status: active execution program

Started: 2026-07-28

Owner: atrib maintainers

Decision basis: [D141](../DECISIONS.md#d141-devatribattribution-first-class-mcp-extension-sep-2133), [D148](../DECISIONS.md#d148-atribd-is-the-public-stateless-native-local-daemon-for-the-primitive-runtime), and [D166](../DECISIONS.md#d166-verifiable-action-mode-commits-request-and-outcome-by-default-in-the-wrapper)

## The shift

The plain framing is:

> An atrib MCP server is a request-shaped proof service, not a conversation-shaped process.

The MCP 2026-07-28 transport removed the protocol session as the place where a
server remembers the client. Each request now carries the protocol version,
client information, capabilities, extension declarations, and application
context needed to handle that request.

This fits atrib's core model. Important context should be explicit, signed,
portable, and independently checkable. It should not be hidden inside a
transport session that disappears when a process restarts.

Stateless transport does not mean atrib has no state. atrib still owns durable
records, chain heads, mirrors, indexes, keys, permits, and submission queues.
The change is that transport state no longer decides what those objects mean.
Requests name the context and authority they rely on.

## What this buys

### Safer restarts

A daemon restart can interrupt one request, but it does not destroy a hidden
MCP session. The next complete request can be served by any healthy instance
with access to the correct profile state.

### Normal service deployment

atribd can use ordinary health checks, process replacement, connection reuse,
and eventually load balancing. Scaling still requires explicit routing for
keys, mirrors, identities, and per-context ordering.

### Verifiable context

Each consequential request must carry its own `context_id`, capabilities,
authorization facts, extension negotiation, and propagation material. Missing
context should fail clearly. Ambient state remains a compatibility aid for
stdio startup-spawn environments, never the primary HTTP contract.

### Request-bound attribution

When a client declares `dev.atrib/attribution`, the result can carry a receipt
for that exact operation: token, record hash, creator key, context, chain root,
submission status, and optionally the full signed record.

### Wider wrapper reach

`@atrib/mcp-wrap` can expose a native v2 boundary while talking to an older
upstream MCP server internally. Third-party server adoption is useful but no
longer blocks atrib from offering modern negotiation and signed action
evidence.

## Invariants

Every follow-through change must preserve these rules:

1. Signed record bytes stay independent of the transport generation.
2. HTTP writes require explicit context. No last-active-context fallback.
3. Writes within one `context_id` remain ordered.
4. Reads may retry freely only when their backing operation is read-only.
5. Write retries must not silently create duplicate intended actions.
6. Authentication and authorization are checked per request.
7. A connection is not an authority signal.
8. Extension result carriage occurs only when the request declares the
   extension.
9. Compatibility behavior must be measured and named.
10. An upstream v1 server behind a wrapper is not described as an atrib-owned
    v2 holdout.
11. The daemon remains a local proof service. It does not become a generic
    agent runtime or a policy authority.
12. Degradation remains explicit under [§5.8](../atrib-spec.md#58-degradation-contract).

## Priority map

| Priority | Program                                                   | Why it is ordered here                                                       |
| -------- | --------------------------------------------------------- | ---------------------------------------------------------------------------- |
| P0       | Freeze the cutover contract                               | Prevent later releases from quietly returning an entrypoint to v1            |
| P0       | Observe modern and compatibility traffic                  | A removal decision needs evidence, not a calendar guess                      |
| P1       | Make write retries duplicate-safe                         | A timed-out signed write can otherwise be repeated                           |
| P1       | Make per-request context and extension carriage automatic | Explicit context must be the easy SDK path                                   |
| P1       | Pin request-scoped security and lifecycle behavior        | Statelessness moves trust, cancellation, and replay checks onto each request |
| P2       | Prove restart, concurrency, and performance behavior      | The architecture should survive the failures it is meant to simplify         |
| P2       | Publish independent extension interoperability            | The extension becomes useful when another implementation can reproduce it    |
| P2       | Complete developer and support propagation                | Operators need request-level debugging language and runbooks                 |
| P3       | Evaluate profile-aware daemon consolidation               | One daemon is possible only after identity and key routing are explicit      |
| P3       | Propagate the commercial and ecosystem story              | Product claims should follow verified engineering facts                      |

## Execution tranches

Each tranche lands as one or more independently testable changes. A tranche is
complete only when its code, tests, release metadata, docs, and live proof all
agree.

### Tranche 0A: Freeze the native-v2 surface

Goal: make the completed cutover difficult to regress.

Work:

- Maintain a machine-readable inventory of every atrib-owned MCP entrypoint.
- Run pinned `2026-07-28` process negotiation against every standalone binary,
  atribd stdio, the stdio-to-HTTP proxy, and `atrib-wrap`.
- Scan shipped entrypoints for direct legacy SDK transport connections.
- Inspect packed npm artifacts, not only workspace builds.
- Make release readiness fail when an inventory item lacks a pinned process
  proof or when the published entrypoint does not contain the v2 negotiator.
- Keep upstream simulation fixtures explicitly classified as fixtures.

Acceptance:

- One command proves the complete owned-surface inventory.
- CI and release readiness run that command.
- A deliberately reintroduced direct legacy transport causes the gate to fail.
- Registry-artifact inspection covers every publishable MCP package.

### Tranche 0B: Observe the compatibility window

Goal: know who still uses the v1 adapter and when it is safe to remove.

Work:

- Keep separate modern, legacy, rejected-header, and legacy-initialize
  counters.
- Add profile, client, and protocol labels without recording private request
  bodies.
- Report the last observed legacy request and the client identity when known.
- Alert on new legacy traffic after a profile has shown modern traffic.
- Define a sustained-zero window and an announcement requirement before
  removal.
- Keep the compatibility adapter stateless during the window.

Acceptance:

- Runtime health and the topology report show the same compatibility facts.
- The updater fails if a profile expected to be modern falls back to legacy.
- A documented sunset decision can be made entirely from collected evidence.

### Tranche 1A: Duplicate-safe writes

Goal: make retries safe when a write completed but its response was lost.

Contract questions to settle before code:

- Which request identifier is supplied by the caller?
- Which canonical fields define one intended action?
- How long is the deduplication window?
- Does a duplicate return the original signed result or a typed duplicate
  reference?
- Which durable store owns the decision across process restarts?
- How do explicit retries interact with chain ordering and submission status?

Likely shape:

- Add an optional caller-generated idempotency key to write requests.
- Bind it to the canonical action identity, including context, tool, and
  committed arguments.
- Store the binding and completed signed result atomically.
- Return the original result for the same key and same binding.
- Reject the same key with a different binding.
- Preserve the completed entry before acknowledging success.
- Keep requests without a key backward compatible, with a clear warning in
  SDK diagnostics when automatic retry is enabled.

Acceptance:

- Repeating a completed write with the same key produces one signed action.
- A lost-response simulation returns the original result after restart.
- Concurrent duplicates produce one winner and identical replay results.
- Binding mismatch fails without consuming or replacing the valid entry.
- The public spec or an accepted ADR owns the exact contract before release.

### Tranche 1B: Automatic request carriage

Goal: make the correct stateless request the default SDK behavior.

Work:

- JS/TS and Python clients attach protocol metadata on every request.
- Carry explicit `context_id`, W3C trace context, attribution token, client
  capabilities, and `dev.atrib/attribution` declaration.
- Expose the negotiated protocol and extension result to callers.
- Preserve full control for hosts that need custom metadata.
- Reject conflicting context carriers according to the existing resolution
  ladder.
- Keep stdio ambient discovery as a documented compatibility path.

Acceptance:

- The same conformance fixtures run against JS/TS and Python.
- A default client call receives a negotiated attribution receipt.
- Missing write context fails before signing.
- Conflicting carriers resolve or fail exactly as the extension spec states.
- SDK examples no longer teach session-era initialization or session IDs.

### Tranche 1C: Request-scoped security and lifecycle

Goal: move every trust and resource decision to the request boundary.

Work:

- Recheck authentication, scopes, revocation, and action permits per request.
- Keep bearer tokens and private authorization material out of signed records.
- Bind one-time permits and idempotency keys to the exact intended action.
- Define cancellation and timeout behavior for long-running calls.
- Record late completion without reporting a timeout as a proven failure.
- Treat opaque `requestState` and other continuation handles as untrusted
  caller-carried state until validated.
- Add per-identity or per-context rate-limit hooks that do not depend on a
  connection.

Acceptance:

- Replay, changed-action, expired, and revoked cases fail before dispatch.
- Cancellation frees host resources.
- Late completion is distinguishable from no side effect.
- Security tests do not infer authority from a connection or client name.

### Tranche 2A: Restart, concurrency, and performance proof

Goal: prove the operational promises of the new model.

Work:

- Kill and restart atribd during discovery, reads, writes, and receipt
  generation.
- Exercise many contexts concurrently.
- Exercise one context with competing writes.
- Test process replacement while clients retry.
- Benchmark cold discovery, cached tool listing, reads, writes, receipt
  generation, and compatibility routing.
- Pin `ttlMs` and `cacheScope` behavior.
- Test cancellation, timeouts, and late settlement under load.

Acceptance:

- Reads recover without session repair.
- Duplicate-safe writes do not multiply after lost responses.
- One context remains linear while independent contexts run concurrently.
- Performance budgets are documented and enforced where stable.
- Cache behavior never causes a removed or renamed tool to remain silently
  usable past the advertised TTL.

### Tranche 2B: Independent `dev.atrib/attribution` interoperability

Goal: prove the extension outside atrib's own server and client pair.

Work:

- Publish a minimal request and receipt walkthrough.
- Ship language-neutral fixtures for discovery, negotiation, token carriage,
  receipt integrity, and degradation.
- Add one independent client implementation against atribd.
- Add one independent server implementation consumed by an atrib client.
- Verify token, record hash, creator key, context, chain root, and signature.
- Document what a receipt proves and what it does not prove.
- Track the standards path without making official status a dependency.

Acceptance:

- Two implementations written against the extension document interoperate
  without importing atrib's TypeScript transport code.
- Negative fixtures reject malformed or internally inconsistent receipts.
- The public example is reproducible from released packages.

### Tranche 2C: Developer, operator, and support propagation

Goal: remove session-era assumptions from every human-facing surface.

Work:

- Update architecture, SDK, package, extension, deployment, and troubleshooting
  docs.
- Replace "connected session" checks with recent successful request checks.
- Teach operators to inspect protocol headers, request `_meta`, explicit
  context, and per-request errors.
- Document retry rules separately for reads and writes.
- Document wrapper boundaries: modern outer server, possibly older upstream.
- Add a restart and recovery runbook.
- Remove or clearly deprecate ignored session-era configuration.

Acceptance:

- A repository-wide wording and configuration scan finds no active
  session-era instruction for a native-v2 surface.
- Support can diagnose a request from one bounded evidence packet.
- Every public example uses the modern request model.

### Tranche 3A: Profile-aware consolidation study

Goal: decide whether three local daemons should become one.

Do not implement consolidation until the study proves:

- Request identity selects the correct signing key.
- Mirror and index routing cannot cross profiles.
- Authorization policy is explicit per request.
- Per-context serialization works across profiles.
- Health and logs retain profile-level attribution.
- One profile cannot starve another.
- Rollback to one daemon per profile remains simple.

Possible outcomes:

1. Keep one daemon per profile because it is the clearest security boundary.
2. Run one process with isolated profile workers.
3. Run one fully shared daemon with explicit profile routing.

The study may conclude that no consolidation is worth doing.

### Tranche 3B: Product and ecosystem propagation

Goal: explain the verified benefit without overstating it.

Core message:

> Add verifiable records to a tool call without adopting a new agent runtime
> or maintaining an atrib session.

Work:

- Update product language only after the underlying SDK and interop paths ship.
- Show call, result, and verifiable receipt together.
- Explain that stateless transport still uses durable signed state.
- Position `dev.atrib/attribution` as a server capability, not only a wrapper
  feature.
- Create integration guides for tool gateways, agent frameworks, cloud agents,
  commerce systems, and audit systems.
- Keep "proof of a signed claim" separate from "proof the claim is true."

Acceptance:

- Public claims map to runnable proof.
- A developer can add attribution without changing their agent loop.
- A verifier can check the receipt without trusting atrib's hosted service.

## Cross-cutting work

These requirements apply to every tranche:

- **Privacy:** counters and diagnostics never store private request bodies by
  default.
- **Parity:** standalone, daemon, proxy, wrapper, JS/TS, and Python paths share
  fixtures where their contracts overlap.
- **Published-artifact proof:** release checks inspect what users install.
- **Compatibility:** fallback is explicit, measured, and removable.
- **Honest claims:** signatures prove commitments, not arbitrary real-world
  truth.
- **Rollback:** each tranche can be reverted without invalidating existing
  signed records.
- **Documentation:** update this plan as status changes. Do not leave completed
  work checked as pending or move work silently between priorities.

## Definition of done

The follow-through program is complete when:

1. Every owned MCP surface has a mandatory native-v2 release gate.
2. Modern traffic is observable and the v1 adapter has either been retired or
   has a current evidence-backed reason to remain.
3. Write retries are duplicate-safe across timeout, concurrency, and restart.
4. JS/TS and Python clients carry required request context automatically.
5. Request-scoped authorization, replay, cancellation, and timeout behavior are
   pinned by tests.
6. Restart, concurrency, cache, and performance claims have executable proofs.
7. Independent client and server implementations reproduce
   `dev.atrib/attribution`.
8. Active docs, examples, runbooks, and support language use the request model.
9. The daemon consolidation question has a written evidence-backed outcome.
10. Product claims link to released, runnable proof.

## Current execution state

| Tranche                                   | State           | Evidence                                                                                                                                                                                                                                                                                        |
| ----------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0A: native-v2 release gate                | complete        | `scripts/mcp-v2-owned-surfaces.json` covers 13 owned surfaces and 12 published surfaces; source, process-proof, built-entrypoint, and packed-artifact gates run through doc sync and release readiness                                                                                          |
| 0B: compatibility observability           | release pending | atribd persists bounded profile, client, protocol, and era observations; health and topology agree; the updater rejects modern-to-legacy regressions; the live profiles still need the released package                                                                                         |
| 1A: duplicate-safe writes                 | release pending | [D184](../DECISIONS.md#d184-stateless-mcp-writes-use-action-bound-idempotency-keys) defines action-bound keys, durable completed-result replay, indeterminate pending outcomes, seven-day retention, and lock-through-settlement; daemon and TS SDK implementation needs release and live proof |
| 1B: automatic request carriage            | release pending | [D185](../DECISIONS.md#d185-client-sdks-carry-complete-stateless-mcp-request-context) adds one shared metadata builder, default receipt negotiation, explicit write context, W3C and legacy carriers, exposed transport facts, and an independent Python v2 HTTP client. The shared corpus, Python mock daemon, and both clients pass live atribd reads. |
| 1C: request-scoped security and lifecycle | not started     | Existing permit and authorization components must be audited against the stateless request boundary                                                                                                                                                                                             |
| 2A: resilience and performance            | not started     | Existing tests cover parts of concurrency and transport behavior, not the full failure matrix                                                                                                                                                                                                   |
| 2B: independent interoperability          | not started     | atribd and atrib clients interoperate; independence gate remains                                                                                                                                                                                                                                |
| 2C: human-facing propagation              | in progress     | Cutover docs are current; the wider session-era scan and runbooks remain                                                                                                                                                                                                                        |
| 3A: daemon consolidation study            | deferred        | Begins only after tranches 1 and 2                                                                                                                                                                                                                                                              |
| 3B: product propagation                   | deferred        | Begins after released SDK and interop proof                                                                                                                                                                                                                                                     |

## Immediate next slice

Land and release Tranches 0B, 1A, and 1B. Install the released daemon and SDKs
on the three operator profiles. Confirm modern traffic with no post-modern
legacy regression. Run the duplicate-write proof matrix against the installed
daemon, then begin the request-scoped security and lifecycle audit.
