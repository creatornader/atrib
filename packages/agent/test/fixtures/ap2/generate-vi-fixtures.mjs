// SPDX-License-Identifier: Apache-2.0

import { Buffer } from 'node:buffer'
import { createECDH, createHash, createPrivateKey, sign as signEcdsa } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { format } from 'prettier'

const fixtureDir = dirname(fileURLToPath(import.meta.url))
const nowSeconds = 1_779_840_000
const expiresSeconds = 1_900_000_000

const p256Order = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551')

function publicJwk(key) {
  const { d: _d, ...publicKey } = key
  return publicKey
}

function base64url(value) {
  return Buffer.from(value).toString('base64url')
}

function base64urlBuffer(value) {
  return Buffer.from(value).toString('base64url')
}

function keyFromSeed(kid, seed) {
  const digest = createHash('sha256').update(`atrib-ap2-vi-fixture:${seed}`).digest('hex')
  const scalar = (BigInt(`0x${digest}`) % (p256Order - 1n)) + 1n
  const privateBytes = Buffer.from(scalar.toString(16).padStart(64, '0'), 'hex')
  const ecdh = createECDH('prime256v1')
  ecdh.setPrivateKey(privateBytes)
  const publicBytes = ecdh.getPublicKey()

  return {
    kty: 'EC',
    crv: 'P-256',
    x: base64urlBuffer(publicBytes.subarray(1, 33)),
    y: base64urlBuffer(publicBytes.subarray(33, 65)),
    d: base64urlBuffer(privateBytes),
    kid,
    alg: 'ES256',
  }
}

const keys = {
  issuer: keyFromSeed('iss-fixture-1', 'issuer'),
  user: keyFromSeed('usr-fixture-1', 'user'),
  agent: keyFromSeed('agt-fixture-1', 'agent'),
}

const immediateKeys = {
  issuer: keyFromSeed('iss-1', 'immediate-issuer-2026-07'),
  user: keyFromSeed('usr-1', 'immediate-user-2026-07'),
}

function jsonBase64url(value) {
  return base64url(JSON.stringify(value))
}

function hashAscii(value) {
  return createHash('sha256').update(value, 'ascii').digest('base64url')
}

function signJwt(payload, key, typ) {
  const header = { alg: 'ES256', typ, kid: key.kid }
  const signingInput = `${jsonBase64url(header)}.${jsonBase64url(payload)}`
  const privateKey = createPrivateKey({ key, format: 'jwk' })
  const signature = signEcdsa('sha256', Buffer.from(signingInput, 'ascii'), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  })
  return `${signingInput}.${signature.toString('base64url')}`
}

function disclosure(salt, value) {
  const encoded = jsonBase64url([salt, value])
  return { encoded, digest: hashAscii(encoded), value }
}

async function writeJson(filename, value) {
  await writeFile(
    join(fixtureDir, filename),
    await format(JSON.stringify(value), { parser: 'json' }),
  )
}

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
  order_id: 'order_autonomous_1',
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

const checkoutJwt = 'checkout.jwt.fixture.autonomous.success'
const checkoutHash = hashAscii(checkoutJwt)

const openCheckoutMandate = {
  vct: 'mandate.checkout.open.1',
  cnf: { jwk: publicJwk(keys.agent) },
  constraints: [
    {
      type: 'checkout.allowed_merchants',
      allowed: [merchant],
    },
    {
      type: 'checkout.line_items',
      items: [
        {
          id: 'req_gold_shoe',
          acceptable_items: [{ id: 'sku_gold_shoe', title: 'Gold Shoe' }],
          quantity: 1,
        },
      ],
    },
  ],
}

const openPaymentMandate = {
  vct: 'mandate.payment.open.1',
  cnf: { jwk: publicJwk(keys.agent) },
  constraints: [
    { type: 'payment.amount_range', currency: 'USD', min: 0, max: 20000 },
    { type: 'payment.allowed_payees', allowed: [merchant] },
    { type: 'payment.allowed_payment_instruments', allowed: [paymentInstrument] },
    { type: 'payment.allowed_pisps', allowed: [pisp] },
    {
      type: 'payment.execution_date',
      not_before: '2026-05-01T00:00:00Z',
      not_after: '2026-06-01T00:00:00Z',
    },
  ],
}

const closedCheckoutMandate = {
  vct: 'mandate.checkout.1',
  checkout_jwt: checkoutJwt,
  checkout_hash: checkoutHash,
  checkout_payload: checkoutPayload,
}

const closedPaymentMandate = {
  vct: 'mandate.payment.1',
  transaction_id: checkoutHash,
  payee: merchant,
  pisp,
  payment_amount: { amount: 19900, currency: 'USD' },
  payment_instrument: paymentInstrument,
  execution_date: '2026-05-28T12:00:00Z',
}

