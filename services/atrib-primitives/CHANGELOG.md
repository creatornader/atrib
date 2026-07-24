# @atrib/primitives-runtime

## 0.2.2

### Patch Changes

- Updated dependencies [5da8f9b]
  - @atrib/attest@0.2.0
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

- b40f207: The attest/recall rename ([D164](DECISIONS.md#d164-attestrecall-verb-rename-and-primitive-surface-collapse)). `@atrib/attest` is the new write-verb home: one `attest` tool signs observations, annotations (`ref.kind: "annotates"`), and revisions (`ref.kind: "revises"`), with the legacy `emit` / `atrib-annotate` / `atrib-revise` tool names mounted as permanent aliases over the same handler; records are byte-identical in canonical form. `@atrib/recall` absorbs the trace and handoff-verification implementations and adds the `recall` read verb (shape dispatch, walk directions, and a `verification` parameter with a typed `verifier_unavailable` degradation; `@atrib/verify` becomes an optional peer). `@atrib/emit`, `@atrib/annotate`, `@atrib/revise`, `@atrib/trace`, and `@atrib/verify-mcp` become re-export shims over the new homes; every legacy binary forwards and every legacy import keeps working. The primitives runtime mounts the seventeen-tool alias-window union. Zero signed bytes change; existing mirrors and records stay valid.

### Patch Changes

- Updated dependencies [b40f207]
  - @atrib/attest@0.1.0
  - @atrib/recall@1.0.0

## 0.1.24

### Patch Changes

- Updated dependencies [72d0f05]
- Updated dependencies [72d0f05]
  - @atrib/recall@0.14.7
  - @atrib/emit@0.17.3
  - @atrib/annotate@0.2.41
  - @atrib/revise@0.2.41
  - @atrib/verify-mcp@0.2.22
  - @atrib/summarize@0.4.23
  - @atrib/trace@0.5.21

## 0.1.23

### Patch Changes

- @atrib/annotate@0.2.40
- @atrib/emit@0.17.2
- @atrib/recall@0.14.6
- @atrib/revise@0.2.40
- @atrib/summarize@0.4.22
- @atrib/trace@0.5.20
- @atrib/verify-mcp@0.2.21

## 0.1.22

### Patch Changes

- @atrib/verify-mcp@0.2.20

## 0.1.21

### Patch Changes

- Updated dependencies [1378d4f]
  - @atrib/emit@0.17.1
  - @atrib/annotate@0.2.39
  - @atrib/revise@0.2.39
  - @atrib/recall@0.14.5
  - @atrib/trace@0.5.19
  - @atrib/summarize@0.4.21
  - @atrib/verify-mcp@0.2.19

## 0.1.20

### Patch Changes

- Updated dependencies [3c8e63d]
  - @atrib/emit@0.17.0
  - @atrib/annotate@0.2.38
  - @atrib/revise@0.2.38
  - @atrib/recall@0.14.4
  - @atrib/summarize@0.4.20
  - @atrib/trace@0.5.18
  - @atrib/verify-mcp@0.2.18

## 0.1.19

### Patch Changes

- 99cf86c: Expose deterministic non-mutating behavioral probes in primitive runtime health and gate stale hosts on the new probe status.

## 0.1.18

### Patch Changes

- 34c8075: Report package and tool-surface contracts for every mounted primitive in HTTP health, and extend the host-owned runtime updater to build the runtime dependency closure, validate the full primitive surface, and keep recall as the only live behavioral probe.

## 0.1.17

### Patch Changes

- Updated dependencies [e46b509]
  - @atrib/recall@0.14.3

## 0.1.16

### Patch Changes

- Updated dependencies [29aee57]
  - @atrib/recall@0.14.2

## 0.1.15

### Patch Changes

- Updated dependencies [f21f1ac]
  - @atrib/recall@0.14.1

## 0.1.14

### Patch Changes

- Updated dependencies [bad1477]
  - @atrib/recall@0.14.0

## 0.1.13

### Patch Changes

- Updated dependencies [53f1d06]
  - @atrib/recall@0.13.0

## 0.1.12

### Patch Changes

- Updated dependencies [6d7c462]
  - @atrib/recall@0.12.21

## 0.1.11

### Patch Changes

- Updated dependencies [44bc84d]
  - @atrib/emit@0.16.2
  - @atrib/annotate@0.2.37
  - @atrib/recall@0.12.20
  - @atrib/revise@0.2.37
  - @atrib/summarize@0.4.19
  - @atrib/trace@0.5.17
  - @atrib/verify-mcp@0.2.17

## 0.1.10

### Patch Changes

- Bound primitive tool dispatch with runtime-level timeouts and exposed in-flight timeout diagnostics through HTTP health.

## 0.1.9

### Patch Changes

- Updated dependencies [bc2daf3]
- Updated dependencies [e96057d]
- Updated dependencies [2659564]
  - @atrib/recall@0.12.19

## 0.1.7

### Patch Changes

- @atrib/annotate@0.2.36
- @atrib/emit@0.16.1
- @atrib/recall@0.12.18
- @atrib/revise@0.2.36
- @atrib/summarize@0.4.18
- @atrib/trace@0.5.16
- @atrib/verify-mcp@0.2.16

## 0.1.6

### Patch Changes

- Updated dependencies [3a4af87]
  - @atrib/emit@0.16.0
  - @atrib/annotate@0.2.35
  - @atrib/revise@0.2.35

## 0.1.5

### Patch Changes

- Updated dependencies [444a0d7]
  - @atrib/emit@0.15.3
  - @atrib/annotate@0.2.34
  - @atrib/revise@0.2.34

## 0.1.4

### Patch Changes

- Updated dependencies [07b0649]
  - @atrib/emit@0.15.2
  - @atrib/annotate@0.2.33
  - @atrib/revise@0.2.33

## 0.1.3

### Patch Changes

- Updated dependencies [7ffd086]
  - @atrib/emit@0.15.1
  - @atrib/summarize@0.4.17
  - @atrib/trace@0.5.15
  - @atrib/recall@0.12.17
  - @atrib/annotate@0.2.32
  - @atrib/revise@0.2.32
  - @atrib/verify-mcp@0.2.15

## 0.1.2

### Patch Changes

- Updated dependencies [10cc623]
  - @atrib/emit@0.15.0
  - @atrib/annotate@0.2.31
  - @atrib/revise@0.2.31

## 0.1.1

### Patch Changes

- Updated dependencies [466a55c]
- Updated dependencies [466a55c]
  - @atrib/emit@0.14.21
  - @atrib/annotate@0.2.30
  - @atrib/revise@0.2.30
  - @atrib/recall@0.12.16
