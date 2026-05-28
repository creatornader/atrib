import { createECDH, createHash, createPrivateKey, sign as signEcdsa } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyAp2ViEvidenceAsync } from '../src/ap2-vi-evidence.js'
import type { Ap2ReceiptJwtIssuer, Ap2ViEvidenceBundle } from '../src/ap2-vi-evidence.js'

import autonomousFixture from '../../agent/test/fixtures/ap2/vi_autonomous_success_evidence.json'
import manifest from '../../../spec/conformance/ap2-vi-crypto/manifest.json'

const nowSeconds = 1_779_840_000
const clockSkewSeconds = 300
const p256Order = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551')

type JsonObject = Record<string, unknown>

type ReceiptMutation =
  | { type: 'jwt_header_patch'; patch: JsonObject }
  | { type: 'jwt_header_remove'; field: string }
  | { type: 'payload_patch'; patch: JsonObject }
  | { type: 'replace_jwt'; jwt: string }
  | { type: 'duplicate_jwks_kid' }
  | { type: 'jwk_patch'; patch: JsonObject }

interface ReceiptCase {
  name: string
  mutation: ReceiptMutation
  expectedErrors: string[]
}

interface BoundaryCase {
  name: string
  payloadPatch: JsonObject
  expectedValid?: boolean
  expectedErrors?: string[]
}

interface MetadataCase {
  name: string
  expectedFetches?: string[]
  expectedValid: boolean
}

type ViMutation =
  | { type: 'duplicate_disclosure'; layer: string; disclosureIndex: number }
  | { type: 'duplicate_sd_digest'; layer: string; digestIndex: number }
  | { type: 'append_unused_disclosure'; layer: string }
  | { type: 'payload_patch_resign'; layer: string; patch: JsonObject }

interface ViCase {
  name: string
  mutation: ViMutation
  expectedErrors: string[]
}

interface CryptoManifest {
  receipt_jwt_cases: ReceiptCase[]
  receipt_jwt_boundary_cases: BoundaryCase[]
  metadata_cases: MetadataCase[]
  vi_sd_jwt_cases: ViCase[]
}

interface ReceiptFixture {
  issuer: string
  closedMandate: string
  key: JsonWebKey
  publicJwk: JsonWebKey
  jwt: string
  payload: JsonObject
}

const cryptoManifest = manifest as CryptoManifest

function base64url(value: Buffer | string): string {
  return Buffer.from(value).toString('base64url')
}

function jsonBase64url(value: unknown): string {
  return base64url(JSON.stringify(value))
}

function decodeBase64urlJson(value: string): JsonObject {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as JsonObject
}

function hashAscii(value: string): string {
  return createHash('sha256').update(value, 'ascii').digest('base64url')
}

function keyFromSeed(kid: string, seed: string): JsonWebKey {
  const digest = createHash('sha256').update(`atrib-ap2-vi-fixture:${seed}`).digest('hex')
  const scalar = (BigInt(`0x${digest}`) % (p256Order - 1n)) + 1n
  const privateBytes = Buffer.from(scalar.toString(16).padStart(64, '0'), 'hex')
  const ecdh = createECDH('prime256v1')
  ecdh.setPrivateKey(privateBytes)
  const publicBytes = ecdh.getPublicKey()

  return {
    kty: 'EC',
    crv: 'P-256',
    x: base64url(publicBytes.subarray(1, 33)),
    y: base64url(publicBytes.subarray(33, 65)),
    d: base64url(privateBytes),
    kid,
    alg: 'ES256',
  }
}

function publicJwk(key: JsonWebKey): JsonWebKey {
  const { d: _privateKey, ...publicKey } = key
  return publicKey
}

const keys = {
  issuer: keyFromSeed('iss-fixture-1', 'issuer'),
  user: keyFromSeed('usr-fixture-1', 'user'),
  agent: keyFromSeed('agt-fixture-1', 'agent'),
  receipt: keyFromSeed('receipt-key-1', 'receipt'),
  receiptOther: keyFromSeed('receipt-key-1', 'receipt-other'),
  receiptB: keyFromSeed('shared-receipt-kid', 'receipt-b'),
  receiptC: keyFromSeed('shared-receipt-kid', 'receipt-c'),
}

