// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { buildAAuthEvidenceFromEvent } from '../src/aauth-evidence.js'

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function unsignedJwt(claims: Record<string, unknown>): string {
  return `${encodeJson({ alg: 'none', typ: 'aa-auth+jwt' })}.${encodeJson(claims)}.signature`
}

describe('AAuth evidence capture', () => {
  it('captures decoded AAuth token facts without storing the raw token', () => {
    const authToken = unsignedJwt({
      iss: 'https://ps.example',
      sub: 'user-pairwise-123',
      aud: 'https://api.example',
      resource: 'https://api.example',
      agent: 'aauth:researcher@example.com',
      scope: 'files:read files:write',
      act: { sub: 'aauth:researcher@example.com' },
      mission: { approver: 'https://ps.example/person/alice', s256: 'mission-s256-1' },
    })

    const evidence = buildAAuthEvidenceFromEvent(
      {
        authToken,
        signedRequest: {
          headers: {
            'Signature-Input':
              'sig1=("@method" "@authority" "@path" "signature-key" "authorization");created=1700000000',
            'Signature-Key': 'sig1;scheme="jwt";keyid="agent-key"',
          },
        },
      },
      {
        tokenKind: 'auth_token',
        accessMode: 'aauth-access-token',
        claimsVerified: true,
        expectedAgent: 'aauth:researcher@example.com',
        expectedActSubject: 'aauth:researcher@example.com',
        requiredScopes: ['files:read'],
        resourceMetadata: {
          resource: 'https://api.example',
          access_mode: 'aauth-access-token',
        },
        requiredMission: {
          approver: 'https://ps.example/person/alice',
          s256: 'mission-s256-1',
        },
        httpSignatureVerified: true,
        signingKeyJkt: 'test-jkt',
        r3: {
          expectedS256: 'r3-s256-1',
          documentHashVerified: true,
        },
      },
    )

    expect(evidence).toMatchObject({
      protocol: 'aauth',
      tokenKind: 'auth_token',
      accessMode: 'aauth-access-token',
      claimsVerified: true,
      expectedAgent: 'aauth:researcher@example.com',
      expectedActSubject: 'aauth:researcher@example.com',
      requiredScopes: ['files:read'],
      claims: {
        iss: 'https://ps.example',
        sub: 'user-pairwise-123',
        aud: 'https://api.example',
        resource: 'https://api.example',
        agent: 'aauth:researcher@example.com',
        scope: 'files:read files:write',
        act: { sub: 'aauth:researcher@example.com' },
        mission: { approver: 'https://ps.example/person/alice', s256: 'mission-s256-1' },
      },
      resourceMetadata: {
        resource: 'https://api.example',
        access_mode: 'aauth-access-token',
      },
      requiredMission: {
        approver: 'https://ps.example/person/alice',
        s256: 'mission-s256-1',
      },
      httpSignature: {
        verified: true,
        scheme: 'jwt',
        coveredComponents: ['@method', '@authority', '@path', 'signature-key', 'authorization'],
        signingKeyJkt: 'test-jkt',
      },
      r3: {
        expectedS256: 'r3-s256-1',
        documentHashVerified: true,
      },
    })
    expect(evidence?.token_hash).toMatch(/^sha256:[A-Za-z0-9_-]{43}$/)
    expect(JSON.stringify(evidence)).not.toContain(authToken)
    expect(JSON.stringify(evidence)).not.toContain('authToken')
  })

  it('bounds HTTP signature metadata parsed from event headers', () => {
    const authToken = unsignedJwt({
      iss: 'https://ps.example',
      sub: 'user-pairwise-123',
      agent: 'aauth:researcher@example.com',
    })
    const malformedComponents = '(('.repeat(5000)

    const evidence = buildAAuthEvidenceFromEvent(
      {
        authToken,
        signedRequest: {
          headers: {
            'Signature-Input': `sig1=(${malformedComponents}`,
            'Signature-Key': 'sig1;scheme=jwt,keyid="agent-key"',
          },
        },
      },
      {
        tokenKind: 'auth_token',
        httpSignatureVerified: true,
      },
    )

    expect(evidence?.httpSignature).toEqual({
      verified: true,
      scheme: 'jwt',
    })
  })

  it('accepts decoded claims from audit sinks when no token is available', () => {
    const evidence = buildAAuthEvidenceFromEvent(
      {
        decodedClaims: {
          iss: 'https://ap.example',
          sub: 'aauth:researcher@example.com',
          scope: ['calendar.read'],
        },
      },
      {
        tokenKind: 'agent_token',
        accessMode: 'agent-token',
        includeTokenHash: false,
        expectedAgent: 'aauth:researcher@example.com',
      },
    )

    expect(evidence).toEqual({
      protocol: 'aauth',
      tokenKind: 'agent_token',
      accessMode: 'agent-token',
      claimsVerified: false,
      expectedAgent: 'aauth:researcher@example.com',
      claims: {
        iss: 'https://ap.example',
        sub: 'aauth:researcher@example.com',
        scope: ['calendar.read'],
      },
    })
  })

  it('accepts a generic jwt event when tokenKind is supplied', () => {
    const jwt = unsignedJwt({
      iss: 'https://resource.example',
      sub: 'aauth:researcher@example.com',
      resource: 'https://api.example',
    })

    const evidence = buildAAuthEvidenceFromEvent(
      { jwt },
      {
        tokenKind: 'agent_token',
        accessMode: 'agent-token',
        includeTokenHash: false,
      },
    )

    expect(evidence).toMatchObject({
      protocol: 'aauth',
      tokenKind: 'agent_token',
      claims: {
        iss: 'https://resource.example',
        sub: 'aauth:researcher@example.com',
        resource: 'https://api.example',
      },
    })
    expect(evidence).not.toHaveProperty('token_hash')
  })
})
