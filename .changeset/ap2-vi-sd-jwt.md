---
'@atrib/verify': minor
'@atrib/integration': patch
---

Add async AP2 / Verifiable Intent SD-JWT conformance checks to `@atrib/verify`.

`verifyAp2ViEvidenceAsync()` now verifies VI credentials with OpenWallet `sd-jwt-js`, reports per-credential `sdJwtConformance`, and supports require, best-effort, and off policies. The AP2 integration test now exercises the async verifier path across package exports.
