# @atrib/verify-mcp

## 1.0.2

### Patch Changes

- Updated dependencies [4c2510d]
  - @atrib/verify@0.10.0
  - @atrib/recall@2.0.0

## 1.0.1

### Patch Changes

- 1f50763: Shorten the package description under the npm registry's 255-character limit; the 1.0.0 description was stored truncated mid-word on the registry.

## 1.0.0

### Major Changes

- b40f207: The attest/recall rename ([D164](DECISIONS.md#d164-attestrecall-verb-rename-and-primitive-surface-collapse)). `@atrib/attest` is the new write-verb home: one `attest` tool signs observations, annotations (`ref.kind: "annotates"`), and revisions (`ref.kind: "revises"`), with the legacy `emit` / `atrib-annotate` / `atrib-revise` tool names mounted as permanent aliases over the same handler; records are byte-identical in canonical form. `@atrib/recall` absorbs the trace and handoff-verification implementations and adds the `recall` read verb (shape dispatch, walk directions, and a `verification` parameter with a typed `verifier_unavailable` degradation; `@atrib/verify` becomes an optional peer). `@atrib/emit`, `@atrib/annotate`, `@atrib/revise`, `@atrib/trace`, and `@atrib/verify-mcp` become re-export shims over the new homes; every legacy binary forwards and every legacy import keeps working. The primitives runtime mounts the seventeen-tool alias-window union. Zero signed bytes change; existing mirrors and records stay valid.

### Patch Changes

- Updated dependencies [b40f207]
  - @atrib/recall@1.0.0

## 0.2.22

### Patch Changes

- Updated dependencies [c8f2fb2]
- Updated dependencies [c8f2fb2]
- Updated dependencies [c8f2fb2]
  - @atrib/verify@0.9.0
  - @atrib/mcp@0.21.0

## 0.2.21

### Patch Changes

- Updated dependencies [f4a5ebd]
  - @atrib/mcp@0.20.0
  - @atrib/verify@0.8.3

## 0.2.20

### Patch Changes

- Updated dependencies [6f6ca5f]
  - @atrib/verify@0.8.2

## 0.2.19

### Patch Changes

- 1378d4f: Docs: bring every public package README and description to standalone-completeness parity. Lowercase the brand to `atrib` throughout, add a uniform Install section and a Part of atrib orientation block, and fix standalone gaps found in review: missing imports and undefined variables in quick-starts, the published npx wire-up form for the MCP servers, an off-machine privacy note for summarize, a worked handoff example for verify-mcp, and a rewrite of the directory README against its real class-based API. No code or public API changes.
- Updated dependencies [1378d4f]
  - @atrib/mcp@0.19.1
  - @atrib/verify@0.8.1

## 0.2.18

### Patch Changes

- Updated dependencies [3c8e63d]
- Updated dependencies [3c8e63d]
  - @atrib/mcp@0.19.0
  - @atrib/verify@0.8.0

## 0.2.17

### Patch Changes

- Updated dependencies [44bc84d]
  - @atrib/mcp@0.18.1
  - @atrib/verify@0.7.10

## 0.2.16

### Patch Changes

- Updated dependencies [e700e1a]
  - @atrib/mcp@0.18.0
  - @atrib/verify@0.7.9

## 0.2.15

### Patch Changes

- Updated dependencies [7ffd086]
  - @atrib/mcp@0.17.6
  - @atrib/verify@0.7.8

## 0.2.14

### Patch Changes

- Updated dependencies [61c1ec7]
  - @atrib/mcp@0.17.5
  - @atrib/verify@0.7.7

## 0.2.13

### Patch Changes

- Updated dependencies [95cd2ca]
- Updated dependencies [95cd2ca]
- Updated dependencies [95cd2ca]
- Updated dependencies [c738147]
  - @atrib/mcp@0.17.4
  - @atrib/verify@0.7.6

## 0.2.12

### Patch Changes

- Updated dependencies [3de7d59]
  - @atrib/mcp@0.17.3
  - @atrib/verify@0.7.5

## 0.2.11

### Patch Changes

- Updated dependencies [ed766a4]
  - @atrib/mcp@0.17.2
  - @atrib/verify@0.7.4

## 0.2.10

### Patch Changes

- Updated dependencies [5ee04c5]
  - @atrib/mcp@0.17.1
  - @atrib/verify@0.7.3

## 0.2.9

### Patch Changes

- Updated dependencies [80310e7]
  - @atrib/mcp@0.17.0
  - @atrib/verify@0.7.2

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
