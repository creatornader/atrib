# @atrib/verify-mcp

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