function signJwtWithHeader(payload: JsonObject, key: JsonWebKey, header: JsonObject): string {
  const signingInput = `${jsonBase64url(header)}.${jsonBase64url(payload)}`
  const privateKey = createPrivateKey({ key, format: 'jwk' })
  const signature = signEcdsa('sha256', Buffer.from(signingInput, 'ascii'), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  })
  return `${signingInput}.${signature.toString('base64url')}`
}

function signJwt(payload: JsonObject, key: JsonWebKey, typ = 'JWT'): string {
  return signJwtWithHeader(payload, key, { alg: 'ES256', typ, kid: key.kid })
}

function patchJwtHeader(jwt: string, patch: JsonObject): string {
  const [header, payload, signature] = jwt.split('.')
  const nextHeader = { ...decodeBase64urlJson(header!), ...patch }
  return `${jsonBase64url(nextHeader)}.${payload}.${signature}`
}

function removeJwtHeaderField(jwt: string, field: string): string {
  const [header, payload, signature] = jwt.split('.')
  const nextHeader = decodeBase64urlJson(header!)
  delete nextHeader[field]
  return `${jsonBase64url(nextHeader)}.${payload}.${signature}`
}

function signReceiptFixture(
  kind: 'payment' | 'checkout',
  input: { issuer: string; key: JsonWebKey; payloadPatch?: JsonObject },
): ReceiptFixture {
  const closedMandate =
    kind === 'payment'
      ? '{"transaction_id":"tx_crypto_conformance"}'
      : '{"checkout_hash":"checkout_crypto_conformance"}'
  const payload =
    kind === 'payment'
      ? {
          status: 'Success',
          iss: input.issuer,
          iat: nowSeconds,
          reference: hashAscii(closedMandate),
          payment_id: 'pay_crypto_conformance',
          ...input.payloadPatch,
        }
      : {
          status: 'Success',
          iss: input.issuer,
          iat: nowSeconds,
          reference: hashAscii(closedMandate),
          order_id: 'order_crypto_conformance',
          ...input.payloadPatch,
        }

  return {
    issuer: input.issuer,
    closedMandate,
    key: input.key,
    publicJwk: publicJwk(input.key),
    jwt: signJwt(payload, input.key),
    payload,
  }
}

function makeReceiptBundle(fixture: ReceiptFixture, jwks: JsonWebKey[]): Ap2ViEvidenceBundle {
  return {
    receiptJwtIssuers: [{ issuer: fixture.issuer, jwks: { keys: jwks } }],
    ap2: {
      paymentReceiptJwt: fixture.jwt,
      closedPaymentMandate: fixture.closedMandate,
    },
  }
}

function applyReceiptMutation(fixture: ReceiptFixture, mutation: ReceiptMutation): JsonWebKey[] {
  if (mutation.type === 'jwt_header_patch') {
    fixture.jwt = patchJwtHeader(fixture.jwt, mutation.patch)
    return [fixture.publicJwk]
  }
  if (mutation.type === 'jwt_header_remove') {
    fixture.jwt = removeJwtHeaderField(fixture.jwt, mutation.field)
    return [fixture.publicJwk]
  }
  if (mutation.type === 'payload_patch') {
    fixture.payload = { ...fixture.payload, ...mutation.patch }
    fixture.jwt = signJwt(fixture.payload, fixture.key)
    return [fixture.publicJwk]
  }
  if (mutation.type === 'replace_jwt') {
    fixture.jwt = mutation.jwt
    return [fixture.publicJwk]
  }
  if (mutation.type === 'duplicate_jwks_kid') {
    return [fixture.publicJwk, publicJwk(keys.receiptOther)]
  }
  return [{ ...fixture.publicJwk, ...mutation.patch }]
}

function cloneEvidence<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function credentialByLayer(bundle: Ap2ViEvidenceBundle, layer: string) {
  const credential = bundle.vi?.credentials?.find((candidate) => candidate.layer === layer)
  if (!credential) throw new Error(`missing credential layer ${layer}`)
  return credential
}

