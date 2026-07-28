# @atrib/daemon

## 0.2.9

### Patch Changes

- 7528afa: Serve MCP 2026-07-28 HTTP requests through the stable v2 SDK while retaining the v1 compatibility path for older clients. Have the consolidated SDK negotiate the modern protocol with atribd automatically.

## 0.2.8

### Patch Changes

- Updated dependencies [ffa7378]
  - @atrib/verify@0.13.0
  - @atrib/recall@5.0.0

## 0.2.7

### Patch Changes

- Updated dependencies [f98f932]
  - @atrib/verify@0.12.4
  - @atrib/recall@4.0.1

## 0.2.6

### Patch Changes

- Updated dependencies [f16d2dc]
- Updated dependencies [f16d2dc]
  - @atrib/attest@0.3.0
  - @atrib/mcp@0.23.0
  - @atrib/verify@0.12.3
  - @atrib/recall@4.0.1
  - @atrib/summarize@0.4.25

## 0.2.5

### Patch Changes

- Updated dependencies [71b756d]
  - @atrib/verify@0.12.2
  - @atrib/recall@4.0.0

## 0.2.4

### Patch Changes

- Updated dependencies [0678e07]
  - @atrib/verify@0.12.1
  - @atrib/recall@4.0.0

## 0.2.3

### Patch Changes

- Updated dependencies [d3dfaf7]
  - @atrib/verify@0.12.0
  - @atrib/recall@4.0.0

## 0.2.2

### Patch Changes

- Updated dependencies [5da8f9b]
  - @atrib/attest@0.2.0
  - @atrib/mcp@0.22.0
  - @atrib/recall@3.0.0
  - @atrib/verify@0.11.0
  - @atrib/summarize@0.4.24

## 0.2.1

### Patch Changes

- Updated dependencies [4c2510d]
  - @atrib/verify@0.10.0
  - @atrib/recall@2.0.0

## 0.2.0

### Minor Changes

- d75e3c8: First public release of atribd, the stateless-native local daemon for the
  seven cognitive primitives ([D148](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d148-atribd-is-the-public-stateless-native-local-daemon-for-the-primitive-runtime)): stateless Streamable HTTP with routing-
  header validation, direct stdio, and a stdio-to-HTTP proxy shim, with
  per-context write serialization and byte-identical signed records.

### Patch Changes

- ebff5ed: Export the `./package.json` subpath so registry consumers can resolve the
  manifest through the exports map, matching the fix CI caught for
  `@atrib/attest` (health contracts read dependency versions via
  `require.resolve('<pkg>/package.json')`).
- Updated dependencies [b40f207]
  - @atrib/attest@0.1.0
  - @atrib/recall@1.0.0
