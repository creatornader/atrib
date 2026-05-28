// SPDX-License-Identifier: Apache-2.0

import canonicalize from 'canonicalize'
import { createPublicKey, verify as verifyEcdsa } from 'node:crypto'
import { base64urlDecode, base64urlEncode, sha256 } from '@atrib/mcp'
import { SDJwtInstance } from '@sd-jwt/core'
import { SDJwtVcInstance } from '@sd-jwt/sd-jwt-vc'
import type {
  SDJWTVCConfig,
  StatusListFetcher,
  StatusValidator,
  VcTFetcher,
} from '@sd-jwt/sd-jwt-vc'
import {
  createLocalJWKSet,
  createRemoteJWKSet,
  customFetch,
  decodeJwt,
  decodeProtectedHeader,
  jwtVerify,
} from 'jose'
import type { JWK, JSONWebKeySet, JWTVerifyGetKey, JWTVerifyOptions } from 'jose'

export type ViCredentialLayer = 'L1' | 'L2' | 'L3_PAYMENT' | 'L3_CHECKOUT'
export type ViMode = 'immediate' | 'autonomous' | 'unknown'
export type SdJwtConformancePolicy = 'require' | 'best-effort' | 'off'
export type SdJwtConformanceProfile = 'sd-jwt' | 'sd-jwt-vc'

export interface ViCredentialInput {
  layer: ViCredentialLayer
  sdJwt: string
  parentPresentation?: string
}

export interface Ap2EvidenceInput {
  paymentReceipt?: unknown
  checkoutReceipt?: unknown
  paymentReceiptJwt?: string
  checkoutReceiptJwt?: string
  closedPaymentMandate?: string
  closedCheckoutMandate?: string
  closedPaymentMandateHash?: string
  closedCheckoutMandateHash?: string
}

export interface Ap2ReceiptJwtIssuer {
  issuer?: string
  audience?: string | string[]
  jwks?: JsonWebKey[] | { keys: JsonWebKey[] }
  jwksUrl?: string
  metadataUrl?: string
}

export interface SdJwtVcConformanceOptions {
  loadTypeMetadata?: boolean
  vctFetcher?: VcTFetcher
  statusListFetcher?: StatusListFetcher
  statusValidator?: StatusValidator
  maxVctExtendsDepth?: number
}

export interface Ap2ViEvidenceBundle {
  ap2?: Ap2EvidenceInput
  vi?: {
    credentials?: ViCredentialInput[]
  }
  trustedIssuerKeys?: JsonWebKey[]
  receiptJwtIssuers?: Ap2ReceiptJwtIssuer[]
}

export interface VerifyAp2ViEvidenceOptions {
  trustedIssuerKeys?: JsonWebKey[]
  receiptJwtIssuers?: Ap2ReceiptJwtIssuer[]
  receiptJwtPolicy?: 'require' | 'best-effort'
  signaturePolicy?: 'require' | 'best-effort'
  sdJwtConformancePolicy?: SdJwtConformancePolicy
  sdJwtConformanceProfile?: SdJwtConformanceProfile
  sdJwtVc?: SdJwtVcConformanceOptions
  nowSeconds?: number
  clockSkewSeconds?: number
  fetch?: typeof fetch
}

export interface SignatureCheck {
  status: 'verified' | 'invalid' | 'not_checked'
  reason?: string
}

export interface SdJwtConformanceCheck {
  status: 'verified' | 'invalid' | 'not_checked'
  profile: SdJwtConformanceProfile | null
  reason?: string
}

export interface ViCredentialCheck {
  layer: ViCredentialLayer
  alg: string | null
  typ: string | null
  kid: string | null
  signature: SignatureCheck
  sdJwtConformance: SdJwtConformanceCheck
  sdHashOk: boolean | null
  disclosuresOk: boolean | null
  mandateVcts: string[]
}

export interface Ap2ReceiptCheck {
  present: boolean
  status: string | null
  success: boolean
  reference: string | null
  referenceOk: boolean | null
  missingFields: string[]
  jwt?: Ap2ReceiptJwtCheck
}

export interface Ap2ReceiptJwtCheck {
  present: boolean
  verified: boolean
  issuer: string | null
  kid: string | null
  alg: string | null
  jwksSource: 'static' | 'jwks_url' | 'metadata' | null
  error?: string
}

export interface Ap2EvidenceCheck {
  paymentReceipt?: Ap2ReceiptCheck
  checkoutReceipt?: Ap2ReceiptCheck
}

export interface ViEvidenceCheck {
  mode: ViMode
  credentials: ViCredentialCheck[]
  delegationOk: boolean | null
  checkoutPaymentBindingOk: boolean | null
}

export interface Ap2ViEvidenceVerification {
  valid: boolean
  transactionAccepted: boolean
  ap2: Ap2EvidenceCheck
  vi: ViEvidenceCheck
  errors: string[]
  warnings: string[]
}

interface JsonRecord {
  [key: string]: unknown
}

interface Disclosure {
  encoded: string
  digest: string
  value: unknown
}

