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
| Commits                   | gitsign (Sigstore keyless OIDC)    | `git log --pretty='%h %G? %GS %s'` shows signature status; full verify via `gitsign verify --certificate-identity ...`   |
| npm packages (`@atrib/*`) | npm publish `--provenance` (SLSA)  | `npm view @atrib/<pkg> dist.attestations`; visible as "verified" badges on npmjs.com                                     |
| WASM artifact (directory) | `--remap-path-prefix` (build-time) | `strings packages/directory/wasm/atrib_directory_bridge_bg.wasm` should contain no `/Users/` or `/home/` paths           |
| CI workflows              | GitHub Actions OIDC                | Security-scan results visible at github.com/creatornader/atrib/actions; SARIF uploaded to GHAS Code Scanning when public |

Commits signed via gitsign appear in the Sigstore Rekor public transparency log. Anyone can independently verify a commit was signed by the claimed identity at the claimed time without needing access to a long-lived public key. This is the same trust model atrib provides for agent actions: no central issuer to trust, just verifiable cryptographic primitives + a public log.
