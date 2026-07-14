# `@atrib/cli`

**The operator CLI for atrib's verifiable action layer. Generate Ed25519 keypairs, manage them in macOS Keychain, and publish identity claims to the atrib directory (spec [§6](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#6-key-directory)).**

```bash
npx @atrib/cli keygen --keychain
# Generates an Ed25519 keypair. Stores the seed in macOS Keychain
# under service "atrib-creator" (or --service NAME). Prints only the
# public key to stdout.
```

The CLI is the companion tool to the SDK packages: producers (`@atrib/mcp`, `@atrib/agent`) read keys from environment variables or Keychain entries; this CLI is what creates and manages those entries. Those keys are the signer identities behind the action records that teams control, coordinate, and verify.

## Subcommands

### `keygen`

Generate a new Ed25519 keypair. Without `--keychain`, prints both seed and pubkey to stdout in env-var format (suitable for piping to `.env`). With `--keychain`, the seed is stored in macOS Keychain and only the pubkey is printed.

```bash
atrib keygen
# ATRIB_PRIVATE_KEY=<base64url-32-byte-seed>
# ATRIB_PUBLIC_KEY=<base64url-32-byte-pubkey>

atrib keygen --keychain --service atrib-creator-claude-code
# pubkey: <base64url-32-byte-pubkey>
# (seed stored in Keychain under service=atrib-creator-claude-code)
```

### `export-pubkey --keychain`

Read a seed from Keychain and print the derived public key only. Useful for confirming which identity a Keychain entry maps to.

```bash
atrib export-pubkey --keychain --service atrib-creator-claude-code
# pubkey: <base64url-32-byte-pubkey>
```

### `delegate`

Issue a [§1.11](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#111-delegation-certificates) delegation certificate for a new ephemeral run key. The command reads the principal key from the macOS Keychain service `atrib-creator` by default. Use `--service` to select another Keychain entry or `--key-file` when Keychain is unavailable.

The scope file uses the [§6.7](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#67-capability-declarations) capability-envelope fields. At least one constraint is required:

```json
{
  "tool_names": ["search", "read_file"],
  "event_types": ["https://atrib.dev/v1/types/tool_call"]
}
```

```bash
atrib delegate \
  --service atrib-creator-claude-code \
  --scope ./run-scope.json \
  --ttl 3600 \
  --context 4bf92f3577b34da6a3ce929d0e0e4736

# ATRIB_KEY=<base64url-32-byte-run-seed>
# ATRIB_DELEGATION_CERT=<base64url-certificate-json>
```

`--ttl` is measured in seconds from `--not-before` when supplied, or from the current time. The output is an env bundle for an orchestrator to inject into the delegated process. `ATRIB_KEY` is a secret. The certificate contains public keys, scope, and timestamps.

### `delete-key --keychain`

Remove a Keychain entry. Operator-confirmable destructive operation.

### `publish-claim --keychain`

Publish an `IdentityClaim` to the atrib directory (spec [§6.1](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#61-identity-claim-format)), optionally with a [§6.7](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#67-capability-declarations) capability envelope. The seed is read from Keychain, the claim is canonicalized + signed, and POST'd to `--directory URL` (defaults to `https://directory.atrib.dev/v6`).

```bash
atrib publish-claim --keychain \
  --service atrib-creator-claude-code \
  --display-name "My Agent" \
  --organization "My Org" \
  --email "ops@my-org.example.com" \
  --url "https://my-tool.example.com" \
  --tool-names search,fetch \
  --event-types tool_call \
  --max-amount-currency USD --max-amount-value 100 \
  --expires-at 2027-01-01T00:00:00Z
```

Capability envelope fields are optional; an empty envelope means "any tool, any event_type, no payment limits, no expiry."

### `revoke --keychain`

Revoke a key per spec [§1.9](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#19-key-rotation-and-revocation) (key rotation and revocation). Emits a `key_revocation` record to the log endpoint, signed by the key being retired.

## macOS Keychain integration

Keychain support requires macOS (`security` binary). On other platforms the CLI exits with a clear error directing operators to the `--key-file` alternative used by the SDK packages.

Service naming convention (matches what `@atrib/mcp` and `@atrib/agent` look up):

- `atrib-creator-<agent>`: agent-scoped (e.g. `atrib-creator-claude-code`)
- `atrib-creator`: generic fallback

## Key handling

The private seed is a secret and stays on your machine. `publish-claim` and
`revoke` send only the signed claim or revocation record and the public key to
the directory and log; the seed itself is never transmitted. Prefer
`--keychain` (or the SDK `--key-file` path) so the seed is never written to a
shell history or an `.env` file. Bare `keygen` prints the seed to stdout for
piping; `delegate` prints the ephemeral run seed for process injection. Treat
both outputs as credentials and do not commit or log them.

## Install

```bash
npm install -g @atrib/cli
# or use one-off:
npx @atrib/cli keygen --keychain
```

## License

Apache-2.0.

## Part of atrib

atrib is an open protocol for verifiable agent actions. Every action becomes a signed, chain-linked record that anyone can verify against a public Merkle log, with no operator to trust. This package is one entrypoint. See the [full package family](https://github.com/creatornader/atrib#packages) and the [protocol spec](https://github.com/creatornader/atrib/blob/main/atrib-spec.md).
