import { createECDH, createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { calculateJwkThumbprint, exportJWK, importJWK, SignJWT } from 'jose'
import { base64urlEncode, sha256 } from '@atrib/mcp'
import { verifyOAuthAuthorizationEvidence } from '../src/authorization-evidence.js'
import { MemoryDpopReplayCache } from '../src/dpop-replay-cache.js'
import manifest from '../../../spec/conformance/5.5.6/oauth/manifest.json'
import type {
  OAuthAuthorizationEvidenceInput,
  OAuthAccessTokenClaims,
  OAuthDpopProofInput,
} from '../src/authorization-evidence.js'
import type { JWK } from 'jose'

interface ManifestCase {
  name: string
  file: string
}

interface OAuthEvidenceCase {
  name: string
  kind: 'claims' | 'jwt' | 'dpop' | 'introspection'
  input: OAuthAuthorizationEvidenceInput
  jwtClaims?: OAuthAccessTokenClaims
  accessToken?: string
  dpop?: {
    method: string
    url: string
    ath: 'token' | 'mismatch'
    iat: number
    jti: string
    bindCnfJkt?: boolean
  }
  expected: {
    valid: boolean
    constraints: Array<{ type: string; status: string }>
    errors: string[]
  }
}

const corpusRoot = fileURLToPath(new URL('../../../spec/conformance/5.5.6/oauth/', import.meta.url))
const p256Order = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551')

function keyFromSeed(kid: string, seed: string): JWK {
  const digest = createHash('sha256').update(`atrib-oauth-evidence:${seed}`).digest('hex')
  const scalar = (BigInt(`0x${digest}`) % (p256Order - 1n)) + 1n
  const privateBytes = Buffer.from(scalar.toString(16).padStart(64, '0'), 'hex')
  const ecdh = createECDH('prime256v1')
  ecdh.setPrivateKey(privateBytes)
  const publicBytes = ecdh.getPublicKey()

  return {
    kty: 'EC',
    crv: 'P-256',
    x: Buffer.from(publicBytes.subarray(1, 33)).toString('base64url'),
    y: Buffer.from(publicBytes.subarray(33, 65)).toString('base64url'),
    d: Buffer.from(privateBytes).toString('base64url'),
    kid,
    alg: 'ES256',
  }
}

function publicJwk(key: JWK): JWK {
  const { d: _privateKey, ...publicKey } = key
  return publicKey
}

function accessTokenHash(token: string): string {
  return base64urlEncode(sha256(new TextEncoder().encode(token)))
}

function readCase(file: string): OAuthEvidenceCase {
  return JSON.parse(readFileSync(resolve(corpusRoot, file), 'utf8')) as OAuthEvidenceCase
}

async function buildJwtInput(fixture: OAuthEvidenceCase): Promise<OAuthAuthorizationEvidenceInput> {
  const key = keyFromSeed('oauth-access-token-1', 'access-token')
  const privateKey = await importJWK(key, 'ES256')
  const accessTokenJwt = await new SignJWT(fixture.jwtClaims ?? {})
    .setProtectedHeader({ alg: 'ES256', kid: key.kid })
    .sign(privateKey)
  return {
    ...fixture.input,
    accessTokenJwt,
    jwks: [publicJwk(key)],
  }
}

async function buildDpopInput(
  fixture: OAuthEvidenceCase,
): Promise<OAuthAuthorizationEvidenceInput> {
  if (!fixture.dpop || !fixture.accessToken)
    throw new Error(`invalid DPoP fixture: ${fixture.name}`)
  const key = keyFromSeed('oauth-dpop-1', 'dpop')
  const publicKey = await importJWK(publicJwk(key), 'ES256')
  const publicHeaderJwk = await exportJWK(publicKey)
  const privateKey = await importJWK(key, 'ES256')
  const jkt = await calculateJwkThumbprint(publicHeaderJwk, 'sha256')
  const expectedAth = accessTokenHash(fixture.accessToken)
  const proofAth = fixture.dpop.ath === 'token' ? expectedAth : accessTokenHash('different-token')
  const proofJwt = await new SignJWT({
    htm: fixture.dpop.method,
    htu: fixture.dpop.url,
    iat: fixture.dpop.iat,
    jti: fixture.dpop.jti,
    ath: proofAth,
  })
    .setProtectedHeader({ typ: 'dpop+jwt', alg: 'ES256', jwk: publicHeaderJwk })
    .sign(privateKey)

  const claims = { ...(fixture.input.claims ?? {}) }
  if (fixture.dpop.bindCnfJkt) claims.cnf = { jkt }

  const dpopProof: OAuthDpopProofInput = {
    proofJwt,
    method: fixture.dpop.method,
    url: fixture.dpop.url,
    expectedAth,
    nowSeconds: fixture.input.nowSeconds,
  }

  return {
    ...fixture.input,
    claims,
    requiredCnfJkt: fixture.dpop.bindCnfJkt ? jkt : fixture.input.requiredCnfJkt,
    dpopProof,
  }
}

async function buildInput(fixture: OAuthEvidenceCase): Promise<OAuthAuthorizationEvidenceInput> {
  if (fixture.kind === 'jwt') return buildJwtInput(fixture)
  if (fixture.kind === 'dpop') return buildDpopInput(fixture)
  return fixture.input
}

describe('OAuth / MCP authorization evidence conformance corpus', () => {
  const cases = (manifest.cases as ManifestCase[]).map((entry) => ({
    manifest: entry,
    fixture: readCase(entry.file),
  }))

  for (const { manifest: manifestEntry, fixture } of cases) {
    it(manifestEntry.name, async () => {
      expect(fixture.name).toBe(manifestEntry.name)
      const result = await verifyOAuthAuthorizationEvidence(await buildInput(fixture))

      expect(result.valid).toBe(fixture.expected.valid)
      for (const expected of fixture.expected.constraints) {
        const actual = result.constraints.find((constraint) => constraint.type === expected.type)
        expect(actual, `${fixture.name}: ${expected.type}`).toBeDefined()
        expect(actual?.status).toBe(expected.status)
      }
      for (const expectedError of fixture.expected.errors) {
        expect(result.errors).toContain(expectedError)
      }
      if (fixture.expected.errors.length === 0) expect(result.errors).toEqual([])
    })
  }

  it('rejects repeated DPoP jtis through a shared replay cache', async () => {
    const fixture: OAuthEvidenceCase = {
      name: 'shared-dpop-replay-cache',
      kind: 'dpop',
      accessToken: 'opaque-access-token',
      input: {
        protocol: 'mcp_oauth',
        claimsVerified: true,
        claims: {
          iss: 'https://issuer.example',
          sub: 'agent-a',
          client_id: 'client-1',
          scope: 'tools:read',
          resource: 'https://mcp.example',
        },
        issuer: 'https://issuer.example',
        resource: 'https://mcp.example',
        requiredScopes: ['tools:read'],
        expectedClientId: 'client-1',
        nowSeconds: 1_700_000_200,
      },
      dpop: {
        method: 'POST',
        url: 'https://mcp.example/tools/search',
        ath: 'token',
        iat: 1_700_000_100,
        jti: 'shared-jti-1',
        bindCnfJkt: true,
      },
      expected: { valid: true, constraints: [], errors: [] },
    }
    const cache = new MemoryDpopReplayCache({ nowSeconds: () => 1_700_000_200 })
    const input = await buildDpopInput(fixture)

    const first = await verifyOAuthAuthorizationEvidence({ ...input, dpopReplayCache: cache })
    expect(first.valid).toBe(true)

    const second = await verifyOAuthAuthorizationEvidence({ ...input, dpopReplayCache: cache })
    expect(second.valid).toBe(false)
    expect(second.constraints).toContainEqual(
      expect.objectContaining({
        type: 'dpop.jti',
        status: 'failed',
        reason: 'jti already seen',
      }),
    )
  })
})
