// SPDX-License-Identifier: Apache-2.0

import { createECDH, createHash, createPrivateKey, sign } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const inputUrl = new URL(
  '../../agent/test/fixtures/ap2/vi_autonomous_success_evidence.json',
  import.meta.url,
)
const output = new URL('../test/fixtures/ap2-local-chain/', import.meta.url)
const input = await readFile(inputUrl)
const evidence = JSON.parse(input)
const receiptJwtIssuers = []
const result = { status: 'success', source: 'atrib local AP2 / VI chain fixture' }
const order = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551')

for (const kind of ['payment', 'checkout']) {
  const digest = createHash('sha256').update(`atrib-local-chain-receipt:${kind}`).digest('hex')
  const scalar = (BigInt(`0x${digest}`) % (order - 1n)) + 1n
  const privateBytes = Buffer.from(scalar.toString(16).padStart(64, '0'), 'hex')
  const ecdh = createECDH('prime256v1')
  ecdh.setPrivateKey(privateBytes)
  const point = ecdh.getPublicKey()
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    alg: 'ES256',
    kid: `atrib-local-${kind}-receipt`,
    x: point.subarray(1, 33).toString('base64url'),
    y: point.subarray(33).toString('base64url'),
  }
  const payload = evidence.ap2[`${kind}Receipt`]
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const parts = [encode({ alg: 'ES256', typ: 'JWT', kid: jwk.kid }), encode(payload)]
  const signature = sign('sha256', Buffer.from(parts.join('.')), {
    key: createPrivateKey({
      key: { ...jwk, d: privateBytes.toString('base64url') },
      format: 'jwk',
    }),
    dsaEncoding: 'ieee-p1363',
  })
  parts.push(signature.toString('base64url'))
  evidence.ap2[`${kind}ReceiptJwtParts`] = parts
  delete evidence.ap2[`${kind}Receipt`]
  result[`${kind}_receipt_jwt_parts`] = parts
  receiptJwtIssuers.push({ issuer: payload.iss, jwks: { keys: [jwk] } })
}
evidence.receiptJwtIssuers = receiptJwtIssuers

function splitSdJwt(value) {
  const parts = value.split('~')
  const trailingTilde = parts.at(-1) === ''
  if (trailingTilde) parts.pop()
  return { jwt: parts.shift().split('.'), disclosures: parts, trailingTilde }
}
for (const credential of evidence.vi.credentials) {
  credential.sdJwtParts = splitSdJwt(credential.sdJwt)
  delete credential.sdJwt
  if (credential.parentPresentation) {
    credential.parentPresentationParts = splitSdJwt(credential.parentPresentation)
    delete credential.parentPresentation
  }
}

await mkdir(output, { recursive: true })
for (const [name, body] of Object.entries({
  evidence,
  result,
  metadata: {
    source: 'atrib local fixture; not an upstream capture or live payment',
    vi_source: 'packages/agent/test/fixtures/ap2/vi_autonomous_success_evidence.json',
    vi_source_sha256: createHash('sha256').update(input).digest('hex'),
    now_seconds: 1779840000,
    receipt_signing: 'local P-256 test keys; ES256 signatures are freshly generated',
    note: 'Regenerating receipt signatures changes the chain snapshot. Preserve upstream negative fixtures unchanged.',
  },
})) {
  await writeFile(
    new URL(`ap2-local-chain-${name}.json`, output),
    `${JSON.stringify(body, null, 2)}\n`,
  )
}
process.stdout.write('Generated local AP2 / VI positive chain fixtures\n')
