// SPDX-License-Identifier: Apache-2.0

/**
 * Delegation certificates, producer side (spec §1.11 / D140).
 *
 * A *principal* Ed25519 key certifies an ephemeral *run* key with an
 * explicit scope, expiry, and optional session binding. Records signed by
 * the run key occupy the existing `creator_key` slot unchanged; delegation
 * never introduces a new record signing path. This module provides:
 *
 *   - `issueDelegationCertificate`: build + sign a certificate with the
 *     principal seed (§1.11.1 / §1.11.2). Byte-identical construction to
 *     the spec/conformance/delegation-certificates/ corpus generator.
 *   - `delegationCertHash`: the §1.11.3 stable identifier over the SIGNED
 *     certificate bytes.
 *   - `withDelegationCertHash`: stamp the OPTIONAL `delegation_cert_hash`
 *     field onto a genesis record body BEFORE the existing
 *     `signRecord` / `handleEmit` flow signs it. No new signing path: the
 *     field threads exactly like `session_token` / `provenance_token` —
 *     present-or-omitted (never null) so presence changes the JCS
 *     canonical form and therefore the signature (§1.3).
 *   - `buildRunKeyRevocationRecord`: §1.11.5 / §1.9.2 signing rule 3 — a
 *     principal-signed `key_revocation` retiring a certified run key,
 *     carrying `delegation_cert_hash` referencing the covering
 *     certificate. Signed through the existing `signRecord` primitive.
 *
 * Degradation (§5.8): `withDelegationCertHash` sits on the record signing
 * path, so it NEVER throws — every failure is caught, logged with the
 * `atrib:` prefix, and the record is returned unchanged so signing
 * proceeds without the genesis field (§1.11.10). Certificate issuance and
 * revocation-record building are explicit operator/host actions off the
 * primary tool-call path; they throw on invalid input like the other
 * setup-time helpers (`signTransactionAttestation`).
 */

import * as ed from '@noble/ed25519'
import canonicalize from 'canonicalize'
import { base64urlEncode, base64urlDecode } from './base64url.js'
import { sha256, hexEncode } from './hash.js'
import { genesisChainRoot } from './chain-root.js'
// Importing from signing.js also wires @noble/ed25519 v3's sha512 hashes.
import { getPublicKey, signRecord } from './signing.js'
import type { AtribRecord } from './types.js'

/** §1.11.1 literal version discriminator. */
export const DELEGATION_CERT_TYPE = 'atrib/delegation-cert/v1'

/**
 * key_revocation event type URI (§1.9). Not part of the §1.2.4 normative
 * event-byte vocabulary (it maps to the extension byte in log entries);
 * exported here for the §1.11.5 revocation builder and its consumers.
 */
export const EVENT_TYPE_KEY_REVOCATION_URI = 'https://atrib.dev/v1/types/key_revocation'

/** `"sha256:" + 64 lowercase hex` — the §1.11.3 field wire format. */
export const DELEGATION_CERT_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/

const CONTEXT_ID_PATTERN = /^[0-9a-f]{32}$/
const FIELD_NAME = 'delegation_cert_hash'
const encoder = new TextEncoder()

/**
 * §6.7.1 capability envelope schema, reused VERBATIM as the certificate
 * scope per §1.11.1. One schema, two carriers: directory-published
 * (per-key, identity-claim cadence) and certificate-carried (per-run,
 * issuance cadence). When `expires_at` is present the effective expiry is
 * `min(not_after, scope.expires_at)`.
 */
export interface DelegationScope {
  tool_names?: string[]
  event_types?: string[]
  max_amount?: { currency: string; value: number }
  counterparties?: string[]
  expires_at?: number
}

/**
 * A delegation certificate per §1.11.1. JCS lexicographic field order:
 * cert_type < context_id < not_after < not_before < principal_key <
 * run_pubkey < scope < signature. Optional fields MUST be omitted, not
 * null, when absent — presence/absence changes the canonical form and
 * therefore the signature, mirroring the `session_token` rule (§1.3).
 */
export interface DelegationCertificate {
  cert_type: typeof DELEGATION_CERT_TYPE
  /** OPTIONAL 32-lowercase-hex session binding. */
  context_id?: string
  /** Unix ms; records after this are out-of-window. */
  not_after: number
  /** OPTIONAL Unix ms; defaults to 0 when absent. */
  not_before?: number
  /** base64url 32-byte Ed25519 principal public key. */
  principal_key: string
  /** base64url 32-byte Ed25519 run public key. MUST differ from principal_key. */
  run_pubkey: string
  /** OPTIONAL §6.7.1 capability envelope, verbatim. */
  scope?: DelegationScope
  /** Ed25519 by principal_key over the JCS signing input (§1.11.2). */
  signature: string
}