const openCheckoutDisclosure = disclosure('open-checkout', openCheckoutMandate)
const openPaymentDisclosure = disclosure('open-payment', openPaymentMandate)

const l1 = signJwt(
  {
    iss: 'fixture-issuer',
    sub: 'fixture-user',
    iat: nowSeconds,
    exp: expiresSeconds,
    vct: 'credential.provider.1',
    cnf: { jwk: publicJwk(keys.user) },
  },
  keys.issuer,
  'sd+jwt',
)

const l2 = signJwt(
  {
    nonce: 'autonomous-fixture',
    aud: 'fixture-agent-network',
    iat: nowSeconds + 10,
    exp: expiresSeconds,
    sd_hash: hashAscii(l1),
    _sd_alg: 'sha-256',
    // SD-JWT digest uniqueness: each disclosure digest appears exactly once
    // in the payload (enforced by @sd-jwt/core >= 0.20.0), so the mandate
    // digests live only in the delegate_payload array-element refs.
    delegate_payload: [
      { '...': openCheckoutDisclosure.digest },
      { '...': openPaymentDisclosure.digest },
    ],
  },
  keys.user,
  'kb-sd-jwt+kb',
)

const l2Presentation = `${l2}~${openCheckoutDisclosure.encoded}~${openPaymentDisclosure.encoded}~`

const closedCheckoutDisclosure = disclosure('closed-checkout', closedCheckoutMandate)
const closedPaymentDisclosure = disclosure('closed-payment', closedPaymentMandate)

const l3Checkout = signJwt(
  {
    nonce: 'autonomous-checkout-fixture',
    aud: 'fixture-merchant',
    iat: nowSeconds + 20,
    exp: expiresSeconds,
    sd_hash: hashAscii(l2Presentation),
    _sd_alg: 'sha-256',
    delegate_payload: [{ '...': closedCheckoutDisclosure.digest }],
  },
  keys.agent,
  'kb-sd-jwt',
)

const l3Payment = signJwt(
  {
    nonce: 'autonomous-payment-fixture',
    aud: 'fixture-pisp',
    iat: nowSeconds + 20,
    exp: expiresSeconds,
    sd_hash: hashAscii(l2Presentation),
    _sd_alg: 'sha-256',
    delegate_payload: [{ '...': closedPaymentDisclosure.digest }],
  },
  keys.agent,
  'kb-sd-jwt',
)

await writeJson('vi_autonomous_success_evidence.json', {
  trustedIssuerKeys: [publicJwk(keys.issuer)],
  ap2: {
    paymentReceipt: {
      status: 'Success',
      iss: 'fixture-pisp',
      iat: nowSeconds + 30,
      reference: hashAscii(closedPaymentDisclosure.encoded),
      payment_id: 'pay_autonomous_1',
      psp_confirmation_id: 'psp_autonomous_1',
      network_confirmation_id: 'net_autonomous_1',
    },
    checkoutReceipt: {
      status: 'Success',
      iss: 'fixture-merchant',
      iat: nowSeconds + 30,
      reference: hashAscii(closedCheckoutDisclosure.encoded),
      order_id: checkoutPayload.order_id,
    },
    closedPaymentMandate: closedPaymentDisclosure.encoded,
    closedCheckoutMandate: closedCheckoutDisclosure.encoded,
    checkoutPayload,
  },
  vi: {
    credentials: [
      { layer: 'L1', sdJwt: l1 },
      { layer: 'L2', sdJwt: l2Presentation },
      {
        layer: 'L3_CHECKOUT',
        sdJwt: `${l3Checkout}~${closedCheckoutDisclosure.encoded}~`,
        parentPresentation: l2Presentation,
      },
      {
        layer: 'L3_PAYMENT',
        sdJwt: `${l3Payment}~${closedPaymentDisclosure.encoded}~`,
        parentPresentation: l2Presentation,
      },
    ],
  },
})