interface ParsedCredential {
  input: ViCredentialInput
  jwt: string
  header: JsonRecord
  payload: JsonRecord
  signingInput: string
  signature: Uint8Array
  disclosures: Disclosure[]
  mandateValues: JsonRecord[]
}

type ReceiptKind = 'payment' | 'checkout'

interface ReceiptJwtVerification {
  check: Ap2ReceiptJwtCheck
  payload?: JsonRecord
  errors: string[]
  warnings: string[]
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isJsonWebKeySet(value: unknown): value is { keys: JsonWebKey[] } {
  return (
    isRecord(value) && Array.isArray(value['keys']) && value['keys'].every((key) => isRecord(key))
  )
}

function hashAscii(value: string): string {
  return base64urlEncode(sha256(textEncoder.encode(value)))
}

function decodeBase64urlJson(value: string): unknown {
  return JSON.parse(textDecoder.decode(base64urlDecode(value)))
}

function signatureCheck(status: SignatureCheck['status'], reason?: string): SignatureCheck {
  return reason === undefined ? { status } : { status, reason }
}

function sdJwtConformanceCheck(
  status: SdJwtConformanceCheck['status'],
  profile: SdJwtConformanceProfile | null,
  reason?: string,
): SdJwtConformanceCheck {
  return reason === undefined ? { status, profile } : { status, profile, reason }
}

function collectDelegatePayloadDigests(payload: JsonRecord): Set<string> {
  const digests = new Set<string>()
  const delegatePayload = payload['delegate_payload']
  if (!Array.isArray(delegatePayload)) return digests

  for (const item of delegatePayload) {
    if (isRecord(item) && isString(item['...'])) {
      digests.add(item['...'])
    }
  }
  return digests
}

function disclosureValue(decoded: unknown): unknown {
  if (!Array.isArray(decoded)) return undefined
  if (decoded.length === 2) return decoded[1]
  if (decoded.length >= 3) return decoded[2]
  return undefined
}

function parseCredential(input: ViCredentialInput): ParsedCredential {
  const [jwt, ...rawDisclosures] = input.sdJwt.split('~')
  if (!jwt) throw new Error('vi_jwt_malformed')

  const parts = jwt.split('.')
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new Error('vi_jwt_malformed')
  }

  const header = decodeBase64urlJson(parts[0])
  const payload = decodeBase64urlJson(parts[1])
  if (!isRecord(header) || !isRecord(payload)) throw new Error('vi_jwt_malformed')

  const disclosures = rawDisclosures
    .filter((value) => value.length > 0)
    .map((encoded) => {
      const value = disclosureValue(decodeBase64urlJson(encoded))
      return { encoded, digest: hashAscii(encoded), value }
    })
  const mandateValues = disclosures.flatMap((disclosure) =>
    isRecord(disclosure.value) && isString(disclosure.value['vct']) ? [disclosure.value] : [],
  )

  return {
    input,
    jwt,
    header,
    payload,
    signingInput: `${parts[0]}.${parts[1]}`,
    signature: base64urlDecode(parts[2]),
    disclosures,
    mandateValues,
  }
}

function getKid(jwk: JsonWebKey | JsonRecord | undefined): string | null {
  const kid = jwk ? (jwk as JsonRecord)['kid'] : undefined
  return isString(kid) ? kid : null
}

function getCnfJwk(record: JsonRecord | undefined): JsonWebKey | undefined {
  const cnf = record?.['cnf']
  if (!isRecord(cnf)) return undefined
  const jwk = cnf['jwk']
  return isRecord(jwk) ? (jwk as JsonWebKey) : undefined
}

function canonicalJson(value: unknown): string | null {
  const canonical = canonicalize(value)
  return typeof canonical === 'string' ? canonical : null
}

function sameJson(left: unknown, right: unknown): boolean {
  const leftCanonical = canonicalJson(left)
  const rightCanonical = canonicalJson(right)
  return leftCanonical !== null && leftCanonical === rightCanonical
}

function normalizeJwks(value: JsonWebKey[] | { keys: JsonWebKey[] }): JSONWebKeySet {
  const keys = Array.isArray(value) ? value : value.keys
  return { keys: keys as JWK[] }
}

function verifyEs256Signature(data: string, signature: Uint8Array, publicJwk: JsonWebKey): boolean {
  const key = createPublicKey({ key: publicJwk, format: 'jwk' })
  return verifyEcdsa(
    'sha256',
    Buffer.from(data, 'ascii'),
    { key, dsaEncoding: 'ieee-p1363' },
    Buffer.from(signature),
  )
}

function verifyJwtSignature(parsed: ParsedCredential, publicJwk: JsonWebKey): boolean {
  return verifyEs256Signature(parsed.signingInput, parsed.signature, publicJwk)
}

function findIssuerKey(kid: string | null, keys: JsonWebKey[]): JsonWebKey | undefined {
  if (kid === null) return keys[0]
  return keys.find((key) => getKid(key) === kid)
}

function receiptJwtError(kind: ReceiptKind, code: string): string {
  return `ap2_${kind}_receipt_jwt_${code}`
}

