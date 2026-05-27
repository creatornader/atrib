import { describe, expect, it } from 'vitest'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { base64urlDecode, base64urlEncode, sha256 } from '@atrib/mcp'
import { verifyAp2ViEvidence, verifyAp2ViEvidenceAsync } from '../src/ap2-vi-evidence.js'

import immediateFixture from '../../agent/test/fixtures/ap2/vi_immediate_evidence.json'
import splitAgentFixture from '../../agent/test/fixtures/ap2/vi_autonomous_split_agent_evidence.json'

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

describe('verifyAp2ViEvidence', () => {
  it('verifies signed VI immediate evidence with matching AP2 receipts', () => {
    const result = verifyAp2ViEvidence(immediateFixture)

    expect(result.valid).toBe(true)
    expect(result.transactionAccepted).toBe(true)
    expect(result.ap2.paymentReceipt?.referenceOk).toBe(true)
    expect(result.ap2.checkoutReceipt?.referenceOk).toBe(true)
    expect(result.vi.mode).toBe('immediate')
    expect(result.vi.checkoutPaymentBindingOk).toBe(true)
    expect(
      result.vi.credentials.every((credential) => credential.signature.status === 'verified'),
    ).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('rejects autonomous VI evidence when checkout and payment mandates bind different agent keys', () => {
    const result = verifyAp2ViEvidence(splitAgentFixture)

    expect(result.valid).toBe(false)
    expect(result.vi.mode).toBe('autonomous')
    expect(result.vi.delegationOk).toBe(false)
    expect(result.errors).toContain('vi_l2_cnf_mismatch')
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
