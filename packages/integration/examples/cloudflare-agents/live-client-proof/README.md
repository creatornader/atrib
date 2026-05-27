# Cloudflare live client proof

This proof deploys a real Cloudflare `Agent` Durable Object, connects it to an upstream `McpAgent` through `Agent.addMcpServer`, wraps that connection with `attributeCloudflareAgentMcp`, and verifies the resulting fallback transaction record against `log.atrib.dev`.

It covers the P16 client-side gate:

- Cloudflare Workers runtime
- Cloudflare Agents `Agent.addMcpServer`
- `MCPClientManager.callTool`
- `attributeCloudflareAgentMcp` in-place client wrapping
- atrib trace metadata observed by the upstream MCP tool
- unsigned-gap tracking for an unwrapped upstream
- fallback transaction signing and public log inclusion proof verification

Run it from this directory:

```sh
pnpm install
pnpm proof
```

The runner creates `.tmp/secrets.json` with a fresh proof-only `ATRIB_PRIVATE_KEY` if one does not exist. The Worker URL is discovered from Wrangler output at runtime and written only to ignored run artifacts.

Successful runs write JSON artifacts under `runs/`. These artifacts include the Worker URL, upstream URL, signed transaction record hash, log index, and verification booleans. They do not include the private key.

Latest clean run:

```text
ran_at: 2026-05-27T03:02:46.404Z
worker_url: written to the ignored run artifact
upstream_url: written to the ignored run artifact
context_id: 9918dd8064998e04c07c72635fc496ee
wrapped_count: 1
upstream saw trace metadata: true
gap_nodes: 1
```

Verified record:

```text
22871 sha256:a1a9d277f65b2c1195d5bec6395b60b242cac76cfe826fdbb334ae4f1bbd7f01 transaction signature_ok=true inclusion_ok=true
```