function addReceiptJwtFailure(
  verification: ReceiptJwtVerification,
  kind: ReceiptKind,
  code: string,
  policy: 'require' | 'best-effort',
): void {
  const error = receiptJwtError(kind, code)
  verification.check.error = error
  if (policy === 'require') verification.errors.push(error)
  else verification.warnings.push(error)
}

function findReceiptJwtIssuer(
  issuer: string | null,
  issuers: Ap2ReceiptJwtIssuer[],
): Ap2ReceiptJwtIssuer | undefined {
  if (issuer !== null) {
    const exact = issuers.find((candidate) => candidate.issuer === issuer)
    if (exact) return exact
  }
  return issuers.find((candidate) => candidate.issuer === undefined)
}

async function fetchJson(url: string, fetchImpl: typeof fetch | undefined): Promise<unknown> {
  const fetchFn = fetchImpl ?? globalThis.fetch
  if (typeof fetchFn !== 'function') throw new Error('fetch_unavailable')
  const response = await fetchFn(url)
  if (!response.ok) throw new Error('metadata_fetch_failed')
  return response.json()
}

async function resolveReceiptJwtKey(
  issuer: Ap2ReceiptJwtIssuer,
  fetchImpl: typeof fetch | undefined,
): Promise<{ getKey: JWTVerifyGetKey; source: Ap2ReceiptJwtCheck['jwksSource'] }> {
  const remoteOptions = fetchImpl ? { [customFetch]: fetchImpl } : undefined

  if (issuer.jwks) {
    return {
      getKey: createLocalJWKSet(normalizeJwks(issuer.jwks)),
      source: 'static',
    }
  }

  if (issuer.jwksUrl) {
    return {
      getKey: createRemoteJWKSet(new URL(issuer.jwksUrl), remoteOptions),
      source: 'jwks_url',
    }
  }

  if (issuer.metadataUrl) {
    const metadata = await fetchJson(issuer.metadataUrl, fetchImpl)
    if (!isRecord(metadata)) throw new Error('metadata_invalid')

    const inlineJwks = metadata['jwks']
    if (isJsonWebKeySet(inlineJwks)) {
      return {
        getKey: createLocalJWKSet(normalizeJwks(inlineJwks)),
        source: 'metadata',
      }
    }

    const jwksUri = metadata['jwks_uri']
    if (isString(jwksUri)) {
      return {
        getKey: createRemoteJWKSet(new URL(jwksUri), remoteOptions),
        source: 'metadata',
      }
    }

    throw new Error('metadata_jwks_missing')
  }

  throw new Error('key_source_missing')
}

function expectedTyp(layer: ViCredentialLayer, typ: string | null): boolean {
  if (layer === 'L1') return typ === 'sd+jwt'
  if (layer === 'L2') return typ === 'kb-sd-jwt' || typ === 'kb-sd-jwt+kb'
  return typ === 'kb-sd-jwt'
}

function disclosureDigestsOk(parsed: ParsedCredential): boolean | null {
  if (parsed.disclosures.length === 0) return null

  const sd = parsed.payload['_sd']
  const sdDigests = new Set(Array.isArray(sd) ? sd.filter(isString) : [])
  const delegateDigests = collectDelegatePayloadDigests(parsed.payload)

  return parsed.disclosures.every(
    (disclosure) => sdDigests.has(disclosure.digest) || delegateDigests.has(disclosure.digest),
  )
}

function initialCredentialCheck(parsed: ParsedCredential): ViCredentialCheck {
  const alg = isString(parsed.header['alg']) ? parsed.header['alg'] : null
  const typ = isString(parsed.header['typ']) ? parsed.header['typ'] : null
  const kid = isString(parsed.header['kid']) ? parsed.header['kid'] : null
  return {
    layer: parsed.input.layer,
    alg,
    typ,
    kid,
    signature: signatureCheck('not_checked'),
    sdJwtConformance: sdJwtConformanceCheck('not_checked', null, 'async_required'),
    sdHashOk: null,
    disclosuresOk: disclosureDigestsOk(parsed),
    mandateVcts: parsed.mandateValues.map((mandate) => String(mandate['vct'])),
  }
}

function checkReceipt(
  value: unknown,
  requiredFields: string[],
  expectedReference?: string,
): Ap2ReceiptCheck {
  if (!isRecord(value)) {
    return {
      present: value !== undefined,
      status: null,
      success: false,
      reference: null,
      referenceOk: null,
      missingFields: ['receipt_object'],
    }
  }

  const status = isString(value['status']) ? value['status'] : null
  const reference = isString(value['reference']) ? value['reference'] : null
  const missingFields = requiredFields.filter(
    (field) => !isString(value[field]) && !isNumber(value[field]),
  )
  const success = status === 'Success'
  const referenceOk = expectedReference === undefined ? null : reference === expectedReference

  return {
    present: true,
    status,
    success,
    reference,
    referenceOk,
    missingFields,
  }
}

function emptyJwtReceiptCheck(jwt: Ap2ReceiptJwtCheck): Ap2ReceiptCheck {
  return {
    present: true,
    status: null,
    success: false,
    reference: null,
    referenceOk: null,
    missingFields: ['receipt_object'],
    jwt,
  }
}

