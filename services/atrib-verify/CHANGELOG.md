# @atrib/verify-mcp

## 0.2.8

### Patch Changes

- Updated dependencies [f790fa0]
  - @atrib/mcp@0.16.1
  - @atrib/verify@0.7.1

## 0.2.7

### Patch Changes

- Updated dependencies [114248a]
  - @atrib/mcp@0.16.0
  - @atrib/verify@0.7.0

## 0.2.6

### Patch Changes

- Updated dependencies [4bec234]
  - @atrib/verify@0.6.0

## 0.2.5

### Patch Changes

- Updated dependencies [c2ea30d]
  - @atrib/mcp@0.15.1
  - @atrib/verify@0.5.2

## 0.2.4

### Patch Changes

- 92352be: Add explicit npm author, homepage, and keyword metadata to the cognitive MCP packages.

## 0.2.3

### Patch Changes

- ef495a6: Add npm keywords and align the package README with the cognitive-primitive MCP presentation pattern.

## 0.2.2

### Patch Changes

- 77ea856: Add the package README status and license sections before the first Trusted Publisher-backed patch release.

## 0.2.1

### Patch Changes

- Updated dependencies [8ad7158]
  - @atrib/mcp@0.15.0
  - @atrib/verify@0.5.1

## 0.2.0

### Minor Changes

- 24e8160: Promote Pattern 3 handoff verification into the verifier library and agent-facing MCP primitive.

  `@atrib/verify` now accepts packet-derived handoff claims, checks allowed contexts, and preserves missing required records as explicit rejections. `@atrib/verify-mcp` exposes the read-only `atrib-verify` primitive for receiving agents before they link follow-up work through `informed_by`.

### Patch Changes

- Updated dependencies [d19cb28]
- Updated dependencies [cd149be]
- Updated dependencies [24e8160]
  - @atrib/mcp@0.14.0
  - @atrib/verify@0.5.0
