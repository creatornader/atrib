// SPDX-License-Identifier: Apache-2.0

import { base64urlDecode } from '@atrib/mcp'
import * as ed from '@noble/ed25519'
import { sha256, sha512 } from '@noble/hashes/sha2.js'
import canonicalize from 'canonicalize'
import type { JWK } from 'jose'
import type {
  EvidenceConstraintCheck,
  EvidenceVerificationBlock,
} from './authorization-evidence.js'

ed.hashes.sha512 = sha512
ed.hashes.sha512Async = (m) => Promise.resolve(sha512(m))

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const BASE58_MAP = new Map([...BASE58_ALPHABET].map((char, index) => [char, index]))
const ED25519_MULTICODEC_PREFIX = [0xed, 0x01]

type JsonRecord = Record<string, unknown>
type ConstraintStatus = EvidenceConstraintCheck['status']

export interface VouchIntentConstraints {
  action?: string
  target?: string
  resource?: string
}

export interface VouchTrustedKeyInput {
  /**
   * Ed25519 public key bytes, base64url public key bytes, or a `z...`
   * base58btc Multikey string.
   */
  publicKey?: Uint8Array | string
  /** Ed25519 Multikey in base58btc multibase form, usually `z` + ed25519-pub. */
  publicKeyMultibase?: string
  /** JWK form for an Ed25519 public key (`kty: "OKP"`, `crv: "Ed25519"`). */
  publicKeyJwk?: JWK
}

export interface VouchAuthorizationEvidenceInput extends VouchTrustedKeyInput {
  /**
   * Vouch credential secured with a Data Integrity proof using
   * `cryptosuite: "eddsa-jcs-2022"`.
   */
  credential: unknown
  expectedIssuer?: string
  expectedSubject?: string
  expectedIntent?: VouchIntentConstraints
  /**
   * Optional trusted-key map keyed by `proof.verificationMethod`. This keeps
   * DID resolution and trust-root policy outside the verifier.
   */
  verificationMethods?: Record<string, VouchTrustedKeyInput>
  nowSeconds?: number
  clockSkewSeconds?: number
}

export interface VouchEvidenceDetails {
  credential_id: string | null
  verification_method: string | null
  proof_type: string | null
  cryptosuite: string | null
  proof_created: string | null
  intent: {
    action: string | null
    target: string | null
    resource: string | null
  }
  temporal: {
    valid_from: string | null
    valid_until: string | null
    now_seconds: number
  }
  signature: {
    alg: 'Ed25519'
    proof_value_present: boolean
    verified: boolean
    key_source: 'verification_method' | 'input' | 'none'
  }
}

export interface VouchAuthorizationEvidenceVerification extends EvidenceVerificationBlock<VouchEvidenceDetails> {
  protocol: 'vouch'
}

interface SelectedProof {
  proof: JsonRecord | null
  index: number | null
}

interface KeyResolution {
  publicKey: Uint8Array | null
  source: 'verification_method' | 'input' | 'none'
  errors: string[]
}

