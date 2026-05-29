# Security Policy

## Reporting a Vulnerability

atrib is cryptographic infrastructure.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, email **security@atrib.dev** with:

- Description of the vulnerability
- Steps to reproduce
- Affected versions/components
- Potential impact

### What qualifies as a security vulnerability

- Ed25519 signature bypass or forgery
- Merkle proof forgery or inclusion proof manipulation
- JCS canonicalization collision that produces valid signatures for different records
- Timing attacks on signing or verification
- Key material exposure through API responses or logs
- Input validation bypass that leads to data corruption
- Supply chain attacks on published packages

### What does NOT qualify

- Denial of service on `@atrib/log-dev` (it's a dev-only fixture, not production infrastructure)
- Issues in example code under `packages/integration/examples/`
- Feature requests or general bugs (use GitHub Issues for these)

## Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 7 days
- **Patch release**: Within 90 days for confirmed vulnerabilities

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |

## Credit

We credit security researchers in release notes (unless you prefer anonymity). Let us know your preference when reporting.

## Cryptographic Standards

atrib uses exclusively audited libraries implementing published standards:

| Component        | Standard                            | Library                                     |
| ---------------- | ----------------------------------- | ------------------------------------------- |
| Signing          | Ed25519 (RFC 8032)                  | @noble/ed25519 (audited)                    |
| Hashing          | SHA-256                             | @noble/hashes (audited)                     |
| Canonicalization | JCS (RFC 8785)                      | canonicalize                                |
| Merkle tree      | RFC 6962 (Certificate Transparency) | In-house, tested against Wycheproof vectors |

No custom cryptography.

## Release Integrity

The protocol is about provable signed records; the project's own release artifacts are signed end-to-end so consumers can verify what they're running matches what was committed.

| Surface                   | Mechanism                          | How to verify                                                                                                            |
| ------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Commits                   | SSH commit signing (Ed25519 key uploaded to GitHub) | `git log --pretty='%h %G? %GS %s'` locally; "Verified" badge on github.com per GitHub's commit-signature-verification |
| npm packages (`@atrib/*`) | npm publish `--provenance` (Sigstore + SLSA L3) | `npm view @atrib/<pkg> dist.attestations`; visible as "verified" badges on npmjs.com; transparency-log entries in Rekor |
| WASM artifact (directory) | `--remap-path-prefix` (build-time) | `strings packages/directory/wasm/atrib_directory_bridge_bg.wasm` should contain no `/Users/` or `/home/` paths           |
| CI workflows              | GitHub Actions OIDC                | Security-scan results visible at github.com/creatornader/atrib/actions; SARIF uploaded to GHAS Code Scanning when public |

The release-artifact surface (npm packages) carries Sigstore-anchored provenance attestations recorded in the public Rekor transparency log. Anyone can independently verify that a published `@atrib/*` package was built from the claimed source at the claimed time, without trusting any central issuer. This is the same trust model atrib provides for agent actions: cryptographic primitives plus a public log, no central authority required. Commits use industry-standard SSH signing for the same identity-binding property at the level GitHub's UI recognizes; the decision-critical transparency-log surface for downstream consumers is the npm provenance, where it materially affects what those consumers run.