function appendDisclosure(sdJwt: string, disclosure: string): string {
  const parts = sdJwt.split('~')
  parts.splice(Math.max(1, parts.length - 1), 0, disclosure)
  return parts.join('~')
}

function disclosure(value: unknown): string {
  return jsonBase64url(['unused-salt', value])
}

function keyForLayer(layer: string): JsonWebKey {
  if (layer === 'L1') return keys.issuer
  if (layer === 'L2') return keys.user
  return keys.agent
}

function resignSdJwtPayload(
  sdJwt: string,
  key: JsonWebKey,
  update: (payload: JsonObject) => JsonObject,
): string {
  const parts = sdJwt.split('~')
  const jwt = parts[0]!
  const [encodedHeader, encodedPayload] = jwt.split('.')
  const header = decodeBase64urlJson(encodedHeader!)
  const payload = decodeBase64urlJson(encodedPayload!)
  parts[0] = signJwtWithHeader(update(payload), key, header)
  return parts.join('~')
}

function applyViMutation(bundle: Ap2ViEvidenceBundle, mutation: ViMutation): void {
  const credential = credentialByLayer(bundle, mutation.layer)
  if (mutation.type === 'duplicate_disclosure') {
    const disclosureToDuplicate = credential.sdJwt.split('~')[mutation.disclosureIndex + 1]
    if (!disclosureToDuplicate) throw new Error('missing disclosure')
    credential.sdJwt = appendDisclosure(credential.sdJwt, disclosureToDuplicate)
    return
  }
  if (mutation.type === 'append_unused_disclosure') {
    credential.sdJwt = appendDisclosure(
      credential.sdJwt,
      disclosure({ vct: 'mandate.payment.1', transaction_id: 'unused' }),
    )
    return
  }
  if (mutation.type === 'duplicate_sd_digest') {
    credential.sdJwt = resignSdJwtPayload(
      credential.sdJwt,
      keyForLayer(mutation.layer),
      (payload) => {
        const sd = Array.isArray(payload['_sd']) ? [...payload['_sd']] : []
        const digest = sd[mutation.digestIndex]
        if (typeof digest !== 'string') throw new Error('missing digest')
        return { ...payload, _sd: [...sd, digest] }
      },
    )
    return
  }
  credential.sdJwt = resignSdJwtPayload(
    credential.sdJwt,
    keyForLayer(mutation.layer),
    (payload) => ({
      ...payload,
      ...mutation.patch,
    }),
  )
}

function makeViBundle(): Ap2ViEvidenceBundle {
  const bundle = cloneEvidence(autonomousFixture) as Ap2ViEvidenceBundle
  if (bundle.vi?.credentials) {
    bundle.vi.credentials = bundle.vi.credentials.filter(
      (credential) => credential.layer === 'L1' || credential.layer === 'L2',
    )
  }
  delete bundle.ap2
  return bundle
}

