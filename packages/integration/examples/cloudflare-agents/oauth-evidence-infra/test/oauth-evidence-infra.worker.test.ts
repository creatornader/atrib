// SPDX-License-Identifier: Apache-2.0

import { env, exports as workerExports } from 'cloudflare:workers'
import { createExecutionContext, reset, waitOnExecutionContext } from 'cloudflare:test'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createFetchDpopReplayCache,
  introspectOAuthToken,
  oauthEvidenceFromIntrospectionResult,
  verifyOAuthAuthorizationEvidence,
} from '@atrib/verify'

interface FetchHandler {
  fetch(request: Request, env: unknown, ctx: ExecutionContext): Promise<Response>
}

const worker = (workerExports as unknown as { default: FetchHandler }).default

afterEach(async () => {
  await reset()
})

async function dispatch(path: string, init: RequestInit = {}): Promise<Response> {
  const ctx = createExecutionContext()
  try {
    const response = await worker.fetch(
      new Request(`https://oauth-infra.test${path}`, init),
      env,
      ctx,
    )
    await waitOnExecutionContext(ctx)
    return response
  } catch (error) {
    await waitOnExecutionContext(ctx).catch(() => undefined)
    throw error
  }
}

async function workerFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input))
  return dispatch(url.pathname, init)
}

describe('Cloudflare OAuth evidence infrastructure reference', () => {
  it('backs createFetchDpopReplayCache with an atomic Durable Object check', async () => {
    const cache = createFetchDpopReplayCache({
      endpoint: 'https://oauth-infra.test/v1/dpop/check',
      fetchImpl: workerFetch,
      headers: { Authorization: 'Bearer replay-test-secret' },
    })
    const key = {
      issuer: 'https://issuer.example',
      client_id: 'mcp-client',
      jkt: 'fixture-thumbprint',
      htm: 'POST',
      htu: 'https://mcp.example/mcp',
      jti: 'proof-1',
    }

    await expect(cache.checkAndRemember(key, 1_893_456_000)).resolves.toBe(true)
    await expect(cache.checkAndRemember(key, 1_893_456_000)).resolves.toBe(false)
  })

  it('requires host auth before accepting DPoP replay-cache writes', async () => {
    const response = await dispatch('/v1/dpop/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key_id: 'proof-unauthorized',
        key: { jti: 'proof-unauthorized' },
        expires_at_seconds: 1_893_456_000,
      }),
    })

    expect(response.status).toBe(401)
  })

  it('proxies OAuth introspection and returns caller-supplied evidence without raw tokens', async () => {
    const result = await introspectOAuthToken({
      endpoint: 'https://oauth-infra.test/v1/oauth/introspect',
      token: 'opaque-token-secret',
      tokenTypeHint: 'access_token',
      clientAuthentication: {
        method: 'bearer',
        token: 'introspection-proxy-test-secret',
      },
      expectedIssuer: 'https://issuer.example',
      expectedAudience: 'mcp-client',
      expectedResource: 'mcp://files.example',
      fetchImpl: workerFetch,
    })

    expect(result.ok).toBe(true)
    expect(result.introspectionVerified).toBe(true)
    expect(JSON.stringify(result)).not.toContain('opaque-token-secret')
    expect(result.introspection).toMatchObject({
      active: true,
      iss: 'https://issuer.example',
      sub: 'agent-123',
      client_id: 'mcp-client',
    })

    const evidence = await verifyOAuthAuthorizationEvidence(
      oauthEvidenceFromIntrospectionResult(result, {
        protocol: 'mcp_oauth',
        issuer: 'https://issuer.example',
        audience: 'mcp-client',
        resource: 'mcp://files.example',
        requiredScopes: ['files.read'],
        expectedClientId: 'mcp-client',
      }),
    )
    expect(evidence.valid).toBe(true)
    expect(evidence.attenuation_ok).toBe(true)
    expect(evidence.scope).toEqual(['files.read', 'files.write'])
    expect(evidence.details).toMatchObject({
      token: { introspection_present: true },
    })
  })

  it('requires proxy auth before forwarding introspection requests', async () => {
    const response = await dispatch('/v1/oauth/introspect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: 'opaque-token-secret' }),
    })

    expect(response.status).toBe(401)
  })
})
