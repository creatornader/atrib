import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  generateAp2LocalParticipantArtifacts,
  joinCompactJwt,
  joinSdJwt,
  type Ap2LocalParticipantArtifacts,
} from './ap2-local-participant.js'

interface JsonRecord {
  [key: string]: unknown
}

interface FunctionResponse {
  name: string
  response: unknown
}

interface SplitSdJwtFixture {
  jwt: string[]
  disclosures: string[]
  trailingTilde?: boolean
}

export interface GoogleAp2SampleExtractionOptions {
  events: unknown
  tempDbDir: string
  outDir: string
  nowSeconds?: number
  contextId?: string
}

export interface GoogleAp2SampleExtractionResult {
  artifacts: Ap2LocalParticipantArtifacts
  metadata: {
    source: string
    order_id: string
    checkout_receipt_issuer: string | null
    checkout_mandate_chain_id: string
    payment_mandate_chain_id: string
    now_seconds: number
    ap2_receipt_signature: string
    atrib_counterparty_attestation: string
  }
  files: Ap2LocalParticipantArtifacts['files'] & {
    extractionMetadata: string
  }
}

const GOOGLE_AP2_SAMPLE_SOURCE =
  'google-agentic-commerce/AP2 samples/python/scenarios/a2a/human-not-present/cards'

export async function extractGoogleAp2SampleArtifacts(
  options: GoogleAp2SampleExtractionOptions,
): Promise<GoogleAp2SampleExtractionResult> {
  const completeCheckout = requireFunctionResponseObject(options.events, 'complete_checkout')
  const checkoutReceipt = requireCompactJwtProperty(
    completeCheckout,
    'checkout_receipt',
    'checkout_receipt_jwt_parts',
  )
  const orderId = requireStringProperty(completeCheckout, 'order_id')
  const receiptPayload = decodeCompactJwtPayload(checkoutReceipt)
  const nowSeconds = options.nowSeconds ?? requireSafeIntegerProperty(receiptPayload, 'iat')

  const checkoutMandateChainId =
    optionalFunctionResponseString(
      options.events,
      'create_checkout_presentation',
      'checkout_mandate_chain_id',
    ) ?? (await findSingleMandateId(options.tempDbDir, 'chk_'))
  const paymentMandateChainId =
    optionalFunctionResponseString(
      options.events,
      'create_payment_presentation',
      'payment_mandate_chain_id',
    ) ?? (await findSingleMandateId(options.tempDbDir, 'pay_'))

  const merchantJwk = await readMerchantPublicJwk(options.tempDbDir)
  const checkoutMandateChain = await readMandateChain(options.tempDbDir, checkoutMandateChainId)
  const paymentMandateChain = await readMandateChain(options.tempDbDir, paymentMandateChainId)
  const receiptIssuer = isString(receiptPayload['iss']) ? receiptPayload['iss'] : null

  const result = {
    ...completeCheckout,
    source: GOOGLE_AP2_SAMPLE_SOURCE,
    status: isString(completeCheckout['status']) ? completeCheckout['status'] : 'success',
    order_id: orderId,
    checkout_receipt: checkoutReceipt,
  }
  const evidence = {
    ap2: {
      checkoutReceiptJwt: checkoutReceipt,
      closedCheckoutMandate: checkoutMandateChain,
      closedPaymentMandate: paymentMandateChain,
    },
    trustedIssuerKeys: [merchantJwk],
    receiptJwtIssuers: [
      {
        ...(receiptIssuer === null ? {} : { issuer: receiptIssuer }),
        jwks: [merchantJwk],
      },
    ],
  }

  const artifacts = await generateAp2LocalParticipantArtifacts({
    result,
    evidence,
    outDir: options.outDir,
    nowSeconds,
    ...(options.contextId ? { contextId: options.contextId } : {}),
  })

  const metadata = {
    source: GOOGLE_AP2_SAMPLE_SOURCE,
    order_id: orderId,
    checkout_receipt_issuer: receiptIssuer,
    checkout_mandate_chain_id: checkoutMandateChainId,
    payment_mandate_chain_id: paymentMandateChainId,
    now_seconds: nowSeconds,
    ap2_receipt_signature: 'external_evidence_es256_jwt',
    atrib_counterparty_attestation: 'local_ed25519_over_atrib_transaction_bytes',
  }
  const extractionMetadata = join(options.outDir, 'google-ap2-sample-extraction.json')
  await writeJson(extractionMetadata, metadata)

  return {
    artifacts,
    metadata,
    files: {
      ...artifacts.files,
      extractionMetadata,
    },
  }
}

