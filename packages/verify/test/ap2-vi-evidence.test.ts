import { describe, expect, it } from 'vitest'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { base64urlDecode, base64urlEncode, sha256 } from '@atrib/mcp'
import {
  evaluateAp2ViConstraints,
  verifyAp2ViEvidence,
  verifyAp2ViEvidenceAsync,
} from '../src/ap2-vi-evidence.js'
import type { Ap2MandateConstraintInput, Ap2ViEvidenceBundle } from '../src/ap2-vi-evidence.js'

import immediateFixture from '../../agent/test/fixtures/ap2/vi_immediate_evidence.json'
import autonomousFixture from '../../agent/test/fixtures/ap2/vi_autonomous_success_evidence.json'
import autonomousNegativeMatrix from '../../agent/test/fixtures/ap2/vi_autonomous_negative_matrix.json'
import splitAgentFixture from '../../agent/test/fixtures/ap2/vi_autonomous_split_agent_evidence.json'
import constraintFixture from '../../agent/test/fixtures/ap2/vi_autonomous_constraints_decoded.json'

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

function hashAscii(value: string): string {
  return base64urlEncode(sha256(textEncoder.encode(value)))
}

async function signedReceiptJwt(input: {
  issuer: string
  kid: string
  payload: Record<string, unknown>
  audience?: string | string[]
  expirationTime?: number
}) {
  const { privateKey, publicKey } = await generateKeyPair('ES256')
  const publicJwk = (await exportJWK(publicKey)) as JsonWebKey
  publicJwk.kid = input.kid
  publicJwk.alg = 'ES256'

  let builder = new SignJWT(input.payload)
    .setProtectedHeader({ alg: 'ES256', kid: input.kid, typ: 'JWT' })
    .setIssuer(input.issuer)
  if (input.audience !== undefined) builder = builder.setAudience(input.audience)
  if (input.expirationTime !== undefined) builder = builder.setExpirationTime(input.expirationTime)

  const jwt = await builder.sign(privateKey)

  return { jwt, publicJwk }
}

function tamperJwtPayload(jwt: string, patch: Record<string, unknown>): string {
  const [header, payload, signature] = jwt.split('.')
  const decoded = JSON.parse(textDecoder.decode(base64urlDecode(payload!))) as Record<
    string,
    unknown
  >
  const tampered = base64urlEncode(textEncoder.encode(JSON.stringify({ ...decoded, ...patch })))
  return `${header}.${tampered}.${signature}`
}

function tamperSdJwtPayload(sdJwt: string, patch: Record<string, unknown>): string {
  const parts = sdJwt.split('~')
  parts[0] = tamperJwtPayload(parts[0]!, patch)
  return parts.join('~')
}

function tamperSdJwtHeader(sdJwt: string, patch: Record<string, unknown>): string {
  const parts = sdJwt.split('~')
  const [header, payload, signature] = parts[0]!.split('.')
  const decoded = JSON.parse(textDecoder.decode(base64urlDecode(header!))) as Record<
    string,
    unknown
  >
  const tampered = base64urlEncode(textEncoder.encode(JSON.stringify({ ...decoded, ...patch })))
  parts[0] = `${tampered}.${payload}.${signature}`
  return parts.join('~')
}

function cloneEvidence<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function tamperDisclosure(sdJwt: string, disclosureIndex: number, patch: Record<string, unknown>) {
  const parts = sdJwt.split('~')
  const disclosure = parts[disclosureIndex + 1]
  if (!disclosure) throw new Error('missing disclosure')

  const decoded = JSON.parse(textDecoder.decode(base64urlDecode(disclosure))) as unknown[]
  const valueIndex = decoded.length === 2 ? 1 : 2
  decoded[valueIndex] = { ...(decoded[valueIndex] as Record<string, unknown>), ...patch }
  parts[disclosureIndex + 1] = base64urlEncode(textEncoder.encode(JSON.stringify(decoded)))
  return parts.join('~')
}

