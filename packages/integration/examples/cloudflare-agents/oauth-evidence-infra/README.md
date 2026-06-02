# Cloudflare OAuth Evidence Infrastructure Reference

This deployable reference backs the two host-owned surfaces from [D111](../../../../../DECISIONS.md#d111-host-owned-oauth-evidence-infrastructure):

- `POST /v1/dpop/check`: an atomic DPoP replay-cache endpoint for `createFetchDpopReplayCache()`.
- `POST /v1/oauth/introspect`: an OAuth token-introspection proxy for `introspectOAuthToken()`.

It is not an authorization server and it does not issue, validate, or enforce OAuth grants. It gives hosts a small Cloudflare Worker and Durable Object pattern for keeping replay state and live introspection secrets outside `@atrib/verify`, while still producing evidence that can be passed to `verifyRecord()`.

## Endpoints

### `POST /v1/dpop/check`

Authentication: `Authorization: Bearer $DPOP_REPLAY_CACHE_BEARER_TOKEN`.

Request body:

```json
{
  "key_id": "{\"issuer\":\"https://issuer.example\",...}",
  "key": {
    "issuer": "https://issuer.example",
    "client_id": "mcp-client",
    "jkt": "thumbprint",
    "htm": "POST",
    "htu": "https://mcp.example/mcp",
    "jti": "proof-1"
  },
  "expires_at_seconds": 1893456000
}
```

Response:

```json
{ "accepted": true }
```

The Durable Object stores each `key_id` until its expiry. The first request for an unexpired key returns `accepted: true`; a replay returns `accepted: false`.

### `POST /v1/oauth/introspect`

Authentication: `Authorization: Bearer $INTROSPECTION_PROXY_BEARER_TOKEN`.

Request body: `application/x-www-form-urlencoded`, usually the body created by `introspectOAuthToken()`:

```text
token=opaque-access-token&token_type_hint=access_token
```

The Worker forwards the form body to `OAUTH_INTROSPECTION_ENDPOINT` with the configured upstream auth mode:

- `OAUTH_INTROSPECTION_AUTH_MODE=none`
- `OAUTH_INTROSPECTION_AUTH_MODE=basic` with `OAUTH_INTROSPECTION_CLIENT_ID` and `OAUTH_INTROSPECTION_CLIENT_SECRET`
- `OAUTH_INTROSPECTION_AUTH_MODE=bearer` with `OAUTH_INTROSPECTION_BEARER_TOKEN`

The response must include `active: boolean`. The Worker strips token-shaped fields such as `token`, `access_token`, `refresh_token`, and `id_token` before returning the response to the caller. Optional `EXPECTED_ISSUER`, `EXPECTED_AUDIENCE`, and `EXPECTED_RESOURCE` checks fail closed at the proxy boundary.

## Use With `@atrib/verify`

```ts
import {
  createFetchDpopReplayCache,
  introspectOAuthToken,
  oauthEvidenceFromIntrospectionResult,
  verifyRecord,
} from '@atrib/verify'

const dpopReplayCache = createFetchDpopReplayCache({
  endpoint: 'https://oauth-evidence.example.workers.dev/v1/dpop/check',
  headers: { Authorization: `Bearer ${process.env.REPLAY_CACHE_TOKEN}` },
})

const introspection = await introspectOAuthToken({
  endpoint: 'https://oauth-evidence.example.workers.dev/v1/oauth/introspect',
  token: opaqueAccessToken,
  clientAuthentication: {
    method: 'bearer',
    token: process.env.INTROSPECTION_PROXY_TOKEN ?? '',
  },
  expectedIssuer: 'https://issuer.example',
  expectedAudience: 'mcp-client',
  expectedResource: 'mcp://files.example',
})

const result = await verifyRecord(record, {
  authorizationEvidence: [
    {
      protocol: 'mcp_oauth',
      claims,
      claimsVerified: true,
      dpopReplayCache,
      dpopProof,
      requiredScopes: ['files.read'],
    },
    oauthEvidenceFromIntrospectionResult(introspection, {
      protocol: 'mcp_oauth',
      requiredScopes: ['files.read'],
    }),
  ],
})
```

`result.valid` still describes the signed atrib record. OAuth evidence appears under `result.evidence[]` and stays policy-side.

## Run Locally

```bash
pnpm --filter @atrib/cloudflare-oauth-evidence-infra typecheck
pnpm --filter @atrib/cloudflare-oauth-evidence-infra test
```

The Worker tests run in Cloudflare's Vitest pool. They prove the shipped `@atrib/verify` HTTP replay-cache adapter can call the Durable Object endpoint, replayed DPoP keys are rejected, the introspection helper can call the proxy endpoint, and raw opaque tokens do not appear in returned evidence.

## Deploy

Set secrets with Wrangler:

```bash
pnpm --filter @atrib/cloudflare-oauth-evidence-infra exec wrangler secret put DPOP_REPLAY_CACHE_BEARER_TOKEN
pnpm --filter @atrib/cloudflare-oauth-evidence-infra exec wrangler secret put INTROSPECTION_PROXY_BEARER_TOKEN
pnpm --filter @atrib/cloudflare-oauth-evidence-infra exec wrangler secret put OAUTH_INTROSPECTION_ENDPOINT
pnpm --filter @atrib/cloudflare-oauth-evidence-infra exec wrangler secret put OAUTH_INTROSPECTION_CLIENT_ID
pnpm --filter @atrib/cloudflare-oauth-evidence-infra exec wrangler secret put OAUTH_INTROSPECTION_CLIENT_SECRET
```

Then deploy:

```bash
pnpm --filter @atrib/cloudflare-oauth-evidence-infra deploy
```

For bearer-auth upstream introspection, set `OAUTH_INTROSPECTION_AUTH_MODE=bearer` in `wrangler.jsonc` and use `OAUTH_INTROSPECTION_BEARER_TOKEN` instead of the basic-auth client id and secret.

## How This Relates To The Other Cloudflare Examples

The existing Cloudflare examples show atrib signing inside Cloudflare-hosted agents:

- [`live-worker-proof/`](../live-worker-proof/) signs tool calls from a Cloudflare `McpAgent`.
- [`live-client-proof/`](../live-client-proof/) signs agent-side fallback transaction records from `Agent.addMcpServer`.
- [`approval-trace/`](../approval-trace/) signs a human approval workflow across agent, human, MCP execution, outcome, and handoff steps.

This reference is different. It is support infrastructure for OAuth evidence verification. A Cloudflare Agent, an MCP server, or any other host can call these endpoints when it needs shared DPoP replay state or controlled opaque-token introspection. It strengthens the Cloudflare story for MCP/OAuth evidence, but it does not replace the approval-trace demo.