/** An unsigned certificate: all fields except signature. */
export type UnsignedDelegationCertificate = Omit<DelegationCertificate, 'signature'>

/** A record carrying the OPTIONAL §1.11.3 genesis field. */
export type DelegatedAtribRecord = AtribRecord & { delegation_cert_hash?: string }

/**
 * A §1.9.1 key_revocation record extended with the OPTIONAL §1.11.5
 * `delegation_cert_hash` field (JCS order when present:
 * creator_key < delegation_cert_hash < emergency_signed_by < revoked_key).
 */
export type RunKeyRevocationRecord = AtribRecord & {
  revoked_key: string
  revocation_reason: 'compromise' | 'retirement'
  delegation_cert_hash: string
}

export interface IssueDelegationCertificateOptions {
  /** base64url 32-byte Ed25519 run public key to certify. */
  run_pubkey: string
  /** Unix ms expiry (MUST). */
  not_after: number
  /** OPTIONAL Unix ms validity start; omitted (not null) when absent. */
  not_before?: number
  /** OPTIONAL 32-lowercase-hex session binding; omitted when absent. */
  context_id?: string
  /** OPTIONAL §6.7.1 capability envelope, carried verbatim. */
  scope?: DelegationScope
}

export interface BuildRunKeyRevocationRecordOptions {
  /** The valid certificate proving the principal–run relationship. */
  certificate: DelegationCertificate
  /** 32-lowercase-hex context the revocation record is committed under. */
  context_id: string
  /** §1.11.5: 'compromise' for a burned sandbox, 'retirement' for clean early wind-down. */
  revocation_reason: 'compromise' | 'retirement'
  /** `sha256:<64-hex>` content_id for the record (§1.2.2). */
  content_id: string
  /** Defaults to `genesisChainRoot(context_id)`; pass a chain tail to append to an existing chain. */
  chain_root?: string
  /** Defaults to Date.now(). */
  timestamp?: number
}

/**
 * The certificate signing input (§1.11.2): UTF-8 bytes of
 * JCS(cert with signature field omitted). Mirrors `canonicalSigningInput`
 * for records; the certificate is not a record, but the byte rule is
 * deliberately identical so no second canonicalization scheme exists.
 */
export function delegationCertSigningInput(
  cert: DelegationCertificate | UnsignedDelegationCertificate,
): Uint8Array {
  const { signature: _, ...unsigned } = cert as DelegationCertificate
  const json = canonicalize(unsigned)
  if (json === undefined) {
    throw new Error('atrib: delegation certificate canonicalization produced undefined')
  }
  return encoder.encode(json)
}

/** Canonical form of a SIGNED certificate (for hashing). */
export function canonicalDelegationCert(cert: DelegationCertificate): Uint8Array {
  const json = canonicalize(cert)
  if (json === undefined) {
    throw new Error('atrib: delegation certificate canonicalization produced undefined')
  }
  return encoder.encode(json)
}

/**
 * cert_hash = "sha256:" + hex(SHA-256(UTF-8(JCS(full signed cert)))) —
 * over the SIGNED bytes, analogous to record_hash (§1.11.2). The stable
 * identifier used by the §1.11.3 record field, §1.11.5 revocation,
 * sidecars, and archive evidence keys.
 */
export function delegationCertHash(cert: DelegationCertificate): string {
  return `sha256:${hexEncode(sha256(canonicalDelegationCert(cert)))}`
}

function isWellFormedKey(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0) return false
  try {
    return base64urlDecode(value).length === 32
  } catch {
    return false
  }
}

/**
 * Validity of a certificate AS DELEGATION EVIDENCE per §1.11.2: both keys
 * well-formed per §1.4.1, `run_pubkey !== principal_key`, and the
 * signature verifies under `principal_key`. Returns the error list
 * (empty = valid). Never throws; malformed input degrades to errors.
 *
 * Error identifiers: 'principal_key_malformed', 'run_pubkey_malformed',
 * 'self_certificate', 'principal_signature_invalid'. An invalid
 * certificate never invalidates any record (the record falls back to
 * depth 0); this check exists so producers can validate at startup per
 * §1.11.10 before stamping or provisioning.
 */
export async function delegationCertErrors(cert: DelegationCertificate): Promise<string[]> {
  const errors: string[] = []
  if (!isWellFormedKey(cert.principal_key)) errors.push('principal_key_malformed')
  if (!isWellFormedKey(cert.run_pubkey)) errors.push('run_pubkey_malformed')
  if (errors.length > 0) return errors
  if (cert.run_pubkey === cert.principal_key) {
    return ['self_certificate']
  }
  try {
    const pub = base64urlDecode(cert.principal_key)
    const sig = base64urlDecode(cert.signature)
    if (sig.length !== 64 || !(await ed.verifyAsync(sig, delegationCertSigningInput(cert), pub))) {
      errors.push('principal_signature_invalid')
    }
  } catch {
    errors.push('principal_signature_invalid')
  }
  return errors
}