async function verifyReceiptJwt(
  kind: ReceiptKind,
  receiptJwt: string,
  issuers: Ap2ReceiptJwtIssuer[],
  policy: 'require' | 'best-effort',
  nowSeconds: number,
  clockSkewSeconds: number,
  fetchImpl: typeof fetch | undefined,
): Promise<ReceiptJwtVerification> {
  const verification: ReceiptJwtVerification = {
    check: {
      present: true,
      verified: false,
      issuer: null,
      kid: null,
      alg: null,
      jwksSource: null,
    },
    errors: [],
    warnings: [],
  }

  try {
    const header = decodeProtectedHeader(receiptJwt)
    const payload = decodeJwt(receiptJwt)
    const issuer = isString(payload.iss) ? payload.iss : null

    verification.check.alg = isString(header.alg) ? header.alg : null
    verification.check.kid = isString(header.kid) ? header.kid : null
    verification.check.issuer = issuer

    if (header.alg !== 'ES256') {
      addReceiptJwtFailure(verification, kind, 'alg_unsupported', policy)
      return verification
    }

    const issuerConfig = findReceiptJwtIssuer(issuer, issuers)
    if (!issuerConfig) {
      addReceiptJwtFailure(verification, kind, 'issuer_untrusted', policy)
      return verification
    }

    const key = await resolveReceiptJwtKey(issuerConfig, fetchImpl)
    verification.check.jwksSource = key.source

    const verifyOptions: JWTVerifyOptions = {
      algorithms: ['ES256'],
      clockTolerance: clockSkewSeconds,
      currentDate: new Date(nowSeconds * 1000),
    }
    if (issuerConfig.audience !== undefined) verifyOptions.audience = issuerConfig.audience
    if (issuerConfig.issuer !== undefined) verifyOptions.issuer = issuerConfig.issuer

    const verified = await jwtVerify(receiptJwt, key.getKey, verifyOptions)

    verification.check.verified = true
    verification.payload = verified.payload as JsonRecord
    return verification
  } catch (error) {
    const code = error instanceof Error && error.message ? error.message : 'invalid'
    addReceiptJwtFailure(
      verification,
      kind,
      code === 'fetch_unavailable' ? 'metadata_fetch_unavailable' : 'invalid',
      policy,
    )
    if (code !== 'invalid' && code !== 'fetch_unavailable') {
      verification.warnings.push(`${receiptJwtError(kind, 'detail')}:${code}`)
    }
    return verification
  }
}

function expectedReceiptReference(serialized?: string, explicitHash?: string): string | undefined {
  if (explicitHash) return explicitHash
  if (serialized) return hashAscii(serialized)
  return undefined
}

function findMandates(parsedCredentials: ParsedCredential[], vct: string): JsonRecord[] {
  return parsedCredentials.flatMap((parsed) =>
    parsed.mandateValues.filter((mandate) => mandate['vct'] === vct),
  )
}

function checkCheckoutHash(mandates: JsonRecord[], errors: string[]): void {
  for (const mandate of mandates) {
    const checkoutJwt = mandate['checkout_jwt']
    const checkoutHash = mandate['checkout_hash']
    if (!isString(checkoutJwt) || !isString(checkoutHash)) continue
    if (hashAscii(checkoutJwt) !== checkoutHash) {
      errors.push('vi_checkout_hash_mismatch')
    }
  }
}

function checkPaymentCheckoutBinding(
  paymentMandates: JsonRecord[],
  checkoutMandates: JsonRecord[],
  errors: string[],
): boolean | null {
  if (paymentMandates.length === 0 || checkoutMandates.length === 0) return null

  const checkoutHashes = new Set(
    checkoutMandates.map((mandate) => mandate['checkout_hash']).filter(isString),
  )
  const ok = paymentMandates.every(
    (mandate) =>
      isString(mandate['transaction_id']) && checkoutHashes.has(mandate['transaction_id']),
  )
  if (!ok) errors.push('vi_checkout_payment_binding_mismatch')
  return ok
}

function checkDelegation(
  openCheckoutMandates: JsonRecord[],
  openPaymentMandates: JsonRecord[],
  errors: string[],
): boolean | null {
  const jwks = [...openCheckoutMandates, ...openPaymentMandates]
    .map(getCnfJwk)
    .filter((jwk): jwk is JsonWebKey => jwk !== undefined)
  if (jwks.length === 0) return null
  const first = jwks[0]
  const ok = jwks.every((jwk) => sameJson(jwk, first))
  if (!ok) errors.push('vi_l2_cnf_mismatch')
  return ok
}

