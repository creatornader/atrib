// SPDX-License-Identifier: Apache-2.0

import canonicalize from 'canonicalize'
import * as ed from '@noble/ed25519'
import { sha256 as nobleSha256, sha512 } from '@noble/hashes/sha2.js'
import { base64urlEncode, signRecord, type AtribRecord } from '@atrib/mcp'
import { verifyRecord, type RecordVerificationResult } from '@atrib/verify'

ed.hashes.sha512 = sha512
ed.hashes.sha512Async = (m) => Promise.resolve(sha512(m))

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const ED25519_MULTICODEC_PREFIX = [0xed, 0x01]
const RECORD_PRIVATE_KEY = new Uint8Array(32).fill(61)
const VOUCH_PRIVATE_KEY = new Uint8Array(32).fill(93)
const ISSUER = 'did:web:vouch.example'
const SUBJECT = 'did:web:agent.example'
const VERIFICATION_METHOD = `${ISSUER}#key-1`
const RESOURCE = 'mcp://files.example/report.md'

export interface VouchEvidenceHarnessResult {
  record: AtribRecord
  credential: Record<string, unknown>
  publicKeyMultibase: string
  verification: RecordVerificationResult
}

export async function runVouchEvidenceHarness(): Promise<VouchEvidenceHarnessResult> {
  const record = await buildToolCallRecord()
  const { credential, publicKeyMultibase } = await buildVouchCredential()

  const verification = await verifyRecord(record, {
    vouchEvidence: [
      {
        credential,
        publicKeyMultibase,
        expectedIssuer: ISSUER,
        expectedSubject: SUBJECT,
        expectedIntent: {
          action: 'call_tool',
          target: 'mcp://files.example',
          resource: RESOURCE,
        },
        nowSeconds: 1_780_310_400,
      },
    ],
  })

  return {
    record,
    credential,
    publicKeyMultibase,
    verification,
  }
}

async function buildToolCallRecord(): Promise<AtribRecord> {
  const publicKey = await ed.getPublicKeyAsync(RECORD_PRIVATE_KEY)
  return signRecord(
    {
      spec_version: 'atrib/1.0',
      content_id: 'sha256:' + 'f'.repeat(64),
      creator_key: base64urlEncode(publicKey),
      chain_root: 'sha256:' + 'e'.repeat(64),
      event_type: 'https://atrib.dev/v1/types/tool_call',
      context_id: '1234567890abcdef1234567890abcdef',
      timestamp: 1_780_310_400_000,
      tool_name: 'read_file',
      signature: '',
    },
    RECORD_PRIVATE_KEY,
  )
}

async function buildVouchCredential(): Promise<{
  credential: Record<string, unknown>
  publicKeyMultibase: string
}> {
  const publicKey = await ed.getPublicKeyAsync(VOUCH_PRIVATE_KEY)
  const unsignedProof = {
    type: 'DataIntegrityProof',
    cryptosuite: 'eddsa-jcs-2022',
    created: '2026-06-01T12:00:00Z',
    proofPurpose: 'assertionMethod',
    verificationMethod: VERIFICATION_METHOD,
  }
  const unsignedCredential = {
    '@context': ['https://www.w3.org/ns/credentials/v2', 'https://vouch.dev/ns/v1'],
    id: 'urn:uuid:0b1bd654-2e7a-4d66-85d2-97d5a82ebf3b',
    type: ['VerifiableCredential', 'VouchCredential'],
    issuer: ISSUER,
    validFrom: '2026-01-01T00:00:00Z',
    validUntil: '2027-01-01T00:00:00Z',
    credentialSubject: {
      id: SUBJECT,
      intent: {
        action: 'call_tool',
        target: 'mcp://files.example',
        resource: RESOURCE,
      },
    },
    proof: unsignedProof,
  }
  const canonical = canonicalize(unsignedCredential)
  if (!canonical) throw new Error('failed to canonicalize Vouch harness credential')
  const digest = nobleSha256(new TextEncoder().encode(canonical))
  const proofValue = encodeBase58btc(await ed.signAsync(digest, VOUCH_PRIVATE_KEY))

  return {
    credential: {
      ...unsignedCredential,
      proof: {
        ...unsignedProof,
        proofValue,
      },
    },
    publicKeyMultibase: encodeBase58btc(
      new Uint8Array([...ED25519_MULTICODEC_PREFIX, ...publicKey]),
    ),
  }
}

function encodeBase58btc(bytes: Uint8Array): string {
  const digits = [0]
  for (const byte of bytes) {
    let carry = byte
    for (let i = 0; i < digits.length; i++) {
      const next = digits[i]! * 256 + carry
      digits[i] = next % 58
      carry = Math.floor(next / 58)
    }
    while (carry > 0) {
      digits.push(carry % 58)
      carry = Math.floor(carry / 58)
    }
  }

  for (const byte of bytes) {
    if (byte !== 0) break
    digits.push(0)
  }

  const encoded = digits
    .reverse()
    .map((digit) => {
      const char = BASE58_ALPHABET[digit]
      if (!char) throw new Error(`invalid base58 digit: ${digit}`)
      return char
    })
    .join('')
  return `z${encoded}`
}