export async function verifyVouchAuthorizationEvidence(
  input: VouchAuthorizationEvidenceInput,
): Promise<VouchAuthorizationEvidenceVerification> {
  const constraints: EvidenceConstraintCheck[] = []
  const errors: string[] = []
  const warnings: string[] = []
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000)
  const clockSkewSeconds = input.clockSkewSeconds ?? 0

  const credential = asRecord(input.credential)
  if (!credential) {
    return invalidResult('vouch_evidence credential must be an object', nowSeconds)
  }

  const selected = selectProof(credential, warnings)
  const proof = selected.proof
  const issuer = getString(credential['issuer'])
  const credentialId = getString(credential['id'])
  const subjectRecord = asRecord(credential['credentialSubject'])
  const subject = getString(subjectRecord?.['id'])
  const intentRecord = asRecord(subjectRecord?.['intent'])
  const action = getString(intentRecord?.['action'])
  const target = getString(intentRecord?.['target'])
  const resource = getString(intentRecord?.['resource'])
  const validFrom = getString(credential['validFrom'])
  const validUntil = getString(credential['validUntil'])
  const proofType = getString(proof?.['type'])
  const cryptosuite = getString(proof?.['cryptosuite'])
  const verificationMethod = getString(proof?.['verificationMethod'])
  const proofCreated = getString(proof?.['created'])
  const proofValue = getString(proof?.['proofValue'])

  constraints.push(fieldCheck('proof.type', 'DataIntegrityProof', proofType))
  constraints.push(fieldCheck('proof.cryptosuite', 'eddsa-jcs-2022', cryptosuite))
  constraints.push(fieldCheck('issuer', input.expectedIssuer ?? 'present', issuer))
  constraints.push(fieldCheck('credentialSubject.id', input.expectedSubject ?? 'present', subject))
  constraints.push(fieldCheck('intent.action', input.expectedIntent?.action ?? 'present', action))
  constraints.push(fieldCheck('intent.target', input.expectedIntent?.target ?? 'present', target))
  constraints.push(
    fieldCheck('intent.resource', input.expectedIntent?.resource ?? 'present', resource),
  )
  constraints.push(temporalCheck('validFrom', validFrom, nowSeconds, clockSkewSeconds, 'from'))
  constraints.push(temporalCheck('validUntil', validUntil, nowSeconds, clockSkewSeconds, 'until'))

  let signatureVerified = false
  let keySource: KeyResolution['source'] = 'none'

  if (!proof) errors.push('vouch_evidence missing eddsa-jcs-2022 DataIntegrityProof')
  if (!proofValue) errors.push('vouch_evidence proof.proofValue is required')

  if (proof && proofValue) {
    const keyResolution = resolveTrustedPublicKey(input, verificationMethod)
    keySource = keyResolution.source
    errors.push(...keyResolution.errors)

    if (keyResolution.publicKey) {
      try {
        const signature = decodeMultibaseBase58btc(proofValue)
        if (signature.length !== 64) {
          errors.push(
            `vouch_evidence proof.proofValue decoded to ${signature.length} bytes, expected 64`,
          )
        } else {
          const unsignedCredential = credentialWithoutProofValue(credential, selected.index)
          const canonical = canonicalize(unsignedCredential)
          if (!canonical) {
            errors.push('vouch_evidence failed to canonicalize credential')
          } else {
            const digest = sha256(new TextEncoder().encode(canonical))
            signatureVerified = await ed.verifyAsync(signature, digest, keyResolution.publicKey)
            constraints.push(
              check(
                'proof.signature',
                signatureVerified ? 'passed' : 'failed',
                'valid Ed25519 signature over JCS SHA-256 digest',
                signatureVerified,
              ),
            )
            if (!signatureVerified) errors.push('vouch_evidence signature verification failed')
          }
        }
      } catch (err) {
        errors.push(`vouch_evidence signature verification error: ${errorMessage(err)}`)
      }
    }
  }

  const failedConstraints = constraints.filter(
    (constraint) => constraint.status === 'failed' || constraint.status === 'unresolved',
  )
  for (const constraint of failedConstraints) {
    const reason = constraint.reason ? `: ${constraint.reason}` : ''
    errors.push(`vouch_evidence constraint failed: ${constraint.type}${reason}`)
  }

  const intentConstraints = constraints.filter((constraint) =>
    constraint.type.startsWith('intent.'),
  )
  const attenuationOk =
    intentConstraints.length > 0 &&
    intentConstraints.every((constraint) => constraint.status === 'passed')

  return {
    protocol: 'vouch',
    valid: errors.length === 0,
    issuer,
    subject,
    scope: resource ? [resource] : [],
    attenuation_ok: attenuationOk,
    delegation_ok: null,
    constraints,
    errors: Array.from(new Set(errors)),
    warnings,
    details: {
      credential_id: credentialId,
      verification_method: verificationMethod,
      proof_type: proofType,
      cryptosuite,
      proof_created: proofCreated,
      intent: {
        action,
        target,
        resource,
      },
      temporal: {
        valid_from: validFrom,
        valid_until: validUntil,
        now_seconds: nowSeconds,
      },
      signature: {
        alg: 'Ed25519',
        proof_value_present: Boolean(proofValue),
        verified: signatureVerified,
        key_source: keySource,
      },
    },
  }
}

