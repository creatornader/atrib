import { createECDH, createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { calculateJwkThumbprint, importJWK, SignJWT } from 'jose'
import { verifyAAuthAuthorizationEvidence } from '../src/aauth-evidence.js'
import { verifyAuthorizationEvidence } from '../src/authorization-evidence.js'
import manifest from '../../../spec/conformance/5.5.6/aauth/manifest.json'
import type { JWK, JWTPayload } from 'jose'
import type { AAuthAuthorizationEvidenceInput } from '../src/aauth-evidence.js'

interface ManifestCase {
  name: string
  file: string
}

interface AAuthEvidenceCase {
  name: string
  kind: 'claims' | 'jwt'
  input: AAuthAuthorizationEvidenceInput
  jwtClaims?: JWTPayload & Record<string, unknown>
  includeCnfJwk?: boolean
  bindCnfJkt?: boolean
  bindAgentJkt?: boolean
  bindHttpSignature?: boolean
  expected: {
    valid: boolean
    constraints: Array<{ type: string; status: string }>
    errors: string[]
  }
}

const corpusRoot = fileURLToPath(new URL('../../../spec/conformance/5.5.6/aauth/', import.meta.url))
const p256Order = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551')

function keyFromSeed(kid: string, seed: string): JWK {
  const digest = createHash('sha256').update(`atrib-aauth-evidence:${seed}`).digest('hex')
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

function readCase(file: string): AAuthEvidenceCase {
  return JSON.parse(readFileSync(resolve(corpusRoot, file), 'utf8')) as AAuthEvidenceCase
}

function tokenTyp(kind: AAuthAuthorizationEvidenceInput['tokenKind']): string {
  if (kind === 'agent_token') return 'aa-agent+jwt'
  if (kind === 'resource_token') return 'aa-resource+jwt'
  if (kind === 'auth_token') return 'aa-auth+jwt'
  throw new Error(`fixture missing tokenKind`)
}

async function buildJwtInput(fixture: AAuthEvidenceCase): Promise<AAuthAuthorizationEvidenceInput> {
  const issuerKey = keyFromSeed('aauth-issuer-1', `${fixture.name}:issuer`)
  const httpKey = keyFromSeed('aauth-http-1', `${fixture.name}:http`)
  const httpPublicJwk = publicJwk(httpKey)
  const httpJkt = await calculateJwkThumbprint(httpPublicJwk, 'sha256')
  const jwtClaims: Record<string, unknown> = { ...(fixture.jwtClaims ?? {}) }
  if (fixture.includeCnfJwk) jwtClaims.cnf = { jwk: httpPublicJwk }
  if (fixture.bindAgentJkt) jwtClaims.agent_jkt = httpJkt

  const privateKey = await importJWK(issuerKey, 'ES256')
  const tokenJwt = await new SignJWT(jwtClaims)
    .setProtectedHeader({
      alg: 'ES256',
      kid: issuerKey.kid,
      typ: tokenTyp(fixture.input.tokenKind),
    })
    .sign(privateKey)

  const input: AAuthAuthorizationEvidenceInput = {
    ...fixture.input,
    tokenJwt,
    jwks: [publicJwk(issuerKey)],
  }
  if (fixture.bindCnfJkt) input.expectedCnfJkt = httpJkt
  if (fixture.bindAgentJkt) input.expectedAgentJkt = httpJkt
  if (fixture.bindHttpSignature) {
    input.httpSignature = {
      ...(input.httpSignature ?? {}),
      signingKeyJkt: httpJkt,
    }
  }
  return input
}

async function buildInput(fixture: AAuthEvidenceCase): Promise<AAuthAuthorizationEvidenceInput> {
  if (fixture.kind === 'jwt') return buildJwtInput(fixture)
  return fixture.input
}

describe('AAuth authorization evidence conformance corpus', () => {
  const cases = (manifest.cases as ManifestCase[]).map((entry) => ({
    manifest: entry,
    fixture: readCase(entry.file),
  }))

  for (const { manifest: manifestEntry, fixture } of cases) {
    it(manifestEntry.name, async () => {
      expect(fixture.name).toBe(manifestEntry.name)
      const result = await verifyAAuthAuthorizationEvidence(await buildInput(fixture))

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

  it('dispatches protocol: aauth through generic authorization evidence', async () => {
    const fixture = readCase('cases/auth-token-act-mission-r3-pass.json')
    const result = await verifyAuthorizationEvidence(await buildInput(fixture))
    expect(result.protocol).toBe('aauth')
    expect(result.valid).toBe(true)
  })
})
