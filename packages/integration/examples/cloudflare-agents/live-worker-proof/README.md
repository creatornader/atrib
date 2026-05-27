# Cloudflare live Worker proof

This proof deploys a real Cloudflare `McpAgent` Durable Object, calls it through Streamable HTTP MCP, and verifies the signed atrib records against `log.atrib.dev`.

It covers the P16 gate that the unit packet did not cover:

- Cloudflare Workers runtime
- Cloudflare Agents `McpAgent.serve("/mcp")`
- Durable Object SQLite for prior outcomes and signed record capture
- `@atrib/mcp` server-side signing for successful MCP tool calls
- public log inclusion proof verification

Run it from this directory:

```sh
pnpm install
pnpm proof
```

The runner creates `.tmp/secrets.json` with a fresh proof-only `ATRIB_PRIVATE_KEY` if one does not exist. After the first deploy, it also writes the discovered `ATRIB_SERVER_URL` into that ignored file and redeploys if needed, so signed records use the actual Worker URL without committing account-specific hostnames.

Successful runs write JSON artifacts under `runs/`. These artifacts include signed records, record hashes, log indexes, and verification booleans. They do not include the private key.

Latest clean run:

```text
ran_at: 2026-05-27T02:35:29.055Z
worker_url: written to the ignored run artifact
mcp_url: written to the ignored run artifact
context_id: e59be437e0bcf5391863b8464ba0cfb6
```

Verified records from the Durable Object:

```text
22832 sha256:99f88337e8905ada32a8f61037538cde1d49f3e5f6921001d61a8865bac26925 record_outcome signature_ok=true inclusion_ok=true
22833 sha256:1667ce43254a940d7c22bab4d547337042c942c7b20ae396b569aa2c8b1f209e recall_outcomes signature_ok=true inclusion_ok=true
22834 sha256:097e417b80a26361a3d9c537c19056b799c1ac49c53fecb69d3d997a7d6db0fa flush_atrib_queue signature_ok=true inclusion_ok=true
```

The same context returned five `tool_call` entries from `log.atrib.dev` because `list_signed_records` and the final queue flush are signed after the proof runner retrieves the first three DO-captured records.
