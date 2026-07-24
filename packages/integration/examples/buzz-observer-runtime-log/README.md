# Buzz observer runtime-log proof

This example turns locally captured Buzz NIP-AO observer frames into a bounded
`log_window_manifest`. It verifies each Nostr event, calls a host-owned NIP-44
decrypt function, validates the telemetry payload, and audits the session
capture before building the manifest.

## Run it

```bash
pnpm --filter @atrib/integration buzz-observer-runtime-log-smoke
```

The smoke writes three deterministic observer events to a temporary JSONL
capture, maps them through the adapter, and prints a hash-only verifier summary.
It does not connect to a Buzz relay or publish an atrib record.

## Boundary

The adapter supports both Buzz's own agents and ACP agents observed through
Buzz. It consumes the observer plane, not the agent harness itself.

- The Nostr event ID and agent signature are verifier-checked.
- The owner recipient and NIP-AO telemetry tags are checked against
  caller-supplied policy.
- The decrypt callback belongs to the host. The manifest commits to hashes of
  the ciphertext and decrypted payload.
- Process-sequence gaps, duplicates, and out-of-order capture prevent a
  completeness claim by default. ACP sessions remain projections over that
  process window.
- Relay admission, relay persistence, audit-chain inclusion, tool execution,
  and arbitrary result truth are not inferred from observer telemetry.

Buzz relays treat kind 24200 as ephemeral and exclude it from relay storage,
search, and audit logs. A desktop local archive can retain frames only while
the owner client is online and subscribed. The adapter therefore describes a
host-owned captured window, not a complete relay history.

NIP-AO describes `seq` as monotonic per session, while current `buzz-acp`
assigns it from one process-wide counter. The adapter follows the
implementation so interleaved ACP sessions do not appear as false gaps.

## Native action capture

Observer frames can show ACP protocol activity, but they do not replace tool
boundary capture. A Buzz deployment can still put `@atrib/mcp-wrap` or another
atrib producer on the MCP path and bind those signed records to this runtime
window with a coverage manifest.
