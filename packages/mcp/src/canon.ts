// SPDX-License-Identifier: Apache-2.0

/**
 * JCS canonicalization (RFC 8785) for Atrib records.
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
