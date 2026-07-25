// SPDX-License-Identifier: Apache-2.0

import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'
import canonicalize from 'canonicalize'

ed.hashes.sha512 = sha512
ed.hashes.sha512Async = (message) => Promise.resolve(sha512(message))

const RETIREMENT_SCHEMA = 'atrib.witness-retirement.v1'
const BASE64URL_KEY = /^[A-Za-z0-9_-]{43}$/
const BASE64URL_SIGNATURE = /^[A-Za-z0-9_-]{86}$/
const SAFE_WITNESS_NAME = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/
const RETIREMENT_FIELDS = new Set([
  'schema',
  'witness_name',
  'epoch',
  'public_key',
  'retired_at',
  'reason',
  'successor_public_key',
  'signature',
])

export interface WitnessRetirement {
  schema: typeof RETIREMENT_SCHEMA
  witness_name: string
  epoch: number
  public_key: string
  retired_at: string
  reason: string
  successor_public_key?: string
  signature: string
}

export type UnsignedWitnessRetirement = Omit<WitnessRetirement, 'signature'>

export interface WitnessRetirementVerification {
  valid: boolean
  retirement?: WitnessRetirement
  reason?: string
}

export function witnessRetirementSigningInput(retirement: UnsignedWitnessRetirement): Uint8Array {
  const canonical = canonicalize(retirement)
  if (canonical === undefined) throw new Error('witness retirement could not be canonicalized')
  return new TextEncoder().encode(`atrib witness retirement v1\n${canonical}`)
}

export async function verifyWitnessRetirement(
  value: unknown,
): Promise<WitnessRetirementVerification> {
  const parsed = parseWitnessRetirement(value)
  if (typeof parsed === 'string') return { valid: false, reason: parsed }
  const { signature, ...unsigned } = parsed
  try {
    const valid = await ed.verifyAsync(
      Buffer.from(signature, 'base64url'),
      witnessRetirementSigningInput(unsigned),
      Buffer.from(parsed.public_key, 'base64url'),
    )
    return valid
      ? { valid: true, retirement: parsed }
      : { valid: false, reason: 'witness retirement signature is invalid' }
  } catch {
    return { valid: false, reason: 'witness retirement signature is invalid' }
  }
}

function parseWitnessRetirement(value: unknown): WitnessRetirement | string {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return 'witness retirement must be an object'
  }
  const record = value as Record<string, unknown>
  if (Object.keys(record).some((field) => !RETIREMENT_FIELDS.has(field))) {
    return 'witness retirement contains an unknown field'
  }
  if (record['schema'] !== RETIREMENT_SCHEMA) return 'witness retirement schema is invalid'
  if (
    typeof record['witness_name'] !== 'string' ||
    !SAFE_WITNESS_NAME.test(record['witness_name'])
  ) {
    return 'witness retirement name is invalid'
  }
  if (!Number.isSafeInteger(record['epoch']) || (record['epoch'] as number) < 1) {
    return 'witness retirement epoch is invalid'
  }
  if (typeof record['public_key'] !== 'string' || !BASE64URL_KEY.test(record['public_key'])) {
    return 'witness retirement public key is invalid'
  }
  if (
    typeof record['retired_at'] !== 'string' ||
    !Number.isFinite(Date.parse(record['retired_at']))
  ) {
    return 'witness retirement time is invalid'
  }
  if (
    typeof record['reason'] !== 'string' ||
    record['reason'].length === 0 ||
    record['reason'].length > 500 ||
    /[\r\n]/.test(record['reason'])
  ) {
    return 'witness retirement reason is invalid'
  }
  if (
    record['successor_public_key'] !== undefined &&
    (typeof record['successor_public_key'] !== 'string' ||
      !BASE64URL_KEY.test(record['successor_public_key']))
  ) {
    return 'witness retirement successor key is invalid'
  }
  if (
    typeof record['signature'] !== 'string' ||
    !BASE64URL_SIGNATURE.test(record['signature']) ||
    Buffer.from(record['signature'], 'base64url').length !== 64
  ) {
    return 'witness retirement signature is malformed'
  }
  return record as unknown as WitnessRetirement
}
