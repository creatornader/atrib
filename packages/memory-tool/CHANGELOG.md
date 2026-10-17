# @atrib/memory-tool

## 0.3.0

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

## 0.2.22

### Patch Changes

- Updated dependencies [27f9b95]
- Updated dependencies [5d51ea6]
  - @atrib/mcp@0.25.2

## 0.2.21

### Patch Changes

- Updated dependencies [8a616d9]
  - @atrib/mcp@0.25.1

## 0.2.20

### Patch Changes

- Updated dependencies [f650be9]
  - @atrib/mcp@0.25.0

## 0.2.19

### Patch Changes

- Updated dependencies [fc4f351]
  - @atrib/mcp@0.24.0

## 0.2.18

### Patch Changes

- Updated dependencies [f16d2dc]
  - @atrib/mcp@0.23.0

## 0.2.17

### Patch Changes

- Updated dependencies [5da8f9b]
  - @atrib/mcp@0.22.0

## 0.2.16

### Patch Changes

- Updated dependencies [c8f2fb2]
  - @atrib/mcp@0.21.0

## 0.2.15

### Patch Changes

- Updated dependencies [f4a5ebd]
  - @atrib/mcp@0.20.0

## 0.2.14

### Patch Changes

- 1378d4f: Docs: bring every public package README and description to standalone-completeness parity. Lowercase the brand to `atrib` throughout, add a uniform Install section and a Part of atrib orientation block, and fix standalone gaps found in review: missing imports and undefined variables in quick-starts, the published npx wire-up form for the MCP servers, an off-machine privacy note for summarize, a worked handoff example for verify-mcp, and a rewrite of the directory README against its real class-based API. No code or public API changes.
- Updated dependencies [1378d4f]
  - @atrib/mcp@0.19.1

## 0.2.13

### Patch Changes

- Updated dependencies [3c8e63d]
  - @atrib/mcp@0.19.0

## 0.2.12

### Patch Changes

- Updated dependencies [44bc84d]
  - @atrib/mcp@0.18.1

## 0.2.11

### Patch Changes

- 09448bd: Update npm keywords so package metadata favors ecosystem discovery terms and keeps atrib-specific terms for family grouping.

## 0.2.10

### Patch Changes

- Updated dependencies [e700e1a]
  - @atrib/mcp@0.18.0

## 0.2.9

### Patch Changes

- Updated dependencies [7ffd086]
  - @atrib/mcp@0.17.6

## 0.2.8

### Patch Changes

- Updated dependencies [61c1ec7]
  - @atrib/mcp@0.17.5

## 0.2.7

### Patch Changes

- Updated dependencies [95cd2ca]
- Updated dependencies [95cd2ca]
- Updated dependencies [95cd2ca]
- Updated dependencies [c738147]
  - @atrib/mcp@0.17.4

## 0.2.6

### Patch Changes

- Updated dependencies [3de7d59]
  - @atrib/mcp@0.17.3

## 0.2.5

### Patch Changes

- Updated dependencies [ed766a4]
  - @atrib/mcp@0.17.2

## 0.2.4

### Patch Changes

- Updated dependencies [5ee04c5]
  - @atrib/mcp@0.17.1

## 0.2.3

### Patch Changes

- Updated dependencies [80310e7]
  - @atrib/mcp@0.17.0

## 0.2.2

### Patch Changes

- Updated dependencies [f790fa0]
  - @atrib/mcp@0.16.1

## 0.2.1

### Patch Changes

- 722ee51: Publish a corrected memory-tool manifest with the resolved `@atrib/mcp` dependency.

## 0.2.0

### Minor Changes

- 64d97b6: Add the Anthropic Memory Tool handler wrapper and a filesystem smoke for the generic MCP wrapper.
