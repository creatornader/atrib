---
'@atrib/emit': patch
---

Accept shorthand `event_type` aliases for atrib's normative event types.

Calls such as `event_type: "observation"` now sign a canonical
`https://atrib.dev/v1/types/observation` record instead of returning a
warnings-only `sha256:unknown` response. The signed record format stays
unchanged; only the input boundary is more forgiving.
