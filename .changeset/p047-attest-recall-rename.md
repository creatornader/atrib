---
"@atrib/attest": minor
"@atrib/emit": major
"@atrib/annotate": major
"@atrib/revise": major
"@atrib/recall": major
"@atrib/trace": major
"@atrib/verify-mcp": major
"@atrib/primitives-runtime": minor
---

The attest/recall rename ([D164](DECISIONS.md#d164-attestrecall-verb-rename-and-primitive-surface-collapse)). `@atrib/attest` is the new write-verb home: one `attest` tool signs observations, annotations (`ref.kind: "annotates"`), and revisions (`ref.kind: "revises"`), with the legacy `emit` / `atrib-annotate` / `atrib-revise` tool names mounted as permanent aliases over the same handler; records are byte-identical in canonical form. `@atrib/recall` absorbs the trace and handoff-verification implementations and adds the `recall` read verb (shape dispatch, walk directions, and a `verification` parameter with a typed `verifier_unavailable` degradation; `@atrib/verify` becomes an optional peer). `@atrib/emit`, `@atrib/annotate`, `@atrib/revise`, `@atrib/trace`, and `@atrib/verify-mcp` become re-export shims over the new homes; every legacy binary forwards and every legacy import keeps working. The primitives runtime mounts the seventeen-tool alias-window union. Zero signed bytes change; existing mirrors and records stay valid.
