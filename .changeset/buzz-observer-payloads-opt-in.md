---
'@atrib/runtime-log': minor
---

The Buzz observer source no longer returns decrypted payloads by default. `telemetry.payload` is now optional and present only with `include_payloads: true`, with `nsec1...` values redacted. `plaintext_hash` still covers the original decrypted object.