function invalidResult(
  message: string,
  nowSeconds: number,
): VouchAuthorizationEvidenceVerification {
  return {
    protocol: 'vouch',
    valid: false,
    issuer: null,
    subject: null,
    scope: [],
    attenuation_ok: null,
    delegation_ok: null,
    constraints: [],
    errors: [message],
    warnings: [],
    details: {
      credential_id: null,
      verification_method: null,
      proof_type: null,
      cryptosuite: null,
      proof_created: null,
      intent: {
        action: null,
        target: null,
        resource: null,
      },
      temporal: {
        valid_from: null,
        valid_until: null,
        now_seconds: nowSeconds,
      },
      signature: {
        alg: 'Ed25519',
        proof_value_present: false,
        verified: false,
        key_source: 'none',
      },
    },
  }
}

function selectProof(credential: JsonRecord, warnings: string[]): SelectedProof {
  const rawProof = credential['proof']
  const proofs = Array.isArray(rawProof) ? rawProof : [rawProof]
  const recordProofs = proofs
    .map((entry, index) => ({ proof: asRecord(entry), index }))
    .filter((entry): entry is { proof: JsonRecord; index: number } => entry.proof !== null)
  const matching = recordProofs.filter(
    ({ proof }) =>
      getString(proof['type']) === 'DataIntegrityProof' &&
      getString(proof['cryptosuite']) === 'eddsa-jcs-2022',
  )

  if (matching.length > 1) {
    warnings.push('vouch_evidence multiple eddsa-jcs-2022 proofs found; verifying the first')
  }

  if (matching[0]) {
    return {
      proof: matching[0].proof,
      index: Array.isArray(rawProof) ? matching[0].index : null,
    }
  }

  return { proof: null, index: null }
}

function credentialWithoutProofValue(
  credential: JsonRecord,
  proofIndex: number | null,
): JsonRecord {
  const rawProof = credential['proof']
  if (Array.isArray(rawProof)) {
    return {
      ...credential,
      proof: rawProof.map((entry, index) => {
        if (index !== proofIndex || !asRecord(entry)) return entry
        const { proofValue: _proofValue, ...rest } = entry as JsonRecord
        return rest
      }),
    }
  }

  const proof = asRecord(rawProof)
  if (!proof) return credential
  const { proofValue: _proofValue, ...rest } = proof
  return { ...credential, proof: rest }
}

function resolveTrustedPublicKey(
  input: VouchAuthorizationEvidenceInput,
  verificationMethod: string | null,
): KeyResolution {
  if (verificationMethod && input.verificationMethods?.[verificationMethod]) {
    const publicKey = decodeTrustedPublicKey(input.verificationMethods[verificationMethod])
    return publicKey
      ? { publicKey, source: 'verification_method', errors: [] }
      : {
          publicKey: null,
          source: 'verification_method',
          errors: [
            `vouch_evidence trusted key for ${verificationMethod} is not a 32-byte Ed25519 key`,
          ],
        }
  }

  const publicKey = decodeTrustedPublicKey(input)
  if (publicKey) return { publicKey, source: 'input', errors: [] }

  return {
    publicKey: null,
    source: 'none',
    errors: ['vouch_evidence trusted Ed25519 public key is required'],
  }
}

