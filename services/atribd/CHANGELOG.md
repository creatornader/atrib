# @atrib/daemon

## 0.4.5

### Patch Changes

- 27f9b95: The HTTP context policy now injects the inbound token's chain root for the `attest` verb as well as `emit`.
- 27f9b95: The HTTP context policy no longer replaces a present but malformed `context_id` argument with a carrier context; the primitive's schema refuses it. A valid bare `traceparent` now satisfies strict mode, so a client that attaches one gets its trace-id as the context instead of a refusal.
- 27f9b95: The HTTP context policy now resolves both context ladders of the MCP transport section: a write's `context_id` comes from the `dev.atrib/attribution` block, then the `traceparent` trace-id, and its `chain_root` from the extension token before the legacy carriers. A write whose only context is the extension block, or a bare `traceparent`, is no longer refused.
- 27f9b95: An idempotent write with a malformed `context_id` now reaches the primitive and gets its schema refusal, the same tool error a non-idempotent call gets, instead of a JSON-RPC invalid-params error.
- 62406b5: The stdio-to-HTTP proxy now forwards the session named in its own environment (`ATRIB_CONTEXT_ID`, `CLAUDE_CODE_SESSION_ID` or `CODEX_THREAD_ID`) as an explicit `context_id` on write calls that carry none, so a strict daemon accepts them without `--ambient-context`. It never reads the active-session files.
- Updated dependencies [27f9b95]
- Updated dependencies [ea023f3]
- Updated dependencies [5d51ea6]
- Updated dependencies [bd922cc]
  - @atrib/mcp@0.25.2
  - @atrib/verify@0.14.1
  - @atrib/recall@5.1.6
  - @atrib/attest@0.4.5
  - @atrib/summarize@0.5.5

## 0.4.4

### Patch Changes

- 8a616d9: Align MCP client/server 2.3.1, Node transport 2.1.1, legacy SDK 1.32.1 and Zod 4.6.6 dependencies. Declare Zod 4 explicitly for the wrapper so fresh consumers match workspace validation.
- Updated dependencies [8811d2c]
- Updated dependencies [8a616d9]
  - @atrib/verify@0.14.0
  - @atrib/attest@0.4.4
  - @atrib/mcp@0.25.1
  - @atrib/recall@5.1.5
  - @atrib/summarize@0.5.4

## 0.4.3

### Patch Changes

- b9daa8b: Add a lightweight readiness endpoint, recent tool-call latency diagnostics, and a stable durable recall-index path that replaces stale snapshots.
- Updated dependencies [e443d05]
- Updated dependencies [b9daa8b]
  - @atrib/recall@5.1.4

## 0.4.2

### Patch Changes

- f970204: Degrade health and emit a structured event when an expected-modern profile receives legacy traffic after its first modern request.

  Let content recall observe HTTP cancellation between synchronous corpus phases.

- Updated dependencies [f970204]
  - @atrib/recall@5.1.3

## 0.4.1

### Patch Changes

- Updated dependencies [c4b6d5a]
  - @atrib/attest@0.4.3
  - @atrib/summarize@0.5.3

## 0.4.0

### Minor Changes

- d5939c5: Add per-request bearer verification and rate limiting, abort read primitives on
  cancellation, and preserve late write settlement through idempotent replay.
- d735df2: Add action-bound idempotency keys for stateless daemon writes, durable result
  replay across restarts, indeterminate pending outcomes, and SDK fallback
  suppression after uncertain writes.

### Patch Changes

- a754f97: Report privacy-bounded modern and legacy MCP traffic by profile, persist the
  operational counters across restarts, and fail runtime updates when a
  modern-only profile falls back to legacy traffic.
- d5939c5: Carry modern request metadata into duplicate-write binding, and prove discovery,
  reads, receipts, and replay across hard process replacement.
- 52d53e6: Prevent valid operator contexts from colliding with the daemon's absent-context health probe.
- d5939c5: Add real-process in-flight kill coverage and enforce local request-path latency budgets.
- Updated dependencies [f650be9]
  - @atrib/mcp@0.25.0
  - @atrib/verify@0.13.2
  - @atrib/attest@0.4.2
  - @atrib/recall@5.1.2
  - @atrib/summarize@0.5.2

## 0.3.1

### Patch Changes

- Updated dependencies [33c9e34]
  - @atrib/attest@0.4.1
  - @atrib/recall@5.1.1
  - @atrib/summarize@0.5.1

## 0.3.0

### Minor Changes

- fc4f351: Migrate maintained MCP servers, clients, and the primitive runtime to the v2 SDK split. atribd now negotiates dev.atrib/attribution receipts on stateless v2 tool calls. The retired primitives HTTP entry point delegates to atribd's stateless host.

### Patch Changes

- Updated dependencies [fc4f351]
  - @atrib/mcp@0.24.0
  - @atrib/attest@0.4.0
  - @atrib/recall@5.1.0
  - @atrib/summarize@0.5.0
  - @atrib/verify@0.13.1

## 0.2.10

### Patch Changes

- Updated dependencies [22ec7eb]
  - @atrib/attest@0.3.1

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
