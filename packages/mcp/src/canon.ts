// SPDX-License-Identifier: Apache-2.0

/**
 * JCS canonicalization (RFC 8785) for atrib records.
 *
 * Uses the `canonicalize` npm package. The signing input is the JCS
 * serialization of the record with the `signature` field removed.
 */

import canonicalize from 'canonicalize'
import type { AtribRecord } from './types.js'

const encoder = new TextEncoder()

/**
 * Produce the canonical signing input for an attribution record (§1.3).
 * Removes the `signature` field, applies JCS serialization, returns UTF-8 bytes.
 */
export function canonicalSigningInput(record: AtribRecord): Uint8Array {
  const { signature: _, ...unsigned } = record
  const json = canonicalize(unsigned)
  if (json === undefined) {
    throw new Error('atrib: canonicalization produced undefined')
  }
  return encoder.encode(json)
}

/**
 * Produce the canonical form of a signed record (for hashing).
 * Includes the signature field.
 */
export function canonicalRecord(record: AtribRecord): Uint8Array {
  const json = canonicalize(record)
  if (json === undefined) {
    throw new Error('atrib: canonicalization produced undefined')
  }
  return encoder.encode(json)
}

/**
 * Cross-attestation canonical signing input per spec §1.7.6 (D052).
 *
 * Each entry in a transaction record's `signers` array signs over the
 * SAME bytes: the JCS serialization of the record with `signers` set to
 * `[]` (empty array) and the top-level `signature` field omitted. This
 * ensures all signers commit to identical content; verifiers reproduce
 * these bytes once and check each signer's signature against them.
 *
 * Use only on transaction records (event_type =
 * https://atrib.dev/v1/types/transaction). On other event types, the
 * standard `canonicalSigningInput` applies.
 */
export function canonicalCrossAttestationInput(record: AtribRecord): Uint8Array {
  const { signature: _, signers: __, ...rest } = record
  const withEmptySigners = { ...rest, signers: [] as Record<string, unknown>[] }
  const json = canonicalize(withEmptySigners)
  if (json === undefined) {
    throw new Error('atrib: cross-attestation canonicalization produced undefined')
  }
  return encoder.encode(json)
}
