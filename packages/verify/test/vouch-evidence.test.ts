// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import canonicalize from 'canonicalize'
import * as ed from '@noble/ed25519'
import { sha256, sha512 } from '@noble/hashes/sha2.js'
import { base64urlEncode, signRecord, type AtribRecord } from '@atrib/mcp'
import {
  verifyRecord,
  verifyVouchAuthorizationEvidence,
  type VouchAuthorizationEvidenceInput,
} from '../src/index.js'

ed.hashes.sha512 = sha512
ed.hashes.sha512Async = (m) => Promise.resolve(sha512(m))

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const ISSUER = 'did:web:vouch.example'
const SUBJECT = 'did:web:agent.example'
const VERIFICATION_METHOD = `${ISSUER}#key-1`
const RESOURCE = 'mcp://files.example/report.md'

interface CredentialBuildOptions {
  seed?: Uint8Array
  issuer?: string
  subject?: string
  action?: string
  target?: string
  resource?: string
  validFrom?: string
  validUntil?: string
}

async function buildRecord(seed: Uint8Array): Promise<AtribRecord> {
  const pubKey = base64urlEncode(await ed.getPublicKeyAsync(seed))
  return signRecord(
    {
      spec_version: 'atrib/1.0',
      content_id: 'sha256:' + 'a'.repeat(64),
      creator_key: pubKey,
      chain_root: 'sha256:' + 'b'.repeat(64),
      event_type: 'https://atrib.dev/v1/types/tool_call',
      context_id: 'c'.repeat(32),
      timestamp: 1_000_000_000_000,
      signature: '',
    },
    seed,
  )
}

async function buildVouchCredential(options: CredentialBuildOptions = {}): Promise<{
  credential: Record<string, unknown>
  publicKeyMultibase: string
}> {
  const seed = options.seed ?? seededBytes(7)
  const publicKey = await ed.getPublicKeyAsync(seed)
  const unsignedProof = {
    type: 'DataIntegrityProof',
    cryptosuite: 'eddsa-jcs-2022',
    created: '2026-06-01T12:00:00Z',
    proofPurpose: 'assertionMethod',
    verificationMethod: VERIFICATION_METHOD,
  }
  const credential = {
    '@context': ['https://www.w3.org/ns/credentials/v2', 'https://vouch.dev/ns/v1'],
    id: 'urn:uuid:67e4d5c8-ff90-4f35-9327-7f0fbb49397a',
    type: ['VerifiableCredential', 'VouchCredential'],
    issuer: options.issuer ?? ISSUER,
    validFrom: options.validFrom ?? '2026-01-01T00:00:00Z',
    validUntil: options.validUntil ?? '2027-01-01T00:00:00Z',
    credentialSubject: {
      id: options.subject ?? SUBJECT,
      intent: {
        action: options.action ?? 'call_tool',
        target: options.target ?? 'mcp://files.example',
        resource: options.resource ?? RESOURCE,
      },
    },
    proof: unsignedProof,
  }
  const canonical = canonicalize(credential)
  if (!canonical) throw new Error('test credential failed to canonicalize')
  const digest = sha256(new TextEncoder().encode(canonical))
  const signature = await ed.signAsync(digest, seed)
  return {
    credential: {
      ...credential,
      proof: {
        ...unsignedProof,
        proofValue: encodeBase58btc(signature),
      },
    },
    publicKeyMultibase: encodeBase58btc(new Uint8Array([0xed, 0x01, ...publicKey])),
  }
}

function vouchInput(
  credential: Record<string, unknown>,
  publicKeyMultibase: string,
): VouchAuthorizationEvidenceInput {
  return {
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
  }
}

function seededBytes(offset: number): Uint8Array {
  const seed = new Uint8Array(32)
  for (let i = 0; i < seed.length; i++) seed[i] = (i * 17 + offset) & 0xff
  return seed
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

  return `z${digits
    .reverse()
    .map((digit) => BASE58_ALPHABET[digit])
    .join('')}`
}

describe('verifyVouchAuthorizationEvidence', () => {
  it('verifies eddsa-jcs-2022 Vouch credentials as tiered evidence', async () => {
    const { credential, publicKeyMultibase } = await buildVouchCredential()

    const result = await verifyVouchAuthorizationEvidence(
      vouchInput(credential, publicKeyMultibase),
    )

    expect(result.valid).toBe(true)
    expect(result.protocol).toBe('vouch')
    expect(result.issuer).toBe(ISSUER)
    expect(result.subject).toBe(SUBJECT)
    expect(result.scope).toEqual([RESOURCE])
    expect(result.attenuation_ok).toBe(true)
    expect(result.details?.signature.verified).toBe(true)
    expect(
      result.constraints.find((constraint) => constraint.type === 'proof.signature')?.status,
    ).toBe('passed')
  })

  it('fails when the bound resource is tampered after signing', async () => {
    const { credential, publicKeyMultibase } = await buildVouchCredential()
    const subject = credential['credentialSubject'] as Record<string, unknown>
    const intent = subject['intent'] as Record<string, unknown>
    intent['resource'] = 'mcp://files.example/other.md'

    const result = await verifyVouchAuthorizationEvidence(
      vouchInput(credential, publicKeyMultibase),
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('vouch_evidence signature verification failed')
    expect(result.errors).toContain('vouch_evidence constraint failed: intent.resource')
  })

  it('fails when the trusted public key does not match the proof signer', async () => {
    const { credential } = await buildVouchCredential()
    const wrongPublicKey = await ed.getPublicKeyAsync(seededBytes(19))

    const result = await verifyVouchAuthorizationEvidence(
      vouchInput(credential, encodeBase58btc(new Uint8Array([0xed, 0x01, ...wrongPublicKey]))),
    )

    expect(result.valid).toBe(false)
    expect(result.details?.signature.verified).toBe(false)
    expect(result.errors).toContain('vouch_evidence signature verification failed')
  })

  it('fails expired credentials while keeping the signature finding separate', async () => {
    const { credential, publicKeyMultibase } = await buildVouchCredential({
      validUntil: '2026-01-02T00:00:00Z',
    })

    const result = await verifyVouchAuthorizationEvidence(
      vouchInput(credential, publicKeyMultibase),
    )

    expect(result.valid).toBe(false)
    expect(result.details?.signature.verified).toBe(true)
    expect(result.errors).toContain('vouch_evidence constraint failed: validUntil')
  })

  it('fails credentials that omit the Data Integrity proof', async () => {
    const { credential, publicKeyMultibase } = await buildVouchCredential()
    delete credential['proof']

    const result = await verifyVouchAuthorizationEvidence(
      vouchInput(credential, publicKeyMultibase),
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('vouch_evidence missing eddsa-jcs-2022 DataIntegrityProof')
    expect(result.errors).toContain('vouch_evidence proof.proofValue is required')
  })

  it('attaches Vouch evidence to record verification without changing base validity', async () => {
    const recordSeed = seededBytes(31)
    const record = await buildRecord(recordSeed)
    const { credential, publicKeyMultibase } = await buildVouchCredential()

    const result = await verifyRecord(record, {
      vouchEvidence: [vouchInput(credential, publicKeyMultibase)],
    })

    expect(result.signatureOk).toBe(true)
    expect(result.valid).toBe(true)
    expect(result.evidence).toHaveLength(1)
    expect(result.evidence![0]!.protocol).toBe('vouch')
    expect(result.evidence![0]!.valid).toBe(true)
    expect(result.evidence![0]!.scope).toEqual([RESOURCE])
  })
})