/**
 * Issue a delegation certificate (§1.11.1 / §1.11.2): the principal seed
 * signs `{run_pubkey, scope, not_after, context_id?}` over the JCS
 * signing input. The construction is byte-identical to the
 * spec/conformance/delegation-certificates/ corpus generator: optional
 * fields are omitted (never null) so absence changes the canonical form.
 *
 * Issuance is an explicit operator/host action off the primary tool-call
 * path, so invalid input throws (with the `atrib:` prefix). In
 * particular a self-certificate (`run_pubkey === principal_key`) is
 * refused at issuance because verifiers MUST reject it as evidence.
 */
export async function issueDelegationCertificate(
  principalSeed: Uint8Array,
  options: IssueDelegationCertificateOptions,
): Promise<DelegationCertificate> {
  if (!(principalSeed instanceof Uint8Array) || principalSeed.length !== 32) {
    throw new Error('atrib: principal seed must be a 32-byte Ed25519 seed (§1.4.1)')
  }
  if (!isWellFormedKey(options.run_pubkey)) {
    throw new Error('atrib: run_pubkey must be a base64url 32-byte Ed25519 public key (§1.4.1)')
  }
  if (!Number.isInteger(options.not_after) || options.not_after <= 0) {
    throw new Error('atrib: not_after must be a positive Unix-ms integer (§1.11.1)')
  }
  if (options.not_before !== undefined) {
    if (!Number.isInteger(options.not_before) || options.not_before < 0) {
      throw new Error('atrib: not_before must be a non-negative Unix-ms integer (§1.11.1)')
    }
    if (options.not_before > options.not_after) {
      throw new Error('atrib: not_before must not exceed not_after (§1.11.1)')
    }
  }
  if (options.context_id !== undefined && !CONTEXT_ID_PATTERN.test(options.context_id)) {
    throw new Error('atrib: context_id must be exactly 32 lowercase hex chars (§1.11.1)')
  }

  const principalKey = base64urlEncode(await getPublicKey(principalSeed))
  if (options.run_pubkey === principalKey) {
    throw new Error(
      'atrib: refusing to issue a self-certificate (run_pubkey === principal_key, §1.11.2)',
    )
  }

  // Field insertion order matches the JCS lexicographic order for
  // readability in mirrors and fixtures; JCS itself re-sorts regardless.
  const unsigned: UnsignedDelegationCertificate = {
    cert_type: DELEGATION_CERT_TYPE,
    ...(options.context_id !== undefined ? { context_id: options.context_id } : {}),
    not_after: options.not_after,
    ...(options.not_before !== undefined ? { not_before: options.not_before } : {}),
    principal_key: principalKey,
    run_pubkey: options.run_pubkey,
    ...(options.scope !== undefined ? { scope: options.scope } : {}),
  }
  const sig = await ed.signAsync(delegationCertSigningInput(unsigned), principalSeed)
  return { ...unsigned, signature: base64urlEncode(sig) }
}

/**
 * Stamp `delegation_cert_hash` onto a GENESIS record body (§1.11.3 role 1)
 * before the existing signing flow (`signRecord` / `handleEmit` /
 * middleware) signs it. This introduces NO new signing path: the caller
 * stamps the unsigned body, then signs exactly as before; JCS slots the
 * field between `creator_key` and `event_type` and its presence changes
 * the signature, exactly like `session_token` (§1.3).
 *
 * Degradation (§5.8 / §1.11.10): this function NEVER throws. Every
 * failure — non-genesis record, malformed hash, a certificate that does
 * not cover the record's own creator_key, an expired certificate, an
 * invalid record shape — is logged with the `atrib:` prefix and the
 * record is returned UNCHANGED so signing proceeds without the field.
 * Records remain valid; the verifier simply sees an uncertified run key.
 *
 * Pass either the full certificate (preferred; enables the coverage and
 * expiry checks) or a pre-computed `sha256:<64-hex>` cert hash.
 */
