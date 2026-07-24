# @atrib/action-gate

## 0.1.0

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
  - @atrib/verify@0.11.0

## 0.0.9

### Patch Changes

- 2a58186: Reject contradictory action-gate entries during signing and verification. Add
  precomputed digests and truthful not-executed outcomes for split-phase hosts.

## 0.0.8

### Patch Changes

- Updated dependencies [4c2510d]
  - @atrib/verify@0.10.0

## 0.0.7

### Patch Changes

- Updated dependencies [c8f2fb2]
- Updated dependencies [c8f2fb2]
- Updated dependencies [c8f2fb2]
  - @atrib/verify@0.9.0
  - @atrib/mcp@0.21.0

## 0.0.6

### Patch Changes

- Updated dependencies [f4a5ebd]
  - @atrib/mcp@0.20.0
  - @atrib/verify@0.8.3

## 0.0.5

### Patch Changes

- 1378d4f: Docs: bring every public package README and description to standalone-completeness parity. Lowercase the brand to `atrib` throughout, add a uniform Install section and a Part of atrib orientation block, and fix standalone gaps found in review: missing imports and undefined variables in quick-starts, the published npx wire-up form for the MCP servers, an off-machine privacy note for summarize, a worked handoff example for verify-mcp, and a rewrite of the directory README against its real class-based API. No code or public API changes.
- Updated dependencies [1378d4f]
  - @atrib/mcp@0.19.1

## 0.0.4

### Patch Changes

- Updated dependencies [3c8e63d]
  - @atrib/mcp@0.19.0

## 0.0.3

### Patch Changes

- 236d65f: Tighten the public README copy around action-gate continuity and follow-up workflows.

## 0.0.2

### Patch Changes

- Fix npm README and package metadata after the first publish.

## 0.0.1

### Patch Changes

- Add host-owned action gate helpers for signing policy decisions and outcomes
  before high-impact agent actions run.
