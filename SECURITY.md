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