function requireFunctionResponseObject(events: unknown, name: string): JsonRecord {
  const response = findFunctionResponse(events, name)
  if (!response) throw new Error(`missing_${name}_function_response`)

  const parsed = parseToolResponseObject(response.response)
  if (!parsed) throw new Error(`missing_${name}_json_response`)
  return parsed
}

function optionalFunctionResponseString(
  events: unknown,
  functionName: string,
  property: string,
): string | undefined {
  const response = findFunctionResponse(events, functionName)
  if (!response) return undefined

  const parsed = parseToolResponseObject(response.response)
  if (!parsed) return undefined
  const value = findStringProperty(parsed, property)
  return value === null ? undefined : value
}

function findFunctionResponse(events: unknown, name: string): FunctionResponse | undefined {
  const responses: FunctionResponse[] = []
  collectFunctionResponses(events, responses)
  return responses.filter((response) => response.name === name).at(-1)
}

function collectFunctionResponses(value: unknown, responses: FunctionResponse[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectFunctionResponses(item, responses)
    return
  }
  if (!isRecord(value)) return

  const root = isRecord(value['root']) ? value['root'] : value
  const functionResponse = root['functionResponse'] ?? root['function_response']
  if (isRecord(functionResponse)) pushFunctionResponse(functionResponse, responses)

  const data = root['data']
  if (isRecord(data)) pushFunctionResponse(data, responses)

  for (const child of Object.values(value)) {
    collectFunctionResponses(child, responses)
  }
}

function pushFunctionResponse(value: JsonRecord, responses: FunctionResponse[]): void {
  const name = value['name']
  if (!isString(name)) return
  if (!('response' in value)) return
  responses.push({ name, response: value['response'] })
}

function parseToolResponseObject(value: unknown): JsonRecord | null {
  if (!isRecord(value)) return null

  const structuredContent = value['structuredContent'] ?? value['structured_content']
  if (isRecord(structuredContent)) return structuredContent

  if (Array.isArray(value['content'])) {
    for (const item of value['content']) {
      if (!isRecord(item) || !isString(item['text'])) continue
      const parsed = parseJsonObject(item['text'])
      if (parsed) return parsed
    }
  }

  return value
}

