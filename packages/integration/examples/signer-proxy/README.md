# Signer proxy example

This example shows the sandboxed-execution composition pattern from [§9.7](../../../../atrib-spec.md#97-pattern-sandboxed-execution-signer-proxy). The agent code that runs in the sandbox can build an unsigned atrib record and ask for a signature. The Ed25519 key stays in a host signer process outside the sandbox.

The host signer owns these fields:

- `creator_key`
- `signature`
- `signers[]` for transaction records

It also runs host policy before signing. A prompt-injected sandbox can still ask for a bad record to be signed, but it cannot directly reach key material or forge a record without going through the host boundary.

Run the demo:

```bash
pnpm --filter @atrib/integration signer-proxy-demo
```

The demo signs one tool-call record through the host signer proxy and prints the resulting `record_hash`.