function verifyCredentialSignatures(
  parsedCredentials: ParsedCredential[],
  checks: ViCredentialCheck[],
  trustedIssuerKeys: JsonWebKey[],
  signaturePolicy: 'require' | 'best-effort',
  errors: string[],
  warnings: string[],
): void {
  const byLayer = new Map<ViCredentialLayer, ParsedCredential>()
  for (const parsed of parsedCredentials) byLayer.set(parsed.input.layer, parsed)

  const l1 = byLayer.get('L1')
  const l2 = byLayer.get('L2')
  const l1UserKey = getCnfJwk(l1?.payload)
  const l2AgentKeys =
    l2?.mandateValues.map(getCnfJwk).filter((jwk): jwk is JsonWebKey => jwk !== undefined) ?? []

  for (let index = 0; index < parsedCredentials.length; index += 1) {
    const parsed = parsedCredentials[index]!
    const check = checks[index]!
    if (check.alg !== 'ES256') {
      check.signature = signatureCheck('invalid', 'alg')
      errors.push('vi_alg_unsupported')
      continue
    }

    let key: JsonWebKey | undefined
    if (parsed.input.layer === 'L1') {
      key = findIssuerKey(check.kid, trustedIssuerKeys)
    } else if (parsed.input.layer === 'L2') {
      key = l1UserKey
      if (key && getKid(key) !== null && check.kid !== getKid(key))
        errors.push('vi_l2_kid_mismatch')
    } else {
      key = l2AgentKeys.find((candidate) => getKid(candidate) === check.kid)
    }

    if (!key) {
      check.signature = signatureCheck('not_checked', 'missing_key')
      warnings.push(`vi_signature_key_missing:${parsed.input.layer}`)
      if (signaturePolicy === 'require') errors.push('vi_signature_key_missing')
      continue
    }

    try {
      check.signature = verifyJwtSignature(parsed, key)
        ? signatureCheck('verified')
        : signatureCheck('invalid', 'signature')
      if (check.signature.status === 'invalid') errors.push('vi_signature_invalid')
    } catch {
      check.signature = signatureCheck('invalid', 'signature')
      errors.push('vi_signature_invalid')
    }
  }
}

function checkSdHash(
  parsedCredentials: ParsedCredential[],
  checks: ViCredentialCheck[],
  errors: string[],
): void {
  const byLayer = new Map<ViCredentialLayer, ParsedCredential>()
  for (const parsed of parsedCredentials) byLayer.set(parsed.input.layer, parsed)

  const l1 = byLayer.get('L1')

  for (let index = 0; index < parsedCredentials.length; index += 1) {
    const parsed = parsedCredentials[index]!
    const check = checks[index]!

    if (parsed.input.layer === 'L1') {
      check.sdHashOk = parsed.payload['sd_hash'] === undefined
      continue
    }

    const sdHash = parsed.payload['sd_hash']
    if (!isString(sdHash)) {
      check.sdHashOk = false
      errors.push('vi_sd_hash_missing')
      continue
    }

    let parentPresentation: string | undefined
    if (parsed.input.layer === 'L2') {
      parentPresentation = l1?.input.sdJwt
    } else {
      parentPresentation = parsed.input.parentPresentation
    }

    if (!parentPresentation) {
      check.sdHashOk = null
      continue
    }

    check.sdHashOk = hashAscii(parentPresentation) === sdHash
    if (!check.sdHashOk) errors.push('vi_sd_hash_mismatch')
  }
}

function checkTimeWindow(
  parsedCredentials: ParsedCredential[],
  nowSeconds: number,
  clockSkewSeconds: number,
  errors: string[],
): void {
  for (const parsed of parsedCredentials) {
    const exp = parsed.payload['exp']
    if (isNumber(exp) && nowSeconds > exp + clockSkewSeconds) errors.push('vi_credential_expired')
    const iat = parsed.payload['iat']
    if (isNumber(iat) && nowSeconds + clockSkewSeconds < iat)
      errors.push('vi_credential_iat_in_future')
  }
}

function sdJwtHasher(data: string | ArrayBuffer, alg: string): Uint8Array {
  if (alg !== 'sha-256') throw new Error('hash_alg_unsupported')
  const bytes = typeof data === 'string' ? textEncoder.encode(data) : new Uint8Array(data)
  return sha256(bytes)
}

function sdJwtVerifier(publicJwk: JsonWebKey): (data: string, signature: string) => boolean {
  return (data, signature) => verifyEs256Signature(data, base64urlDecode(signature), publicJwk)
}

function credentialVerificationKey(
  parsed: ParsedCredential,
  trustedIssuerKeys: JsonWebKey[],
  byLayer: Map<ViCredentialLayer, ParsedCredential>,
): JsonWebKey | undefined {
  const kid = isString(parsed.header['kid']) ? parsed.header['kid'] : null
  if (parsed.input.layer === 'L1') return findIssuerKey(kid, trustedIssuerKeys)

  const l1UserKey = getCnfJwk(byLayer.get('L1')?.payload)
  if (parsed.input.layer === 'L2') return l1UserKey

  const l2AgentKeys =
    byLayer
      .get('L2')
      ?.mandateValues.map(getCnfJwk)
      .filter((jwk): jwk is JsonWebKey => jwk !== undefined) ?? []
  return l2AgentKeys.find((candidate) => getKid(candidate) === kid)
}

function sdJwtErrorReason(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  if (message.includes('status_fetcher_unconfigured')) return 'status_fetcher'
  if (message.includes('vct_fetcher_unconfigured')) return 'vct_fetcher'
  if (message.includes('hash') || message.includes('digest')) return 'disclosure_digest'
  if (message.includes('signature')) return 'signature'
  if (message.includes('expired') || message.includes('exp')) return 'exp'
  if (message.includes('nbf')) return 'nbf'
  if (message.includes('iat')) return 'iat'
  if (message.includes('key binding') || message.includes('kb')) return 'key_binding'
  if (message.includes('vct')) return 'vct'
  if (message.includes('status')) return 'status'
  return 'invalid'
}