function parseJsonObject(value: string): JsonRecord | null {
  try {
    const parsed = JSON.parse(value) as unknown
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

async function readMerchantPublicJwk(tempDbDir: string): Promise<JsonWebKey> {
  const jwk = await readJson(join(tempDbDir, 'merchant_signing_key.pub'))
  if (!isRecord(jwk)) throw new Error('merchant_signing_key_pub_not_json_object')
  return {
    ...jwk,
    alg: isString(jwk['alg']) ? jwk['alg'] : 'ES256',
    use: isString(jwk['use']) ? jwk['use'] : 'sig',
  } as JsonWebKey
}

async function readMandateChain(tempDbDir: string, mandateId: string): Promise<string> {
  const rawPath = join(tempDbDir, `${mandateId}.sdjwt`)
  const splitPath = join(tempDbDir, `${mandateId}.sdjwt.json`)
  const raw = await readTextIfExists(rawPath)
  if (raw !== null) {
    const serialized = raw.trim()
    if (!serialized) throw new Error(`empty_mandate_chain:${mandateId}`)
    return serialized
  }

  return readSplitMandateChain(splitPath, mandateId)
}

async function findSingleMandateId(tempDbDir: string, prefix: 'chk_' | 'pay_'): Promise<string> {
  const names = await readdir(tempDbDir)
  const matches = Array.from(
    new Set(
      names
        .filter(
          (name) =>
            name.startsWith(prefix) && (name.endsWith('.sdjwt') || name.endsWith('.sdjwt.json')),
        )
        .map((name) =>
          name.endsWith('.sdjwt.json')
            ? name.slice(0, -'.sdjwt.json'.length)
            : name.slice(0, -'.sdjwt'.length),
        ),
    ),
  ).sort()

  if (matches.length !== 1) {
    throw new Error(`expected_one_${prefix}mandate_chain_found_${matches.length}`)
  }
  return matches[0]!
}

async function readSplitMandateChain(path: string, mandateId: string): Promise<string> {
  const fixture = await readJson(path)
  const chain = parseSplitMandateChain(fixture)
  if (chain.length === 0) throw new Error(`empty_mandate_chain:${mandateId}`)
  return chain.map((sdJwt) => joinSdJwt(sdJwt)).join('~~')
}

function parseSplitMandateChain(value: unknown): SplitSdJwtFixture[] {
  if (!isRecord(value)) throw new Error('split_mandate_chain_not_object')

  const chain = value['chain']
  if (Array.isArray(chain)) return chain.map(parseSplitSdJwt)

  const sdJwt = value['sdJwt'] ?? value['sd_jwt']
  if (sdJwt !== undefined) return [parseSplitSdJwt(sdJwt)]

  throw new Error('split_mandate_chain_missing_chain')
}

function parseSplitSdJwt(value: unknown): SplitSdJwtFixture {
  if (!isRecord(value)) throw new Error('split_sd_jwt_not_object')

  const jwt = parseStringArray(value['jwt'], 'split_sd_jwt_missing_jwt')
  const disclosures = parseStringArray(value['disclosures'], 'split_sd_jwt_missing_disclosures')
  const trailingTilde = value['trailingTilde']
  return {
    jwt,
    disclosures,
    ...(typeof trailingTilde === 'boolean' ? { trailingTilde } : {}),
  }
}

function requireStringProperty(record: JsonRecord, property: string): string {
  const value = record[property]
  if (!isString(value) || value.length === 0) throw new Error(`missing_${property}`)
  return value
}

function requireCompactJwtProperty(
  record: JsonRecord,
  property: string,
  partsProperty: string,
): string {
  const value = record[property]
  if (isString(value) && value.length > 0) return value

  const parts = parseStringArray(record[partsProperty], `missing_${property}`)
  return joinCompactJwt(parts)
}

function parseStringArray(value: unknown, errorMessage: string): string[] {
  if (!Array.isArray(value) || value.some((item) => !isString(item) || item.length === 0)) {
    throw new Error(errorMessage)
  }
  return value
}

function requireSafeIntegerProperty(record: JsonRecord, property: string): number {
  const value = record[property]
  if (!Number.isSafeInteger(value)) throw new Error(`missing_${property}`)
  return value as number
}

function findStringProperty(value: unknown, property: string): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStringProperty(item, property)
      if (found !== null) return found
    }
    return null
  }
  if (!isRecord(value)) return null

  const direct = value[property]
  if (isString(direct) && direct.length > 0) return direct

  for (const child of Object.values(value)) {
    const found = findStringProperty(child, property)
    if (found !== null) return found
  }
  return null
}

function decodeCompactJwtPayload(jwt: string): JsonRecord {
  const parts = jwt.split('.')
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    throw new Error('checkout_receipt_jwt_malformed')
  }

  const parsed = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as unknown
  if (!isRecord(parsed)) throw new Error('checkout_receipt_jwt_payload_not_object')
  return parsed
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown
}

async function readTextIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return null
    throw error
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