describe('AP2 / VI crypto conformance corpus', () => {
  for (const testCase of cryptoManifest.receipt_jwt_cases) {
    it(`rejects receipt JWT case: ${testCase.name}`, async () => {
      const fixture = signReceiptFixture('payment', {
        issuer: 'https://issuer.example',
        key: keys.receipt,
      })
      const jwks = applyReceiptMutation(fixture, testCase.mutation)

      const result = await verifyAp2ViEvidenceAsync(makeReceiptBundle(fixture, jwks), {
        nowSeconds,
        clockSkewSeconds,
        fetch: async () => {
          throw new Error(`unexpected network access for ${testCase.name}`)
        },
      })

      expect(result.valid).toBe(false)
      for (const expectedError of testCase.expectedErrors) {
        expect(result.errors).toContain(expectedError)
      }
    })
  }

  for (const testCase of cryptoManifest.receipt_jwt_boundary_cases) {
    it(`checks receipt JWT clock boundary: ${testCase.name}`, async () => {
      const fixture = signReceiptFixture('payment', {
        issuer: 'https://issuer.example',
        key: keys.receipt,
        payloadPatch: testCase.payloadPatch,
      })

      const result = await verifyAp2ViEvidenceAsync(
        makeReceiptBundle(fixture, [fixture.publicJwk]),
        { nowSeconds, clockSkewSeconds },
      )

      if (testCase.expectedValid) {
        expect(result.valid).toBe(true)
        expect(result.errors).toEqual([])
      }
      for (const expectedError of testCase.expectedErrors ?? []) {
        expect(result.errors).toContain(expectedError)
      }
    })
  }

  it('uses inline verifier metadata JWKS before jwks_uri', async () => {
    const testCase = cryptoManifest.metadata_cases.find(
      (candidate) => candidate.name === 'inline-jwks-takes-precedence-over-jwks-uri',
    )
    expect(testCase).toBeDefined()
    const metadataUrl = 'https://issuer.example/.well-known/ap2'
    const fixture = signReceiptFixture('payment', {
      issuer: 'https://issuer.example',
      key: keys.receipt,
    })
    const fetchedUrls: string[] = []

    const result = await verifyAp2ViEvidenceAsync(
      {
        receiptJwtIssuers: [{ issuer: fixture.issuer, metadataUrl }],
        ap2: {
          paymentReceiptJwt: fixture.jwt,
          closedPaymentMandate: fixture.closedMandate,
        },
      },
      {
        nowSeconds,
        clockSkewSeconds,
        fetch: async (input) => {
          const url = input instanceof Request ? input.url : String(input)
          fetchedUrls.push(url)
          if (url === metadataUrl) {
            return new Response(
              JSON.stringify({
                jwks: { keys: [fixture.publicJwk] },
                jwks_uri: 'https://issuer.example/remote-wrong-jwks.json',
              }),
              { status: 200, headers: { 'content-type': 'application/json' } },
            )
          }
          return new Response(JSON.stringify({ keys: [publicJwk(keys.receiptOther)] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        },
      },
    )

    expect(result.valid).toBe(testCase!.expectedValid)
    expect(fetchedUrls).toEqual(testCase!.expectedFetches)
  })

  it('isolates receipt JWT issuer keys when issuers share a kid', async () => {
    const testCase = cryptoManifest.metadata_cases.find(
      (candidate) => candidate.name === 'issuer-key-cache-is-isolated-by-issuer',
    )
    expect(testCase).toBeDefined()
    const payment = signReceiptFixture('payment', {
      issuer: 'https://pisp.example',
      key: keys.receiptB,
    })
    const checkout = signReceiptFixture('checkout', {
      issuer: 'https://merchant.example',
      key: keys.receiptC,
    })
    const issuers: Ap2ReceiptJwtIssuer[] = [
      { issuer: payment.issuer, jwks: { keys: [payment.publicJwk] } },
      { issuer: checkout.issuer, jwks: { keys: [checkout.publicJwk] } },
    ]

    const result = await verifyAp2ViEvidenceAsync(
      {
        receiptJwtIssuers: issuers,
        ap2: {
          paymentReceiptJwt: payment.jwt,
          checkoutReceiptJwt: checkout.jwt,
          closedPaymentMandate: payment.closedMandate,
          closedCheckoutMandate: checkout.closedMandate,
        },
      },
      { nowSeconds, clockSkewSeconds },
    )

    expect(result.valid).toBe(testCase!.expectedValid)
    expect(result.ap2.paymentReceipt?.jwt?.verified).toBe(true)
    expect(result.ap2.checkoutReceipt?.jwt?.verified).toBe(true)
  })

  for (const testCase of cryptoManifest.vi_sd_jwt_cases) {
    it(`rejects VI SD-JWT case: ${testCase.name}`, async () => {
      const bundle = makeViBundle()
      applyViMutation(bundle, testCase.mutation)

      const result = await verifyAp2ViEvidenceAsync(bundle, {
        nowSeconds,
        clockSkewSeconds,
        constraintPolicy: 'off',
        sdJwtConformancePolicy: 'best-effort',
      })

      expect(result.valid).toBe(false)
      for (const expectedError of testCase.expectedErrors) {
        expect(result.errors).toContain(expectedError)
      }
    })
  }
})
