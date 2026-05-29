---
'@atrib/openinference': minor
'@atrib/mcp': minor
'@atrib/recall': patch
'@atrib/trace': patch
'@atrib/summarize': patch
---

Add OpenInference sidecar content for cognitive recall.

`@atrib/openinference` now mirrors span payloads as local-only sidecar content for recall, trace, and summarize while signed records stay canonical. `@atrib/mcp` exposes shared sidecar normalization helpers, and the read primitives consume normalized wrapper and OpenInference content. The OpenInference processors now resolve custom chain roots against the actual signed `context_id`, including spans that use `session.id`.

OpenInference args/result commitments now hash verifier-compatible JCS material: JSON strings are parsed before hashing, while non-JSON strings are hashed as JCS string values. This lets `@atrib/verify` replay `args_hash` and `result_hash` from supplied body material. Integration coverage now includes a dual-export OTLP smoke, body-commitment replay, richer recall queries over OpenInference sidecars, and a negative guard that generic OTel parent-child nesting does not create `informed_by`.
