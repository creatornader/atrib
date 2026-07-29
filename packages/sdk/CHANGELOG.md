# @atrib/sdk

## 7.1.1

### Patch Changes

- @atrib/emit@1.2.3

## 7.1.0

### Minor Changes

- f650be9: Add complete stateless MCP request metadata, default attribution negotiation,
  and exposed transport facts to client surfaces.
- d735df2: Add action-bound idempotency keys for stateless daemon writes, durable result
  replay across restarts, indeterminate pending outcomes, and SDK fallback
  suppression after uncertain writes.

### Patch Changes

- Updated dependencies [f650be9]
  - @atrib/mcp@0.25.0
  - @atrib/verify@0.13.2
  - @atrib/recall@5.1.2
  - @atrib/verify-mcp@1.1.2
  - @atrib/emit@1.2.2

## 7.0.1

### Patch Changes

- Updated dependencies [33c9e34]
  - @atrib/emit@1.2.1
  - @atrib/recall@5.1.1
  - @atrib/verify-mcp@1.1.1

## 7.0.0

### Patch Changes

- Updated dependencies [fc4f351]
  - @atrib/mcp@0.24.0
  - @atrib/emit@1.2.0
  - @atrib/recall@5.1.0
  - @atrib/verify-mcp@1.1.0
  - @atrib/verify@0.13.1

## 6.0.2

### Patch Changes

- 22ec7eb: Add an explicit local-only SDK submission mode. It signs and mirrors records without creating a public-log submission queue or anchor fan-out.
- Updated dependencies [22ec7eb]
  - @atrib/emit@1.1.1

## 6.0.1

### Patch Changes

- 7528afa: Serve MCP 2026-07-28 HTTP requests through the stable v2 SDK while retaining the v1 compatibility path for older clients. Have the consolidated SDK negotiate the modern protocol with atribd automatically.

## 6.0.0

### Patch Changes

- Updated dependencies [ffa7378]
  - @atrib/verify@0.13.0
  - @atrib/recall@5.0.0
  - @atrib/verify-mcp@1.0.9

## 5.1.1

### Patch Changes

- Updated dependencies [f98f932]
  - @atrib/verify@0.12.4
  - @atrib/recall@4.0.1
  - @atrib/verify-mcp@1.0.8

## 5.1.0

### Minor Changes

- f16d2dc: Add explicit per-call and per-client mirror paths, file-scoped chain inheritance, and isolated anchor fan-out for concurrent in-process clients.

### Patch Changes

- Updated dependencies [f16d2dc]
  - @atrib/emit@1.1.0
  - @atrib/mcp@0.23.0
  - @atrib/verify@0.12.3
  - @atrib/recall@4.0.1
  - @atrib/verify-mcp@1.0.7

## 5.0.2

### Patch Changes

- Updated dependencies [71b756d]
  - @atrib/verify@0.12.2
  - @atrib/recall@4.0.0
  - @atrib/verify-mcp@1.0.6

## 5.0.1

### Patch Changes

- Updated dependencies [0678e07]
  - @atrib/verify@0.12.1
  - @atrib/recall@4.0.0
  - @atrib/verify-mcp@1.0.5

## 5.0.0

### Patch Changes

- Updated dependencies [d3dfaf7]
  - @atrib/verify@0.12.0
  - @atrib/recall@4.0.0
  - @atrib/verify-mcp@1.0.4

## 4.0.0

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
  - @atrib/recall@3.0.0
  - @atrib/verify@0.11.0
  - @atrib/emit@1.0.1
  - @atrib/verify-mcp@1.0.3

## 3.0.0

### Patch Changes

- Updated dependencies [4c2510d]
  - @atrib/verify@0.10.0
  - @atrib/recall@2.0.0
  - @atrib/verify-mcp@1.0.2

## 2.0.1

### Patch Changes

- Updated dependencies [1f50763]
  - @atrib/verify-mcp@1.0.1

## 2.0.0

### Patch Changes

- Updated dependencies [b40f207]
  - @atrib/emit@1.0.0
  - @atrib/recall@1.0.0
  - @atrib/verify-mcp@1.0.0

## 1.0.0

### Patch Changes

- Updated dependencies [72d0f05]
- Updated dependencies [c8f2fb2]
- Updated dependencies [c8f2fb2]
- Updated dependencies [c8f2fb2]
- Updated dependencies [72d0f05]
  - @atrib/recall@0.14.7
  - @atrib/verify@0.9.0
  - @atrib/mcp@0.21.0
  - @atrib/emit@0.17.3
  - @atrib/verify-mcp@0.2.22

## 0.1.3

### Patch Changes

- Updated dependencies [f4a5ebd]
  - @atrib/mcp@0.20.0
  - @atrib/verify@0.8.3
  - @atrib/emit@0.17.2
  - @atrib/recall@0.14.6
  - @atrib/verify-mcp@0.2.21

## 0.1.2

### Patch Changes

- Updated dependencies [6f6ca5f]
  - @atrib/verify@0.8.2
  - @atrib/verify-mcp@0.2.20

## 0.1.1

### Patch Changes

- 1378d4f: Docs: bring every public package README and description to standalone-completeness parity. Lowercase the brand to `atrib` throughout, add a uniform Install section and a Part of atrib orientation block, and fix standalone gaps found in review: missing imports and undefined variables in quick-starts, the published npx wire-up form for the MCP servers, an off-machine privacy note for summarize, a worked handoff example for verify-mcp, and a rewrite of the directory README against its real class-based API. No code or public API changes.
- Updated dependencies [1378d4f]
  - @atrib/mcp@0.19.1
  - @atrib/verify@0.8.1
  - @atrib/emit@0.17.1
  - @atrib/recall@0.14.5
  - @atrib/verify-mcp@0.2.19