await writeJson('vi_autonomous_negative_matrix.json', {
  description:
    'Negative AP2 autonomous VI evidence cases applied to vi_autonomous_success_evidence.json.',
  source: 'Synthetic AP2 v0.2 and Verifiable Intent verifier corpus.',
  base: 'vi_autonomous_success_evidence.json',
  nowSeconds,
  cases: [
    {
      name: 'tampered_l2_signature',
      mutation: { type: 'tamper_payload', layer: 'L2', patch: { nonce: 'tampered' } },
      expectedErrors: ['vi_signature_invalid'],
    },
    {
      name: 'tampered_l3_signature',
      mutation: { type: 'tamper_payload', layer: 'L3_PAYMENT', patch: { nonce: 'tampered' } },
      expectedErrors: ['vi_signature_invalid'],
    },
    {
      name: 'disclosure_digest_mismatch',
      mutation: {
        type: 'tamper_disclosure',
        layer: 'L2',
        disclosureIndex: 0,
        patch: { constraints: [] },
      },
      expectedErrors: ['vi_disclosure_digest_mismatch'],
    },
    {
      name: 'sd_hash_mismatch',
      mutation: { type: 'tamper_payload', layer: 'L3_CHECKOUT', patch: { sd_hash: 'bad_hash' } },
      expectedErrors: ['vi_sd_hash_mismatch'],
    },
    {
      name: 'wrong_l3_agent_key',
      mutation: { type: 'tamper_header', layer: 'L3_PAYMENT', patch: { kid: 'agt-fixture-2' } },
      expectedErrors: ['vi_signature_key_missing'],
    },
    {
      name: 'wrong_checkout_hash',
      mutation: {
        type: 'tamper_disclosure',
        layer: 'L3_CHECKOUT',
        disclosureIndex: 0,
        patch: { checkout_hash: 'wrong_checkout_hash' },
      },
      expectedErrors: ['vi_checkout_hash_mismatch'],
    },
    {
      name: 'wrong_transaction_id',
      mutation: {
        type: 'tamper_disclosure',
        layer: 'L3_PAYMENT',
        disclosureIndex: 0,
        patch: { transaction_id: 'wrong_transaction_id' },
      },
      expectedErrors: ['vi_checkout_payment_binding_mismatch'],
    },
    {
      name: 'wrong_receipt_reference',
      mutation: {
        type: 'patch_receipt_reference',
        receipt: 'payment',
        reference: 'wrong_reference',
      },
      expectedErrors: ['ap2_payment_receipt_reference_mismatch'],
    },
    {
      name: 'expired_credential',
      mutation: { type: 'tamper_payload', layer: 'L2', patch: { exp: 1 } },
      expectedErrors: ['vi_credential_expired'],
    },
    {
      name: 'missing_issuer_key',
      mutation: { type: 'remove_trusted_issuer_keys' },
      expectedErrors: ['vi_signature_key_missing'],
    },
  ],
})

// ── vi_immediate_evidence.json ────────────────────────────────────────
// Regenerated here 2026-07-15 (originally hand-signed in PR #145, keys not
// recoverable). Every literal value matches the original fixture; only the
// signing keys rotated to deterministic seeds and the L2 payload dropped
// its duplicate `_sd` digest listing: SD-JWT digest uniqueness (enforced by
// @sd-jwt/core >= 0.20.0) allows each disclosure digest exactly once, so
// the mandate digests live only in the delegate_payload array-element refs.
// Disclosures are byte-identical to the original, so the receipt
// references and closed-mandate encodings are reproduced verbatim.

const immCheckoutDisclosure = disclosure('c', {
  vct: 'mandate.checkout.1',
  checkout_jwt: 'checkout.jwt.sig',
  checkout_hash: 'sC6pCJS01hDsD4kcqTFzpYUr-gc9f4K8k7SM6ho9BCY',
})
const immPaymentDisclosure = disclosure('p', {
  vct: 'mandate.payment.1',
  payment_amount: { currency: 'USD', amount: 123 },
  payee: { name: 'M' },
  transaction_id: 'sC6pCJS01hDsD4kcqTFzpYUr-gc9f4K8k7SM6ho9BCY',
})

const immL1 = signJwt(
  {
    iss: 'iss',
    sub: 'u',
    iat: 1,
    exp: 9_999_999_999,
    vct: 'credential.provider.1',
    cnf: { jwk: publicJwk(immediateKeys.user) },
  },
  immediateKeys.issuer,
  'sd+jwt',
)

const immL2 = signJwt(
  {
    nonce: 'n',
    aud: 'net',
    iat: 2,
    exp: 9_999_999_999,
    sd_hash: hashAscii(immL1),
    _sd_alg: 'sha-256',
    delegate_payload: [
      { '...': immCheckoutDisclosure.digest },
      { '...': immPaymentDisclosure.digest },
    ],
  },
  immediateKeys.user,
  'kb-sd-jwt',
)

await writeJson('vi_immediate_evidence.json', {
  trustedIssuerKeys: [publicJwk(immediateKeys.issuer)],
  ap2: {
    paymentReceipt: {
      status: 'Success',
      iss: 'pisp',
      iat: 3,
      reference: immPaymentDisclosure.digest,
      payment_id: 'pay',
      psp_confirmation_id: 'psp',
      network_confirmation_id: 'net',
    },
    checkoutReceipt: {
      status: 'Success',
      iss: 'm',
      iat: 3,
      reference: immCheckoutDisclosure.digest,
      order_id: 'ord',
    },
    closedPaymentMandate: immPaymentDisclosure.encoded,
    closedCheckoutMandate: immCheckoutDisclosure.encoded,
  },
  vi: {
    credentials: [
      { layer: 'L1', sdJwt: immL1 },
      { layer: 'L2', sdJwt: `${immL2}~${immCheckoutDisclosure.encoded}~${immPaymentDisclosure.encoded}~` },
    ],
  },
})