function addSdJwtConformanceFinding(
  policy: Exclude<SdJwtConformancePolicy, 'off'>,
  code: string,
  layer: ViCredentialLayer,
  errors: string[],
  warnings: string[],
): void {
  if (policy === 'require') errors.push(code)
  else warnings.push(`${code}:${layer}`)
}

async function verifyCredentialSdJwtConformance(
  credentials: ViCredentialInput[],
  trustedIssuerKeys: JsonWebKey[],
  policy: Exclude<SdJwtConformancePolicy, 'off'>,
  profile: SdJwtConformanceProfile,
  options: VerifyAp2ViEvidenceOptions,
  nowSeconds: number,
  clockSkewSeconds: number,
): Promise<{ checks: SdJwtConformanceCheck[]; errors: string[]; warnings: string[] }> {
  const errors: string[] = []
  const warnings: string[] = []
  const parsedCredentials: Array<{ index: number; parsed: ParsedCredential }> = []
  const checks = credentials.map(() => sdJwtConformanceCheck('not_checked', profile))

  for (let index = 0; index < credentials.length; index += 1) {
    const credential = credentials[index]!
    try {
      parsedCredentials.push({ index, parsed: parseCredential(credential) })
    } catch {
      checks[index] = sdJwtConformanceCheck('invalid', profile, 'parse')
      addSdJwtConformanceFinding(
        policy,
        'vi_sd_jwt_conformance_invalid',
        credential.layer,
        errors,
        warnings,
      )
    }
  }

  const byLayer = new Map<ViCredentialLayer, ParsedCredential>()
  for (const { parsed } of parsedCredentials) byLayer.set(parsed.input.layer, parsed)

  for (const { index: checkIndex, parsed } of parsedCredentials) {
    const key = credentialVerificationKey(parsed, trustedIssuerKeys, byLayer)

    if (parsed.header['alg'] !== 'ES256') {
      checks[checkIndex] = sdJwtConformanceCheck('invalid', profile, 'alg')
      addSdJwtConformanceFinding(
        policy,
        'vi_sd_jwt_conformance_invalid',
        parsed.input.layer,
        errors,
        warnings,
      )
      continue
    }

    if (!key) {
      checks[checkIndex] = sdJwtConformanceCheck('not_checked', profile, 'missing_key')
      addSdJwtConformanceFinding(
        policy,
        'vi_sd_jwt_conformance_key_missing',
        parsed.input.layer,
        errors,
        warnings,
      )
      continue
    }

    if (disclosureDigestsOk(parsed) === false) {
      checks[checkIndex] = sdJwtConformanceCheck('invalid', profile, 'disclosure_digest')
      addSdJwtConformanceFinding(
        policy,
        'vi_sd_jwt_conformance_invalid',
        parsed.input.layer,
        errors,
        warnings,
      )
      continue
    }

    try {
      const verifier = sdJwtVerifier(key)
      const verifyOptions = { currentDate: nowSeconds, skewSeconds: clockSkewSeconds }

      if (profile === 'sd-jwt-vc') {
        const vcOptions = options.sdJwtVc ?? {}
        const statusListFetcher =
          vcOptions.statusListFetcher ??
          (async () => {
            throw new Error('status_fetcher_unconfigured')
          })
        const vctFetcher =
          vcOptions.vctFetcher ??
          (vcOptions.loadTypeMetadata
            ? async () => {
                throw new Error('vct_fetcher_unconfigured')
              }
            : undefined)
        const vcConfig: SDJWTVCConfig = {
          hasher: sdJwtHasher,
          hashAlg: 'sha-256',
          verifier,
          loadTypeMetadataFormat: vcOptions.loadTypeMetadata === true,
          statusListFetcher,
        }
        if (vcOptions.maxVctExtendsDepth !== undefined)
          Object.assign(vcConfig, { maxVctExtendsDepth: vcOptions.maxVctExtendsDepth })
        if (vcOptions.statusValidator !== undefined)
          Object.assign(vcConfig, { statusValidator: vcOptions.statusValidator })
        if (vctFetcher !== undefined) Object.assign(vcConfig, { vctFetcher })

        const verifierInstance = new SDJwtVcInstance(vcConfig)
        await verifierInstance.verify(parsed.input.sdJwt, verifyOptions)
        await verifierInstance.getClaims(parsed.input.sdJwt)
      } else {
        const verifierInstance = new SDJwtInstance<Record<string, unknown>>({
          hasher: sdJwtHasher,
          hashAlg: 'sha-256',
          verifier,
        })
        await verifierInstance.verify(parsed.input.sdJwt, verifyOptions)
        await verifierInstance.getClaims(parsed.input.sdJwt)
      }

      checks[checkIndex] = sdJwtConformanceCheck('verified', profile)
    } catch (error) {
      checks[checkIndex] = sdJwtConformanceCheck('invalid', profile, sdJwtErrorReason(error))
      addSdJwtConformanceFinding(
        policy,
        'vi_sd_jwt_conformance_invalid',
        parsed.input.layer,
        errors,
        warnings,
      )
    }
  }

  return { checks, errors, warnings }
}