type NegativeMutation =
  | { type: 'tamper_payload'; layer: string; patch: Record<string, unknown> }
  | { type: 'tamper_header'; layer: string; patch: Record<string, unknown> }
  | {
      type: 'tamper_disclosure'
      layer: string
      disclosureIndex: number
      patch: Record<string, unknown>
    }
  | { type: 'patch_receipt_reference'; receipt: 'payment' | 'checkout'; reference: string }
  | { type: 'remove_trusted_issuer_keys' }

interface NegativeCase {
  name: string
  mutation: NegativeMutation
  expectedErrors: string[]
}

function credentialByLayer(bundle: Ap2ViEvidenceBundle, layer: string) {
  const credential = bundle.vi?.credentials?.find((candidate) => candidate.layer === layer)
  if (!credential) throw new Error(`missing credential layer ${layer}`)
  return credential
}

function applyNegativeMutation(bundle: Ap2ViEvidenceBundle, mutation: NegativeMutation): void {
  if (mutation.type === 'tamper_payload') {
    const credential = credentialByLayer(bundle, mutation.layer)
    credential.sdJwt = tamperSdJwtPayload(credential.sdJwt, mutation.patch)
    return
  }

  if (mutation.type === 'tamper_header') {
    const credential = credentialByLayer(bundle, mutation.layer)
    credential.sdJwt = tamperSdJwtHeader(credential.sdJwt, mutation.patch)
    return
  }

  if (mutation.type === 'tamper_disclosure') {
    const credential = credentialByLayer(bundle, mutation.layer)
    credential.sdJwt = tamperDisclosure(credential.sdJwt, mutation.disclosureIndex, mutation.patch)
    return
  }

  if (mutation.type === 'patch_receipt_reference') {
    if (mutation.receipt === 'payment' && bundle.ap2?.paymentReceipt) {
      ;(bundle.ap2.paymentReceipt as Record<string, unknown>).reference = mutation.reference
      return
    }
    if (mutation.receipt === 'checkout' && bundle.ap2?.checkoutReceipt) {
      ;(bundle.ap2.checkoutReceipt as Record<string, unknown>).reference = mutation.reference
      return
    }
    throw new Error(`missing ${mutation.receipt} receipt`)
  }

  delete bundle.trustedIssuerKeys
}

