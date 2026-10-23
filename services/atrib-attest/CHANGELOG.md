# @atrib/attest

## 0.6.0

### Minor Changes

- 5280751: Add a local signer socket key source ([D190](../DECISIONS.md#d190-a-local-signer-socket-is-a-final-key-source)). `@atrib/mcp` exports `createSignerSocket` and `signerSocketFromEnv`. A producer sends each unsigned record over a Unix socket to a host signer and accepts the signature only if it verifies under the pinned `ATRIB_SIGNER_PUBKEY`. The `atrib()` middleware and `createInProcessLocalSubstrateCoordinator()` take the client as a `signer` option, so the seed never enters those processes. `@atrib/attest`, `@atrib/mcp-wrap`, the local substrate host, `@atrib/memory-tool` and `@atrib/action-gate` treat a set `ATRIB_SIGNER_SOCK` as their only environment key source, with no seed fallback; `@atrib/memory-tool` and `@atrib/action-gate` also accept an explicit `signer`. `ResolvedKey` from `@atrib/attest` and `@atrib/mcp-wrap` is now a union; callers reading the seed must check `source !== 'signer-socket'` first. `CreateInProcessLocalSubstrateCoordinatorOptions.creatorKey` is now optional, `signActionGateDecision()` and `signActionGateOutcome()` take `privateKey` or `signer`, and `resolveActionGatePrivateKey()` throws instead of reading `ATRIB_PRIVATE_KEY` while `ATRIB_SIGNER_SOCK` is set.

### Patch Changes

- Updated dependencies [5280751]
  - @atrib/mcp@0.27.0

## 0.5.0

### Minor Changes

- 1387ea3: Upgrade canonicalize to 5.1 and require Node.js 22 or newer. JSON values retain their canonical bytes, signatures, hashes, and tokens. JavaScript-only inputs change: function properties and toJSON() results of undefined are omitted from objects and become null in arrays; boxed primitives serialize as their values, and sparse array holes become null. Stored commitments over these JavaScript-only inputs can differ. Pass JSON data when committing tool arguments, results, or content.
- ca2debb: Add closed source-bound evidence body schemas, cryptographic nonces and body
  commitments. Export a receiver that checks exact requests, authenticated source
  artifacts, pinned authority snapshots, coverage and conflicts from supplied
  bytes and policy. Keep generic record validity separate from evidence reliance.

  Validate source and basis locator slots while preserving arbitrary JSON
  parameters and state. Reject recognized credentials in relative query and fragment hints.
  Distinguish absent publication proofs from present invalid proofs without
  aborting other evidence checks.

  Allow non-tool statements to omit content_id and transactions to use their
  creator's signers entry without a top-level signature. Align submission helper
  checks with the five-minute future-clock limit already enforced by core record
  verification. Let callers supply a fixed evaluation clock to that verifier.

  This changes TypeScript source compatibility. Callers must handle optional
  `content_id` on non-tool statements and the signature union, including signers-only
  transactions without a top-level `signature`. The minor release for these `0.x`
  packages includes these breaking source changes. Signing and log-leaf algorithms
  remain unchanged; accepted record shapes and the submission clock window change.

  The stable `@atrib/sdk` and `@atrib/emit` APIs expose these changed record fields.
  Their major releases mark the same source compatibility break. The `0.x`
  `@atrib/attest`, `@atrib/openinference`, `@atrib/memory-tool`, and
  `@atrib/action-gate` APIs also expose these fields through signed records,
  submission callbacks, or mapping results. `@atrib/agent` exposes them through
  attribution receipts. Their minor releases mark that break.

  The stable `@atrib/annotate` and `@atrib/revise` registration helpers expose
  record types through submission queues. `@atrib/trace` exposes them through
  trace compaction arguments. Their major releases mark the source break.
  The `0.x` `@atrib/cli` package exposes record types through its shipped,
  unrestricted identity subpath. `@atrib/summarize` exposes them through its
  exported `__test_only__.selectRecords` helper. Minor releases mark these source
  changes, including the test helper without making it a production guarantee.

### Patch Changes

- Updated dependencies [1387ea3]
- Updated dependencies [ca2debb]
  - @atrib/mcp@0.26.0

## 0.4.5

### Patch Changes

- 5d51ea6: Recall skips a stale durable content index without parsing it and keeps one bounded search window across different `max_records` limits. The signer's mirror tail index folds in appends that land during its incremental read instead of rescanning the whole mirror. `@atrib/attest` and `@atrib/emit` take the signer fix so the global `atrib-emit-cli` hook signer gets it on its next refresh.
- Updated dependencies [27f9b95]
- Updated dependencies [5d51ea6]
  - @atrib/mcp@0.25.2

## 0.4.4

### Patch Changes

- 8a616d9: Align MCP client/server 2.3.1, Node transport 2.1.1, legacy SDK 1.32.1 and Zod 4.6.6 dependencies. Declare Zod 4 explicitly for the wrapper so fresh consumers match workspace validation.
- Updated dependencies [8a616d9]
  - @atrib/mcp@0.25.1

## 0.4.3

### Patch Changes

- c4b6d5a: Install Zod v4 with the standalone MCP servers so fresh npm installs can register their tools and negotiate MCP 2026-07-28.

## 0.4.2

### Patch Changes

- Updated dependencies [f650be9]
  - @atrib/mcp@0.25.0

## 0.4.1

### Patch Changes

- 33c9e34: Negotiate the 2026-07-28 MCP protocol on every standalone stdio executable.

## 0.4.0

### Minor Changes

- fc4f351: Migrate maintained MCP servers, clients, and the primitive runtime to the v2 SDK split. atribd now negotiates dev.atrib/attribution receipts on stateless v2 tool calls. The retired primitives HTTP entry point delegates to atribd's stateless host.

### Patch Changes

- Updated dependencies [fc4f351]
  - @atrib/mcp@0.24.0

## 0.3.1

### Patch Changes

- 22ec7eb: Add an explicit local-only SDK submission mode. It signs and mirrors records without creating a public-log submission queue or anchor fan-out.

## 0.3.0

### Minor Changes

- f16d2dc: Add explicit per-call and per-client mirror paths, file-scoped chain inheritance, and isolated anchor fan-out for concurrent in-process clients.

### Patch Changes

- f16d2dc: Accept the normative hashed and unrestricted verbatim tool-name forms from protocol section 8.2.
- Updated dependencies [f16d2dc]
  - @atrib/mcp@0.23.0

## 0.2.0

### Minor Changes

- 5da8f9b: Strengthen the signed-action reference path. The wrapper now defaults to
  tool, argument, and result commitments with linked request and outcome
  records. Runtime coverage manifests bind expected capture surfaces to bounded
  run evidence. Action Gate adds a one-time protected MCP executor. Verification
  adds pinned witness checks, checkpoint gossip incidents, trusted-time
  delegation evaluation, and explicit missing-scope evidence. The CLI adds a
  named principal, workspace, agent, and ephemeral-run identity flow with
  accepted prior-run retirement. Protected execution and verification consume
  verified, reloadable revocation views.
  Recall and the TypeScript SDK add a policy-bound current-state projection
  over verified revision lineages. The projection exposes every active head,
  keeps forks unresolved, bounds fork and exclusion fan-out with truncation
  metadata, and reports its signer, context, and inclusion basis. The open
  explorer session view renders public revision commitments, conflicts, and
  partial roots without claiming that browser projection applied receiver
  policy.
  The specification now contains one normative session-checkpoint section
  instead of two byte-identical copies.
  Log subscriptions now resume after an exact log-index cursor, honor native
  `EventSource` reconnect headers, and reject cursor rollback instead of losing
  or duplicating the disconnected interval. The open explorer uses that stream
  for live activity and keeps polling as a compatibility fallback.
  The explorer action view now distinguishes the log's compact commitment entry
  from the signed record body. It reports whether the configured archive returned
  the body, never labels a commitment projection as a raw record, and serves
  direct action, session, identity, and trace routes from the fallback log host.
  The TypeScript client adds an explicit application action helper that signs a
  salted request before execution and a linked salted terminal outcome. Direct
  attest calls now carry argument and result salts through the same record path
  as middleware. Verification classifies committed, inconsistent,
  uncorroborated, and corroborated result evidence without claiming that hashes
  prove real-world truth.

### Patch Changes

- Updated dependencies [5da8f9b]
  - @atrib/mcp@0.22.0

## 0.1.0

### Minor Changes

- b40f207: The attest/recall rename ([D164](DECISIONS.md#d164-attestrecall-verb-rename-and-primitive-surface-collapse)). `@atrib/attest` is the new write-verb home: one `attest` tool signs observations, annotations (`ref.kind: "annotates"`), and revisions (`ref.kind: "revises"`), with the legacy `emit` / `atrib-annotate` / `atrib-revise` tool names mounted as permanent aliases over the same handler; records are byte-identical in canonical form. `@atrib/recall` absorbs the trace and handoff-verification implementations and adds the `recall` read verb (shape dispatch, walk directions, and a `verification` parameter with a typed `verifier_unavailable` degradation; `@atrib/verify` becomes an optional peer). `@atrib/emit`, `@atrib/annotate`, `@atrib/revise`, `@atrib/trace`, and `@atrib/verify-mcp` become re-export shims over the new homes; every legacy binary forwards and every legacy import keeps working. The primitives runtime mounts the seventeen-tool alias-window union. Zero signed bytes change; existing mirrors and records stay valid.