export function withDelegationCertHash<T extends AtribRecord>(
  record: T,
  certificate: DelegationCertificate | string,
): T & { delegation_cert_hash?: string } {
  try {
    if (typeof record !== 'object' || record === null) {
      console.warn('atrib: withDelegationCertHash received a non-object record; skipping stamp')
      return record
    }
    if (typeof record.context_id !== 'string' || record.chain_root !== genesisChainRoot(record.context_id)) {
      console.warn(
        'atrib: delegation_cert_hash is genesis-record-only (§1.11.3); record is not the context genesis, signing without the field',
      )
      return record
    }

    let hash: string
    if (typeof certificate === 'string') {
      hash = certificate
    } else {
      // §1.11.3 role 1: the field commits the genesis signer's OWN run key.
      if (certificate.run_pubkey !== record.creator_key) {
        console.warn(
          'atrib: delegation certificate does not cover this record\'s creator_key (§1.11.3), signing without the field',
        )
        return record
      }
      if (
        typeof record.timestamp === 'number' &&
        Number.isFinite(record.timestamp) &&
        record.timestamp > certificate.not_after
      ) {
        console.warn(
          'atrib: delegation certificate is expired for this record\'s timestamp (§1.11.10), signing without the field',
        )
        return record
      }
      hash = delegationCertHash(certificate)
    }

    if (!DELEGATION_CERT_HASH_PATTERN.test(hash)) {
      console.warn(
        'atrib: delegation_cert_hash must be "sha256:" + 64 lowercase hex (§1.11.3), signing without the field',
      )
      return record
    }

    // Insert the field directly after `creator_key` so debug-form JSON
    // reflects the JCS lexicographic slot (creator_key <
    // delegation_cert_hash < event_type). JCS re-sorts at signing time
    // regardless, so this is presentation, not correctness.
    const out: Record<string, unknown> = {}
    let inserted = false
    for (const [key, value] of Object.entries(record)) {
      out[key] = value
      if (!inserted && key === 'creator_key') {
        out[FIELD_NAME] = hash
        inserted = true
      }
    }
    if (!inserted) out[FIELD_NAME] = hash
    return out as unknown as T & { delegation_cert_hash: string }
  } catch (err) {
    console.warn('atrib: withDelegationCertHash failed, signing without the field', err)
    return record
  }
}

/**
 * Build and sign a run-key revocation record per §1.11.5 (§1.9.2 signing
 * rule 3): a `key_revocation` record retiring `certificate.run_pubkey`,
 * signed by the PRINCIPAL, carrying `delegation_cert_hash` referencing
 * the certificate that proves the principal–run relationship. Verifiers
 * resolve that certificate — valid per §1.11.2, `run_pubkey ===
 * revoked_key`, `principal_key === creator_key` — before accepting the
 * revoker, so this builder enforces the same preconditions at build time.
 *
 * Signing goes through the existing `signRecord` primitive; the extra
 * fields ride the record body and are covered by the signature via JCS
 * (canonical order: creator_key < delegation_cert_hash < event_type,
 * with revoked_key / revocation_reason in their alphabetical slots per
 * §1.9.1).
 *
 * This is an explicit principal-side action off the primary tool-call
 * path, so invalid input throws (with the `atrib:` prefix).
 */
export async function buildRunKeyRevocationRecord(
  principalSeed: Uint8Array,
  options: BuildRunKeyRevocationRecordOptions,
): Promise<RunKeyRevocationRecord> {
  if (!(principalSeed instanceof Uint8Array) || principalSeed.length !== 32) {
    throw new Error('atrib: principal seed must be a 32-byte Ed25519 seed (§1.4.1)')
  }
  if (!CONTEXT_ID_PATTERN.test(options.context_id)) {
    throw new Error('atrib: context_id must be exactly 32 lowercase hex chars (§1.2.1)')
  }
  if (options.revocation_reason !== 'compromise' && options.revocation_reason !== 'retirement') {
    throw new Error(
      "atrib: run-key revocation_reason must be 'compromise' or 'retirement' (§1.11.5)",
    )
  }
  const certificateErrors = await delegationCertErrors(options.certificate)
  if (certificateErrors.length > 0) {
    throw new Error(
      `atrib: certificate is invalid as delegation evidence (${certificateErrors.join(', ')}); verifiers would reject the revocation (§1.11.5)`,
    )
  }
  const principalKey = base64urlEncode(await getPublicKey(principalSeed))
  if (options.certificate.principal_key !== principalKey) {
    throw new Error(
      'atrib: signing seed is not the certificate principal; verifiers would reject the revoker (§1.11.5)',
    )
  }

  const unsigned: RunKeyRevocationRecord = {
    spec_version: 'atrib/1.0',
    content_id: options.content_id,
    creator_key: principalKey,
    chain_root: options.chain_root ?? genesisChainRoot(options.context_id),
    delegation_cert_hash: delegationCertHash(options.certificate),
    event_type: EVENT_TYPE_KEY_REVOCATION_URI,
    context_id: options.context_id,
    timestamp: options.timestamp ?? Date.now(),
    revoked_key: options.certificate.run_pubkey,
    revocation_reason: options.revocation_reason,
    signature: '',
  }
  return (await signRecord(unsigned, principalSeed)) as RunKeyRevocationRecord
}