export function verifyAp2ViEvidence(
  bundle: Ap2ViEvidenceBundle,
  options: VerifyAp2ViEvidenceOptions = {},
): Ap2ViEvidenceVerification {
  const errors: string[] = []
  const warnings: string[] = []
  const signaturePolicy = options.signaturePolicy ?? 'require'
  const trustedIssuerKeys = options.trustedIssuerKeys ?? bundle.trustedIssuerKeys ?? []
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000)
  const clockSkewSeconds = options.clockSkewSeconds ?? 300

  const parsedCredentials: ParsedCredential[] = []
  const credentialChecks: ViCredentialCheck[] = []
  for (const credential of bundle.vi?.credentials ?? []) {
    try {
      const parsed = parseCredential(credential)
      const check = initialCredentialCheck(parsed)
      parsedCredentials.push(parsed)
      credentialChecks.push(check)

      if (!expectedTyp(credential.layer, check.typ)) errors.push('vi_typ_mismatch')
      if (check.disclosuresOk === false) errors.push('vi_disclosure_digest_mismatch')
    } catch (error) {
      const code = error instanceof Error && error.message ? error.message : 'vi_jwt_malformed'
      errors.push(code)
      credentialChecks.push({
        layer: credential.layer,
        alg: null,
        typ: null,
        kid: null,
        signature: signatureCheck('invalid', 'parse'),
        sdJwtConformance: sdJwtConformanceCheck('invalid', null, 'parse'),
        sdHashOk: null,
        disclosuresOk: null,
        mandateVcts: [],
      })
    }
  }

  checkSdHash(parsedCredentials, credentialChecks, errors)
  checkTimeWindow(parsedCredentials, nowSeconds, clockSkewSeconds, errors)
  verifyCredentialSignatures(
    parsedCredentials,
    credentialChecks,
    trustedIssuerKeys,
    signaturePolicy,
    errors,
    warnings,
  )

  const finalPaymentMandates = findMandates(parsedCredentials, 'mandate.payment.1')
  const finalCheckoutMandates = findMandates(parsedCredentials, 'mandate.checkout.1')
  const openPaymentMandates = findMandates(parsedCredentials, 'mandate.payment.open.1')
  const openCheckoutMandates = findMandates(parsedCredentials, 'mandate.checkout.open.1')

  checkCheckoutHash(finalCheckoutMandates, errors)
  const checkoutPaymentBindingOk = checkPaymentCheckoutBinding(
    finalPaymentMandates,
    finalCheckoutMandates,
    errors,
  )
  const delegationOk = checkDelegation(openCheckoutMandates, openPaymentMandates, errors)
  const mode: ViMode =
    openPaymentMandates.length > 0 || openCheckoutMandates.length > 0
      ? 'autonomous'
      : finalPaymentMandates.length > 0 || finalCheckoutMandates.length > 0
        ? 'immediate'
        : 'unknown'

  const ap2: Ap2EvidenceCheck = {}
  const expectedPaymentReference = expectedReceiptReference(
    bundle.ap2?.closedPaymentMandate,
    bundle.ap2?.closedPaymentMandateHash,
  )
  const expectedCheckoutReference = expectedReceiptReference(
    bundle.ap2?.closedCheckoutMandate,
    bundle.ap2?.closedCheckoutMandateHash,
  )

  if (bundle.ap2?.paymentReceipt !== undefined) {
    ap2.paymentReceipt = checkReceipt(
      bundle.ap2.paymentReceipt,
      ['status', 'iss', 'iat', 'reference', 'payment_id'],
      expectedPaymentReference,
    )
    if (!ap2.paymentReceipt.success) errors.push('ap2_payment_receipt_not_success')
    if (ap2.paymentReceipt.missingFields.length > 0)
      errors.push('ap2_payment_receipt_missing_fields')
    if (ap2.paymentReceipt.referenceOk === false)
      errors.push('ap2_payment_receipt_reference_mismatch')
  }

  if (bundle.ap2?.checkoutReceipt !== undefined) {
    ap2.checkoutReceipt = checkReceipt(
      bundle.ap2.checkoutReceipt,
      ['status', 'iss', 'iat', 'reference', 'order_id'],
      expectedCheckoutReference,
    )
    if (!ap2.checkoutReceipt.success) errors.push('ap2_checkout_receipt_not_success')
    if (ap2.checkoutReceipt.missingFields.length > 0)
      errors.push('ap2_checkout_receipt_missing_fields')
    if (ap2.checkoutReceipt.referenceOk === false)
      errors.push('ap2_checkout_receipt_reference_mismatch')
  }

  const paymentAccepted =
    ap2.paymentReceipt?.success === true && ap2.paymentReceipt.referenceOk !== false
  const checkoutAccepted =
    ap2.checkoutReceipt?.success === true && ap2.checkoutReceipt.referenceOk !== false
  const transactionAccepted = paymentAccepted || checkoutAccepted
  const hasAp2Receipt =
    ap2.paymentReceipt?.present === true || ap2.checkoutReceipt?.present === true

  return {
    valid: errors.length === 0 && (!hasAp2Receipt || transactionAccepted),
    transactionAccepted,
    ap2,
    vi: {
      mode,
      credentials: credentialChecks,
      delegationOk,
      checkoutPaymentBindingOk,
    },
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
  }
}

