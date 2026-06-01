// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { verifyOAuthAuthorizationEvidence } from '../src/authorization-evidence.js'
import {
  introspectOAuthToken,
  oauthEvidenceFromIntrospectionResult,
} from '../src/oauth-introspection.js'

describe('OAuth token introspection helper', () => {
  it('fetches a host-owned introspection response without returning the raw token', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} })
      return new Response(
        JSON.stringify({
          active: true,
          iss: 'https://issuer.example',
          sub: 'agent-a',
          client_id: 'client-1',
          scope: 'tools:read',
          resource: 'https://mcp.example',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }

    const result = await introspectOAuthToken({
      endpoint: 'https://issuer.example/oauth/introspect',
      token: 'secret-access-token',
      tokenTypeHint: 'access_token',
      clientAuthentication: {
        method: 'basic',
        clientId: 'client-1',
        clientSecret: 'client-secret',
      },
      expectedIssuer: 'https://issuer.example',
      expectedResource: 'https://mcp.example',
      fetchImpl,
    })

    expect(result.ok).toBe(true)
    expect(result.introspectionVerified).toBe(true)
    expect(JSON.stringify(result)).not.toContain('secret-access-token')
    expect(calls[0]?.url).toBe('https://issuer.example/oauth/introspect')
    expect(calls[0]?.init.method).toBe('POST')
    expect((calls[0]?.init.headers as Record<string, string>).authorization).toMatch(/^Basic /)
    expect(String(calls[0]?.init.body)).toContain('token=secret-access-token')

    const evidence = await verifyOAuthAuthorizationEvidence(
      oauthEvidenceFromIntrospectionResult(result, {
        protocol: 'mcp_oauth',
        issuer: 'https://issuer.example',
        resource: 'https://mcp.example',
        requiredScopes: ['tools:read'],
        expectedClientId: 'client-1',
      }),
    )
    expect(evidence.valid).toBe(true)
    expect(evidence.details.token.introspection_present).toBe(true)
  })

  it('marks introspection unverified when host expectations do not match', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          active: true,
          iss: 'https://wrong.example',
          scope: 'tools:read',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )

    const result = await introspectOAuthToken({
      endpoint: 'https://issuer.example/oauth/introspect',
      token: 'secret-access-token',
      expectedIssuer: 'https://issuer.example',
      fetchImpl,
    })

    expect(result.ok).toBe(false)
    expect(result.introspectionVerified).toBe(false)
    expect(result.errors).toContain('introspection issuer mismatch')
  })
})