function decodeTrustedPublicKey(input: VouchTrustedKeyInput): Uint8Array | null {
  if (input.publicKey instanceof Uint8Array) return normalizePublicKeyBytes(input.publicKey)

  if (typeof input.publicKey === 'string') {
    return input.publicKey.startsWith('z')
      ? decodePublicKeyMultibase(input.publicKey)
      : normalizePublicKeyBytes(base64urlDecode(input.publicKey))
  }

  if (input.publicKeyMultibase) return decodePublicKeyMultibase(input.publicKeyMultibase)
  if (input.publicKeyJwk) return publicKeyFromJwk(input.publicKeyJwk)
  return null
}

function publicKeyFromJwk(jwk: JWK): Uint8Array | null {
  if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || typeof jwk.x !== 'string') return null
  return normalizePublicKeyBytes(base64urlDecode(jwk.x))
}

function decodePublicKeyMultibase(value: string): Uint8Array | null {
  const bytes = decodeMultibaseBase58btc(value)
  return normalizePublicKeyBytes(bytes)
}

function normalizePublicKeyBytes(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length === 32) return bytes
  if (
    bytes.length === 34 &&
    bytes[0] === ED25519_MULTICODEC_PREFIX[0] &&
    bytes[1] === ED25519_MULTICODEC_PREFIX[1]
  ) {
    return bytes.slice(2)
  }
  return null
}

function decodeMultibaseBase58btc(value: string): Uint8Array {
  if (!value.startsWith('z')) throw new Error('expected base58btc multibase value')
  const source = value.slice(1)
  const bytes = [0]

  for (const char of source) {
    const carry = BASE58_MAP.get(char)
    if (carry === undefined) throw new Error(`invalid base58btc character: ${char}`)
    let valueCarry = carry
    for (let i = 0; i < bytes.length; i++) {
      const next = bytes[i]! * 58 + valueCarry
      bytes[i] = next & 0xff
      valueCarry = next >> 8
    }
    while (valueCarry > 0) {
      bytes.push(valueCarry & 0xff)
      valueCarry >>= 8
    }
  }

  for (const char of source) {
    if (char !== '1') break
    bytes.push(0)
  }

  return new Uint8Array(bytes.reverse())
}

function fieldCheck(
  type: string,
  expected: string,
  actual: string | null,
): EvidenceConstraintCheck {
  if (expected === 'present') {
    const present = typeof actual === 'string' && actual.length > 0
    return check(type, present ? 'passed' : 'failed', 'present', actual)
  }
  return check(type, actual === expected ? 'passed' : 'failed', expected, actual)
}

function temporalCheck(
  type: string,
  value: string | null,
  nowSeconds: number,
  clockSkewSeconds: number,
  direction: 'from' | 'until',
): EvidenceConstraintCheck {
  if (!value) return check(type, 'failed', 'present', value)
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return check(type, 'failed', 'valid RFC3339 timestamp', value)
  const timestampSeconds = Math.floor(parsed / 1000)
  if (direction === 'from') {
    const passed = timestampSeconds <= nowSeconds + clockSkewSeconds
    return check(
      type,
      passed ? 'passed' : 'failed',
      `<= ${nowSeconds + clockSkewSeconds}`,
      timestampSeconds,
    )
  }
  const passed = timestampSeconds >= nowSeconds - clockSkewSeconds
  return check(
    type,
    passed ? 'passed' : 'failed',
    `>= ${nowSeconds - clockSkewSeconds}`,
    timestampSeconds,
  )
}

function check(
  type: string,
  status: ConstraintStatus,
  expected?: unknown,
  actual?: unknown,
  reason?: string,
): EvidenceConstraintCheck {
  const result: EvidenceConstraintCheck = { type, status }
  if (expected !== undefined) result.expected = expected
  if (actual !== undefined) result.actual = actual
  if (reason !== undefined) result.reason = reason
  return result
}

function asRecord(value: unknown): JsonRecord | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  return value as JsonRecord
}

function getString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