export async function verifyAp2ViEvidenceAsync(
  bundle: Ap2ViEvidenceBundle,
  options: VerifyAp2ViEvidenceOptions = {},
): Promise<Ap2ViEvidenceVerification> {
  const ap2: Ap2EvidenceInput = { ...bundle.ap2 }
  const receiptJwtIssuers = options.receiptJwtIssuers ?? bundle.receiptJwtIssuers ?? []
  const receiptJwtPolicy = options.receiptJwtPolicy ?? 'require'
  const sdJwtConformancePolicy = options.sdJwtConformancePolicy ?? 'require'
  const sdJwtConformanceProfile = options.sdJwtConformanceProfile ?? 'sd-jwt-vc'
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000)
  const clockSkewSeconds = options.clockSkewSeconds ?? 300
  const jwtErrors: string[] = []
  const jwtWarnings: string[] = []
  const sdJwtErrors: string[] = []
  const sdJwtWarnings: string[] = []

  const paymentJwt = ap2.paymentReceiptJwt
    ? await verifyReceiptJwt(
        'payment',
        ap2.paymentReceiptJwt,
        receiptJwtIssuers,
        receiptJwtPolicy,
        nowSeconds,
        clockSkewSeconds,
        options.fetch,
      )
    : undefined
  if (paymentJwt) {
    jwtErrors.push(...paymentJwt.errors)
    jwtWarnings.push(...paymentJwt.warnings)
    if (paymentJwt.payload) {
      if (ap2.paymentReceipt !== undefined && !sameJson(ap2.paymentReceipt, paymentJwt.payload)) {
        const code = receiptJwtError('payment', 'payload_mismatch')
        if (receiptJwtPolicy === 'require') jwtErrors.push(code)
        else jwtWarnings.push(code)
      }
      ap2.paymentReceipt = paymentJwt.payload
    }
  }

  const checkoutJwt = ap2.checkoutReceiptJwt
    ? await verifyReceiptJwt(
        'checkout',
        ap2.checkoutReceiptJwt,
        receiptJwtIssuers,
        receiptJwtPolicy,
        nowSeconds,
        clockSkewSeconds,
        options.fetch,
      )
    : undefined
  if (checkoutJwt) {
    jwtErrors.push(...checkoutJwt.errors)
    jwtWarnings.push(...checkoutJwt.warnings)
    if (checkoutJwt.payload) {
      if (
        ap2.checkoutReceipt !== undefined &&
        !sameJson(ap2.checkoutReceipt, checkoutJwt.payload)
      ) {
        const code = receiptJwtError('checkout', 'payload_mismatch')
        if (receiptJwtPolicy === 'require') jwtErrors.push(code)
        else jwtWarnings.push(code)
      }
      ap2.checkoutReceipt = checkoutJwt.payload
    }
  }

  const result = verifyAp2ViEvidence({ ...bundle, ap2 }, options)

  if (sdJwtConformancePolicy !== 'off') {
    const credentials = bundle.vi?.credentials ?? []
    const trustedIssuerKeys = options.trustedIssuerKeys ?? bundle.trustedIssuerKeys ?? []
    const sdJwt = await verifyCredentialSdJwtConformance(
      credentials,
      trustedIssuerKeys,
      sdJwtConformancePolicy,
      sdJwtConformanceProfile,
      options,
      nowSeconds,
      clockSkewSeconds,
    )

    for (let index = 0; index < sdJwt.checks.length; index += 1) {
      const check = result.vi.credentials[index]
      if (check) check.sdJwtConformance = sdJwt.checks[index]!
    }
    sdJwtErrors.push(...sdJwt.errors)
    sdJwtWarnings.push(...sdJwt.warnings)
  }

  if (paymentJwt) {
    if (result.ap2.paymentReceipt) result.ap2.paymentReceipt.jwt = paymentJwt.check
    else result.ap2.paymentReceipt = emptyJwtReceiptCheck(paymentJwt.check)
  }
  if (checkoutJwt) {
    if (result.ap2.checkoutReceipt) result.ap2.checkoutReceipt.jwt = checkoutJwt.check
    else result.ap2.checkoutReceipt = emptyJwtReceiptCheck(checkoutJwt.check)
  }

  const errors = [...new Set([...result.errors, ...jwtErrors, ...sdJwtErrors])]
  const warnings = [...new Set([...result.warnings, ...jwtWarnings, ...sdJwtWarnings])]
  const hasAp2Receipt =
    result.ap2.paymentReceipt?.present === true || result.ap2.checkoutReceipt?.present === true

  return {
    ...result,
    valid: errors.length === 0 && (!hasAp2Receipt || result.transactionAccepted),
    errors,
    warnings,
  }
}