describe('verifyAp2ViEvidence', () => {
  it('verifies signed VI immediate evidence with matching AP2 receipts', () => {
    const result = verifyAp2ViEvidence(immediateFixture)

    expect(result.valid).toBe(true)
    expect(result.transactionAccepted).toBe(true)
    expect(result.ap2.paymentReceipt?.referenceOk).toBe(true)
    expect(result.ap2.checkoutReceipt?.referenceOk).toBe(true)
    expect(result.vi.mode).toBe('immediate')
    expect(result.vi.checkoutPaymentBindingOk).toBe(true)
    expect(result.vi.constraints.status).toBe('not_applicable')
    expect(
      result.vi.credentials.every((credential) => credential.signature.status === 'verified'),
    ).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('verifies signed autonomous VI evidence with AP2 receipts and constraints', async () => {
    const result = await verifyAp2ViEvidenceAsync(autonomousFixture as Ap2ViEvidenceBundle, {
      nowSeconds: 1_779_840_000,
    })

    expect(result.valid).toBe(true)
    expect(result.transactionAccepted).toBe(true)
    expect(result.ap2.paymentReceipt?.referenceOk).toBe(true)
    expect(result.ap2.checkoutReceipt?.referenceOk).toBe(true)
    expect(result.vi.mode).toBe('autonomous')
    expect(result.vi.delegationOk).toBe(true)
    expect(result.vi.checkoutPaymentBindingOk).toBe(true)
    expect(result.vi.constraints.status).toBe('passed')
    expect(result.vi.constraints.checks).toHaveLength(7)
    expect(
      result.vi.credentials.every(
        (credential) =>
          credential.signature.status === 'verified' &&
          credential.sdJwtConformance.status === 'verified',
      ),
    ).toBe(true)
    expect(result.errors).toEqual([])
  })

  for (const testCase of autonomousNegativeMatrix.cases as NegativeCase[]) {
    it(`rejects autonomous VI fixture case: ${testCase.name}`, async () => {
      const fixture = cloneEvidence(autonomousFixture) as Ap2ViEvidenceBundle
      applyNegativeMutation(fixture, testCase.mutation)

      const result = await verifyAp2ViEvidenceAsync(fixture, {
        nowSeconds: autonomousNegativeMatrix.nowSeconds,
        sdJwtConformancePolicy: 'best-effort',
      })

      expect(result.valid).toBe(false)
      for (const expectedError of testCase.expectedErrors) {
        expect(result.errors).toContain(expectedError)
      }
    })
  }

  it('verifies VI SD-JWT VC conformance in the async verifier', async () => {
    const result = await verifyAp2ViEvidenceAsync(immediateFixture, {
      nowSeconds: 1_779_840_000,
    })

    expect(result.valid).toBe(true)
    expect(result.vi.credentials).toHaveLength(2)
    expect(
      result.vi.credentials.every(
        (credential) =>
          credential.sdJwtConformance.status === 'verified' &&
          credential.sdJwtConformance.profile === 'sd-jwt-vc',
      ),
    ).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('rejects VI disclosure tampering through SD-JWT conformance', async () => {
    const tampered = cloneEvidence(immediateFixture)
    tampered.vi.credentials[1]!.sdJwt = tamperDisclosure(tampered.vi.credentials[1]!.sdJwt, 0, {
      checkout_hash: 'different_hash',
    })

    const result = await verifyAp2ViEvidenceAsync(tampered, {
      nowSeconds: 1_779_840_000,
    })

    expect(result.valid).toBe(false)
    expect(result.vi.credentials[1]!.sdJwtConformance.status).toBe('invalid')
    expect(result.errors).toContain('vi_sd_jwt_conformance_invalid')
  })

  it('keeps SD-JWT VC metadata failures advisory in best-effort mode', async () => {
    const result = await verifyAp2ViEvidenceAsync(immediateFixture, {
      nowSeconds: 1_779_840_000,
      sdJwtConformancePolicy: 'best-effort',
      sdJwtVc: { loadTypeMetadata: true },
    })

    expect(result.valid).toBe(true)
    expect(result.errors).not.toContain('vi_sd_jwt_conformance_invalid')
    expect(
      result.warnings.some((warning) => warning.startsWith('vi_sd_jwt_conformance_invalid:')),
    ).toBe(true)
    expect(
      result.vi.credentials.some(
        (credential) => credential.sdJwtConformance.reason === 'vct_fetcher',
      ),
    ).toBe(true)
  })

  it('rejects autonomous VI evidence when checkout and payment mandates bind different agent keys', () => {
    const result = verifyAp2ViEvidence(splitAgentFixture, { constraintPolicy: 'best-effort' })

    expect(result.valid).toBe(false)
    expect(result.vi.mode).toBe('autonomous')
    expect(result.vi.delegationOk).toBe(false)
    expect(result.vi.constraints.status).toBe('unresolved')
    expect(result.errors).toContain('vi_l2_cnf_mismatch')
    expect(result.errors.some((error) => error.startsWith('vi_constraint_'))).toBe(false)
    expect(result.warnings.some((warning) => warning.startsWith('vi_constraint_'))).toBe(true)
  })

  it('fails autonomous evidence when required constraints cannot be resolved', () => {
    const result = verifyAp2ViEvidence(splitAgentFixture)

    expect(result.valid).toBe(false)
    expect(result.vi.constraints.status).toBe('unresolved')
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'vi_constraint_unresolved:mandate.checkout.allowed_merchants',
        'vi_constraint_unresolved:mandate.payment.amount_range',
      ]),
    )
  })

  it('returns a failed result instead of throwing on malformed evidence', () => {
    const result = verifyAp2ViEvidence({
      vi: { credentials: [{ layer: 'L1', sdJwt: 'not-a-jwt' }] },
    })

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('vi_jwt_malformed')
  })

  it('verifies signed AP2 receipt JWTs against trusted local JWKS', async () => {
    const issuer = 'https://pisp.example'
    const closedPaymentMandate = '{"transaction_id":"tx_1"}'
    const reference = hashAscii(closedPaymentMandate)
    const { jwt, publicJwk } = await signedReceiptJwt({
      issuer,
      kid: 'receipt-key-1',
      payload: {
        status: 'Success',
        iss: issuer,
        iat: 1_779_840_000,
        reference,
        payment_id: 'pay_123',
      },
    })

    const result = await verifyAp2ViEvidenceAsync(
      {
        receiptJwtIssuers: [{ issuer, jwks: { keys: [publicJwk] } }],
        ap2: {
          paymentReceiptJwt: jwt,
          closedPaymentMandate,
        },
      },
      { nowSeconds: 1_779_840_001 },
    )

    expect(result.valid).toBe(true)
    expect(result.transactionAccepted).toBe(true)
    expect(result.ap2.paymentReceipt?.jwt?.verified).toBe(true)
    expect(result.ap2.paymentReceipt?.jwt?.jwksSource).toBe('static')
    expect(result.ap2.paymentReceipt?.referenceOk).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('resolves AP2 receipt JWT keys from verifier metadata', async () => {
    const issuer = 'https://merchant.example'
    const closedCheckoutMandate = '{"checkout_hash":"checkout_1"}'
    const reference = hashAscii(closedCheckoutMandate)
    const { jwt, publicJwk } = await signedReceiptJwt({
      issuer,
      kid: 'receipt-key-2',
      payload: {
        status: 'Success',
        iss: issuer,
        iat: 1_779_840_000,
        reference,
        order_id: 'order_123',
      },
    })

    const result = await verifyAp2ViEvidenceAsync(
      {
        receiptJwtIssuers: [{ issuer, metadataUrl: 'https://merchant.example/.well-known/ap2' }],
        ap2: {
          checkoutReceiptJwt: jwt,
          closedCheckoutMandate,
        },
      },
      {
        nowSeconds: 1_779_840_001,
        fetch: async () =>
          new Response(JSON.stringify({ jwks: { keys: [publicJwk] } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      },
    )

    expect(result.valid).toBe(true)
    expect(result.transactionAccepted).toBe(true)
    expect(result.ap2.checkoutReceipt?.jwt?.verified).toBe(true)
    expect(result.ap2.checkoutReceipt?.jwt?.jwksSource).toBe('metadata')
    expect(result.ap2.checkoutReceipt?.referenceOk).toBe(true)
  })

  it('resolves AP2 receipt JWT keys from metadata jwks_uri', async () => {
    const issuer = 'https://merchant.example'
    const jwksUrl = 'https://merchant.example/jwks.json'
    const closedPaymentMandate = '{"transaction_id":"tx_jwks_uri"}'
    const reference = hashAscii(closedPaymentMandate)
    const { jwt, publicJwk } = await signedReceiptJwt({
      issuer,
      kid: 'receipt-key-remote',
      payload: {
        status: 'Success',
        iss: issuer,
        iat: 1_779_840_000,
        reference,
        payment_id: 'pay_remote',
      },
    })

    const requestedUrls: string[] = []
    const result = await verifyAp2ViEvidenceAsync(
      {
        receiptJwtIssuers: [{ issuer, metadataUrl: 'https://merchant.example/.well-known/ap2' }],
        ap2: {
          paymentReceiptJwt: jwt,
          closedPaymentMandate,
        },
      },
      {
        nowSeconds: 1_779_840_001,
        fetch: async (input) => {
          const url = input instanceof Request ? input.url : String(input)
          requestedUrls.push(url)
          if (url === jwksUrl) {
            return new Response(JSON.stringify({ keys: [publicJwk] }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            })
          }
          return new Response(JSON.stringify({ jwks_uri: jwksUrl }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        },
      },
    )

    expect(result.valid).toBe(true)
    expect(result.ap2.paymentReceipt?.jwt?.verified).toBe(true)
    expect(result.ap2.paymentReceipt?.jwt?.jwksSource).toBe('metadata')
    expect(requestedUrls).toContain(jwksUrl)
  })

  it('rejects AP2 receipt JWTs signed by the wrong key', async () => {
    const issuer = 'https://pisp.example'
    const closedPaymentMandate = '{"transaction_id":"tx_2"}'
    const reference = hashAscii(closedPaymentMandate)
    const { jwt } = await signedReceiptJwt({
      issuer,
      kid: 'receipt-key-3',
      payload: {
        status: 'Success',
        iss: issuer,
        iat: 1_779_840_000,
        reference,
        payment_id: 'pay_456',
      },
    })
    const { publicJwk: wrongPublicJwk } = await signedReceiptJwt({
      issuer,
      kid: 'receipt-key-3',
      payload: { status: 'Success', iss: issuer, iat: 1_779_840_000, reference, payment_id: 'x' },
    })

    const result = await verifyAp2ViEvidenceAsync(
      {
        receiptJwtIssuers: [{ issuer, jwks: { keys: [wrongPublicJwk] } }],
        ap2: {
          paymentReceiptJwt: jwt,
          closedPaymentMandate,
        },
      },
      { nowSeconds: 1_779_840_001 },
    )

    expect(result.valid).toBe(false)
    expect(result.transactionAccepted).toBe(false)
    expect(result.ap2.paymentReceipt?.jwt?.verified).toBe(false)
    expect(result.errors).toContain('ap2_payment_receipt_jwt_invalid')
  })

  it('rejects AP2 receipt JWTs with the wrong audience', async () => {
    const issuer = 'https://pisp.example'
    const closedPaymentMandate = '{"transaction_id":"tx_audience"}'
    const reference = hashAscii(closedPaymentMandate)
    const { jwt, publicJwk } = await signedReceiptJwt({
      issuer,
      kid: 'receipt-key-aud',
      audience: 'merchant:other',
      payload: {
        status: 'Success',
        iss: issuer,
        iat: 1_779_840_000,
        reference,
        payment_id: 'pay_audience',
      },
    })

    const result = await verifyAp2ViEvidenceAsync(
      {
        receiptJwtIssuers: [{ issuer, audience: 'merchant:checkout', jwks: { keys: [publicJwk] } }],
        ap2: {
          paymentReceiptJwt: jwt,
          closedPaymentMandate,
        },
      },
      { nowSeconds: 1_779_840_001 },
    )

    expect(result.valid).toBe(false)
    expect(result.ap2.paymentReceipt?.jwt?.verified).toBe(false)
    expect(result.errors).toContain('ap2_payment_receipt_jwt_invalid')
  })

  it('rejects expired AP2 receipt JWTs', async () => {
    const issuer = 'https://pisp.example'
    const closedPaymentMandate = '{"transaction_id":"tx_expired"}'
    const reference = hashAscii(closedPaymentMandate)
    const { jwt, publicJwk } = await signedReceiptJwt({
      issuer,
      kid: 'receipt-key-expired',
      expirationTime: 1_779_839_000,
      payload: {
        status: 'Success',
        iss: issuer,
        iat: 1_779_838_000,
        reference,
        payment_id: 'pay_expired',
      },
    })

    const result = await verifyAp2ViEvidenceAsync(
      {
        receiptJwtIssuers: [{ issuer, jwks: { keys: [publicJwk] } }],
        ap2: {
          paymentReceiptJwt: jwt,
          closedPaymentMandate,
        },
      },
      { nowSeconds: 1_779_840_001, clockSkewSeconds: 0 },
    )

    expect(result.valid).toBe(false)
    expect(result.ap2.paymentReceipt?.jwt?.verified).toBe(false)
    expect(result.errors).toContain('ap2_payment_receipt_jwt_invalid')
  })

  it('rejects AP2 receipt JWTs after payload tampering', async () => {
    const issuer = 'https://pisp.example'
    const closedPaymentMandate = '{"transaction_id":"tx_tampered"}'
    const reference = hashAscii(closedPaymentMandate)
    const { jwt, publicJwk } = await signedReceiptJwt({
      issuer,
      kid: 'receipt-key-tampered',
      payload: {
        status: 'Success',
        iss: issuer,
        iat: 1_779_840_000,
        reference,
        payment_id: 'pay_tampered',
      },
    })

    const result = await verifyAp2ViEvidenceAsync(
      {
        receiptJwtIssuers: [{ issuer, jwks: { keys: [publicJwk] } }],
        ap2: {
          paymentReceiptJwt: tamperJwtPayload(jwt, { payment_id: 'pay_tampered_other' }),
          closedPaymentMandate,
        },
      },
      { nowSeconds: 1_779_840_001 },
    )

    expect(result.valid).toBe(false)
    expect(result.ap2.paymentReceipt?.jwt?.verified).toBe(false)
    expect(result.errors).toContain('ap2_payment_receipt_jwt_invalid')
  })

  it('treats receipt JWT failure as advisory when best-effort has decoded receipt evidence', async () => {
    const issuer = 'https://pisp.example'
    const closedPaymentMandate = '{"transaction_id":"tx_best_effort"}'
    const reference = hashAscii(closedPaymentMandate)
    const paymentReceipt = {
      status: 'Success',
      iss: issuer,
      iat: 1_779_840_000,
      reference,
      payment_id: 'pay_best_effort',
    }
    const { jwt } = await signedReceiptJwt({
      issuer,
      kid: 'receipt-key-best-effort',
      payload: paymentReceipt,
    })
    const { publicJwk: wrongPublicJwk } = await signedReceiptJwt({
      issuer,
      kid: 'receipt-key-best-effort',
      payload: paymentReceipt,
    })

    const result = await verifyAp2ViEvidenceAsync(
      {
        receiptJwtIssuers: [{ issuer, jwks: { keys: [wrongPublicJwk] } }],
        ap2: {
          paymentReceipt,
          paymentReceiptJwt: jwt,
          closedPaymentMandate,
        },
      },
      { nowSeconds: 1_779_840_001, receiptJwtPolicy: 'best-effort' },
    )

    expect(result.valid).toBe(true)
    expect(result.transactionAccepted).toBe(true)
    expect(result.ap2.paymentReceipt?.jwt?.verified).toBe(false)
    expect(result.warnings).toContain('ap2_payment_receipt_jwt_invalid')
    expect(result.errors).not.toContain('ap2_payment_receipt_jwt_invalid')
  })
})

describe('evaluateAp2ViConstraints', () => {
  const merchant = {
    id: 'merchant_1',
    name: 'Demo Merchant',
    website: 'https://demo-merchant.example',
  }
  const pisp = {
    legal_name: 'Example PISP LLC',
    brand_name: 'Example PISP',
    domain_name: 'pisp.example',
  }
  const paymentInstrument = {
    id: 'card_4242',
    type: 'card',
    description: 'Card ending in 4242',
  }
  const checkoutPayload = {
    order_id: 'order_1',
    merchant,
    line_items: [
      {
        id: 'line_1',
        product: { id: 'sku_gold_shoe', title: 'Gold Shoe' },
        quantity: 1,
      },
    ],
    total_price: 199.0,
    currency: 'USD',
  }
  const closedPaymentMandate = {
    vct: 'mandate.payment.1',
    transaction_id: 'checkout_hash',
    payee: merchant,
    pisp,
    payment_amount: { amount: 19900, currency: 'USD' },
    payment_instrument: paymentInstrument,
    execution_date: '2026-05-28T12:00:00Z',
  }

  it('passes AP2 autonomous checkout and payment constraints with disclosed references', () => {
    const result = evaluateAp2ViConstraints(
      constraintFixture.input as Ap2MandateConstraintInput,
      new Map(Object.entries(constraintFixture.disclosures)),
    )

    expect(result.status).toBe(constraintFixture.expected.status)
    expect(result.checks).toHaveLength(constraintFixture.expected.checkCount)
    expect(result.checks.every((check) => check.status === 'passed')).toBe(true)
  })

  it('treats non-integer AP2 payment amounts as unresolved evidence', () => {
    const result = evaluateAp2ViConstraints({
      openPaymentMandates: [
        {
          vct: 'mandate.payment.open.1',
          constraints: [{ type: 'payment.amount_range', currency: 'USD', min: 0, max: 20000 }],
        },
      ],
      closedPaymentMandates: [
        { ...closedPaymentMandate, payment_amount: { amount: 199.5, currency: 'USD' } },
      ],
    })

    expect(result.status).toBe('unresolved')
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        type: 'payment.amount_range',
        status: 'unresolved',
        reason: 'payment_amount',
      }),
    )
  })

  it('passes official VI reference constraints with cart item SKUs and payment reference', () => {
    const result = evaluateAp2ViConstraints({
      openCheckoutMandates: [
        {
          vct: 'mandate.checkout.open.1',
          constraints: [
            { type: 'mandate.checkout.allowed_merchants', allowed: [merchant] },
            {
              type: 'mandate.checkout.line_items',
              items: [
                {
                  id: 'line-item-1',
                  acceptable_items: [{ id: 'sku_gold_shoe', title: 'Gold Shoe' }],
                  quantity: 1,
                },
              ],
            },
          ],
        },
      ],
      openCheckoutMandateDigests: ['open_checkout_disclosure_hash'],
      openPaymentMandates: [
        {
          vct: 'mandate.payment.open.1',
          constraints: [
            { type: 'mandate.payment.amount_range', currency: 'USD', min: 0, max: 20000 },
            { type: 'mandate.payment.allowed_payees', allowed: [merchant] },
            {
              type: 'mandate.payment.reference',
              conditional_transaction_id: 'open_checkout_disclosure_hash',
            },
          ],
        },
      ],
      closedPaymentMandates: [closedPaymentMandate],
      closedCheckoutMandates: [{ vct: 'mandate.checkout.1', checkout_hash: 'checkout_hash' }],
      checkoutPaymentBindingOk: true,
      checkoutPayload: {
        iss: merchant.website,
        cart: {
          items: [{ sku: 'sku_gold_shoe', quantity: 1 }],
        },
      },
    })

    expect(result.status).toBe('passed')
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'mandate.checkout.line_items', status: 'passed' }),
        expect.objectContaining({ type: 'mandate.payment.reference', status: 'passed' }),
      ]),
    )
  })

  it('fails deterministic AP2 constraints when receipt evidence exceeds mandate bounds', () => {
    const result = evaluateAp2ViConstraints({
      openCheckoutMandates: [
        {
          vct: 'mandate.checkout.open.1',
          constraints: [
            {
              type: 'checkout.allowed_merchants',
              allowed: [{ id: 'merchant_other', name: 'Other Merchant' }],
            },
            {
              type: 'checkout.line_items',
              items: [
                {
                  id: 'req_1',
                  acceptable_items: [{ id: 'sku_blue_shoe', title: 'Blue Shoe' }],
                  quantity: 1,
                },
              ],
            },
          ],
        },
      ],
      openPaymentMandates: [
        {
          vct: 'mandate.payment.open.1',
          constraints: [
            { type: 'payment.amount_range', currency: 'USD', min: 0, max: 10000 },
            { type: 'payment.allowed_payees', allowed: [{ id: 'merchant_other' }] },
          ],
        },
      ],
      closedPaymentMandates: [closedPaymentMandate],
      checkoutPayload,
    })

    expect(result.status).toBe('failed')
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'checkout.allowed_merchants', status: 'failed' }),
        expect.objectContaining({ type: 'checkout.line_items', status: 'failed' }),
        expect.objectContaining({ type: 'payment.amount_range', status: 'failed' }),
        expect.objectContaining({ type: 'payment.allowed_payees', status: 'failed' }),
      ]),
    )
  })
})
